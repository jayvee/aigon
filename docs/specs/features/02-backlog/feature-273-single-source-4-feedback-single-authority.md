# Feature: single-source-4-feedback-single-authority

## Summary
Give feedback entities a single lifecycle authority by making frontmatter `status` the source of truth. Feedback does not move into workflow-core in this feature. Folder position becomes a derived projection of `status`, and manual folder moves become cosmetic drift rather than lifecycle mutation.

## User Stories
- [ ] As a user, feedback lifecycle state is managed by a single authority, consistent with how features and research work
- [ ] As a user, feedback entities cannot end up in an inconsistent state due to manual file moves
- [ ] As a user, feedback list/dashboard views show status from feedback metadata, not from whatever folder the file currently sits in

## Acceptance Criteria
- [ ] Feedback frontmatter `status` is the single lifecycle authority
- [ ] Folder position for feedback specs is a derived projection, not the source of truth
- [ ] Feedback commands update `status` metadata first, then project the file into the folder derived from that status
- [ ] Feedback read paths derive stage/status from parsed metadata, not parent folder name
- [ ] If feedback frontmatter `status` and folder position disagree, `status` wins and the file is moved to the status-derived folder
- [ ] Manual `git mv` of a feedback file becomes cosmetic drift, not a lifecycle mutation
- [ ] The conceptual model is consistent: every entity type follows "one authority, derived folders", even if the authority differs by entity type

## Validation
```bash
node --check aigon-cli.js
npm test
```

Manual scenarios:
- [ ] Feedback file with `status: duplicate` in wrong folder -> read/write reconciliation moves it to the duplicate folder
- [ ] `feedback-triage` changes status without relying on current folder to determine the next lifecycle state
- [ ] Dashboard/listing renders feedback stage from metadata even if the file starts in the wrong folder

## Technical Approach
- Keep feedback outside workflow-core for now; use existing frontmatter metadata as the authority
- Add or centralize helpers to parse canonical feedback status from metadata, compute the expected folder from status, and reconcile folder projection when file location drifts
- Update feedback commands so status transitions are driven by metadata, not current folder
- Update dashboard/listing/read-side code so feedback stage comes from metadata
- Key files: `lib/commands/feedback.js`, `lib/feedback.js`, `lib/dashboard-status-collector.js`, `lib/state-queries.js`, feedback spec templates

## Dependencies
- depends_on: single-source-1-engine-only-spec-transitions

## Out of Scope
- Changes to feature/research state management — covered by features 1-3
- Moving feedback into workflow-core

## Open Questions
- None

## Related
- Research: research-33-single-source-of-truth-for-feature-state
