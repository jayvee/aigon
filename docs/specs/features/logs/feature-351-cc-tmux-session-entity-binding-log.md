---
commit_count: 6
lines_added: 1057
lines_removed: 207
lines_changed: 1264
files_touched: 30
fix_commit_count: 1
fix_commit_ratio: 0.167
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
input_tokens: 171
output_tokens: 66103
cache_creation_input_tokens: 192539
cache_read_input_tokens: 13220203
thinking_tokens: 0
total_tokens: 13479016
billable_tokens: 66274
cost_usd: 28.4007
sessions: 1
model: "claude-opus-4-7"
tokens_per_line_changed: null
---
# Implementation Log: Feature 351 - tmux-session-entity-binding
Agent: cc

Sidecar gains `category` + `tmuxId` + `shellPid` (captured via `tmux display-message -p '#{session_id}\\t#{pane_pid}'` after `new-session`); `loadSessionSidecarIndex`/`pruneStaleSessionSidecars` now key on `tmuxId` when present (fallback to name); `repo`-category sidecar is written for `/api/session/ask`; `resolveTmuxTarget(tmuxId, fallbackName)` helper added; `aigon session-list` prints the table from spec; deferred: snapshot `sessions[]` array (engine-managed snapshot) and migrating existing send-keys/attach call sites to `resolveTmuxTarget`.

## Code Review

**Reviewed by**: cx
**Date**: 2026-04-25

### Fixes Applied
- `6239565d` `fix(review): revert accidental F341 rollback and unrelated F339 spec from F351 branch`

### Residual Issues
- **Snapshot `sessions[]` array deferred by implementer.** Acceptance criterion requires entity snapshots to carry a `sessions: [{ tmuxId, role, agent, createdAt }]` array. This needs engine-level snapshot changes (projector, `startFeature`, `createDetachedTmuxSession` append) and was intentionally deferred. Not safe to patch in review without expanding scope.
- **Call-site migration to `resolveTmuxTarget` deferred by implementer.** Acceptance criterion requires all internal `send-keys`, `attach`, and liveness checks to use `-t $N` instead of session names. The helper exists but is not yet wired to any callers. Touching ~8 call sites across worktree/dashboard/supervisor is a follow-on feature, not a review fix.
- **Renamed sessions lose sidecar linkage in `session-list` display.** `loadSessionSidecarIndex` keys by session name, so a renamed repo session appears without its sidecar category/agent. Routing via `resolveTmuxTarget` is unaffected because it keys on tmuxId.

### Notes
- The branch had accidentally rolled back Feature 341 (spec-review first-class engine states) across ~15 files, deleted the F341 test file, deleted the F341 log, and demoted the F341 spec from `05-done` to `03-in-progress`. An unrelated Feature 339 spec was also present in `05-done`. All restored from main in the review fix commit.
- F351 implementation code is clean: sidecar capture, category modelling, pruning by tmuxId, repo-category dashboard sessions, and the `session-list` table all match the spec and are covered by tests.
