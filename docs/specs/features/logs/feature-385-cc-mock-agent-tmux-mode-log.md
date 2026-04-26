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
