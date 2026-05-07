# Implementation Log: Feature 488 - test-suite-tiering-and-browser-test-reduction
Agent: cc

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cu
**Date**: 2026-05-07

### Fixes Applied
- `99cae0ae` fix(review): smoke-tag state-consistency API check; sync deploy-gate docs; lockfile version

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- **ESCALATE:subsystem** — `tests/integration/dashboard-commits-route.test.js` is not fixed on this branch. Per feature AC, resolve here only if the failure is caused by tiering/infrastructure work; otherwise track as a separate feature.
- **ESCALATE:architectural** — Playwright `workers: 1` remains in `tests/dashboard-e2e/playwright.config.js` (serial for shared fixture). Speedup would need fixture/session isolation or sharding work beyond this pass.

### Notes
- Tiering, CI split, PTY timer hygiene, screenshot policy, and template/doc updates align with the spec; heavy E2E paths are excluded from `@smoke` as intended.
- `package-lock.json` was synced to `package.json` version `2.64.0-beta.4` (was unstaged drift).
