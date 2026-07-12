---
commit_count: 6
lines_added: 720
lines_removed: 32
lines_changed: 752
files_touched: 10
fix_commit_count: 1
fix_commit_ratio: 0.167
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 179
output_tokens: 106423
cache_creation_input_tokens: 542290
cache_read_input_tokens: 9946205
thinking_tokens: 0
total_tokens: 10595097
billable_tokens: 106602
cost_usd: 11.0239
sessions: 1
model: "claude-opus-4-8"
tokens_per_line_changed: null
---
# Implementation Log: Feature 672 - harden-dashboard-server-security
Agent: cc

## Status
Implemented F1–F6 in `lib/dashboard-security.js` (central guard) wired into `dashboard-server.js`, `dashboard-action-command.js`, and `dashboard-routes/util.js`; 32 unit tests + PTY integration + over-the-wire curl traversal check all green.

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cx
**Date**: 2026-07-12

### Fixes Applied
- 9e94691f61118dbc4dab5e66893daafd1a0a1868 fix(review): allow configured remote dashboard origins

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None.

### Notes
- Fixed the HTTP Origin/Referer guard so token-protected non-loopback access can use configured allowed hosts for state-changing dashboard routes, while preserving the PTY WebSocket handler's loopback-only Origin policy.
- Hardened malformed cookie handling in the dashboard token parser and applied the body-size cap to the Pro bridge JSON body reader as part of the same dashboard request boundary.
