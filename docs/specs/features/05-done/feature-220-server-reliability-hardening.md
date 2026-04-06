# Feature: server-reliability-hardening

## Summary

Close the remaining reliability gaps in the aigon server lifecycle without destabilising what already works. The server already has signal handlers, `server.close()` graceful shutdown, per-sweep error handling, and launchd/systemd restart-on-crash. This feature adds the **small number** of missing pieces that have bitten us in practice: SIGKILL fallback for the port-holder cleanup, backoff/jitter for launchd's restart loop, supervisor-loop heartbeat detection, and post-restart verification in `aigon update`. Every change must be additive — no existing code path should regress.

## Safety principle (non-negotiable)

**This feature must not make the server more brittle under any circumstance.** The existing code works. Every change is a targeted addition that makes a specific failure mode softer, not a rewrite of working code. Each acceptance criterion must be individually testable and reversible. If any change shows any regression in manual lifecycle testing (stop/start/restart/update), it gets reverted, not patched.

## User Stories

- [ ] As a developer, when `aigon server start` runs but another process is stuck on port 4100 and ignoring SIGTERM, the port is force-freed via SIGKILL after a short grace period, instead of failing with EADDRINUSE
- [ ] As a developer, if the supervisor loop silently stops sweeping (e.g. stalled I/O, unhandled rejection), `aigon server status` tells me — I don't discover it three days later when card statuses are all stale
- [ ] As a developer, when `aigon update` restarts the server via launchd, I see a clear ✅ or ❌ based on whether the new process actually came up and is serving requests — not a silent "🔄 Server restarted via system service" that might be a lie
- [ ] As a developer, if the persistent server crashes on startup (e.g. syntax error in a `lib/*.js` file I just edited), launchd's KeepAlive loop doesn't pin a CPU core respawning it 20 times a second — there's a small backoff so I have time to see logs and fix the issue

## Acceptance Criteria

