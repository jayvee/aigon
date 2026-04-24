---
commit_count: 5
lines_added: 135
lines_removed: 228
lines_changed: 363
files_touched: 23
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 248
output_tokens: 82158
cache_creation_input_tokens: 295522
cache_read_input_tokens: 19517097
thinking_tokens: 0
total_tokens: 19895025
billable_tokens: 82406
cost_usd: 40.9823
sessions: 2
model: "claude-opus-4-7"
tokens_per_line_changed: null
---
Extended `agent-status submitted` to accept `<ID> <agent>` explicit args (auto-detects entity type from snapshot) and removed the duplicate `research-submit` command.

## Code Review

**Reviewed by**: cursor (Composer)
**Date**: 2026-04-25

### Fixes Applied

- `fix(review): skip feature branch gates for explicit agent-status submitted` — Explicit `aigon agent-status submitted <ID> <agent>` for a **feature** was still running `getFeatureSubmissionEvidence` / security scan / scope check, which all assume a feature-branch context. On `main`, evidence fails (no commits above merge-base), violating the F339 acceptance line that the explicit form works from `main` with no tmux. The explicit path now skips those gates, matching the same “out-of-band operator” role as skipping branch/tmux detection. Added `submit-signal-loss` integration case: feature submit from `main` after `initFeatureRepo`.

### Residual Issues

- None for ship-blocking behavior. Optional follow-up: `aigon agent-status submitted --force 01 cc` (flags before positionals) does not trigger the explicit-args path because `args[1]` is `--force`; document flag ordering or use a proper positional parser in a later cleanup.

### Notes

- Staged implementation already matched the spec for research (findings file check, snapshot disambiguation, `research-submit` removal stub, templates, tests, site gen). The gap was feature-only and was not covered by the updated concurrent-submit test (which used env-based feature submit on a worktree).
