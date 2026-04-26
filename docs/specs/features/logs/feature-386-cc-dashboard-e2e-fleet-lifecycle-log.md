# Implementation Log: Feature 386 - dashboard-e2e-fleet-lifecycle
Agent: cc

## Status
Submitted. Fleet lifecycle spec passes in 44s with MOCK_DELAY=fast.

## New API Surface
`tests/dashboard-e2e/fleet-lifecycle.spec.js` — new Playwright spec (122 LOC).

## Key Decisions

**`/api/feature-open` mock over `/api/session/**`**: The eval agent launch goes through `POST /api/feature-open` (via `requestFeatureOpen` in api.js), not the generic session API. `gotoPipelineWithMockedSessions` mocks `/api/session/**` which doesn't cover this. Added a per-test route mock for `/api/feature-open` after the agent picker fires.

**Winner via eval file, not XState `select-winner`**: Writing `**Winner:** cc` to the eval file is sufficient to get the dashboard to pre-select cc in the fleet close modal. The read model parses the `**Winner:**` line for display; the XState `select-winner` transition is fired implicitly by `feature-close <id> cc` when it calls `engine.selectWinner` internally.

**60s timeout on feature-close `waitForResponse`**: Merging a worktree back to main can take >15s. The Playwright `actionTimeout: 15000` is too short; fleet close needs an explicit `{ timeout: 60000 }`.

**`@aigon/pro` symlink in worktree**: `node_modules/@aigon/pro` must be symlinked to `~/src/aigon-pro` in the worktree for the dashboard server to start. Without it, `AIGON_FORCE_PRO=true` in setup.js triggers a `null.register` crash in `pro-bridge.js`. This is a worktree-specific setup step, not a code defect.

## Gotchas / Known Issues

`solo-lifecycle.spec.js` has 2 pre-existing failures (the solo-worktree and solo-branch close scenarios) that also fail on main. These are unrelated to this feature.

## Explicitly Deferred

Per spec: multi-winner/no-winner edge cases (covered by failure-modes spec), solo lifecycle changes.

## For the Next Feature in This Set

- `FLEET_CC_DELAYS` / `FLEET_GG_DELAYS` from `_helpers.js` are now consumed. The constants are not FAST-aware; at 3s/8s they're fast enough for the 20s budget already.
- `startFeatureWithAgents` + `waitForPath` + concurrent `MockAgent.run()` is the established pattern for fleet setup. Reuse it directly.
- The eval agent picker flow: click `feature-eval` button → `#agent-picker` visible → check agent → route-mock `/api/feature-open` → `Promise.all([waitForResponse('/api/action'), click('#agent-picker-submit')])` → `waitForResponse('/api/feature-open')`.

## Test Coverage
`MOCK_DELAY=fast npx playwright test tests/dashboard-e2e/fleet-lifecycle.spec.js` — passes in ~44s.
