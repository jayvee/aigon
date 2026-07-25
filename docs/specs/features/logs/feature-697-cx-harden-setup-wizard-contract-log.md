# Implementation Log: Feature 697 - harden-setup-wizard-contract
Agent: cx

## Status

Shipped safe, resumable setup state and conservative unattended defaults in `lib/onboarding/`, with atomic private global-config writes, read-only command help, health-checked persistent server setup, focused clean-HOME coverage, and refreshed setup documentation.

## New API Surface

## Key Decisions

- `--resume` retries skipped and failed persisted steps; repeatable `--step` is the precise retry mechanism.
- The operator explicitly approved the test LOC ceiling increase to 200,000 for this feature.

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

- `node tests/unit/onboarding-state.test.js`
- `node tests/integration/onboarding-wizard.test.js`
- `npm run test:iterate`, `bash scripts/check-test-budget.sh`, and `npm run build --prefix site`

## Code Review

**Reviewed by**: cx
**Date**: 2026-07-25

### Fixes Applied
- `7b2545dc8` fix(review): gate onboarded flag and persist failed setup steps
- `d9b02f3cf` fix(review): correct setup docs and e2e --yes contract assertion
- `bddf3bbcd` fix(review): read persisted seed-repo state before demo step

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- **ESCALATE:subsystem** — Spec acceptance criteria still list broader coverage (multi-command help matrix, git-identity shell-injection tests, dependency-injected wizard harness, failed health-check integration). Only setup `--help` and state-table unit tests landed; implementer should close the remaining gaps before `feature-close` validation.
- **ESCALATE:ambiguous** — `saveGlobalConfig` always `chmod 0600`, which loosens a pre-existing `0400` file; spec says preserve or tighten existing permissions.

### Notes
- Core wizard contract changes look sound: resume/skipped/failed state model, conservative `--yes`, atomic config writes, read-only help guard, and health-checked persistent server start.
- Setup wizard docs had duplicate/misnumbered steps; corrected to match the nine `STEP_IDS` including Pro.
- `e2e-docker.sh` now asserts the conservative `--yes` contract instead of compensating for auto-clone behavior.
