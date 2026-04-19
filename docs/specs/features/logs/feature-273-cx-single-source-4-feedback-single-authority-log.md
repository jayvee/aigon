# Implementation Log: Feature 273 - single-source-4-feedback-single-authority
Agent: cx

## Plan
- Make feedback frontmatter `status` the lifecycle authority without moving feedback into workflow-core.
- Extend the shared spec reconciler so feedback folder placement is a derived projection of metadata status.
- Update feedback list and dashboard read paths to derive stage from metadata, reconcile drift, and ignore manual folder moves as lifecycle signals.

## Progress
- Updated `lib/feedback.js` so feedback reads no longer fall back to folder-derived status and so collection can target any repo path.
- Extended `lib/spec-reconciliation.js` to reconcile feedback specs from metadata status into the expected feedback folder, with the same logged correction shape used for other entities.
- Updated `lib/commands/feedback.js` so `feedback-list` scans all feedback specs, runs reconciliation through the shared helper, and filters by metadata status instead of folder location.
- Updated `lib/dashboard-status-collector.js` so dashboard feedback rows come from parsed feedback metadata rather than hardcoded per-folder stage scanning.
- Updated `AGENTS.md`, `CLAUDE.md`, and `docs/architecture.md` to document feedback's new single-authority model and the shared reconciler's broader scope.

## Decisions
- Kept feedback outside workflow-core as required by the spec; the authority is frontmatter `status`, not folder position and not engine state.
- Kept reconciliation one-way for feedback just like workflow-backed entities: metadata status determines the visible folder, and manual `git mv` becomes cosmetic drift corrected on supported read paths.
- Avoided adding new feedback-specific state files or background processes; read-time reconciliation and existing write paths were enough to satisfy the lifecycle consistency requirements.
- Made the shared reconciler self-contained for feedback status normalization to avoid import-order issues from pulling feedback helpers into a module already used widely across the codebase.

## Validation
- `node --check lib/feedback.js`
- `node --check lib/spec-reconciliation.js`
- `node --check lib/commands/feedback.js`
- `node --check lib/dashboard-status-collector.js`
- `node --check aigon-cli.js`
- Temporary repo smoke check: a feedback spec with `status: duplicate` placed in `01-inbox` was reconciled to `06-duplicate` and then read back as `duplicate`.
- `aigon feedback-list --all`
- `env -u AIGON_INVOKED_BY_DASHBOARD npm test`
- `env -u AIGON_INVOKED_BY_DASHBOARD aigon server restart`

## Issues Encountered
- `npm test` initially failed in `tests/integration/feature-close-restart.test.js`, but the failure was environmental rather than feature-related: this Codex session runs with `AIGON_INVOKED_BY_DASHBOARD=1`, which intentionally suppresses restart behavior in that test's first assertion.
- The first feedback reconciliation implementation hit circular-dependency issues when `spec-reconciliation.js` pulled feedback status helpers through existing shared module load paths. That was resolved by making feedback status normalization local to the reconciler.

## Conversation Summary
- The work followed the prepared feature worktree and spec directly.
- No user clarification was needed; the implementation focused on aligning feedback with the repo's single-authority lifecycle model while preserving feedback's non-engine status.
