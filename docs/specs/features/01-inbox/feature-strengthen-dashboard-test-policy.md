---
complexity: high
# agent: cc    # optional — id of the agent that owns this spec. Used as the
#              #   default reviewer for spec-revise cycles when the operator
#              #   does not pick one explicitly. Precedence at revision time:
#              #     event payload nextReviewerId > frontmatter agent:
#              #     > snapshot.authorAgentId > getDefaultAgent().
# research: 44 # optional — id (or list of ids) of the research topic that
#              #   spawned this feature. Stamped automatically by `research-eval`
#              #   on features it creates. Surfaced in the dashboard research
#              #   detail panel under Agent Log → FEATURES.
# planning_context: ~/.claude/plans/your-plan.md  # optional — path(s) to plan file(s)
#              #   generated during an interactive planning session (e.g. EnterPlanMode).
#              #   Content is injected into the agent's context at feature-do time and
#              #   copied into the implementation log at feature-start for durability.
#              #   Set this whenever you ran plan mode before writing the spec.
---

# Feature: strengthen dashboard test policy

## Summary
Change Aigon's test policy so critical dashboard action regressions are caught before architectural or dashboard refactors are considered valid. The immediate incident was a broken autonomous-start happy path: the dashboard showed "Action failed to load. Try refreshing the page." because `templates/dashboard/js/actions-picker.js` referenced `AUTONOMOUS_AGENT_IDS` without defining it, and no required gate opened the Start Autonomously modal. This feature must turn that incident into a durable policy: browser tests stay, but they must become intentional critical-path tests, run in the right places, and be backed by static checks for dashboard JavaScript.

## User Stories
- [ ] As an Aigon maintainer, I want critical dashboard user journeys to be tested before merge/release so a basic action such as Start Autonomously cannot be broken by internal refactors.
- [ ] As an implementing agent, I want clear validation rules that tell me when dashboard changes require browser smoke, full browser E2E, or static dashboard JS checks.
- [ ] As a reviewer, I want CI and local test commands to make omitted browser coverage visible instead of silently passing with only core tests.

## Acceptance Criteria
- [ ] `test:browser:smoke` contains a named critical-action smoke suite that opens every critical dashboard action surface currently available in the e2e fixture.
- [ ] At minimum, the critical-action smoke suite covers:
  - `feature-start` opens the agent picker.
  - `feature-autonomous-start` opens the Start Autonomously modal.
  - `feature-close` or the fixture's close/recovery action surface opens or dispatches through the dashboard action layer, whichever is valid for the current fixture state.
  - `feature-eval` is covered when the fixture has a valid fleet/in-evaluation state; if the fixture cannot expose it deterministically, the spec must say so in a code comment and cover the nearest valid action surface.
  - Any visible "resolve and close" recovery action remains covered by the existing close-failure browser test or is moved into the critical-action suite.
- [ ] The critical-action smoke suite fails on any browser console error or page error produced while opening one of these action surfaces, unless that error is explicitly allowlisted with a comment explaining why it is unrelated.
- [ ] The critical-action smoke suite fails if the generic dashboard toast text `Action failed to load. Try refreshing the page.` appears after opening a critical action.
- [ ] Dashboard JS under `templates/dashboard/js/**/*.js` is included in a static parse/lint check. The check must catch undeclared globals in classic browser scripts where practical. If ESLint is used, configure browser globals intentionally instead of disabling the useful checks.
- [ ] `npm run test:quick` runs the critical-action browser smoke suite whenever any of these paths change:
  - `templates/dashboard/**`
  - `lib/dashboard*.js`
  - `lib/dashboard-routes/**`
  - `lib/dashboard-status-*.js`
  - `lib/state-render-meta.js`
  - `lib/workflow-snapshot-adapter.js`
  - `lib/feature-workflow-rules.js`
  - `lib/research-workflow-rules.js`
  - `lib/workflow-core/**` when dashboard actions or state projection could change
- [ ] Pull request CI runs browser smoke, not only core tests. Full browser E2E may remain push/deploy-only if runtime is too high, but PR CI must include the critical-action smoke suite.
- [ ] `npm test` either runs the dashboard static JS check or clearly delegates it through `test:core`; it must not silently exclude checks that would catch broken dashboard scripts.
- [ ] `npm run test:deploy` still runs the full browser suite.
- [ ] The PR template or contributing/test docs are updated so agents know:
  - `npm test` is core validation.
  - `npm run test:browser:smoke` is required for dashboard action/UI changes.
  - `npm run test:deploy` is the release gate.
