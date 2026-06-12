---
commit_count: 5
lines_added: 250
lines_removed: 6
lines_changed: 256
files_touched: 4
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 0
output_tokens: 0
cache_creation_input_tokens: 0
cache_read_input_tokens: 0
thinking_tokens: 0
total_tokens: 0
billable_tokens: 0
cost_usd: 0
sessions: 1
model: "openai-codex"
tokens_per_line_changed: null
---
# Implementation Log: Feature 549 - reviewer-surfacing-in-detail-view
Agent: cx

## Status

Implemented in `0867d927`. The feature detail drawer now surfaces code-review participants
that are present in workflow snapshots but absent from `snapshot.agents`.

## New API Surface

`buildDetailPayload()` now includes `participantAgents`, derived from
`snapshot.codeReview`, `snapshot.pendingCodeReviewer`, and code `reviewCycles`. Detail
events for code review/revision are decorated with `displayLabel` and `displayActor` so the
frontend can render human labels without reparsing workflow event variants.

## Key Decisions

Kept the engine snapshot contract intact: reviewers and revision agents are read-only
participants in the dashboard payload, not new `snapshot.agents` entries. The Agents tab
receives synthetic rows only at the detail payload boundary, preserving existing lifecycle
and analytics assumptions. The agentless implementation-log fallback still keys off the
original implementation-agent list, so adding reviewer rows does not regress the previous
post-close fallback work from feature 548.

## Gotchas / Known Issues

Stats still depends on existing telemetry/deep-status sources for real token and cost data.
When a reviewer has no telemetry row, the detail tab adds an explicit "no cost data
(reviewer)" placeholder instead of inventing usage.

## Explicitly Deferred

No attempt was made to capture new transcript cost for CLI reviewers or to change reviewer
assignment semantics. Browser rendering now consumes derived payload metadata; broader
analytics rollups remain out of scope.

## For the Next Feature in This Set

The detail drawer now has a small payload-level participant model. If later detail-fidelity
features need to surface non-implementer actors, prefer extending this derived participant
shape over mutating workflow-core snapshots or adding frontend-only event parsing.

## Test Coverage

Validation passed with `npm run test:iterate`, including eslint on `lib/dashboard-server.js`,
workflow diagram checks, four scoped integration tests, and the dashboard Playwright smoke
suite. Added `tests/integration/dashboard-detail-reviewer-participants.test.js` to pin that
solo-worktree reviewers/revision agents appear in the detail payload while
`rawManifest.agents` remains implementer-only.

## Code Review

**Reviewed by**: cc (Opus)
**Date**: 2026-06-12

### Fixes Applied
- `d835c7fd` fix(review): decorate code_revision.started events for label parity — projector emits both `code_revision.started` and `code_revision.completed`; only the latter had a `displayLabel`, leaving the timeline asymmetric.

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None

### Notes
- Read-model contract preserved: `snapshot.agents` untouched; participants derived at payload boundary.
- `implementationAgentIds` snapshotted before reviewer injection so the agentless implementation-log fallback (F548) still keys off implementers only — correct.
- Cost table synthetic injection uses `hasRealData: false`, so token cells render `n/a`; reviewer rows get the "no cost data (reviewer)" model-cell note. Matches acceptance criteria.
- Edge case observation (not a bug): if the same agent ever both implements and reviews a feature, the merged `roles` would drop the implicit "implementer" label since implementer rows carry no `roles` field. Solo-worktree forbids this today; worth noting only if the model changes.
