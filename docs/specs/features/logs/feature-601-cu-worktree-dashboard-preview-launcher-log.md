# Implementation Log: Feature 601 - worktree-dashboard-preview-launcher
Agent: cu

## Status
Implemented `aigon preview <id>` with worktree resolution, isolated `server start --preview`, and agent doc updates for worktree UI verification.
## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: op
**Date**: 2026-07-07

### Fixes Applied
- `21cc3deb6` — fix(review): use actual bound port in preview URL and health check. When the preview server's preferred hashed port was already in use, `resolveDashboardPort` fell back to `allocatePort`, but the launcher printed `http://localhost:<preferred-port>` and health-checked that port. The URL pointed at the wrong port and the health check always timed out. Now waits for the runtime entry to learn the actual bound port, then health-checks and reports that port. The Caddy subdomain URL was already correct (routes through Caddy to the actual port).

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None

### Notes
- `listFeatureWorktrees` regex uses `([a-z]{2})` for the agent segment while `deriveServerIdFromBranch` uses `([a-z]+)`. All current agent IDs are 2-char so no breakage today, but a future >2-char agent id would be missed by the worktree scanner while still being matched by the server-id deriver. Worth aligning if/when a non-2-char agent is introduced.
- The no-Caddy `localhost:<port>` fallback URL is now correct, but the spec's deterministic contract is the `<id>.aigon.localhost` subdomain (requires Caddy / `aigon proxy-setup`). The localhost fallback is a secondary path for environments without Caddy.

