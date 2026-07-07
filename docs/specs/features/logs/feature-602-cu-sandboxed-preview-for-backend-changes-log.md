# Implementation Log: Feature 602 - sandboxed-preview-for-backend-changes
Agent: cu

Added `aigon preview <id> --sandbox` with shared `lib/ephemeral-seeded-instance.js` helper, sandbox registry/gc, and preview docs.
Agent: cu

## Status

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
- None — implementation was clean.

### Validation
- Validation not run by reviewer per policy.

### Escalated Issues (exceptions only)
- ESCALATE:subsystem — e2e bootstrap refactor: `seedE2eFeatures` (via `ephemeral-seeded-instance.js#runAigon`) always sets `AIGON_TEST_MODE=1` and no longer calls `stripLiveAgentEnv` during seeding, where the old bootstrap's `runAigon({ live })` conditionally cleared `AIGON_TEST_MODE`/`MOCK_AGENT_BIN` and stripped live-agent env in live mode. `feature-create`/`feature-prioritise` don't spawn agents so this is almost certainly inert, but the live e2e seeding path is subtly divergent from the prior recipe and worth a sanity check during the next live e2e run. Not safely patchable in this review pass without re-introducing a parallel `runAigon` just for live mode (would undo the shared-helper consolidation the spec requires).

### Notes
- Sandbox server env intentionally omits `GIT_SAFE_ENV` (so the user's real git identity applies to disposable commits in the sandbox) — correct for a user-facing tool; the e2e recipe sets it because it's automated tests. Not a bug.
- Starting a sandbox preview while a non-sandbox preview is already running for the same worktree is not guarded against (they share `instanceId` but use separate runtime/registry files, so they'd run on different ports). Edge case, not in spec; users typically stop one before starting another.
- `--sandbox=empty` provisions a repo with no initial commit; aigon git operations that require `HEAD` could fail in that mode. Not exercised by tests, but the spec explicitly allows an "empty-ish seed"; acceptable for now.
- All acceptance criteria satisfied: shared helper, isolated AIGON_HOME + fixture repo, own port/`<agent>-<id>.aigon.localhost` subdomain, stop + `preview gc` cleanup, documented (default = real data, `--sandbox` = isolated data).
