---
complexity: medium
set: architecture-simplify-2026-05
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-12T00:34:50.296Z", actor: "cli/feature-prioritise" }
---

# Feature: simplify-dashboard-server-extract

## Summary

`lib/dashboard-server.js` is **2,587 lines** mixing three unrelated concerns: (a) the HTTP server + asset/proxy routing, (b) the action-runtime layer (`handleLaunchReview`, `handleLaunchSpecReview`, `handleLaunchEval`, `handleLaunchCloseResolve`, `handleLaunchImplementation`, `runDashboardInteractiveAction` — ~700 LOC of business logic), and (c) ~250 LOC of **inline JS-as-string literals** serving Pro-stub UIs at `/js/insights-dashboard.js`, `/js/benchmark-matrix.js`, `/js/backup-sync.js`, `/js/pro-reports.js`. The route dispatcher itself is already cleanly extracted to `lib/dashboard-routes/`, proving the seam works — but the launch handlers and the Pro stub strings still live in the main file.

There is a second, related boundary problem in `lib/dashboard-routes/`: several route handlers still mutate workflow/runtime state directly (`workflowEngine.*`, `createDetachedTmuxSession`, `sendNudge`, `writeAgentStatusAt`). After this feature, HTTP route files should own request parsing and response serialization only. Dashboard-triggered mutations should route through `lib/dashboard-actions/` so the same application-action boundary can later be shared by the CLI, dashboard, and Pro bridge.

## User Stories

- [ ] As an agent investigating "how does the dashboard kick off a review?", I open one focused file in `lib/dashboard-actions/`, not 2,587 lines of HTTP plumbing.
- [ ] As a maintainer editing a Pro stub UI (e.g. the "Pro not available" message in `/js/benchmark-matrix.js`), I edit a real `.js` file with lint coverage, not a multi-line string literal inside an `if (reqPath === ...)` branch.
- [ ] As an agent debugging dashboard routing, I don't have to load 2.5k lines to understand a 50-line dispatch path.

## Acceptance Criteria

- [ ] A new `lib/dashboard-actions/` directory contains: `launch-review.js`, `launch-spec-review.js`, `launch-eval.js`, `launch-close-resolve.js`, `launch-implementation.js`, `run-interactive.js`, `nudge.js`, `agent-control.js`, and `mark-complete.js`. Each exports a single named handler. `dashboard-server.js` and `lib/dashboard-routes/*` import them and pass them through the existing `routes:` config block or a small dashboard action registry.
- [ ] `lib/dashboard-routes/*.js` no longer import `workflow-core/engine`, `worktree.createDetachedTmuxSession`, `nudge.sendNudge`, or `agent-status.writeAgentStatusAt` directly. Those side effects live behind `lib/dashboard-actions/`.
- [ ] Pro stub UIs move out of `dashboard-server.js` into real files under `templates/dashboard/stubs/`: `insights-dashboard.js`, `benchmark-matrix.js`, `backup-sync.js`, `pro-reports.js`. The stub-resolution helper (`resolveProDashboardAsset`) is updated to check the new path before falling back to the `templates/dashboard/stubs/` copy.
- [ ] `dashboard-server.js` shrinks to ≤1,400 LOC. Remaining content: HTTP server, WebSocket attach, settings/screenshot/notification helpers that are genuinely server-scoped.
- [ ] No behaviour change for the user. `/api/status`, `/js/*`, all action endpoints return byte-identical responses.
- [ ] `npm run test:browser` passes. Specifically: dashboard e2e tests in `tests/dashboard-e2e/` all pass without modification.
- [ ] `aigon server restart` works end-to-end after the change (no broken require paths).

## Validation

```bash
npm run test:browser
# Size check after
wc -l lib/dashboard-server.js               # expect: < 1500
ls templates/dashboard/stubs/               # expect: 4 .js files
# Behaviour check: same byte output for stubs
curl -s http://localhost:3001/js/benchmark-matrix.js | head
```

## Technical Approach

- **Launch handlers** are pure: they take a `ctx` object, perform side-effects via injected helpers, and return a payload. Move them as-is and pass them into the dispatcher's existing `routes:` block.
- **Route mutation strangler.** After the launch handlers move, extract the route-local mutations from `dashboard-routes/entities.js` one at a time: nudge → mark-complete → agent-control. Keep the route body as `{ parse payload -> call dashboard action -> send JSON }`.
- **One dashboard action contract.** Each dashboard action returns `{ ok, status?, error?, payload? }` or throws a typed error; route files translate that into HTTP. Do not let route files contain workflow/session branching after extraction.
- **Pro stubs**: the current strings have two variants per stub — one when Pro is installed but the asset is missing, one when Pro is absent. Keep that split in the new files via two named exports per stub.
- **Test risk**: Pro-stub strings have been edited by humans for tone (the "Pro is in development and not yet available for purchase" wording is intentional). Diff carefully to preserve exact text.

## Dependencies

- None. Independent of other architecture-simplify features.

## Out of Scope

- Splitting `dashboard-server.js` further (e.g. extracting screenshot capture, notification helpers). Defer until measurement says it's needed.
- Changing the route dispatcher in `lib/dashboard-routes/`.
- Changing any Pro-stub messaging.
- Replacing CLI command implementations. This feature creates a dashboard action boundary; it does not rewrite feature/research command handlers.

## Open Questions

- Should `lib/dashboard-actions/` register through the dispatcher's `routes:` block (current pattern), or expose its own `registerActions(dispatcher)` helper? The first is less ceremony.
- Should `run-interactive.js` become the first version of a generic `DashboardCommandBus`, or stay dashboard-only until a follow-up unifies CLI/dashboard command dispatch? Lean toward dashboard-only here to keep risk contained.

## Related

- Set: architecture-simplify-2026-05
