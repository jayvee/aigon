# Implementation Log: Feature 205 - add-research-review-step-to-research-workflow
Agent: cc

## Plan

Mirror the existing feature-review pattern across all layers: workflow engine, state management, CLI commands, dashboard integration, and agent instructions.

## Progress

- [x] Added `RESEARCH_REVIEW` to `ManualActionKind` enum in types.js
- [x] Added `reviewing` state to research state machine with transitions
- [x] Added `isReviewing` guard to XState machine
- [x] Added `research.review_requested` handling in projector and engine
- [x] Added `requestResearchReview()` engine function
- [x] Created `lib/research-review-state.js` (mirrors feature-review-state.js)
- [x] Added `research-review` command handler in research.js
- [x] Created `templates/generic/commands/research-review.md` agent instructions
- [x] Extended `agent-status` to support research review statuses
- [x] Updated dashboard server to handle research review launches
- [x] Added `RESEARCH_REVIEW` action descriptor in snapshot adapter
- [x] Added `readResearchReviewState()` in workflow-read-model.js
- [x] Updated `buildRawAgentCommand` to handle research-review task type
- [x] Added `research-review` to cc.json agent commands
- [x] Regenerated workflow diagrams
- [x] All syntax checks pass

## Decisions

- Used `allAgentsReady` guard for research review (vs `soloAllReady` for features) since research typically runs in fleet mode where all agents should submit before review
- Review state stored in `.aigon/workflows/research/{id}/review-state.json` (same pattern as features)
- Research review uses `getEventsPathForEntity` and `getEntityRoot` instead of feature-specific path functions
- The `research-review` command validates all agents submitted before allowing review (with `--force` override)
- Dashboard `handleLaunchReview` now supports both feature and research entities via `isResearch` flag
