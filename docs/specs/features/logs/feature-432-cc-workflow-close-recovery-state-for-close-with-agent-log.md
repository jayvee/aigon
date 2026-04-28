# Implementation Log: Feature 432 - workflow-close-recovery-state-for-close-with-agent
Agent: cc

Implemented close_recovery_in_progress as a first-class engine state with engine-first dashboard wiring and a "Adding a currentSpecState" checklist in AGENTS.md to prevent the next state-add from missing a site.

## Code Review

**Reviewed by**: Composer (code review pass)
**Date**: 2026-04-28

### Fixes Applied
- `fix(review): F432 close-recovery returnSpecState, engine-first await, canClose pass-through` (1adced3c)

### Residual Issues
- None for F432 behaviour. `npm run test:iterate` and `npm test` may still run unrelated integration cases (e.g. `worktree-state-reconcile.test.js`) that depend on local Cursor CLI paths; failures there are environmental, not caused by this branch.

### Notes
- Original implementation matched most acceptance criteria; gaps fixed in review: **`returnSpecState`** on `feature.close_recovery.ended`/`cancelled` was hardcoded to `submitted` in both projector and XState (spec requires restoring the stored prior state); **`recordCloseRecoveryStarted`** was fire-and-forget so tmux could win the race; **`canCloseFeature`** omitted **`close_recovery_in_progress`** from pass-through states.
