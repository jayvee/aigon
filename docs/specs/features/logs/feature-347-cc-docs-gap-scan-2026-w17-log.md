---
commit_count: 4
lines_added: 272
lines_removed: 4
lines_changed: 276
files_touched: 9
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 131
output_tokens: 77104
cache_creation_input_tokens: 282740
cache_read_input_tokens: 7847205
thinking_tokens: 0
total_tokens: 8207180
billable_tokens: 77235
cost_usd: 4.5714
sessions: 1
model: "claude-sonnet-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 347 - docs-gap-scan-2026-w17
Agent: cc

## Status
Complete. Internal docs and site updated for all shipped features since last doc update.

## New API Surface
Three new site reference pages: `feature-code-revise.mdx`, `session-list.mdx`, `token-window.mdx`.

## Key Decisions
- Internal doc SHA baseline: `2c29da65` (last AGENTS.md/architecture.md/dev-workflow.md touch); site SHA baseline: `375d8f87`.
- F342 code review states were undocumented in both AGENTS.md and docs/architecture.md despite F341 spec review states being well-covered — added parallel note and updated Workflow Authority Split table.
- `lib/feature-review-state.js` description updated to reflect F342 writer deprecation; the authoritative signal is now the engine snapshot, not the sidecar.
- F350 terminal registry API was already in docs/architecture.md but missing from AGENTS.md module map — added.
- `feature-autopilot` stale entry removed from `site/content/reference/commands/index.mdx`; the page itself already says "removed" so no content change needed there.
- `agent-status reviewing` is still a valid CLI signal (maps to `code_review_in_progress`) so site references to it are not stale.

## Gotchas / Known Issues
None.

## Explicitly Deferred
- Many commands (`init`, `install-agent`, `sync`, `doctor`, etc.) still have no site reference pages. These predate the SITE_SHA baseline and were not introduced by the recently-shipped features — out of scope for this weekly scan.

## For the Next Feature in This Set
Recurring — next week's scan should use this week's HEAD as the new baseline.

## Test Coverage
Docs-only change — no new logic. `npm test` passes (syntax check + existing suite).
