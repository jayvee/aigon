---
commit_count: 6
lines_added: 303
lines_removed: 172
lines_changed: 475
files_touched: 21
fix_commit_count: 2
fix_commit_ratio: 0.333
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 200
output_tokens: 198266
cache_creation_input_tokens: 372655
cache_read_input_tokens: 19661777
thinking_tokens: 0
total_tokens: 20232898
billable_tokens: 198466
cost_usd: 10.2706
sessions: 1
model: "claude-sonnet-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 490 - patch-card-shell-duplicates
Agent: cc

## Status

**REVERTED 2026-05-07 (commit `8f0a5479`)** — F490 patched F489's card shell, but the
underlying F489 design exhibited additional defects that surfaced during the same
session (uppercase still present in eval/verdict section headers, engine-state
vocabulary leaking through, missing autonomous stage track, ad-hoc tone palettes,
section duplication). The user opted to revert F489 entirely rather than continue the
patch path; F490's diff was reverted alongside since its purpose was to fix things F489
broke, and reverting F489 makes those fixes unnecessary. Pre-F480 legacy card design is
restored as the baseline. Vocabulary work (pre-F480 commits) remains intact.

Implementation complete. 5 defects patched; all integration tests pass; 4 smoke tests pass.

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cu (code review pass)  
**Date**: 2026-05-07

### Fixes Applied

- `8f8ebb54` — `fix(review): undo out-of-scope diffs and fix solo eval card routing` — Reverted unrelated branch drift (F487 spec moved to backlog with expanded scope, `development_workflow` Key Rule 5 removal, binary tarball + op-model-video output deletions). Restored those paths to match `main`. Added `hasEvalSurface` / solo branch to `isFleet` in `templates/dashboard/js/pipeline.js` so solo features in eval still use the fleet layout and the eval section is not dropped when `agents.length === 1`.

### Validation

- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)

- **ESCALATE:ambiguous** — Title row suppresses all of `buildStateRenderBadgeHtml` when `isSoloCard`. The spec calls for suppressing only lifecycle-verb duplicates of `cardHeadline.verb`, while keeping orthogonal `stateRenderMeta` badges. If product still needs those signals inline on solo cards, narrow the condition (compare meta vs headline) in a follow-up.

### Notes

- `mark-complete` E2E and overflow selectors were updated appropriately for card-level chrome on solo cards; behaviour aligns with moving mark-complete into overflow alongside other agent actions in the status row path.
