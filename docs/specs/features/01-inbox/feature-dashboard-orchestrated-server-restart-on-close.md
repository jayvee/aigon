# Feature: dashboard-orchestrated-server-restart-on-close

## Summary
When `feature-close` is invoked from the dashboard for a feature whose merge touches `lib/*.js`, the dashboard server self-immolates. The cause is feature 228's `restartServerIfLibChanged` phase calling `aigon server restart` via `execSync` from inside the close subprocess: that handler kills the running dashboard (its own grandparent), then tries to become the new server in-process — but its stdio was inherited through the `spawnSync → execSync` chain, so its file descriptors point at pipes terminating at the now-dead grandparent. The first `console.log` from `runDashboardServer` hits **EPIPE** and the replacement server crashes. End state: dashboard dead, frontend toast showing **"Proxy error: socket hang up"** for an action that actually succeeded, no auto-restart of any kind. This is a hard blocker for using the dashboard as the primary aigon-on-aigon driver — every other close merges `lib/*.js` and trips the trap.

This feature fixes it by moving the restart **out of the close subprocess and into the dashboard server itself**: the close child records that a restart is needed (instead of triggering it), the dashboard writes the success response to the frontend first, then spawns a fully-detached restart and exits cleanly. Includes belt-and-braces protections (`proxyTimeout`, in-flight action dedupe) so a future blocking call can't reproduce the same class of bug.

Reproduced live: feature 233 close on aigon, 2026-04-07. See the diagnosis in this conversation for the full timeline.

## User Stories
- [ ] As an aigon-on-aigon developer, I can close features from the dashboard whose merges include `lib/*.js` changes, and the dashboard auto-restarts cleanly without me seeing a fake error toast.
- [ ] As a dashboard user, when I click Close I either see a success confirmation OR a real error — never a "socket hang up" false negative for a close that actually completed.
- [ ] As a dashboard user, when the backend restarts after a lib change, the UI shows a brief "Reloading backend…" indicator and reconnects to the new server within ~2 seconds. I never have to manually reload the page or run `aigon server start`.
- [ ] As a developer, double-clicking "Close" on the same feature does not dispatch the action twice in parallel.

## Acceptance Criteria
- [ ] Closing feature 233 (or any equivalent reproducer where the merge touches `lib/*.js`) from the dashboard completes with a green success toast. The dashboard restarts within 2 seconds. The frontend reconnects automatically. Verified manually against a test feature in aigon itself.
- [ ] `aigon server status` shows `running` (not `stopped`) after a dashboard-initiated close that triggered a restart.
- [ ] No "Proxy error: socket hang up" toast appears for successful closes, even when the close triggers a server restart.
- [ ] The dashboard log file shows continuous entries across the restart boundary — old PID's last log lines, then new PID's startup banner — with no more than ~2 seconds of gap.
- [ ] `restartServerIfLibChanged` (`lib/feature-close.js:1003`) detects it's running inside a dashboard-spawned subprocess and **records the need for restart instead of executing it**. Detection is via the `AIGON_INVOKED_BY_DASHBOARD=1` env var the dashboard sets when spawning action subprocesses.
- [ ] When invoked from a normal terminal (no env var set), `restartServerIfLibChanged` keeps its existing behaviour — calls `aigon server restart` and exits cleanly. Existing CLI users see no regression.
- [ ] The "restart needed" signal flows from the close child back to the dashboard via stdout marker, exit-code metadata, or a flag file at `.aigon/server/restart-needed.json` — implementer's choice, but it must be unambiguous and survive `spawnSync` capture.
- [ ] `runDashboardInteractiveAction` in `lib/dashboard-server.js:1014` sets `AIGON_INVOKED_BY_DASHBOARD=1` in the spawned child's env.
- [ ] `/api/action` handler checks the result for the "restart needed" signal. If set: writes the success response to the frontend, flushes, broadcasts a `{type:'server-restarting'}` WebSocket event to all connected clients, then schedules a self-restart on next tick (~100ms delay).
- [ ] The self-restart spawns a **fully detached** subprocess: `spawn(execPath, ['aigon-cli.js','server','restart'], { detached: true, stdio: 'ignore' }).unref()`. After `unref()`, the dashboard process calls `process.exit(0)` so the new server can claim the port without contention.
- [ ] The detached restarter does not depend on the dying dashboard's stdio in any way. Verified by killing the dashboard mid-spawn and confirming the replacement still comes up.
- [ ] Frontend WebSocket client handles `{type:'server-restarting'}` by showing a brief banner ("Reloading backend…") and reconnecting on close. Reconnect loop already exists or is added with backoff capped at 2s.
- [ ] **In-flight action dedupe**: a `Set<string>` keyed by `${repoPath}|${action}|${args.join(',')}` rejects parallel dispatches with HTTP 409. Cleared when the child exits (on either success or failure). Prevents the user double-clicking Close from triggering two parallel close subprocesses.
- [ ] **Belt-and-braces** — `lib/aigon-proxy.js:61` sets explicit `proxyTimeout: 5*60*1000` and `timeout: 5*60*1000` on the `http-proxy` instance. Comment explains: "Long actions (feature-close on a large merge) can take 60+ seconds; default timeouts mask successful actions as failures."
- [ ] No regression for terminal-mode `feature-close`: running `aigon feature-close <id>` directly from a shell still auto-restarts the live server and the user sees "🔄 Restarting aigon server…".
- [ ] **Regression test 1**: `tests/dashboard-restart-after-close.test.js` — spin up a fake dashboard server, dispatch a synthetic action that returns the "restart needed" marker, assert (a) the success response is written to the client BEFORE the restart spawn fires, (b) the spawned restart has `detached: true, stdio: 'ignore'`, (c) `process.exit(0)` is scheduled. Comment names the regression: "feature 233 close from dashboard: lib/* merge triggered restartServerIfLibChanged → execSync killed grandparent → EPIPE death spiral".
- [ ] **Regression test 2**: `restartServerIfLibChanged` with `AIGON_INVOKED_BY_DASHBOARD=1` set never calls the `restartServer` injected dep, and instead returns the marker. Without the env var, it calls `restartServer` as before.
- [ ] **Regression test 3**: in-flight action dedupe rejects a duplicate POST to `/api/action` with the same key.
- [ ] Test budget stays under 2,000 LOC (`bash scripts/check-test-budget.sh`). Delete any older tests this subsumes.
- [ ] After backend edits, restart the dashboard server (`aigon server restart`) and verify the full close-from-dashboard flow against a test feature in `~/src/brewboard` or similar. Take a Playwright screenshot of the success toast + reload banner per CLAUDE.md frontend-design rule (only if there are visual changes — the WebSocket banner counts).
- [ ] `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh` all pass before push.

