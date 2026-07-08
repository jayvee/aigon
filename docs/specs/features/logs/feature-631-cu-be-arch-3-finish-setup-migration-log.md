# Implementation Log: Feature 631 - be-arch-3-finish-setup-migration
Agent: cu

## Status
Deleted setup-legacy.js (5,454 LOC); all setup commands now live in lib/commands/setup/*.js with shared helpers split to init-bootstrap, seed-registry, seed-entity-ids. Fan-out: monolith 79 → max per-module ~48 (doctor); install-agent 23, apply ~18.
## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cx
**Date**: 2026-07-08

### Fixes Applied
- b7643605b fix(review): trim setup command import fanout

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- ESCALATE:architectural — `lib/commands/setup/doctor.js` still has 48 `require(` sites after the migration, so the "no single setup module requires more than ~20 modules" acceptance criterion is not met. Reducing that safely needs another doctor-specific extraction pass, not a small review patch.
- ESCALATE:blocked — the branch history has the setup migration as one large feature commit (`effeb6758`) rather than a sequence of per-command extractions. Fixing that requires history rewriting, which is not safe to do from this review pass.

### Notes
- Out-of-scope deletion check only found the intentional `lib/commands/setup-legacy.js` deletion.
