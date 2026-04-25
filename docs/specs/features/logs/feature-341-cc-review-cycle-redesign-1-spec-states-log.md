# Implementation Log: Feature 341 - review-cycle-redesign-1-spec-states
Agent: cc

Promoted spec review/revision from sidecar context to first-class engine states with transient `*_complete` auto-backlog; added `agent:` frontmatter, owning-agent precedence resolver, migration 2.56.0, projector dual-event acceptance (legacy + new), `MISSING_MIGRATION` read-model tag, and doctor `agent:` field validation.

## Code Review

**Reviewed by**: cx
**Date**: 2026-04-25

### Fixes Applied
- `c07d461b` `fix(review): drop unrelated research-submit changes`
- `32097d36` `fix(review): complete spec review lifecycle transitions`

### Residual Issues
- None

### Notes
- Restored unrelated `research-submit` / `research-draft` churn that had leaked into the branch from other feature work.
- Fixed the spec-review producer path so recording review/revision completion now emits the matching `*_completed` workflow events and returns the lifecycle to backlog as designed.
- Verified with `node tests/integration/review-cycle-redesign-states.test.js`.