## Validation
```bash
node -c aigon-cli.js
node -c lib/dashboard-server.js
node -c lib/feature-close.js
node -c lib/commands/feature.js
node -c lib/aigon-proxy.js
npm test
```

## Technical Approach

### Why the current code self-destructs

`lib/feature-close.js:1003` `restartServerIfLibChanged` is invoked from `lib/commands/feature.js:1977-2003`. It executes the restart via `execSync`:

```js
restartServer: () => {
    execSync(
        `node "${path.join(target.repoPath, 'aigon-cli.js')}" server restart`,
        { stdio: 'inherit', cwd: target.repoPath }
    );
},
```

When the close subprocess (`Y`) was itself spawned by the dashboard (`X`) via `spawnSync` with `stdio: ['ignore', 'pipe', 'pipe']`, then `Y`'s stdout/stderr are pipes terminating at `X`. `execSync('aigon server restart', { stdio: 'inherit' })` makes the grandchild (`Z`) inherit `Y`'s stdio — pipes still terminating at `X`.

`Z` runs the `server restart` handler at `lib/commands/infra.js:1248-1283`. That handler:

1. Calls `stopDashboardProcess(existing)` (`lib/server-runtime.js:53`) → `process.kill(X, 'SIGTERM')`. **X dies.** The pipes between `X` and `Y/Z` are now broken at the read end.
2. Calls `launchDashboardServer(...)` which calls `runDashboardServer(port, ...)` **in-process**. `Z` is supposed to *become* the new server.
3. `runDashboardServer` immediately starts logging via `console.log` (poll completes, heartbeat memory, etc.). The first write to the broken pipe raises **EPIPE**, which Node surfaces as an uncaught exception. **Z dies.**

End state: `X` killed by `Z`, `Z` killed by EPIPE, `Y` orphaned and about to exit, no server running, no log entries explaining anything.

This only happens when `feature-close` runs as a child of the dashboard — running from a normal terminal works because `Y`'s stdio is the user's TTY and stays valid after `X` dies.

### The fix — three coordinated changes

#### Change 1 — close child records the need for restart, never triggers it

`lib/dashboard-server.js:1014` `runDashboardInteractiveAction` — set the env var:

```js
const result = spawnSync(process.execPath, cliArgs, {
    cwd: parsed.repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, AIGON_INVOKED_BY_DASHBOARD: '1' },
});
```

