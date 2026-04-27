# Implementation Log: Feature 415 - simplify-setup-mega-module-2026-04
Agent: cc

## Status
Top-of-file helpers (~770 lines) extracted from `lib/commands/setup.js` into five sibling submodules under `lib/commands/setup/` (seed-reset, worktree-cleanup, gitignore-and-hooks, pid-utils, agent-trust); dispatcher and `_test` surface unchanged.

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: composer (code review pass)
**Date**: 2026-04-28

### Fixes Applied
- `fix(review): stage seed-reset commits without git add -A` — `f0f33b05` (porcelain path staging + trim bug in `pathsFromGitStatusPorcelain`)
- `fix(review): remap deprecated submitted before engine for explicit ID form` — `efa695e0` (`lib/commands/misc.js` F339 explicit-args path; submit test assertion)
- `fix(review): enable injectPromptViaTmux for OpenCode agent` — `8a5af18e` (`templates/agents/op.json` — aligns with `lib/worktree.js` TUI + paste-buffer contract)

### Residual Issues
- None

### Notes
- Original F415 split matches simplifications report (behaviour-preserving move of helpers into `lib/commands/setup/*.js`); `module.exports._test` and `createSetupCommands` wiring verified against integration tests.
- `git add -A` in seed-reset provision predated F307 guard but failed static-guards once exercised on this branch.
