# Implementation Log: Feature 691 - release-stabilization-test-budget-and-sse-fallback

## Status
Implemented release-stabilization work on the F691 Drive branch. Adopted the
pre-existing live spec-cycle session read-model changes, repaired the
reproducible SSE fallback browser assertion, reconciled generated agent-context
artifacts, and reduced counted test code from 18,119 to 17,224 LOC without
changing the 17,225 ceiling. A live Brewboard check then exposed a compact-card
renderer gap: inspectable spec-review and spec-revision sessions were present in
the UI contract but their activity rows, including Peek, were suppressed.

## New API Surface
`listSpecReviewTmuxSessions()` is exported from
`lib/dashboard-status-helpers.js` for read-model discovery of every live session
for a spec-cycle role.

## Key Decisions
The read model supplements durable reviewer/checker rows with live tmux
sessions only for resting inbox/backlog entities. It fills a missing session on
an existing agent row and deduplicates by both session name and agent.

The SSE fallback was functioning; the failed test asserted the old
space-formatted title while cards now expose a slug as their stable identity.
The Playwright assertion now targets `data-feature-name="e2e-solo-feature"`.

Compact inbox/backlog cards now reveal the activity row when the server contract
contains an inspectable session. They retain compact layout and actions while
making live and retained spec-cycle output reachable through Peek. Compact
session rows keep their status on one line and use an icon-only Peek control so
the activity remains legible in narrow backlog columns.

The 895-line test reduction removed whole low-value files:

- Rendered-install and root-instruction guard tests duplicated scripts executed
  directly by `prepublishOnly` / `test:core`.
- `static-guards.test.js` mixed private source checks and cross-domain assertions
  already covered by dedicated policy, template, lifecycle, and security gates.
- Doctor stale-stash, analytics cost, proxy-port, and iterate-runner cases were
  narrow maintainer/dev-tool regressions rather than release-critical behavior.
- Probe TTL, monitor projection, health-route, and spec-index unit tests targeted
  private helpers already exercised through retained quota/status integration,
  contract-browser, and dashboard end-to-end coverage.

## Gotchas / Known Issues
The hard budget is now exactly full. Any future test addition must delete or
consolidate at least as much existing test code.

## Explicitly Deferred
Pushing, version selection, tagging, npm publication, and closing F691 remain
operator decisions. The two pre-existing drifted research items were not
changed.

## For the Next Feature in This Set
Standalone feature; no set follow-up.

## Test Coverage
Passed the focused dashboard-review-status integration file, the isolated
two-test SSE Playwright file, `npm run test:iterate` (22 scoped
integration/workflow files plus 30 browser smoke cases), and
`scripts/check-test-budget.sh` at 17,224 / 17,225 LOC. The full maintainer
release gate also passed: all core and heavy tests, package security checks,
zero-vulnerability npm audit, 37 full-browser passes with the opt-in live-agent
case skipped, and the final budget check. After the compact-card follow-up,
`npm run test:iterate` passed 23 scoped files and all 30 browser smoke cases;
the focused compact-session Peek browser regression passed and the budget
remained within its ceiling at 17,225 / 17,225 LOC.
