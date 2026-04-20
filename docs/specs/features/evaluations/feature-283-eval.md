# Evaluation: Feature 283 - rethink-spec-review-workflow-state

**Mode:** Fleet (Multi-agent comparison)
**Evaluator:** cc (same-family bias warning applies — cc is evaluating itself among others; bias acknowledged)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-283-rethink-spec-review-workflow-state.md`

The spec strongly recommended **Option B** (workflow-engine events), listing 5 reasons: alignment with CLAUDE.md Write-Path Contract, ending the "engine never saw spec-reviews" bug class permanently, feature-close gets gating for free, dashboard already reads snapshots, and one-shot bounded migration. Option A (per-entity JSON file) was listed as "acceptable fallback."

## Implementations to Compare

- **cc** (Claude): Option A — per-entity JSON file (`.aigon/workflows/<kind>/<id>/spec-review.json`)
- **cu** (Cursor): Option B — workflow-engine events, entity-prefixed (`feature.spec_review.*`, `research.spec_review.*`)
- **cx** (Codex): Option B — workflow-engine events, entity-agnostic (`spec_review.*`) with `reviewId` for per-review granularity

## Evaluation Criteria

| Criteria | cc | cu | cx |
|---|---|---|---|
| Code Quality | 8/10 | 8/10 | 9/10 |
| Spec Compliance | 6/10 | 9/10 | 8/10 |
| Performance | 8/10 | 8/10 | 9/10 |
| Maintainability | 7/10 | 7/10 | 8/10 |
| **Total** | **29/40** | **32/40** | **34/40** |

## Summary

| Agent | Lines | Score |
|---|---|---|
| cc | 518/+, 1155/- | 29/40 |
| cu | 629/+, 1258/- | 32/40 |
| cx | 710/+, 1115/- | 34/40 |

All three implementations pass `npm test` and the 2000-LOC test budget.

### Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - Cleanest, most focused implementation; smallest diff (34 files)
  - Self-contained `lib/spec-review-state.js` module with explicit reviewer-id validation (rejects `unknown`)
  - Lazy migration with idempotent marker file — no new upgrade code path
  - Auto-ack-with-warning on `feature-close` matches the spec's "Lean" on the open question
  - Dedup fix in `mergeSpecReviewActions` via shared `mergeByKey` helper addresses the duplicate "Review spec" symmetrically
- Weaknesses:
  - **Chose Option A when spec strongly recommended Option B.** Does not fix the "engine never saw spec-reviews" class of bug the spec called out as the most important outcome
  - Creates a parallel state system (JSON file alongside engine snapshot) — two sources of truth for a lifecycle concern
  - `feature-close` reads JSON directly instead of the engine snapshot it already has
  - Reviewer validation is narrow regex (`/^[a-z]{2,10}$/`) — rejects `unknown` but doesn't cross-check against agent-registry

#### cu (Cursor)
- Strengths:
  - Follows spec-recommended Option B; events live in workflow-core event log
  - Properly registered semver migration at **2.53.0** with package.json version bump
  - `AIGON_AGENT_ID:?set AIGON_AGENT_ID` in the commit template — shell-level fail-fast prevents `Reviewer: unknown` at the source
  - Auto-ack-with-warning on close matches the spec's "Lean" on the open question
  - Sensible modular split (`spec-review-derive.js`, `spec-review-record.js`, `spec-review-git.js`, `spec-review-git-backfill.js`) — single-responsibility modules
  - Extensive log sketch (single-line summary) is fine; implementation stands on its own
- Weaknesses:
  - Events are entity-scoped (`feature.spec_review.*` / `research.spec_review.*`) instead of entity-agnostic — more duplication in projector
  - **No `reviewId`** on events — any ack clears ALL pending reviews, losing per-review granularity (same limitation as cc)
  - Projector needs a full context-reseed for spec-review events (workaround in `applyEventsUnlocked`) — architectural smell
  - 4 new files vs. CX's 2; more surface area to reason about
  - Implementation log is terse (2 bullets) — other agents documented decisions more fully

#### cx (Codex)
- Strengths:
  - Follows spec-recommended Option B with cleanest engine design: entity-agnostic `spec_review.submitted` / `spec_review.acked` events, shared projector helpers (`refreshSpecReviewState`, `buildSpecReviewSummary`)
  - **Per-review `reviewId` tracking** — enables granular ack semantics (clear specific reviews, not all-or-nothing)
  - `ensureEntityBootstrapped` helper solves the inbox-review edge case elegantly
  - **Slug-to-numeric workflow-id migration** in `entity.js` handles the real-world case where reviews submitted on an inbox entity survive prioritisation — unique to CX and addresses a bug the spec didn't explicitly call out
  - Most comprehensive `docs/architecture.md` update: adds authority table rows for feature + research spec-review and a full paragraph on the write-path contract
  - Three focused tests covering dashboard actions, label uniqueness, and migration — all under budget
  - Added engine helpers (`recordSpecReviewSubmitted`, `recordSpecReviewAcknowledged`) are reusable API surface
- Weaknesses:
  - **Blocks close** on pending spec-reviews instead of auto-acking — diverges from the spec's explicit "Lean: auto-ack-with-warning" on the open question. Will be more disruptive in solo-mode flows where reviewer suggestions are folded into the spec directly
  - Migration registered at **2.52.1** (current shipped version) instead of a new release version — may not trigger cleanly for users already at 2.52.1
  - Largest engine diff (112 lines in `engine.js`) — more invasive change to the most critical module
  - Some dashboard-side remnants (`getSpecReviewEntries` still calls `snapshotToDashboardActions`) — technically still fine but less clean than CU's rewrite

## Recommendation

**Winner:** cx (Codex) — best engine design and highest spec alignment with Option B, plus an unrequested-but-valuable fix for the slug-to-numeric prioritisation edge case.

**Rationale:** CX delivers the spec's strong-recommended Option B with the cleanest engineering: entity-agnostic events, `reviewId` granularity, reusable engine helpers, and comprehensive docs. CU is a close second with the same Option B choice and better spec-aligned close policy. CC chose Option A despite the spec's strong lean toward B.

**Before merging, consider adopting from `cu`:**
1. **Auto-ack-with-warning close policy** (from `lib/spec-review-record.js` `autoAckPendingSpecReviews` and its call site in `lib/feature-close.js`). The spec explicitly leaned to auto-ack over blocking, citing solo-mode pragmatism: "reviewer suggestions were already folded into the spec directly". CX's blocking policy will surprise users mid-close flow. Swap CX's `canCloseFeature` pending-review branch for an auto-ack-and-warn pre-close step.
2. **Semver migration at 2.53.0** (from `lib/migration.js` registration and `package.json` bump). CX registered the migration at the current shipped version 2.52.1, which may not trigger for users already on that version. Bump to 2.53.0 on merge to guarantee the backfill runs.
3. **Shell-level `AIGON_AGENT_ID:?` guard** (from `templates/generic/commands/feature-spec-review.md`). CX uses a separate `test -n` check; CU's inline `:?` fails the commit itself, closer to a proper forcing function.

Everything else worth having is already in CX.
