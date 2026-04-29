# Implementation Log: Feature 454 - dashboard-eventloop-stalls-and-modal-parallelise
Agent: cc

## Status
Implemented all 7 ordered changes; activity-gated quota scan + chunked dep-graph rebuild + fingerprint-gated render + parallelised autonomous modal. New dedup-skip test added at tests/integration/quota-mid-run-f446.test.js.

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Planning Context

### ~/.claude/plans/crispy-riding-knuth.md

# Two-feature performance plan — Aigon dashboard

## Context

Three user-visible perf complaints surfaced this session, all rooted in two clusters:

- **Server event-loop blocking.** F446's `quotaMidRun.scanActiveSessions()` runs synchronously inside `pollStatus()` every 10s and per-session calls `tmux capture-pane` (sync). With 10+ live tmux sessions the loop blocks for hundreds of ms to multiple seconds; every `/api/spec`, `/api/status`, and `/api/budget` request stalls behind it. The dependency-graph rebuild has the same shape (~700 sync `readFileSync` per tick). Frontend compounds it: `init.js` re-renders unconditionally every 10s; `showAutonomousModal` does four sequential awaits before showing anything; `spec-drawer.js` has a leftover `console.trace` and an auto-close-on-tab-refocus listener.
- **xterm.js client-side render lag.** `xterm@5.3.0` (legacy unscoped) is paired with `@xterm/addon-*@0.x` (scoped, targets `@xterm/xterm` ≥5.4) — version mismatch. ResizeObserver fires `fitAddon.fit()` ~15× per panel slide-in. `ImageAddon` (sixel) loaded but unused. `lineHeight: 1.4` conflicts with WebGL renderer's integer-cell-height. Server-side, `pty-session-handler.js` only flushes on a 12 ms timer, so big chunks sit waiting.

These ship as **two separate Aigon features**. Feature A first — the server-side stalls block any meaningful measurement of frontend gains.

---

## Feature A — Stop dashboard event-loop stalls + parallelise the autonomous modal

### Ordered changes

1. **`lib/quota-mid-run-detector.js`** — gate per-session `capture-pane` on tmux activity. In `scanActiveSessions` (line 165), before the per-sidecar loop run one `tmux list-sessions -F '#{session_name} #{session_activity}'` via the existing `runTmux` helper. Build `Map<sessionName, activityEpoch>`. Keep a module-level `lastActivityByName: Map<string, number>` cache. For each sidecar: if `current === cached`, `continue` (skip both `tmuxSessionExists` and `capture-pane`). Update the cache after a successful classify. Convert the function to `async`. After every 4 sidecars that DID need a `capture-pane`, `await new Promise(r => setImmediate(r))` so the loop drains.

2. **`lib/dashboard-server.js:1832`** — make `pollStatus` async; `await quotaMidRun.scanActiveSessions(repoPath)`. The `setInterval` already tolerates async callbacks. Existing failure handler stays.

3. **`lib/feature-dependencies.js` + `lib/dashboard-server.js:197`** — yield in dep-graph rebuild. Add a new exported `buildDependencyGraphAsync(paths, utils, featureIndex, { chunkSize = 25 } = {})` to `feature-dependencies.js`: outer loop becomes `for await`; after every `chunkSize` files, `await new Promise(r => setImmediate(r))`. Convert `_rebuildDepGraphAsync` to `async`, await the new builder, write cache on completion. Keep the sync `buildDependencyGraph` exported (used by `tests/integration/feature-dependencies.test.js` and CLI).

4. **`templates/dashboard/js/spec-drawer.js`** — delete `console.trace('openDrawer called:', ...)` (line 114). Delete the entire `visibilitychange` listener block (lines 273-279).

5. **`templates/dashboard/js/init.js`** — gate `render()` on a status fingerprint. Add `function statusFingerprint(data)` that hashes: `summary.{waiting,inProgress,inEval}`, each repo's `(features.length, research.length, feedback.length)`, and per-feature `(id, stage, currentSpecState, agents.map(a => a.id+":"+a.status+":"+(a.idleLadder?.state||'')))`. Stash on `state.lastFingerprint`. In `poll()` (line 439), only call `render()` when the fingerprint changes. Move the `updated-text`/title refresh OUT of the gated branch so the timestamp updates each poll regardless. The settings-view path keeps using `settingsNeedsRerender`.

