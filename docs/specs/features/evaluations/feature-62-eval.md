# Evaluation: Feature 62 - unified-state-machine

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-62-unified-state-machine.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-62-cc-unified-state-machine`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-worktrees/feature-62-cx-unified-state-machine`

## Evaluation Criteria

| Criteria | cc | cx |
|----------|---|---|
| Code Quality | 9 | 7 |
| Spec Compliance | 9 | 6 |
| Performance | 8 | 8 |
| Maintainability | 9 | 7 |

## Summary

### Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - **Pure, well-structured state machine module** (600 lines) with comprehensive JSDoc types, clear separation of transitions and actions, and entity registry pattern.
  - **53 new tests** (124 total) covering all transitions, guards, per-agent expansion, session action resolution, recommended action ordering, and `isActionValid`.
  - **`getSessionAction`** — the critical function from the spec that resolves create-and-start / attach / send-keys based on tmux session × agent status. cx omitted this entirely.
  - **`feature-open` as canonical command** with `worktree-open` kept as implementation backend. Clean delegation pattern.
  - **`validActions` wired into `/api/status`** for features, research, and feedback. Dashboard drag-drop updated to use `validTargetStages` from `validActions`.
  - **`inferDashboardNextActions` refactored** to consume state machine `getRecommendedActions`, translating to dashboard command format. Both old fields (`nextAction`/`nextActions`) preserved for backward compat while `validActions` is added.
  - **`SM_INVOCABLE_ACTIONS` set** derived from state machine definitions, supplementing `RADAR_INTERACTIVE_ACTIONS` — a step toward replacing the hardcoded allowlist.
  - Phases 5-6 (session unification, full old code removal) deferred intentionally per spec's "each phase independently shippable" guideline.

- Weaknesses:
  - Some context construction is duplicated between `inferDashboardNextActions` and `collectDashboardStatusData` (both build `smContext` objects independently).
  - `RADAR_INTERACTIVE_ACTIONS` still exists alongside `SM_INVOCABLE_ACTIONS` — full replacement deferred.

#### cx (Codex)
- Strengths:
  - **Numeric priority scoring** in `getRecommendedActions` (feature-focus: 80, feature-open: 60, feature-eval: 50, etc.) — more granular than cc's binary high/normal split.
  - **`getInteractiveActionNames()`** — dynamically derives the action allowlist from definitions, which cc approximates with `SM_INVOCABLE_ACTIONS`.
  - **`normalizeFeatureContext()`** — defensive normalization of context input, ensuring type safety.
  - **`validateRadarActionForCurrentState`** — runtime validation against entity stage/context before executing Radar actions. cc added this check at parse time but cx validates at execution time too.
  - **Removed `ALLOWED_TRANSITIONS` from dashboard** entirely — cc keeps it as fallback.

- Weaknesses:
  - **No tests added** — 71 tests (unchanged from baseline). A pure state machine module with no test coverage is a significant gap.
  - **Missing `getSessionAction`** — the spec's most important function for resolving the "Open" button regression. Not implemented.
  - **Missing `isActionValid`** — spec-required query function not exported.
  - **Missing `getValidTransitions`** — not a separate function; transitions are embedded in `getAvailableActions`.
  - **Entity type mismatch** — uses `'features'` (plural) instead of `'feature'` (singular), inconsistent with the spec and cc's implementation.
  - **Feedback transitions all use `feedback-triage` as the action** for every transition (triaged→actionable, triaged→wont-fix, etc.) — incorrect, should be different actions.
  - **Research has no in-state actions** — empty actions array, missing research-open, research-attach, research-synthesize.
  - **`feature-open` merged into `feature-open` as primary with `worktree-open` as alias** — good direction, but renamed the command implementation key which breaks existing tests that reference `worktree-open`.

## Recommendation

**Winner:** cc

**Rationale:** cc delivers a significantly more complete implementation: the pure state machine module covers all three entity types with correct transitions and in-state actions, includes the critical `getSessionAction` function (which directly addresses the "Open" button regression that motivated this feature), has comprehensive test coverage (53 new tests), and wires `validActions` into the API response for all entity types. cx has some good ideas (numeric priority scoring, runtime action validation, context normalization) but is missing too many spec requirements (no tests, no `getSessionAction`, wrong entity type key, incorrect feedback transitions).

The other implementation doesn't have particular features or aspects worth adopting beyond what the winner already provides. cx's numeric priority scoring for `getRecommendedActions` is interesting but cc's `priority: 'high'` approach is simpler and sufficient for the current use cases. cx's `normalizeFeatureContext` defensive normalization could be useful later but isn't needed now since the state machine is only called from controlled code paths. cx's `validateRadarActionForCurrentState` is a good idea but can be added in Phase 4 when CLI commands are refactored to validate via the state machine.

Which implementation would you like to merge?

`/aigon:feature-close 62 cc`
