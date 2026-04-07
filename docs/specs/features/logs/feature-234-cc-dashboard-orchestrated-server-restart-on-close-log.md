---
commit_count: 5
lines_added: 409
lines_removed: 19
lines_changed: 428
files_touched: 12
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 125
output_tokens: 24492
cache_creation_input_tokens: 152323
cache_read_input_tokens: 9031452
thinking_tokens: 0
total_tokens: 9208392
billable_tokens: 24617
cost_usd: 18.242
sessions: 1
model: "claude-opus-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 234 - dashboard-orchestrated-server-restart-on-close
Agent: cc

## Plan
Move the `lib/*.js` auto-restart out of the close subprocess (where it
kills its own grandparent via execSync + inherited pipes) and into the
dashboard server itself. Close child writes a marker file; dashboard
consumes it after responding, then spawns a fully detached restart.

## Progress

### Backend
- `lib/feature-close.js`
  - `restartServerIfLibChanged` now branches on
    `process.env.AIGON_INVOKED_BY_DASHBOARD`. When set, it calls
    `writeRestartMarker(...)` (injected dep) and returns without touching
    `restartServer` — the dashboard will restart itself after responding
    to the client. When unset (terminal invocation), behaviour is
    unchanged.
  - Added two small helpers: `writeRestartMarkerFile(repoPath, marker)`
    (atomic temp+rename write to `.aigon/server/restart-needed.json`) and
    `consumeRestartMarker(repoPath)` (read + unlink, returns null if
    absent or corrupt). Both exported from the module so the dashboard
    can call them and tests can exercise the round-trip.
