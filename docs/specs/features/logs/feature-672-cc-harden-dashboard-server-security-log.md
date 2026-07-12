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
