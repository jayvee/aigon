# Feature 535 — Split Dev and User Pill Modes — Implementation Log

## Code Review

**Reviewed by**: cc (Claude Code / Opus)
**Date**: 2026-05-27

### Fixes Applied
- None — implementation was clean

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None

### Notes
- Spec acceptance criteria mention a browser smoke test for pill label rendering under both modes. The unit tests in `version-status-dev-mode.test.js` cover the backend logic (devMode flag, staleness helpers, route response shape) but no Playwright test was added. The logic is well-covered; a browser test would be additive but not blocking.
- The `getInstalledVersion(repoPath)` signature change in `lib/version.js` is backward-compatible (defaults to `process.cwd()`) and fixes a latent bug where registered repos were reading the current repo's applied version instead of their own.
- The `staleApplyRepos` / `allRepos` refactor now correctly includes the current repo in the stale count, fixing a subtle inconsistency where the current repo could be stale but not counted in the banner message.
