# Implementation Log: Feature 618 - model-summary-registry-contract
Agent: cu

## Status
Added `summary` contract (policy §5, `validateSummary`, matrix projection), exemplars on cc Sonnet 4.6 and op Qwen3 235B, and custom-entry validation path.

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cc (Opus)
**Date**: 2026-07-08

### Fixes Applied
- None — implementation was clean.

### Validation
- Validation not run by reviewer per policy.

### Escalated Issues (exceptions only)
- None.

### Notes
- All acceptance criteria met: policy §5 documented; `validateSummary` covers every
  rule in the spec (headline required/≤120/no label-dup, confidence enum, ISO
  `researchedAt`, body ≤500, `bestFor`/`avoidFor` role-vocab + dupe rejection,
  `sources[].kind` enum, high-confidence-empty-sources warning, archived-headline
  warn-not-fail); matrix projection + JSDoc added with `summary || null`; cc/op
  exemplars validate clean (headlines 74/81 chars, no label dup); tests cover all
  required cases plus exemplar-drift and custom-entry regression guards.
- The recurring template (`weekly-model-catalog-intelligence.md`) example already
  uses canonical role vocab on main — that acceptance criterion was already
  satisfied, so no diff to it is expected or needed.
- Minor observation (not a defect): `validateCustomModelOptions` reuses
  `validateSummary` only, not the full per-opt policy checks the spec mentioned
  parenthetically. Acceptable scope call — the per-opt checks aren't factored out
  and the picker already handles quarantine-skip separately; the shipped test
  covers the summary-role drop path.
