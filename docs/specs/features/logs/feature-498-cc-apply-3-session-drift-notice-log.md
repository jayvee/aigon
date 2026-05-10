# Implementation Log: Feature 498 - apply-3-session-drift-notice
Agent: cc

## Status

All acceptance criteria met. Unified drift notice implemented across hooks (cc/gg/cu) and launcher wrapper (cx/km/op). Zero output when current; named-both-sides notice when stale.

## New API Surface

- `lib/version-status.js` → `getRepoVersionStatus(repoPath?): object` — synchronous read of all three drift layers; honours `AIGON_TEST_INSTALLED_VERSION` env override
- `lib/version-status.js` → `formatDriftNotice(status): string` — returns empty string when current, canonical block when any layer is stale
- `lib/version-status.js` → `DASHBOARD_RUNTIME_FILE: string` — path to `~/.aigon/dashboard-runtime.json`
- `aigon check-version --notice-only` — new flag; read-only, no mutations, exit 0 always

## Key Decisions

- **`--notice-only` writes to stderr**: matches acceptance criteria (hooks/launcher). Validation pipes use `2>&1` so `wc -c` / `grep` still work.
- **Version comparison as Layer 1 trigger (alongside digest)**: `AIGON_TEST_INSTALLED_VERSION=99.99.99` can't affect content digest (same template files), so version mismatch (`appliedVersion !== installedCli`) also triggers Layer 1. This is conservative but harmless — `aigon apply` is idempotent.
- **Worktree guard in Layer 1**: worktrees don't have `.aigon/applied-digest` (write skipped since F497). Layer 1 would always fire in worktrees without the guard. Guard: `.aigon/worktree.json` presence → skip Layer 1.
- **Npm check uses cache only** (`getCachedUpdateCheck`): no network call at session start. Layer 2 is silent if no 5-min cache exists.
- **Dashboard runtime file** at `~/.aigon/dashboard-runtime.json` with `{ version, pid, startedAt }`. PID liveness checked via `process.kill(pid, 0)` before trusting the version.
- **Launcher wrapper for cx/km/op**: added `aigon check-version --notice-only || true` in `buildAgentCommand` when `signals.cliHooks` is null (stderr must not be discarded). Hook-capable agents (cc, gg, cu) get it from their SessionStart hook template instead.
- **Hook timeout 30s → 15s**: `--notice-only` is purely synchronous local reads; 15s is more than enough.

## Gotchas / Known Issues

- gg hooks are currently quarantined for certain models (pre-existing, unrelated to this feature). The template update is correct; the quarantine is about model reliability, not hook format.
- The format line `applied v{X}, installed v{Y}` was chosen over `applied v{X}, installed CLI is v{Y}` to match the spec validation grep pattern `"applied v.*installed v99.99.99"`.

## Explicitly Deferred

- Codex native hook support (behind `features.codex_hooks`): cx has `cliHooks: null`, so the launcher wrapper covers it. Native hook wiring deferred.
- Dashboard drift pill (feature #4 in set).
- Multi-repo apply-all (feature #5).

## For the Next Feature in This Set

- `getRepoVersionStatus()` provides the full status object; `formatDriftNotice()` renders it. Both exported from `lib/version-status.js`.
- `DASHBOARD_RUNTIME_FILE` (`~/.aigon/dashboard-runtime.json`) is written at dashboard startup. Read it to get running dashboard version + pid.
- Layer 1 fires on version mismatch OR digest mismatch — the two signals are independent.

## Test Coverage

- All three spec validation patterns verified via `node aigon-cli.js` in `/tmp/test-drift-498` (pipe `2>&1` because `--notice-only` writes stderr):
  - In-sync → zero bytes combined stdout+stderr ✓
  - `AIGON_TEST_INSTALLED_VERSION=99.99.99` → notice contains "applied v.*installed v99.99.99" ✓
  - Notice contains "aigon apply" ✓
- `npm run test:iterate` passes clean (lint + integration + smoke E2E) ✓

## Code Review

**Reviewed by**: composer (Cursor)
**Date**: 2026-05-10

### Fixes Applied

- `76d0863b` fix(review): stderr drift notice, npm prerelease layer, revert stray feature-501 move

### Validation

- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)

- None.

### Notes

- GG SessionStart dropped `check-version --json` in favour of `--notice-only` (matches feature 498 acceptance criteria). `project-context --json` unchanged.
- Layer 2 now honours cached `prerelease-available` from `npm-update-check`, not only `update-available`.
