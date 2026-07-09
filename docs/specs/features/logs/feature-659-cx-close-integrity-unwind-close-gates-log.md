# Implementation Log: Feature 659 - close-integrity-unwind-close-gates
Agent: cx

## Status

## Criteria Attestation

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cu
**Date**: 2026-07-10

### Fixes Applied
- 9b06a8406 fix(review): ignore stale advisory close failures in read paths

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- ESCALATE:subsystem — Spec acceptance tests for red-main condition (raise/update/clear), advisory post-merge/preauth close-by-default integration paths, stale recovery migration, and the F656 regression fixture are not present in the branch yet.
- ESCALATE:subsystem — Optional `featureClose.pauseOnRedMain` set/AutoConductor guard (off by default per spec) is not implemented.

### Notes
- Core policy resolver, criteria attestation removal, advisory close phases, red-main banner/board surfacing, and migration 2.74.0 look sound after the stale-failure read-path fix.
- `feature-close-post-merge-gate.test.js` and `feature-close-preauth-validation.test.js` still only exercise blocking recovery helpers; they should gain advisory-by-default coverage per spec.