`lib/feature-close.js:1003` `restartServerIfLibChanged` — branch on the env var:

```js
function restartServerIfLibChanged(target, deps) {
    const { getChangedLibFiles, /* ... */ writeRestartMarker, log } = deps;
    /* existing pre-checks unchanged: cfg.featureClose.autoRestartServer === false → return */
    /* getChangedLibFiles → if 0, return */
    /* getServerRegistryEntry → if not alive, return */

    if (process.env.AIGON_INVOKED_BY_DASHBOARD === '1') {
        log(`🔄 Recording restart need (${changed.length} lib/*.js file(s) changed) — dashboard will restart itself.`);
        writeRestartMarker({ reason: 'lib-changed', files: changed, at: new Date().toISOString() });
        return;
    }

    log(`🔄 Restarting aigon server (${changed.length} lib/*.js file(s) changed)...`);
    try { restartServer(); } catch (e) { warn(...); }
}
```

`writeRestartMarker` writes JSON to `.aigon/server/restart-needed.json` (atomic write — temp file + rename). The dashboard reads this file when the spawnSync returns.

**Why a flag file rather than stdout marker**: stdout is already used for action output the user might see. A file is unambiguous, survives any output formatting weirdness, and is trivially atomic. The dashboard deletes it after consuming.

#### Change 2 — dashboard orchestrates its own restart after responding

`lib/dashboard-server.js:1942-1998` `/api/action` handler — after the existing response write:

```js
res.writeHead(200, { /* ... */ });
res.end(JSON.stringify(result));

// Check for restart marker AFTER responding so the user sees the success toast.
const restartMarkerPath = path.join(parsed.repoPath, '.aigon', 'server', 'restart-needed.json');
if (fs.existsSync(restartMarkerPath)) {
    let marker = null;
    try { marker = JSON.parse(fs.readFileSync(restartMarkerPath, 'utf8')); } catch (_) {}
    try { fs.unlinkSync(restartMarkerPath); } catch (_) {}
    if (marker) {
        log(`🔄 Lib files changed (${marker.files.length}) — scheduling dashboard self-restart`);
        broadcastWebSocket({ type: 'server-restarting', reason: marker.reason, at: marker.at });
        setTimeout(() => {
            const child = spawn(
                process.execPath,
                [path.join(__dirname, '..', 'aigon-cli.js'), 'server', 'restart'],
                { detached: true, stdio: 'ignore', cwd: process.cwd() }
            );
            child.unref();
            setTimeout(() => process.exit(0), 50);
        }, 100);
    }
}
```

The 100ms delay gives the in-flight HTTP response time to flush to the proxy. The 50ms inner delay gives `unref()` time to take effect before exit.

`detached: true, stdio: 'ignore'` is the **critical** combo — `detached` means the child gets its own process group (so killing the parent doesn't cascade), `stdio: 'ignore'` means no fd inheritance from the dying parent (so no EPIPE possible). `unref()` removes the child from the parent's reference count so the parent can exit even with the child running.

#### Change 3 — in-flight action dedupe

In `runDashboardServer` scope, add:

```js
const inflightActions = new Map(); // key → { startedAt, action }
```

In the `/api/action` handler, before `spawnSync`:

```js
const inflightKey = `${parsed.repoPath}|${parsed.action}|${parsed.args.join(',')}`;
if (inflightActions.has(inflightKey)) {
    res.writeHead(409, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: `Action already in flight: ${parsed.action}`, since: inflightActions.get(inflightKey).startedAt }));
    return;
}
inflightActions.set(inflightKey, { startedAt: new Date().toISOString(), action: parsed.action });

