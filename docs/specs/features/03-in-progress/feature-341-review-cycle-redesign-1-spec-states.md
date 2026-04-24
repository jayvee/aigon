---
complexity: very-high
set: review-cycle-redesign
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-24T23:50:02.865Z", actor: "cli/feature-prioritise" }
---

# Feature: review-cycle-redesign-1-spec-states

## Summary

Promote spec review from context properties (`context.specReview`, `bypassMachine: true`) to first-class XState engine states, add the `agent:` frontmatter field that owning-agent resolution depends on, and add the spec-revision state pair so the spec-side review cycle is fully governed by the workflow engine. This feature lands the foundational state-machine work the rest of the `review-cycle-redesign` set builds on.

## User Stories

- [ ] As an operator, when I see "● Reviewing spec" on the dashboard, I want that badge driven by `currentSpecState`, not a sidecar context blob.
- [ ] As an operator, I want `feature-create --agent cc` to record the owning agent in spec frontmatter so revision routing is deterministic.
- [ ] As an implementer, I want spec review and spec revision to be reachable through the XState machine so guards/transitions are enforceable instead of bolted on.
- [ ] As a maintainer, I want `bypassMachine: true` removed from spec-review action candidates so future review features stop compounding.

## Acceptance Criteria

- [ ] `FEATURE_ENGINE_STATES` and `RESEARCH_ENGINE_STATES` carry `spec_review_in_progress`, `spec_review_complete`, `spec_revision_in_progress`, `spec_revision_complete`.
- [ ] `lib/workflow-core/machine.js` builds an `always:` transient for each `*_complete` state via a `TRANSIENT_STATES` set in the rules file (Option A from research).
- [ ] `FEATURE_SPEC_REVIEW` and `FEATURE_SPEC_REVISE` action candidates no longer carry `bypassMachine: true`; they emit machine-transition events.
- [ ] `cli-parse.js parseFrontMatter` accepts an `agent:` scalar; `entityCreate` writes it when `--agent <id>` is passed; `feature-start` seeds `context.authorAgentId` from it; `aigon doctor --fix` flags + repairs missing/invalid values.
- [ ] Owning-agent resolution for spec revision: event payload `nextReviewerId` → frontmatter `agent:` → `context.authorAgentId` → `getDefaultAgent()`.
- [ ] Versioned migration in `lib/migration.js` rewrites legacy snapshots: `specReview.activeReviewers.length > 0` → `currentSpecState = 'spec_review_in_progress'`; pendingCount-only → `spec_revision_in_progress`. Idempotent.
- [ ] Projector accepts BOTH old (`spec_review.*`) and new (`feature.spec_review.*` / `feature.spec_revision.*`) events for one release; emits `console.warn` when projecting legacy events.
- [ ] Snapshots that carry `specReview` without matching engine state produce `MISSING_MIGRATION` read-model tag and cite `aigon doctor --fix` — no silent degrade.
- [ ] `LIFECYCLE_TO_STAGE` (`workflow-snapshot-adapter.js`) and `LIFECYCLE_TO_FEATURE_DIR` (`workflow-core/paths.js`) updated for every new state.
- [ ] Tests pin the producer/consumer invariants (see Validation).

## Validation

```bash
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh
```

Specific test files (new or updated):
- `tests/integration/spec-review-status.test.js` — `validActions` for new spec-review states; legacy → new event projection equivalence.
- `tests/integration/agent-frontmatter-resolution.test.js` (new) — frontmatter precedence chain; doctor repair.
- `tests/integration/missing-migration-detection.test.js` (new) — partial state → fail-loudly.
- `tests/workflow-core/projector-spec-review.test.js` (new) — old + new event log produces equivalent projected state.

## Pre-authorised

- May raise `scripts/check-test-budget.sh` CEILING by up to +60 LOC if regression tests for migration idempotency and dual-event acceptance require it.

## Technical Approach

**Files touched (write paths):**
- `lib/feature-workflow-rules.js`, `lib/research-workflow-rules.js` — add states + `TRANSIENT_STATES` set; convert `FEATURE_SPEC_REVIEW`/`FEATURE_SPEC_REVISE` to machine-governed action candidates.
- `lib/workflow-core/machine.js` — `buildStateConfig()` switches on `TRANSIENT_STATES.has(name)` to emit `{ always: [...] }`; new guards (`isBacklog`, `isSpecReviewInProgress`, etc.).
- `lib/workflow-core/projector.js` — new event cases (`feature.spec_review.started`, `.completed`; `feature.spec_revision.started`, `.completed`); legacy `spec_review.*` cases retained with `console.warn`.
- `lib/workflow-core/engine.js` — `recordSpecReview*()` rewrite to emit machine events; `applySpecReviewEventToContext()` narrowed to context-only fields.
- `lib/workflow-core/paths.js` — extend `LIFECYCLE_TO_FEATURE_DIR`.
- `lib/workflow-snapshot-adapter.js` — extend `LIFECYCLE_TO_STAGE`.
- `lib/spec-crud.js`, `lib/cli-parse.js` — frontmatter `agent:` read/write helpers.
- `lib/commands/entity-commands.js` — `feature-create --agent` flag; spec-revise resolver.
- `lib/feature-start.js` — seed `authorAgentId` from frontmatter.
- `lib/commands/setup.js` — `doctor --fix` checks `agent:` is registered.
- `lib/migration.js` — versioned migration with backup/restore/validate.
- `templates/specs/feature-template.md`, `templates/specs/research-template.md` — document `agent:` field.

**Open architectural decision (must resolve in spec-review):**
- Is `backlog` itself a real XState state (op's path — machine governs spec review from root) or does it remain a projector-set value with `hydrating` gaining transitions to the new review states (cc's path — less invasive)? See research-37 §2 and op's findings §Q1. Default to cc's path unless spec-review pushes back.

**Read-path consumers updated in lockstep (per AGENTS.md §Write-Path Contract):**
- `lib/dashboard-status-collector.js` `applySpecReviewFromSnapshots()` — derive from `currentSpecState` + `reviewCycles[]` (cycles array stub introduced here, populated in feature 3).
- `lib/workflow-read-model.js` `readSpecReviewSessions` / `readSpecCheckSessions` — read engine state, not `specReview.activeReviewers`.

## Dependencies

-

## Out of Scope

- Code review states (rename `reviewing` → `code_review_in_progress`) — feature 2.
- `reviewCycles[]` projected context array population for multi-cycle history — feature 3.
- Sidecar `lib/feature-review-state.js` deletion — feature 3.
- Dashboard `STATE_RENDER_META` collapse — feature 4.
- Autonomous multi-cycle configuration (multiple reviewers declared upfront) — future research.

## Open Questions

- Resolve `backlog` as XState state vs projector-only value before implementation; document the chosen path in the technical approach.
- Should the legacy `console.warn` log line in projector be a metric/counter instead, so observability picks up legacy event volume during the migration window?

## Related

- Research: #37 State Machine & Review Cycle Redesign
- Set: review-cycle-redesign
- Prior features in set: <!-- none — this is feature 1 -->