6. **`lib/agent-registry.js:597`** — extend `getDashboardAgents()` to include default models. Accept `(opts = {})` with `{ globalConfig, projectConfig }`. For each agent, resolve `defaultImplementModel`, `defaultResearchModel`, `defaultEvaluateModel`, `defaultReviewModel` using the same project → global → `DEFAULT_GLOBAL_CONFIG` precedence as `buildDashboardSettingsPayload` (`lib/dashboard-server.js:843-937`). Reuse `getConfigModelValue` already in `dashboard-server.js`. Update the call site at `lib/dashboard-server.js:951` to pass `{ globalConfig, projectConfig }`.

7. **`templates/dashboard/js/actions.js:1686`** — parallelise `showAutonomousModal`:
   - Read defaults synchronously from `AIGON_AGENTS[i].defaultImplementModel`. Build skeleton rows immediately.
   - `modal.style.display = 'flex'` BEFORE any awaits.
   - `Promise.all([fetchSpecRecommendation(...), populateAutonomousWorkflowDropdown(repoPath)])`; hydrate banner + dropdown as each resolves.
   - Replace `await fetchBudget(true)` with `fetchBudget(false)` (cache hit). Kick a background `fetchBudget(true)` only if cached value is > 5 min stale; `updateAutonomousBudgetNotice()` after it resolves.
   - Delete the `autonomousModalModels = await fetchAgentModels(...)` line entirely.

### Risks / regression watch
- `tests/integration/quota-mid-run-f446.test.js` — `persistQuotaPause` + `emittedDedupe` semantics must stay identical. Add one new test: when `tmux list-sessions` returns the same activity epoch twice in a row, `capture-pane` is not invoked the second time.
- `tests/integration/feature-dependencies.test.js` — keep the sync `buildDependencyGraph` export.
- `render()` gating must include `idleLadder.state` so the auto-nudge ladder still updates visibly.
- `visibilitychange` removal: the trade-off is a drawer that may show stale content if left open in a background tab. Acceptable; the listener was a workaround, not a feature.

### Verification
- Per-iteration: `npm run test:iterate` (auto-runs Playwright since `lib/dashboard*.js` and `templates/dashboard/**` are in scope).
- Pre-push: `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`.
- Manual MCP browser: open the dashboard with ≥10 active sessions in a seed repo; click 10 spec drawers in rapid succession; record `performance.now()` deltas via `mcp__playwright__browser_evaluate` to check `/api/spec` p95 < 200 ms.
- Open the autonomous modal; first paint < 50 ms after click; budget banner hydrates in the background.
- After `aigon server restart`, watch `logs/server.log` for the `Poll …ms` line under load — should stay < 100 ms.

### Acceptance criteria
- p95 `/api/spec` < 200 ms with 15 active tmux sessions (measured client-side over 30 drawer opens).
- Server `pollStatus` total wall time < 150 ms p95.
- `_rebuildDepGraphAsync` no longer holds the loop > 50 ms in any single tick.
- `showAutonomousModal` first paint < 50 ms after click on a warm cache; modal interactive < 600 ms.
- All existing tests green; one new dedup-skip test added.

---

## Feature B — Fix xterm.js render lag in the dashboard terminal panel

### Ordered changes

1. **`templates/dashboard/index.html:539-545`** — pin one ecosystem. Bump core to `https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/{css/xterm.css,lib/xterm.js}`. Keep all addons on their existing scoped versions (`@xterm/addon-fit@0.10.0`, `@xterm/addon-webgl@0.18.0`, `@xterm/addon-unicode11@0.8.0`, `@xterm/addon-web-links@0.11.0`). DELETE the `@xterm/addon-image@0.9.0` script tag. Both ecosystems expose the same global names so the existing Playwright globals assertion still passes after the `ImageAddon` removal.

2. **`templates/dashboard/js/terminal.js:82`** — terminal options. In `createXtermInstance`: `lineHeight: 1.0` (drop 1.4 — WebGL renderer needs integer cell height); delete `allowProposedApi: true` (line 92); change `cursorBlink: true` to `cursorBlink: localStorage.getItem('aigon.term.cursorBlink') === '1'` (default off). Delete the `ImageAddon` block (lines 124-127).

3. **`templates/dashboard/js/terminal.js:378`** — debounce ResizeObserver. Track `lastSize = { w: 0, h: 0 }` and one `rafHandle`. On observe: read `entry.contentRect`; if `Math.abs(w - lastSize.w) < 4 && Math.abs(h - lastSize.h) < 4` return; cancel any pending `rafHandle`; schedule `rafHandle = requestAnimationFrame(() => { lastSize = {w,h}; try { fitAddon.fit(); } catch (_) {} })`. Add a `transitionrun`/`transitionend`/`transitioncancel` listener on `#terminal-panel`: while a transition is in flight, set `panelTransitioning = true` and skip rAF scheduling; on `transitionend` run one final `fit()` and clear `panelTransitioning`.

