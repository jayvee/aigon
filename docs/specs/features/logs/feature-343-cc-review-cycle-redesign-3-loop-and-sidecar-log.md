# Implementation Log: Feature 343 - review-cycle-redesign-3-loop-and-sidecar
Agent: cc

## Status

Complete. All acceptance criteria implemented, tested, and validated.

## New API Surface

- `engine.recordCodeRevisionCompleted(repo, entityType, id, { requestAnotherCycle, nextReviewerId })` — passes loopback fields through to the event store.
- `snapshot.reviewCycles[]` — populated by projector on each `code_revision.completed` with `requestAnotherCycle: true`.
- `snapshot.pendingCodeReviewer` / `snapshot.pendingSpecReviewer` — set when loopback fires; cleared when next review starts.
- `ManualActionKind.FEATURE_CODE_REVIEW_CYCLE` / `FEATURE_PROCEED_AFTER_REVIEW` — new dashboard action kinds for the two choices from `code_revision_in_progress`.
- `migration/2.58.0` — replays sidecar `review-state.json` history into engine `events.jsonl`, backs up sidecar to `.aigon/state/migrations-backup/2.58.0/`, deletes sidecar. Idempotent via event-signature deduplication.

## Key Decisions

- **Projector owns loopback**: `code_revision.completed` with `requestAnotherCycle=true` sets lifecycle to `code_review_in_progress` directly in the projector. The XState machine mirrors this via the `anotherCycleRequested` guard + `recordNextCycle` action in the `always:` block of `code_revision_complete`.
- **`reviewCycles[]` is cycle-history only**: entries are appended only when a cycle completes via loopback. A single-cycle review (no loopback) leaves `reviewCycles` empty; the existing `codeReview` field covers that case in `deriveReviewStateFromSnapshot`.
- **Sidecar deletion is clean**: `lib/feature-review-state.js` and `lib/research-review-state.js` are deleted outright per pre-authorisation. `feature-autonomous.js` now uses engine snapshot state for review completion detection.
- **Test budget**: trimmed 3 new test files to 119 LOC total to stay under the 4400 LOC ceiling (landed at 4399). Pre-authorised +60 ceiling was not needed.

## Gotchas / Known Issues

- The `spec_revision_complete` loopback is wired in the machine and projector (sets `pendingSpecReviewer`, loops to `spec_review_in_progress`), but no dashboard action candidate surfaces it yet — the spec deferred `spec_revision_complete` UI to feature 4.

## Explicitly Deferred

- `STATE_RENDER_META` dashboard collapse and spec revision loopback UI — feature 4.
- AutoConductor multi-cycle pre-configured plan — future research.

## For the Next Feature in This Set

- `snapshot.reviewCycles[]` is the canonical review history. Feature 4 should consume it for timeline rendering.
- `pendingCodeReviewer` / `pendingSpecReviewer` are in the snapshot — launch paths can consume them to pass the next reviewer to `buildAgentLaunchInvocation` without reading the sidecar.
- The `deriveReviewStateFromSnapshot` helper in `workflow-read-model.js` now handles all review-status/session derivation from the engine snapshot + tmux. No further sidecar cleanup needed.

## Test Coverage

- `tests/workflow-core/review-cycles-projection.test.js` — projector loopback + machine guard
- `tests/integration/review-cycle-loopback.test.js` — full CLI round-trip (1 and 2 cycle scenarios)
- `tests/integration/sidecar-migration.test.js` — migration 2.58.0 replay + idempotency
- Updated `tests/integration/dashboard-review-statuses.test.js` — replaced sidecar `writeReviewState` with engine events
- Updated `tests/integration/review-cycle-redesign-states.test.js` — unchanged (F341/F342 regression tests still valid)
