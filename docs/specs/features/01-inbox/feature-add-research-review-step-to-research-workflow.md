# Feature: Add research-review step to research workflow

## Summary
Add a `research-review` lifecycle step to the research workflow, mirroring the existing `feature-review` pattern. After a research agent submits findings, a different agent reviews the findings for rigor, completeness, and accuracy — then makes targeted improvements. This brings research to parity with features, which already have a review step.

## User Stories
- [ ] As a user running solo research, I can run `/aigon:research-review 01` after findings are submitted, and a different agent reviews and refines the findings
- [ ] As a user running fleet research, I can trigger research-review from the dashboard after agents submit
- [ ] As a user, I can see review status (reviewing / review complete) on the research dashboard card
- [ ] As a user, I can peek into the review agent's session from the dashboard

## Acceptance Criteria
- [ ] `aigon research-review <ID>` command exists and launches a review agent in the research worktree
- [ ] Research workflow state machine has a `reviewing` state between `implementing` and `evaluating`
- [ ] `research.review` event transitions from `implementing` → `reviewing` (guard: all agents ready)
- [ ] Dashboard card shows review section with agent name, status icon, and peek button
- [ ] `RESEARCH_REVIEW` action appears in dashboard validActions when research is in `implementing` state with all agents ready
- [ ] Agent instructions template (`templates/generic/commands/research-review.md`) guides the reviewer on what to check
- [ ] `agent-status review-complete` works for research entities (not just features)
- [ ] Review state is tracked in `.aigon/workflows/research/{id}/review-state.json` (mirroring feature-review-state.js)
- [ ] Syntax check passes: `node -c lib/commands/research.js && node -c lib/research-workflow-rules.js`

## Validation
```bash
node -c lib/commands/research.js
node -c lib/research-workflow-rules.js
node -c lib/workflow-read-model.js
node -c lib/workflow-snapshot-adapter.js
node -c lib/workflow-core/types.js
node -c lib/commands/misc.js
```

## Technical Approach

### Workflow state machine changes (`lib/research-workflow-rules.js`)
- Add `reviewing` state with transitions: can re-run `research.review`, transition to `evaluating`, or `closing`
- Add `RESEARCH_REVIEW` to action candidates (recommendedOrder ~53, between start and eval)
- Guard: `allAgentsReady` (same as eval transition guard — all agents must have submitted)

### New: research review state module (`lib/research-review-state.js`)
- Mirror `lib/feature-review-state.js` (~220 lines)
- Manages `.aigon/workflows/research/{id}/review-state.json`
- Functions: `startReview()`, `completeReview()`, `markReviewing()`, `reconcileReviewState()`, `readReviewState()`

### Command handler (`lib/commands/research.js`)
- Add `'research-review'` handler
- Validates research is in-progress with all findings submitted (or `--force`)
- Resolves worktree path, emits `research.review` event
- Delegates to slash command template (doesn't execute review itself)

### Agent instructions (`templates/generic/commands/research-review.md`)
- Review checklist: methodology rigor, completeness vs research questions, accuracy of conclusions, evidence quality, missing edge cases
- Constraint: MAY refine findings, add nuance, correct errors; MUST NOT change research direction or scope
- Must run `aigon agent-status review-complete` when done

### Engine & types
- `lib/workflow-core/types.js`: add `RESEARCH_REVIEW: 'research-review'` to ManualActionKind
- `lib/workflow-core/projector.js`: handle `research.review_requested` event
- `lib/workflow-core/engine.js`: add `requestResearchReview()` function

### Dashboard integration
- `lib/workflow-snapshot-adapter.js`: map `reviewing` state for research, add RESEARCH_REVIEW action descriptor
- `lib/workflow-read-model.js`: add `readResearchReviewState()` function
- `templates/dashboard/js/pipeline.js`: render review section on research cards (reuse feature review rendering pattern)

### Agent config
- `templates/agents/cc.json`: add `research-review` to commands array

### agent-status compatibility (`lib/commands/misc.js`)
- Ensure `reviewing` and `review-complete` statuses work for research entities (currently feature-gated at line ~122)

## Dependencies
- The research/feature parity fix for `agent-status submitted` signal emission (just fixed in this session)

## Out of Scope
- Auto-triggering review (user manually initiates, same as feature-review)
- Multi-round review cycles (can be added later)
- Review for non-CC agents (only CC has review prompts currently)

## Open Questions
- Should research-review happen before or after eval? Proposed: before eval (review individual findings, then eval synthesizes). But could also be after eval to review the synthesis itself.
- Should fleet research review each agent's findings separately, or review all findings together?

## Related
- Feature review implementation: `lib/feature-review-state.js`, `templates/generic/commands/feature-review.md`
- Research workflow rules: `lib/research-workflow-rules.js`
- Parity fix: agent-status submitted signal emission for research (this session)
