# Implementation Log: Feature 675 - unified-feature-ui-state-contract
Agent: cx

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cc (Claude Code)
**Date**: 2026-07-14

### Fixes Applied
- be885979b `fix(review): clone runtime facts instead of freezing live collector state` — `normalizeRuntimeFacts` deep-froze shallow copies, freezing nested objects still referenced by the live `/api/status` feature row (agents, closeReadiness, autonomousController); any later collector write would throw in strict mode. Now clones via `structuredClone` before freezing and carries `evalSession` as a runtime fact.
- 882fff86e `fix(review): keep legacy action policy server-side in UI contract projector` — restored four behaviors the contract render path silently dropped: eval/code-review suppressed while an eval session is running (double-fire risk), dependency-blocked Start disabled with a reason, picked-winner promotes Close (not Continue Evaluation) as primary, pending spec review demotes Start below Revise spec. All implemented in the projector per the server-owned-eligibility contract.
- d4e5b83da `fix(review): keep close-failure resolve button on contract-rendered cards` — the contract path returned early and dropped the "Close with agent" recovery affordance, which depends on client-stored close-failure info the server cannot carry.

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- ESCALATE:architectural — Most of the spec's acceptance criteria are not yet implemented. This delivery is Phase 1 plus a slice of Phase 3 of the 4-phase plan. Still outstanding: `bypassMachine` elimination; post-derivation injectors (`quota-dashboard-actions`, `feature-autonomous-dashboard-actions`, review-recovery) still append actions after derivation; `FEATURE_STAGE_TRANSITIONS`/`FEATURE_STAGE_ACTIONS` and the `state-queries.js` feature path remain independently maintained; `card-headline`/`card-presentation`/`close-readiness` are *consumed by* the projector rather than generated from it; no execution gateway rehydration/revalidation in `POST /api/action`; no Phase 0 characterization fixtures; no model-based state/action matrix tests or generated documentation artifact; only 3 of the required state scenarios are covered (eval/winner, code-review cycle, quota, escalation, close recovery, paused, etc. untested); Another Review Cycle / Proceed / Continue Evaluation-vs-Pause conflicts unresolved. Completing this is implementation work, not review-patchable.
- ESCALATE:ambiguous — `FEATURE_INTERACTION_DEFINITION` is a bundling of the pre-existing tables (`states: FEATURE_ENGINE_STATES`, `actions: [...candidates]`) rather than a definition the machine/action catalog is *compiled from*. Whether that satisfies "one declarative definition compiles the machine" or is an accepted incremental step needs an implementer/operator call.

### Notes
- The implementation log above this section was committed empty (all sections blank). It must be filled before close — Status, Key Decisions, Explicitly Deferred (especially the unimplemented phases), and Test Coverage.
- The `new Set(primaryIds).size > 1` invariant check in `buildFeatureUiContract` can never fire (the array has ≤1 element by construction), so the spec's "reject multiple primary decisions" invariant is asserted only by tests, not enforced.
- `interaction.surface` conflates surface names with `requiresInput` values (e.g. `'agentPicker'` appears as a surface); `docs/feature-interaction-contract.md` describes surface as card/agent/input. Works today because renderers only test `!== 'agent'`, but the semantics should be tightened when the contract grows consumers.
- Contract-path overflow menus render in `validActions` order; the projected `order` field is populated but unused by both server and client, so destructive items can appear before benign ones (legacy sorted destructive last). Cosmetic.
- `scripts/check-test-budget.sh` now contains a permanent F675-specific ceiling-raise exemption (17177→17236). It goes dead once another commit lands on top, but should be cleaned out later.
- Verified: `FEATURE_STATE_META` covers all 18 `LifecycleState` values with lanes identical to the removed `LIFECYCLE_TO_STAGE` literal map; contract drag targets match the legacy transition set; the `kcard-va-btn`/`data-va-action` wiring in `pipeline.js` binds contract buttons correctly.