- `lib/commands/feature.js`
  - Wired `writeRestartMarker` into the deps passed to
    `restartServerIfLibChanged` (uses the exported helper with the close
    target's repoPath).
- `lib/dashboard-server.js`
  - `runDashboardInteractiveAction` spawns action children with
    `env: { ...process.env, AIGON_INVOKED_BY_DASHBOARD: '1' }`. This is
    the single trigger for the "don't restart inline" branch.
  - Added an `inflightActions` Map + `inflightKey()` helper in the
    `runDashboardServer` scope. The `/api/action` handler rejects
    parallel dispatches of the same `repoPath|action|args.join(',')`
    with HTTP 409. Entry cleared in a try/finally so both success and
    failure release the lock.
  - After a successful action, the handler calls
    `close.consumeRestartMarker(repoPath)`. If a marker is present, the
    response body gets `{ serverRestarting: true, restartReason }`, the
    response is flushed, then a detached `spawn(process.execPath,
    [CLI_ENTRY_PATH, 'server', 'restart'], { detached: true, stdio:
    'ignore', cwd: process.cwd() })` fires after ~100ms and the dashboard
    calls `process.exit(0)` ~50ms later. Detached + stdio:ignore is
    essential — the new process inherits no fds from the dying parent so
    there's no EPIPE exposure.
- `lib/aigon-proxy.js`
  - Added `proxyTimeout: 5*60*1000` and `timeout: 5*60*1000` to
    `httpProxy.createProxyServer`. Belt-and-braces so long actions
    (feature-close on a large merge) never surface as "Proxy error:
    socket hang up" even if some future path blocks the event loop.

### Frontend
- `templates/dashboard/js/api.js`
  - After a successful action response, check `payload.serverRestarting`.
    If set, call `showServerRestartBanner()` and return early without
    calling `requestRefresh` (the server is about to die anyway).
- `templates/dashboard/js/monitor.js`
  - Added `showServerRestartBanner()` / `hideServerRestartBanner()`.
    Lazily injects a fixed-top banner with a spinning ring and
    "Reloading backend…" text; injects a one-shot `@keyframes spin`
    style. `setHealth()` clears the banner on the first successful
    poll after a restart.
- `templates/dashboard/js/state.js`
  - Added `serverRestarting: false` to the dashboard state.
- `templates/dashboard/js/init.js`
  - `poll()` now calls `setHealth()` on success (needed to clear the
    banner) and, while `state.serverRestarting` is true, reschedules
    itself in 500ms on failure so the banner clears within ~2s instead
    of waiting for the 10s poll tick.

### Tests
- Extended `tests/integration/feature-close-restart.test.js` with a new
  case covering the `AIGON_INVOKED_BY_DASHBOARD=1` branch: assertion
  that `restartServer` is NOT called and the marker is recorded with
  the expected reason + files. Env var is saved/restored to avoid
  leaking into sibling tests.
- New `tests/integration/dashboard-restart-marker.test.js` covers the
  `writeRestartMarkerFile` → `consumeRestartMarker` round-trip,
  including the file delete on consume and null return when absent.
  Test budget stayed within the 2000-LOC ceiling (now 1950).

## Decisions

- **Marker file vs stdout marker vs exit code.** The spec left this
  to the implementer. I went with the flag file
  (`.aigon/server/restart-needed.json`) because stdout is already used
  for action output surfaced in the console panel, exit codes can't
  carry structured data (reason/files), and an atomic temp+rename
  write is trivial. The dashboard always knows the `repoPath` of the
  action it dispatched, so lookup is deterministic.
- **No WebSocket broadcast.** The spec suggested a
  `{type:'server-restarting'}` WebSocket event, but this dashboard has
  no WS/SSE — it's poll-based. I used the existing response channel:
  the POST /api/action response includes `serverRestarting: true`, and
  the existing poll-failure path handles the reconnect. Equivalent
  behaviour, zero new transport.
- **Aggressive poll-during-restart.** Default POLL_MS is 10s, which
  would leave the banner visible for up to 10s after the new server
  answered. Added a 500ms retry loop gated on `state.serverRestarting`
  so the banner clears within ~2s as the spec AC requires.
- **Keep terminal-mode behaviour untouched.** The env-var branch is
  the only thing that changes. `aigon feature-close <id>` from a
  shell still calls `restartServer` inline as before. Verified via
  the existing test cases in `feature-close-restart.test.js`.
- **Dedupe covers all actions, not just Close.** It's a double-click
  safeguard — applying it to every action is cheaper than enumerating
  "which actions are slow enough to matter" and catches future
  regressions.

## Issues encountered
- `pro-gate.test.js` has 4 pre-existing failures in this worktree
  (unrelated to this feature — `@aigon/pro` is not installed). Verified
  via `git stash && npm test` that the same failures exist on the base
  commit. Not fixing here; orthogonal concern.

## Approach / Rationale
The spec already had a well-reasoned fix sketch. Main implementer
judgement calls were (1) the marker file vs stdout/exit, (2) using the
existing response channel instead of adding a WS, and (3) extracting
the marker helpers as first-class exports so tests can cover them
directly without spinning up a dashboard. The result is ~90 LOC of
backend + ~40 LOC of frontend + ~20 LOC of tests.

## Manual Testing Checklist
1. `aigon server status` shows `running`.
2. From another repo (e.g. brewboard) pick a feature with `lib/*.js`
   merge, open the dashboard, click Close. Expected:
   - Success toast appears.
   - Fixed-top blue banner "Reloading backend…" appears.
   - Within ~2 seconds, banner clears and health dot returns to green.
   - `aigon server status` in a terminal shows the new PID.
3. Double-click Close on the same card. Expected: second click
   is rejected with "Action already in flight" or simply ignored by
   the disabled button; never two parallel close subprocesses.
4. Close a feature whose merge touches only docs (no `lib/*.js`).
   Expected: no banner, no restart, normal success toast.
5. Run `aigon feature-close <id>` from a terminal (not dashboard).
   Expected: "🔄 Restarting aigon server…" printed, existing behaviour
   unchanged.

## Code Review

**Reviewed by**: cx
**Date**: 2026-04-07

### Findings
- `tests/integration/dashboard-restart-marker.test.js` existed but was not included in `npm test`, so the new restart-marker regression coverage never executed.
- The branch did not exercise `runDashboardInteractiveAction`, leaving the `AIGON_INVOKED_BY_DASHBOARD=1` launch contract unverified.

### Fixes Applied
- `73c4c922` `fix(review): restore feature 234 regression coverage`
  - added `tests/integration/dashboard-restart-marker.test.js` to the `npm test` script
  - added a direct regression assertion in `tests/integration/feature-close-restart.test.js` proving dashboard-launched actions inject `AIGON_INVOKED_BY_DASHBOARD=1`

### Notes
- Review stayed scoped to test coverage because the implementation path itself matched the intended restart behavior and did not warrant architectural changes.
