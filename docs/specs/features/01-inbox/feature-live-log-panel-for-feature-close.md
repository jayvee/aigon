---
complexity: high
---

# Feature: live-log panel for feature close

## Summary

Feature close is a 12-phase synchronous subprocess that can run for 30–120 seconds on large features. Currently the dashboard shows only a spinner until the HTTP response arrives — users have no feedback during the wait, and when the close fails "Close with agent" appears abruptly with no context. This feature adds a live-log side panel that opens the moment the user clicks Close and streams subprocess output in real time, so users can see exactly which phase is running, and the failure path is contextual rather than abrupt.

## User Stories

- [ ] As a user closing a large feature, I want to see a live log panel open immediately so I know the close is progressing and can read what it's doing (auto-commit, merge, security scan, cleanup).
- [ ] As a user whose feature close fails, I want to see the full error log in the panel before being offered "Close with agent", so I understand what went wrong.
- [ ] As a user closing a small feature, I want the panel to appear, show the log, and auto-dismiss after a few seconds so it's informative but not in the way.

## Acceptance Criteria

- [ ] Clicking Close on any feature opens the log panel within 200ms — before the HTTP response arrives.
- [ ] Panel shows live stdout/stderr lines as the subprocess emits them (poll interval ≤ 1s).
- [ ] Phase-transition emoji prefixes (📦 📤 ✅ ❌ 🔒) are visually annotated / colour-coded in the panel.
- [ ] On success: panel shows "Done ✓" summary and auto-dismisses after 3s.
- [ ] On failure: panel stays open with full log; "Close with agent" button appears in the panel footer.
- [ ] Server remains responsive to other requests (status poll, dashboard refresh) while a close is in progress.
- [ ] No behaviour change for non-close actions (start, eval, etc.).
- [ ] Stale `.aigon/server/action-logs/*.log` files older than 5 min are removed on server startup.

## Validation

```bash
node --check lib/dashboard-server.js
node --check lib/dashboard-routes/system.js
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May update `templates/dashboard/index.html` and inline JS modules to add the close-log panel markup and script.

## Technical Approach

### Core architectural change: spawnSync → spawn

`runDashboardInteractiveAction` in `lib/dashboard-server.js` (line ~1246) currently uses `spawnSync`, which blocks the Node event loop for the entire duration of the close. No poll requests can be served during this time. This must be changed to async `spawn` with promise-based completion.

The new implementation:
1. Accepts an `actionId` string from the caller.
2. Creates `.aigon/server/action-logs/<actionId>.log` and opens a write stream.
3. Spawns the subprocess with `spawn`, piping both stdout and stderr; each line is written to the log file AND appended to in-memory buffers.
4. Returns a `Promise<{ exitCode, stdout, stderr }>` that resolves on process exit.
5. Cleans up (closes + deletes) the log file when the promise resolves.

### Poll endpoint: GET /api/action-log/:actionId

Added in `lib/dashboard-routes/system.js` (or a new `lib/dashboard-routes/action-log.js`):
- While action is in-flight: reads log file, returns `{ lines: string[], done: false }`.
- After completion: returns `{ lines: [], done: true }` (log file already deleted by runner).
- Uses `ctx.state.inflightActions` (already exists for dedup) — extend each entry with `{ logPath }`.

### Frontend: actionId generation and panel trigger

In `templates/dashboard/js/api.js` `requestAction()`:
- Generate `actionId = \`${action}-${args[0]}-${Date.now()}\`` before the fetch.
- For `feature-close` only: call `openCloseLogPanel(actionId, featureLabel)` immediately.
- Include `actionId` in the POST body so the server names the log file accordingly.
- When the HTTP response arrives, call `finalizeCloseLogPanel(actionId, result)`.

### Frontend: close-log panel component

New `<aside id="close-log-panel">` markup in `templates/dashboard/index.html` reusing the `.drawer-overlay` + `.terminal-panel` pattern (lines 452–478). Inline `<script>` module handles:
- `openCloseLogPanel(actionId, label)` — slides panel open, starts polling loop.
- Poll loop calls `GET /api/action-log/:actionId` every 800ms; appends new lines to a scrolling `<pre>` element; stops when `done: true`.
- Annotates lines by emoji prefix: `✅` → green, `❌` → red/bold, `📦/📤` → blue, `🔒` → orange.
- `finalizeCloseLogPanel(actionId, result)` — shows "Done ✓" or error summary; on error, renders "Close with agent" button in panel footer.
- Panel closes on Escape or overlay click only when action is done; can't be dismissed mid-run.

### Failure UX

The "Close with agent" button currently appears on the feature card (rendered in `actions.js` line ~565) when `state.closeFailedFeatures` contains the feature ID. This remains as a fallback but the button also appears directly in the panel footer, with the relevant `featureId` and `lastCloseFailure` data already in scope.

## Dependencies

- No other Aigon features.
- Requires Node.js `child_process.spawn` (already used elsewhere in the codebase).

## Out of Scope

- SSE / WebSocket streaming (polling at 800ms is sufficient and simpler).
- Live log for non-close actions (start, eval, etc.) — future work.
- Progress bar or phase-count header (emoji annotations are enough for now).
- Showing adoption diffs in the panel.

## Open Questions

- None — approach is fully defined.

## Related

- Research: none
- Set: none
