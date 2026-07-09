---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-09T00:47:17.028Z", actor: "cli/feature-prioritise" }
---

# Feature: refactor autonomous plan stage status into single progress index

## Summary

`buildAutonomousStagePlan` in `lib/workflow-read-model.js` (~lines 445-572) computes per-stage `complete`/`running`/`waiting`/`failed` status from ~10 overlapping derived booleans (`implementReady`, `implementFailed`, `reviewRunning`, `reviewCurrentlyActive`, `reviewComplete`, `feedbackAddressed`, `reviewApprovedNoRevision`, `evalRunning`, `evalComplete`, `closeRunning`, `closeComplete`). Each stage type (`implement` / `review` / `revision` / `eval` / `close`) has its own ad-hoc combination of those booleans. Replace this with a single linear progress index — "how far has the autonomous run reached?" — then derive each stage's status from its position relative to the index.

## Why this matters (the case for doing it now)

All those booleans encode one underlying fact: the autonomous conductor advances through stages in order, and "stage N is running" implies "stages 0..N-1 are complete". The current model forfeits that invariant and re-derives each stage's completeness from independent signals, with two real costs:

1. **It produces bugs of omission.** F524 just shipped a one-line fix because the `revision` branch lacked a `reviewApprovedNoRevision` signal — when the reviewer approved with no changes, the conductor skipped revision but the read-model left it `waiting`, so the card headline read "Starting revision" for ~10 seconds before close fired. The same shape of bug will recur every time the conductor adds a new skip path (e.g. eval pick-winner shortcuts, future failover branches). A progress-index model makes skips explicit at one site and impossible to miss across stages.

2. **The state space is untestable.** With ~10 booleans × 5 stages there are too many combinations to enumerate; tests can only spot-check. A progress-index model has ~6 states (one per stage boundary) and is exhaustively testable.

The function is read on every dashboard poll for every in-progress feature, so the cost of bad output is paid at high frequency — wrong headlines, wrong checkmarks, wrong "Starting X" cues. The user's reaction to the F524 fix ("is it me or does this seem VERY complicated?!") is the symptom — the structure is past its complexity budget.

## User Stories

- [ ] As a dashboard reader, I see the autonomous plan card advance cleanly through stages without spurious "Starting <skipped-stage>" headlines in transitional windows.
- [ ] As a future implementer adding a new conductor skip path (e.g. solo run with no reviewer, eval-only short-circuit), I add one signal in one place and all stage statuses adjust correctly without sprinkling booleans across five branches.

## Acceptance Criteria

- [ ] `buildAutonomousStagePlan` computes a single `progressIndex` (integer in `[0, stages.length]`) representing the furthest stage the run has reached, plus a `currentStatus` for the stage at that index (`running` / `failed` / `complete-stopped`).
- [ ] Per-stage status is derived from position alone: `i < progressIndex` → `complete`; `i === progressIndex` → `currentStatus`; `i > progressIndex` → `waiting`.
- [ ] Stage skip is a first-class concept: when the conductor skips a stage (e.g. approved-review skips `revision`), the progress index advances past it and the skipped stage renders as `complete` (or a new `skipped` status if downstream UI gains the affordance — out of scope for this feature).
- [ ] The 10+ ad-hoc derived booleans collapse to a small set of stage-boundary predicates (one per `i → i+1` transition).
- [ ] All existing assertions in `tests/integration/workflow-read-model.test.js` pass unchanged, including the F524 regression test that approved-review marks `revision` as `complete`.
- [ ] New table-driven test enumerates one fixture per conductor state (running implement, running review, approved review, requested revision, running eval, eval complete, close running, close complete) and asserts the entire stage list — closing the test gap.
- [ ] `lib/card-headline.js` does not need to change; its current `running` / `failed` / `waiting`-after-`complete` rules continue to produce the right headlines because per-stage status is unchanged in shape.

## Validation

```bash
node tests/integration/workflow-read-model.test.js
node tests/unit/card-headline.test.js
```

## Technical Approach

1. Introduce a small helper inside `lib/workflow-read-model.js` (private to the module) that returns `{ progressIndex, currentStatus }` given `(resolved.stages, snapshot, autoState, review, evaluation, dashboardAgents)`.
2. The helper walks the resolved stage list in order. For each boundary `i → i+1` it asks one predicate: "has the run advanced past stage `i`?" Predicates collapse the existing booleans:
   - past `implement`: any of `implementReady`, `reviewRunning`, `reviewComplete`, `evalRunning`, `evalComplete`, `closeRunning`, `closeComplete`.
   - past `review`: `reviewComplete` or downstream signal.
   - past `revision`: `feedbackAddressed`, `reviewApprovedNoRevision`, or downstream signal.
   - past `eval`: `evalComplete` or downstream signal.
   - past `close`: `closeComplete`.
3. `currentStatus` at the boundary: `failed` if `findAutonomousStageFailure(stage.type, autoState)`; otherwise `running` if the stage's "in-progress" signal is true (e.g. `reviewRunning`, `evalRunning`, `closeRunning`, `autoState.feedbackInjected` for revision); otherwise `waiting`.
4. The outer `stages.map(...)` collapses to a one-liner that picks status by index comparison.
5. Keep the function pure (no I/O) — it already is. Keep the return shape identical (`{ workflowSlug, workflowLabel, source, mode, controllerStatus, stages }`).
6. Existing call sites (`lib/dashboard-status-collector.js` two-pass call, downstream `card-headline` consumer) do not change.

## Dependencies

- None. Pure-function refactor in a single file plus a focused test addition.

## Out of Scope

- New `skipped` stage status (would require a UI affordance in `card-headline.js` / dashboard CSS — file separately if desired).
- Changes to the conductor itself (`lib/feature-autonomous.js`) or the autonomous state schema.
- Workflow-definition-sourced plans (`source: 'workflow-definition'`) — same refactor applies but verify behaviour unchanged in tests; do not redesign the workflow-definition format.
- Research / feedback autonomous flows — feature autonomous only.

## Open Questions

- Should the `skipped` case eventually render distinctly from `complete` in the card (e.g. a strikethrough or muted check)? Punt to a follow-up feature if the visual feedback merits it; for now `complete` is correct as long as the headline doesn't mis-narrate the transition.

## Related

- Related fix: commit `1290e2f2` ("fix(dashboard): skip autonomous revision stage when review approved") — the F524 fix that motivated this refactor.
- Affected reader: `lib/card-headline.js` (consumes the `stages[].status` shape — unchanged).