4. **`tests/dashboard-e2e/review-badges.spec.js:31`** — drop `ImageAddon` from the globals assertion. Update the assertion to `[Terminal,FitAddon,WebglAddon,Unicode11Addon,WebLinksAddon].every(...)`.

5. **`lib/pty-session-handler.js:116`** — high-water-mark flush. In `pty.onData`, after `pendingOutput += data`, add: `if (pendingOutput.length >= 32_768) { clearFlushTimer(); flushOutput(); return; }`. Keep the 12 ms timer for the small-chunk path.

### Risks / regression watch
- xterm core bump may surface visual regressions — capture an MCP `browser_take_screenshot` of the terminal panel before and after; manual verify with a Cursor agent's "Composing tokens" frame.
- WebGL renderer may decline on some headless Chromium configs — the existing `try { ... } catch (_) {}` keeps the canvas fallback path live.
- 32 KB threshold matches typical Cursor frame size; below it we lose coalescing benefit, above it the original lag returns.
- `ImageAddon` removal: confirmed no agent in `templates/agents/*.json` claims sixel.

### Verification
- Per-iteration: `npm run test:iterate`.
- Pre-push: full triple.
- Manual MCP browser: open the in-panel terminal on a long-running session, run `seq 1 50000`, trigger several panel slide-in/slide-out animations. `browser_take_screenshot` mid-transition; expect no torn rows. Add a temporary `console.count('fit')` probe to verify `fit()` is called ≤ 2× per slide-in (remove before merge).
- Smoke: load dashboard cold, attach to a session, run `cat /usr/share/dict/words`. Smooth incremental paint, not stutter blocks.
- `tests/integration/pty-terminal.test.js` must pass unchanged.

### Acceptance criteria
- `fit()` called ≤ 2× per panel slide-in (verified via temporary console.count probe).
- xterm globals check in `review-badges.spec.js` passes with the updated five-addon list.
- Cursor "Composing 13.54k tokens" frame renders within one animation frame of arrival.
- No JS console errors on terminal open/close cycle (`mcp__playwright__browser_console_messages`).
- Cold-load bundle drops ~30 KB (the `addon-image` script tag).

---

## Critical files

### Feature A
- `/Users/jviner/src/aigon/lib/quota-mid-run-detector.js` — async + activity-gated scan
- `/Users/jviner/src/aigon/lib/dashboard-server.js` — async `pollStatus`, async dep-graph rebuild, pass configs to `getDashboardAgents`
- `/Users/jviner/src/aigon/lib/feature-dependencies.js` — new `buildDependencyGraphAsync` export
- `/Users/jviner/src/aigon/lib/agent-registry.js` — `defaultImplementModel` etc. on `getDashboardAgents()`
- `/Users/jviner/src/aigon/templates/dashboard/js/spec-drawer.js` — delete dead code
- `/Users/jviner/src/aigon/templates/dashboard/js/init.js` — fingerprint-gated render
- `/Users/jviner/src/aigon/templates/dashboard/js/actions.js` — parallelise modal

### Feature B
- `/Users/jviner/src/aigon/templates/dashboard/index.html` — bump core, drop image addon
- `/Users/jviner/src/aigon/templates/dashboard/js/terminal.js` — options + ResizeObserver debounce
- `/Users/jviner/src/aigon/lib/pty-session-handler.js` — 32 KB high-water flush
- `/Users/jviner/src/aigon/tests/dashboard-e2e/review-badges.spec.js` — drop ImageAddon assertion

---

## Workflow

After this plan is approved:
1. Create the two specs via the Aigon CLI: `afc dashboard-eventloop-stalls-and-modal-parallelise` (Feature A) and `afc xterm-render-lag-fix` (Feature B). The user runs `afp` to prioritise and `afs`/`afn` to implement at their cadence.
2. Per CLAUDE.md hot rules: after any `lib/*.js` edit run `aigon server restart`. After any `templates/dashboard/index.html` edit, take an MCP `browser_snapshot`. Use the `frontend-design` skill before any visual change (Feature B's terminal styling).
3. Commit cadence: ship Feature A first — its server-side fixes unblock measurement of Feature B's gains.
