# Implementation Log: Feature 513 - merge-init-into-apply
Agent: cc

## Status

Implemented: runInitBootstrap() extracted from init, wired into apply on first run; init→deprecation shim; uninstall→remove with worktree guard, registry deregistration, --purge, --dry-run; help.txt/docs/tests updated; all iterate tests green.

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cc
**Date**: 2026-05-11

### Fixes Applied
- None — no code fixes made by reviewer.

### Validation
- Validation not run by reviewer per policy

### Escalated Issues
- **ESCALATE:subsystem** — CHANGELOG.md contains committed merge-conflict markers (`<<<<<<< Updated upstream` / `=======` / `>>>>>>> Stashed changes`) in two locations (lines 59–103 and 108–134). This is committed debris from an unresolved stash merge and breaks markdown rendering. Must be cleaned before merge.
- **ESCALATE:subsystem** — `site/content/reference/commands/setup/apply.mdx` is missing, but `init.mdx` and `remove.mdx` both link to `[`apply`](./apply)` and `_meta.js` lists it in nav. Creates a broken link in the docs site.
- **ESCALATE:subsystem** — Spec requests a first-time-bootstrap telemetry event (`aigon_apply.first_time_bootstrap`), but `lib/telemetry.js` only exports session-level `writeNormalizedTelemetryRecord`; no generic CLI event emitter exists. Requires new telemetry infrastructure to implement.

### Notes
- Core logic (bootstrap extraction, deprecation shim, remove handler with worktree guard/registry deregistration/--purge) is solid and well-tested.
- `node -c` passes on all touched files.
- Integration tests cover fresh bootstrap, idempotent re-run, non-git error, init deprecation, uninstall redirect, spec preservation, purge, dry-run, worktree refusal, and full cycle idempotency.