### AC1 — SIGKILL fallback in killPortHolder
- [ ] `lib/server-runtime.js:killPortHolder` sends SIGTERM, waits up to 1s (unchanged)
- [ ] If the process is still alive after the SIGTERM grace period, sends SIGKILL and waits up to another 500ms
- [ ] Logs `[server] force-killed stale port holder PID <n>` when SIGKILL is used (visible to user)
- [ ] If the process is STILL alive after SIGKILL (shouldn't happen in practice — defunct zombies), returns without throwing; the subsequent `server.listen()` will fail with its own EADDRINUSE and the existing error handler takes over
- [ ] Never SIGKILL a PID matching `process.pid` (existing guard preserved)
- [ ] Manual test: run `sleep 1000 &` on port 4100 in one terminal using `nc -l 4100`, then `aigon server restart` — should succeed without EADDRINUSE

### AC2 — Supervisor heartbeat freshness check
- [ ] `lib/supervisor.js:getSupervisorStatus()` already returns `lastSweepAt` — unchanged
- [ ] Add a derived field `sweepHealth` to the returned object with values `"healthy"` (sweep within last 90s), `"stale"` (within 5min), `"dead"` (older than 5min or never)
- [ ] `aigon server status` command in `lib/commands/infra.js` reads `sweepHealth` and displays it (🟢/🟡/🔴) alongside the existing "Supervisor: running" line
- [ ] The status check does **not** change engine state or trigger any automatic restart — it is strictly informational (per existing "supervisor is observe-only" rule in CLAUDE.md)
- [ ] Backward compatible: if `sweepHealth` is missing (older server talking to newer CLI or vice versa), status command falls back to the current behavior
- [ ] Manual test: `aigon server status` shows 🟢 within seconds of start; stays 🟢 during normal operation

### AC3 — Post-restart verification in `aigon update`
- [ ] When `lib/commands/setup.js` calls `restartService()` during an update, it follows up with a health check: up to 10 attempts × 500ms polling the HTTP server's `/api/supervisor/status` endpoint (or `/` if the status endpoint is not reachable)
- [ ] On success: prints `✅ Server restarted and responding on port <N>`
- [ ] On timeout: prints `⚠️  Server was restarted via launchd/systemd but did not respond within 5s — check \`aigon server status\` and logs at ~/.aigon/logs/`
- [ ] Update itself does NOT fail if the health check times out — restart is still best-effort (existing behavior preserved)
- [ ] Same verification applies to the non-persistent path (kill + detached spawn) for consistency
- [ ] Manual test: `aigon update` from the aigon repo — should print ✅ within 2-3s

### AC4 — Crash-loop backoff for launchd
- [ ] `lib/supervisor-service.js` macOS plist gains a `ThrottleInterval` key set to **10** (launchd standard; minimum enforced respawn delay in seconds)
- [ ] Linux systemd unit already has `RestartSec=5` — increase to **10** for consistency and add `StartLimitIntervalSec=60` + `StartLimitBurst=5` so systemd gives up after 5 rapid crashes (rather than pinning a core forever)
- [ ] If the service is already installed, the existing plist/unit is NOT silently rewritten — installation flow continues to use `installLaunchd`/`installSystemd` which already `unload`+`load` atomically, so reinstalling with `aigon server start --persistent` picks up the new settings
- [ ] Document the new behavior in `site/content/reference/commands/infra/server.mdx` troubleshooting section
- [ ] Manual test: introduce a deliberate crash (e.g. throw at startup) and observe launchd respawn at 10s intervals instead of immediately

## Validation

```bash
# Syntax + tests
node -c lib/server-runtime.js
node -c lib/supervisor.js
node -c lib/supervisor-service.js
node -c lib/commands/infra.js
node -c lib/commands/setup.js
node -c lib/dashboard-server.js
npm test

# End-to-end lifecycle smoke (run manually, not automated)
aigon server status         # expect sweepHealth 🟢
aigon server restart        # expect success, fresh PID
aigon server status         # expect sweepHealth 🟢 again
```

## Technical Approach

### What is NOT changing

This feature explicitly does **not** touch:

- The HTTP server shutdown handler in `dashboard-server.js:2998-3008` — it already drains + force-exits after 3s, which is correct
- The supervisor sweep loop in `supervisor.js:329` — the outer `.catch()` + per-entity try-catch are already in place
- The launchd/systemd `KeepAlive` / `Restart=on-failure` mechanics themselves — we add backoff, we don't change the restart trigger
- The signal delegation in `aigon server stop/restart` — that work was done earlier and is shipped
- The proxy registry protocol between server and proxy — unchanged
- `resolveDashboardPort()` — unchanged (the port is already centralised via `getConfiguredServerPort()`)

### AC1 — killPortHolder SIGKILL fallback

Smallest possible change. Existing function in `lib/server-runtime.js` has a SIGTERM + 1s poll loop. Add:

```js
// After the existing SIGTERM poll loop, if the process is still alive:
try { process.kill(n, 0); /* still alive */ } catch (_) { continue; /* gone */ }
console.log(`[server] force-killing stale port holder PID ${n}`);
try { process.kill(n, 'SIGKILL'); } catch (_) {}
// Second poll: up to 500ms
for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 100));
    try { process.kill(n, 0); } catch (_) { break; }
}
```

Total addition: ~8 lines. No change to any other code path. If the process is already dead (normal case), the SIGKILL block is skipped entirely.

### AC2 — sweepHealth derivation

Pure derivation from `lastSweepAt` — no new state, no new I/O. In `supervisor.js`:

```js
function getSupervisorStatus() {
    const lastMs = lastSweepAt ? Date.parse(lastSweepAt) : null;
    const ageMs = lastMs ? Date.now() - lastMs : null;
    let sweepHealth = 'dead';
    if (ageMs !== null) {
        if (ageMs < 90 * 1000) sweepHealth = 'healthy';
        else if (ageMs < 5 * 60 * 1000) sweepHealth = 'stale';
    }
    return {
        running: intervalHandle !== null,
        lastSweepAt,
        sweepCount,
        intervalMs: SWEEP_INTERVAL_MS,
        trackedAgents: livenessData.size,
        sweepHealth,  // NEW
    };
}
```

In `infra.js` server status command, read `sweepHealth` with a default of the current "running" boolean logic so older servers are unaffected.

### AC3 — Post-restart health check

New helper in `lib/server-runtime.js`:

```js
async function waitForServerHealthy(port, timeoutMs = 5000) {
    const http = require('http');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const ok = await new Promise(resolve => {
            const req = http.get({ host: '127.0.0.1', port, path: '/api/supervisor/status', timeout: 500 },
                res => { res.resume(); resolve(res.statusCode === 200); });
            req.on('error', () => resolve(false));
            req.on('timeout', () => { req.destroy(); resolve(false); });
        });
        if (ok) return true;
        await new Promise(r => setTimeout(r, 500));
    }
    return false;
}
```

Called from `setup.js` after `restartService()` — non-blocking, non-fatal, informational only.

### AC4 — launchd/systemd backoff

Two-line change to `installLaunchd()` (add `ThrottleInterval` key) and a few lines to `installSystemd()` (add `StartLimitIntervalSec`, `StartLimitBurst`, bump `RestartSec`). Users with an already-installed service keep working as-is until they re-run `aigon server start --persistent`.

### Testing strategy (how I'll avoid introducing bugs)

Each AC is independently implementable and testable. Implementation order:

1. **AC2 (sweepHealth)** first — purely additive, zero risk, visible via `aigon server status` so we can verify anything else working
2. **AC1 (SIGKILL fallback)** — additive to an existing function, controlled by a runtime condition that skips the new code when the normal path works
3. **AC3 (post-restart verification)** — new helper + one call site, non-fatal on failure
4. **AC4 (backoff)** — only affects newly installed services; existing installs unchanged until reinstalled

After each AC:
- `node -c` syntax checks on every edited file
- `npm test`
- **Manual lifecycle test**: `aigon server status / restart / status / stop / start / status`
- For AC1: deliberate port-holder test (`nc -l 4100` in another terminal)
- For AC4: deliberate startup crash test with the new plist, then revert

If any manual test shows regression, the AC is reverted before moving on. No AC depends on another, so partial shipping is acceptable.

## Dependencies
- None. All work is within existing files; no new modules, no new external dependencies.

## Out of Scope

Explicitly excluded to keep the blast radius small:

- **Configurable server port** (`8eb429b8`) — prep refactor is done, but the behaviour change is still deferred
- **Graceful HTTP request drain beyond 3s** — the existing 3s timeout is a conscious trade-off; extending it risks hanging `aigon server stop`
- **Supervisor auto-restart** — explicitly against the "supervisor is observe-only" rule in CLAUDE.md; sweepHealth is informational only
- **Proxy reliability / EADDRINUSE on the proxy port** — separate concern (Caddy/aigon-proxy is its own module)
- **Rewriting the supervisor loop** — `setInterval` + per-entity try-catch is fine; no architectural changes
- **Changing signal delegation for `aigon server stop/restart`** — already shipped in the earlier fix
- **Launchd/systemd service auto-upgrade on `aigon update`** — users reinstall the service manually if they want the new backoff settings
- **Metrics / telemetry endpoints** — scope creep
- **New tests for existing passing behavior** — we keep the 13 existing tests green; the new functionality is primarily validated by manual lifecycle tests because most of it is system-integration code (launchd, signals, sockets) that's impractical to unit-test

## Open Questions

1. **sweepHealth threshold**: is 90s "healthy" / 5min "dead" the right shape? Sweep interval is 30s, so 90s = "missed up to 2 sweeps". Open to tightening to 60s if that feels better.
2. **AC3 endpoint choice**: should the health check hit `/api/supervisor/status` (HTTP + supervisor alive) or the root `/` (HTTP only)? Preference is the status endpoint — it's a stronger signal — with fallback to `/` if status endpoint isn't yet mounted (older server).
3. **AC4 launchd ThrottleInterval default**: launchd's default ThrottleInterval is 10s already. Setting it explicitly is effectively a no-op on macOS unless we want a larger value. Is 10 enough, or should we go to 30s for the "oh no I just broke startup and need time to fix it" case?

## Related
- Prior work this session: dashboard/server consolidation (`5cd236da`), launchd-aware stop/restart (`b6386dbb`), no auto-open (`281bfd0f`), centralised port (`8a810540`)
- CLAUDE.md rule #4 (restart dashboard after backend edits) — this feature does not change that rule
- CLAUDE.md "supervisor is observe-only" principle — this feature preserves it
