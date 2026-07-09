---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-09T00:47:16.530Z", actor: "cli/feature-prioritise" }
---

# Feature: server-restart-after-lib-change-reliability

## Summary
The feature-close "restart server if lib/*.js changed" safety net (F228/F234) is still too fragile. The terminal path can restart directly, and the dashboard action path can consume `.aigon/server/restart-needed.json`, but marker consumption still depends on a successful action response and `restartServerIfLibChanged` still skips several failure modes silently. During the dash-arch set (2026-07-08), this left the dashboard serving new files with old in-memory routes, causing `/styles.css` to 404 until a manual restart. This feature adds a server-side self-heal backstop and makes restart failures observable.

## User Stories
- [ ] As an operator, after any feature-close that merged `lib/*.js` changes, the running dashboard server picks up the new code without me remembering to restart it.
- [ ] As an operator, I never see the dashboard serve broken output (404 styles, missing routes) because the daemon's in-memory code diverged from what's on disk in the main checkout.

## Acceptance Criteria
- [ ] Root cause documented in the implementation log for BOTH observed failures: (a) why F628's close did not call `restartServer()` (or why the marker path was chosen instead); (b) why the F622 marker was written but never consumed by `lib/dashboard-routes/system.js` action handler (`consumeRestartMarker(result.repoPath || dedupeRepoPath)` — suspect repoPath mismatch, e.g. worktree path vs main checkout path, or `/private/var` vs `/var` normalisation).
- [ ] A reproducer test exists for each root cause before the fix is written (per prove-before-fixing discipline); hypothesis-driven fixes are labelled as such in the log.
- [ ] Self-heal backstop: the server detects a pending restart marker (or lib-code staleness) via a path that does NOT depend on a dashboard action round-trip — e.g. consume the marker in the poll loop / fs-watch tick (`.aigon/state` sibling `.aigon/server/` is cheap to check) and schedule the same graceful self-restart used by the action route, including the F622 `server-restarting` SSE broadcast so open tabs show the restart banner.
- [ ] Stale markers cannot sit unconsumed: a marker older than a bounded TTL is either acted on or logged + cleared with a warning, never silently ignored forever.
- [ ] `restartServerIfLibChanged` failure modes are no longer silent: diff failure, missing registry entry, and `restartServer()` errors each log one actionable line (they currently `return` silently or warn inconsistently).
- [ ] Existing behaviour preserved: dashboard-invoked closes must NOT kill their own grandparent process (the F234 EPIPE constraint) — the marker + deferred restart path remains the mechanism there.

## Validation
```bash
node --check lib/feature-close.js
node --check lib/dashboard-server.js
node --check lib/dashboard-routes/system.js
npm run test:core
```

## Technical Approach
Producer side is `lib/feature-close.js` (`restartServerIfLibChanged`, `writeRestartMarkerFile`, `consumeRestartMarker`); consumer side is the action handler in `lib/dashboard-routes/system.js`. The new backstop consumer belongs in the server poll loop in `lib/dashboard-server.js` (or a small helper it calls each safety-net tick), reusing `consumeRestartMarker` per registered repo and the existing self-restart spawn logic. Broadcast `server-restarting` over the F622 SSE hub before exiting so clients switch to the restart banner instead of erroring. Keep the check O(1) per tick (one `fs.existsSync` per repo).

## Dependencies
-

## Out of Scope
- Watching `lib/**` file mtimes for hot-reload of server code (full dev-server behaviour).
- Any change to the iterate/deploy test gates.
- The 1GB `~/.aigon/logs/server-stderr.log` growth from repeated tmux session-ID warnings (separate issue; file separately if it recurs after the stale sidecars are pruned).

## Open Questions
- Should the backstop restart immediately on marker detection, or only when no action/poll is in flight? (The action-route path already defers via `setTimeout`.)

## Related
- Prior work: F228 (restart server on lib change at close), F234 (marker + deferred restart for dashboard-invoked closes), F620–F622 (statusVersion/SSE — provides the `server-restarting` broadcast the backstop should reuse).
- Incident: dash-arch F628 close on 2026-07-08 left the primary dashboard unstyled (404 `/styles.css`) for ~30 minutes.