try {
    const result = runDashboardInteractiveAction({ /* ... */ });
    /* existing response handling */
} finally {
    inflightActions.delete(inflightKey);
}
```

This prevents the double-click footgun. It does **not** address the broader event-loop blocking concern (`spawnSync` still freezes the server during the close), but that's a separate concern that becomes moot once the false-negative toast is gone — users won't be tempted to double-click in panic.

#### Change 4 — proxy timeout (belt-and-braces)

`lib/aigon-proxy.js:61`:

```js
// Long actions (feature-close on a large merge) can take 60+ seconds.
// Default http-proxy timeouts are too short for legitimate work and mask
// successful actions as "Proxy error: socket hang up". 5 minutes is generous
// enough for any realistic action and tight enough that genuinely hung
// connections still time out eventually.
const proxy = httpProxy.createProxyServer({
    proxyTimeout: 5 * 60 * 1000,
    timeout: 5 * 60 * 1000,
});
```

This is defence-in-depth — even after Changes 1-3, if some future code path blocks the event loop or holds a connection open for too long, we want a graceful timeout error, not a kernel-driven socket reset.

#### Change 5 — frontend WebSocket reload UI

The dashboard frontend (probably `templates/dashboard/index.html` or wherever the WS handler lives) needs to handle the new event:

```js
ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'server-restarting') {
        showBanner('Reloading backend…', { kind: 'info', auto: false });
        // Existing reconnect loop will pick up the new server when it comes online
    }
    /* ... existing handlers */
});
```

The reconnect loop should already exist for normal disconnects; if it doesn't, add one with exponential backoff capped at 2s. When reconnect succeeds, hide the banner.

Per CLAUDE.md frontend-design rule: invoke `Skill(frontend-design)` before adding the banner UI. Verify with Playwright screenshot.

### Files touched
- `lib/dashboard-server.js` — env var on spawnSync, restart marker check after response, in-flight dedupe, WS broadcast
- `lib/feature-close.js` — env-var branch in `restartServerIfLibChanged`, `writeRestartMarker` helper
- `lib/commands/feature.js` — wire `writeRestartMarker` into the deps object passed to `restartServerIfLibChanged`
- `lib/aigon-proxy.js` — `proxyTimeout`/`timeout` config
- `templates/dashboard/index.html` (or wherever WS handler lives) — `server-restarting` event handling, reload banner
- `tests/dashboard-restart-after-close.test.js` (new) — regression coverage per acceptance criteria

### Out-of-band recovery for users already affected

After the fix ships, anyone whose dashboard died from this bug just needs `aigon server start` to bring it back. The state isn't corrupted. Worth a one-line note in the closeout doc.

## Dependencies
- depends_on: fix-solo-drive-close-half-closed-state (feature 233 — already done; this feature builds on the same area but doesn't strictly need it)

## Out of Scope
- Replacing `spawnSync` with async `spawn` for `/api/action` dispatch. That's a separate concern (event-loop responsiveness during long actions). It became less urgent once the false-negative toast is fixed by this feature, since that was the user-visible symptom of "frozen" UI. Worth its own feature later if responsiveness during a 60s close is still annoying.
- Hot-reload of `lib/*.js` modules without restarting the server process. Tempting but requires invalidating Node's require cache and is fragile. The full process restart is fine.
- Cancellation of in-flight actions ("stop the close I just started"). Useful but separable.
- Generalising the restart marker to other CLI commands that might need to restart the server (`aigon update`, `aigon install-agent`). The current `restartServerIfLibChanged` is the only known entry point; other commands can adopt the same pattern if/when they need it.
- Replacing `http-proxy` with a different library.

## Open Questions
- Should the dashboard self-restart phase apply to **any** action that records a restart marker, or specifically to `feature-close`? Probably any — the marker is generic and other commands may use it later. Current scope: any action result that comes with a marker.
- Should the in-flight dedupe key include user/session info? Probably not — dashboard is single-user today. Revisit if multi-user support arrives.
- Where should `.aigon/server/restart-needed.json` live — at the repo root or in `~/.aigon/server/`? **Repo root** keeps it scoped to the project and avoids cross-project bleed when running multiple aigon instances. The dashboard already knows the `repoPath` of the action it dispatched, so it can look up the marker at `${repoPath}/.aigon/server/restart-needed.json` deterministically.
- Should the restart-needed marker also include the merge SHA so the new server can log "restarted to pick up commit X"? Nice-to-have, not required.

## Related
- Research:
- Original incident: feature 233 close on aigon, 2026-04-07 — full diagnostic timeline in conversation history.
- Related feature: feature 228 (`feature-close auto-restart-server-on-lib-changes`) — introduced the auto-restart phase that backfires when invoked from the dashboard. This feature does NOT remove that behaviour for terminal users; it only neutralises the self-immolation when the dashboard is the caller.
- Related feature: feature 233 (`fix-solo-drive-close-half-closed-state`) — different bug, same area; both fixes can coexist.
- Affected files:
  - `lib/dashboard-server.js:1014-1085` (runDashboardInteractiveAction)
  - `lib/dashboard-server.js:1942-1998` (/api/action handler)
  - `lib/feature-close.js:1003-1035` (restartServerIfLibChanged)
  - `lib/commands/feature.js:1977-2003` (close handler restart wiring)
  - `lib/server-runtime.js:53-70` (stopDashboardProcess — used by `aigon server restart`)
  - `lib/aigon-proxy.js:61-67` (proxy config)
- Reproducer: any feature whose merge to main touches `lib/*.js`, closed from the dashboard.