- [ ] The suite inventory is reviewed and weak browser tests are either justified, renamed, or moved out of smoke. Do not delete browser tests merely because this incident escaped them; delete only tests that have no clear regression value after review.
- [ ] Add a regression comment or test name referencing the autonomous-start failure mode so future agents understand why this path is load-bearing.

## Validation
```bash
npm run test:quick
npm run test:browser:smoke
npm run test:deploy
```

## Technical Approach
Recommended implementation path:

1. Create or rename a browser spec around critical dashboard actions, for example `tests/dashboard-e2e/critical-actions.spec.js`. Keep action-specific rendering tests in separate files if they are not part of the smoke contract.

2. Introduce a helper in `tests/dashboard-e2e/_helpers.js` for collecting browser runtime errors during an action:
   - subscribe to `page.on('console')` and keep only `error` messages;
   - subscribe to `page.on('pageerror')`;
   - expose an assertion helper that fails after the action if unexpected errors occurred;
   - assert that the generic action-load failure toast is absent.

3. Exercise user-realistic action openings where possible:
   - prefer clicking visible buttons/menus;
   - if an action lives behind an overflow menu in headless layout, open the menu first;
   - use direct DOM `.click()` only when documenting that the test is intentionally verifying action module/runtime loading rather than pointer layout.

4. Add a dashboard JS static check. Possible approaches:
   - Extend ESLint to include `templates/dashboard/js/**/*.js` with browser globals configured.
   - Or add a focused script such as `scripts/check-dashboard-js.js` that parses the files and runs a lightweight undefined-global check.
   - Prefer ESLint if it can be configured without weakening the existing rules.

5. Update `lib/test-loop/scoped.js` so dashboard-sensitive changes trigger the critical-action browser smoke suite. The existing `DASHBOARD_PATH_RE` is too narrow because architectural refactors can break dashboard action availability through read-model or state-action modules.

6. Update `.github/workflows/test.yml` so PR CI includes browser smoke. Keep full `test:browser` on push to `main` if runtime matters, but PRs must exercise the critical action contract.

7. Update package scripts only if needed to make the policy explicit. Avoid making `npm test` unexpectedly very slow unless that is an intentional decision; it is acceptable for `npm test` to remain core-only if CI and docs are explicit and dashboard static JS checks run in core.

8. Review existing browser tests:
   - Keep `optimistic-start.spec.js`; it catches browser reactivity behavior that API tests cannot.
   - Keep `action-lazy-load.spec.js` or fold it into `critical-actions.spec.js`; it catches dynamic import behavior that API tests cannot.
   - Keep `close-failure-event.spec.js`; it verifies recovery action rendering and user-visible failure details.
   - Keep `state-consistency.spec.js`; it guards API-to-DOM drift.
   - Review `autonomous-stage-track.spec.js`; if it is not part of smoke, it may remain in full browser E2E as a rendering regression test.

## Dependencies
- Existing dashboard e2e fixture under `tests/dashboard-e2e/setup.js`.
- Existing scoped validation runner in `lib/test-loop/scoped.js`.
- Existing GitHub Actions workflow in `.github/workflows/test.yml`.
- Existing autonomous-start regression commit `17c7fd8c`.

## Out of Scope
- Do not redesign the dashboard action system.
- Do not change workflow-core lifecycle semantics.
- Do not require the full browser suite on every local `npm test` unless the implementation explicitly evaluates and accepts the runtime tradeoff.
- Do not delete browser tests as a reaction to this incident unless the deletion is justified test-by-test in the implementation log.

## Open Questions
- Should PR CI run browser smoke across every Node version or only one Node version? Recommendation: one Node version, currently Node 20.x, to control runtime.
- Should `npm test` include browser smoke locally? Recommendation: no for now; include dashboard static JS checks in core and make browser smoke mandatory in CI plus feature validation for dashboard changes.
- Should the critical-action suite submit actions or only open action surfaces? Recommendation: open surfaces in smoke, submit only when the fixture can do so safely and deterministically; full submit paths belong in targeted e2e/integration tests.

## Related
- Incident: autonomous dashboard start showed `Action failed to load. Try refreshing the page.` because `AUTONOMOUS_AGENT_IDS` was not defined in `templates/dashboard/js/actions-picker.js`.
- Regression fix: `17c7fd8c fix(dashboard): restore autonomous action modal`.
- Current browser tests: `tests/dashboard-e2e/action-lazy-load.spec.js`, `optimistic-start.spec.js`, `close-failure-event.spec.js`, `state-consistency.spec.js`, `autonomous-stage-track.spec.js`.
