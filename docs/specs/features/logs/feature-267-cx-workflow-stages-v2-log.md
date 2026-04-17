# Implementation Log: Feature 267 - workflow-stages-v2
Agent: cx

## Plan
- Extend saved workflow definitions to accept either legacy flat fields or `version: 2` stage arrays.
- Keep v1 workflows unchanged while teaching `feature-autonomous-start` to execute v2 stage pipelines.
- Add focused integration coverage for validation, CLI create/show, and stage runtime derivation.

## Progress
- Ran `aigon feature-do 267` from the existing worktree and implemented directly in the current checkout.
- Added stage normalization, validation, legacy-to-stage derivation, and v2 runtime shaping in `lib/workflow-definitions.js`.
- Updated `aigon workflow create/show/list` handling in `lib/commands/misc.js` to support `--version 2 --stage ...`.
- Added a stage-based AutoConductor path in `lib/commands/feature.js` while preserving the existing flat v1 loop.
- Updated orientation/help docs in `AGENTS.md`, `docs/architecture.md`, and `templates/help.txt`.
- Added integration tests for v2 workflows in `tests/integration/workflow-definitions.test.js`.
- Validation status:
  - `node -c aigon-cli.js`
  - `node -c lib/workflow-definitions.js`
  - `node -c lib/commands/feature.js`
  - `node -c lib/commands/misc.js`
  - `node tests/integration/workflow-definitions.test.js`
  - `npm test` still fails in `tests/integration/pro-gate.test.js` because this checkout does not have the installed `@aigon/pro` setup those assertions expect; the workflow-definition suite passed.

## Decisions
- Stage-based workflows require `version: 2` and reject mixed flat keys so saved definitions have one canonical shape.
- Validation only allows linear pipelines supported by the current executor:
  - solo: `implement -> (review -> counter-review)* -> [close]`
  - fleet: `implement -> eval -> [close]`
- `counter-review` is modeled as the implementing agent addressing review feedback in the existing session, which reuses the current `feature-review-check` and `feedback-addressed` signaling instead of inventing a new runtime channel.
- The new AutoConductor path is opt-in for v2 workflows only; legacy flat workflows keep the original stop-after/review/eval behavior untouched.
- Validation exposed two follow-up fixes during implementation:
  - repaired a syntax typo in the new workflow test
  - treated empty `stages`/legacy arrays as unset so v1 CLI create continues to work and v2 create no longer falsely reports mixed schema

## Conversation Summary
- User requested implementation of feature 267 from the already-prepared worktree via `aigon feature-do 267`.
- Work completed in-place without re-running `feature-start`, with required status signaling and commit checkpoints during implementation.
