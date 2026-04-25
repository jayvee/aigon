---
complexity: high
---

# Feature: spec-review-cycle-inbox-backlog-only

## Summary

Aigon distinguishes **spec review** (reviewing or revising the **spec document** before or instead of implementation) from later **code review** (reviewing implementation). Today, action eligibility and engine transitions can drift: operators may see spec-review affordances when lifecycle has already moved to **implementing**, or conversely find spec review blocked in **inbox** when it should be valid.

This feature **locks the contract**: a spec-review / spec-revise **cycle** (the workflow actions and engine events that drive `specReview` / `spec_revision_*` states) is **allowed only** while the entity is in **inbox** or **backlog**. It is **not allowed** once the entity is **in progress** (`implementing` and any later lifecycle the product treats as “work has started”). The goal is predictable behaviour across **CLI**, **workflow engine guards**, and **dashboard `validActions`** (single source of truth in workflow rules + read model), with tests that prevent regression.

## User Stories

- [ ] As an operator, I can start a **spec review** on a **feature** that is still in **01-inbox** or **02-backlog** (including slug-keyed inbox rows with a valid engine snapshot).
- [ ] As an operator, I can start a **spec review** on **research** in the same pre-implementation folders.
- [ ] As an operator, I **cannot** start or continue a **spec-review cycle** once the feature or research has moved to **in progress** (implementation); I use **code review** / **eval** flows instead.
- [ ] As a maintainer, I can grep one predicate (or shared helper) used by the action registry and CLI guards so inbox/backlog vs in-progress rules cannot drift.

## Acceptance Criteria

- [ ] **Single predicate (or thin wrapper)** exported or centralized (e.g. in `lib/feature-workflow-rules.js` / `lib/research-workflow-rules.js` or `lib/state-queries.js`) answering: `isSpecReviewCycleAllowed(snapshot, folderStage)` → true iff entity is **inbox or backlog** only. Document the exact inputs (engine `lifecycle` / `currentSpecState` vs folder stage from resolver) in the implementation PR.
- [ ] **Dashboard**: `validActions` for `feature-spec-review`, `feature-spec-revise`, `research-spec-review`, `research-spec-revise` (and any sibling actions that open the spec-review cycle) are emitted **only** when the predicate is true. Rows in **in progress** or later must **not** list these actions (unless a separate, explicitly named “emergency” action exists — default is **no**).
- [ ] **CLI**: `feature-spec-review`, `research-spec-review`, and parallel **revise** entrypoints that assume an active spec-review cycle **refuse** with a non-zero exit and a message that cites the allowed stages when the predicate is false.
- [ ] **Engine / write path**: Appending `feature.spec_review.*` / `research.spec_review.*` (and revision pairing events) from an illegal stage is **rejected** (fail loud) or is provably unreachable from supported entrypoints — pick one strategy in implementation; do not silently no-op.
- [ ] **Inbox nuance**: Spec review remains allowed for **inbox** entities that already have a bootstrapped snapshot (post-F296). Predicate must not accidentally require `02-backlog/` folder if engine state is still `inbox`.
- [ ] **Regression tests** (names + file paths to be chosen by implementer, each with `// REGRESSION:` comment):
  - [ ] Feature + research: **backlog** snapshot → spec-review actions present in derived `validActions` (or equivalent pure helper test if the registry is hard to invoke in isolation).
  - [ ] Feature + research: **implementing** snapshot → spec-review cycle actions **absent**.
  - [ ] CLI invocation against a temp repo in **03-in-progress** exits non-zero with the expected hint.
- [ ] `npm test` passes; if dashboard HTML/JS changes, follow project rules for screenshots and `MOCK_DELAY=fast npm run test:ui` as applicable.
- [ ] After any `lib/*.js` edit, `aigon server restart` in the operator’s workflow.

## Validation

```bash
node -c aigon-cli.js
npm test
```

## Pre-authorised

- May skip `npm run test:ui` if the merged implementation touches only `lib/` and `tests/integration/` with no `templates/dashboard/` changes.
- May raise `scripts/check-test-budget.sh` CEILING only after deleting or consolidating an existing test per project budget rules.

## Technical Approach

1. **Inventory** all producers of spec-review eligibility: `lib/feature-workflow-rules.js`, `lib/research-workflow-rules.js`, `lib/workflow-read-model.js` / `workflow-snapshot-adapter.js` (if actions are filtered post-derivation), and CLI handlers under `lib/commands/feature.js`, `lib/commands/research.js`, `lib/commands/entity-commands.js`.
2. **Introduce** the shared predicate (or reuse an existing stage helper if one already encodes “pre-implementation”) so dashboard and CLI do not duplicate logic.
3. **Tighten** `deriveAvailableActions` / manual action guards so spec-review kinds are impossible to derive for `implementing`+ .
4. **Harden** engine append paths (`lib/workflow-core/engine.js` or event dispatch) if CLI bypass is possible.
5. **Docs**: one short paragraph in `AGENTS.md` or `docs/architecture.md` stating the contract (spec review = inbox/backlog only).

## Dependencies

- Relates to F341 first-class spec states (`spec_review_in_progress`, etc.) — implementation must remain consistent with `lib/workflow-core/machine.js` transitions.
- None blocking (no `depends_on:`).

## Out of Scope

- **Code review** / **implementation review** flows (`reviewing`, eval, close) — different actions and states.
- Kanban **column** bucketing / `LIFECYCLE_TO_STAGE` display choices.
- Automatic **git mv** of spec files between folders (reconciliation) except where already required by existing repair commands.
- **Research** vs **feature** differences beyond mirroring the same predicate for both entity kinds.

## Open Questions

- **Paused (06-paused)**: Should spec-review be allowed when paused? Default for this feature: **out of scope** — only inbox/backlog vs in-progress is in scope; paused behaviour inherits whatever the predicate says once `lifecycle` is classified (document in PR if paused is treated as “not backlog”).
- **Spec revision pending** while folder lags: if `pendingCount > 0` but folder still `02-backlog`, spec-revise must remain available — confirm predicate uses **engine** truth, not folder alone.

## Related

- Research: research-37 state machine / review-cycle redesign (historical context).
- Prior art: `AGENTS.md` dashboard read-only rule — eligibility changes belong in workflow rules + tests, not ad-hoc dashboard JS.
