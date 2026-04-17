# Feature: single-source-4-feedback-single-authority

## Summary
Give feedback entities a single lifecycle authority. Currently feedback uses folder-only state management with no workflow engine — it has no desync today because there's only one authority, but it's the last remaining "state = folder location" subsystem. Either add minimal workflow-core support or move to explicit status metadata (e.g. frontmatter field) with folders as a derived projection.

## User Stories
- [ ] As a user, feedback lifecycle state is managed by a single authority, consistent with how features and research work
- [ ] As a user, feedback entities cannot end up in an inconsistent state due to manual file moves

## Acceptance Criteria
- [ ] Feedback entities have a single lifecycle authority (either workflow-core or explicit status metadata)
- [ ] Folder position for feedback specs is a derived projection, not the source of truth
- [ ] The conceptual model is consistent: every entity type (features, research, feedback) follows "one authority, derived folders"

## Validation
```bash
node --check aigon-cli.js
npm test
```

## Technical Approach
- Evaluate whether minimal workflow-core support or explicit status metadata (frontmatter/state file) is the better fit for feedback's simpler lifecycle
- Implement the chosen approach
- Make feedback folder position a derived projection
- Key files: `lib/commands/feedback.js` (if it exists), `lib/state-queries.js`, feedback spec templates

## Dependencies
- depends_on: single-source-1-engine-only-spec-transitions

## Out of Scope
- Changes to feature/research state management — covered by features 1-3

## Open Questions
- Is workflow-core overkill for feedback's simpler lifecycle (inbox -> triaged -> actionable -> done/wont-fix/duplicate)?
- Would explicit frontmatter status be simpler and sufficient?

## Related
- Research: research-33-single-source-of-truth-for-feature-state
