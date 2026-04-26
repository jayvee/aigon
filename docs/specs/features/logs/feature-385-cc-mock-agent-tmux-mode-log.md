---
commit_count: 4
lines_added: 196
lines_removed: 4
lines_changed: 200
files_touched: 5
fix_commit_count: 1
fix_commit_ratio: 0.25
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 150
output_tokens: 83587
cache_creation_input_tokens: 257248
cache_read_input_tokens: 12582157
thinking_tokens: 0
total_tokens: 12923142
billable_tokens: 83737
cost_usd: 29.2057
sessions: 2
model: "claude-sonnet-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 385 - mock-agent-tmux-mode
Agent: cc

MockAgent gains `useRealWrapper` mode that drives `buildAgentCommand` via real tmux + `MOCK_AGENT_BIN`, so the shell trap + heartbeat sidecar paths are exercised end-to-end by `tests/integration/mock-agent-tmux.test.js`.

## Code Review

**Reviewed by**: op
**Date**: 2026-04-26

### Fixes Applied
- `545f77dc` fix(review): revert out-of-scope F380 spec change from F385 branch — the F380 spec (aigon-profile-sync) was rewritten on this branch; that belongs in the F380 branch, not here
- `0e15032f` fix(review): use shellQuote from terminal-adapters instead of manual reimplementation — the `_runViaTmux` method hand-rolled the same quoting logic that `shellQuote` already provides; using the shared function keeps the two in sync

### Residual Issues
- None

### Notes
- The implementation is clean and well-scoped. `MOCK_AGENT_BIN` correctly takes precedence over `AIGON_TEST_MODE` in `buildRawAgentCommand`, and `buildAgentCommand` still wraps it with the full shell trap + heartbeat sidecar — exactly what the spec requires.
- The test correctly guards with `hasTmux` so CI environments without tmux skip gracefully.
- The `mock-agent-bin.sh` script properly isolates git config (`GIT_CONFIG_GLOBAL=/dev/null`) to avoid polluting the test runner's git setup.
