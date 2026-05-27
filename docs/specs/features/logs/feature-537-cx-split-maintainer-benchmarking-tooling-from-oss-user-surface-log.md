# Implementation Log: Feature 537 - split-maintainer-benchmarking-tooling-from-oss-user-surface
Agent: cx

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cc (Claude Opus 4.7)
**Date**: 2026-05-27

### Fixes Applied
- `a32ed5bc` fix(review): remove dangling references to deleted benchmark/eval modules in docs
  - `docs/architecture.md`: removed module map entries for `lib/commands/bench.js`, `lib/commands/aigon-eval.js`, `lib/aigon-eval-runner.js`/`lib/aigon-eval-checks.js`; updated quota-probe description to drop `perf-bench --all` consumer reference.
  - `CONTRIBUTING.md`: removed "Release: refresh benchmarks before tagging" section that told contributors to run the now-deleted `aigon perf-bench` command.
  - `docs/seeds.md`: replaced specific `aigon perf-bench brewboard cc` command examples with generic maintainer benchmark references.

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None.

### Notes
- Implementation log was left empty by implementer (all sections blank). The implementation itself is solid.
- Deleted files are all in scope per the spec's removal targets. No out-of-scope deletions.
- Read-only paths (`lib/agent-matrix.js`, `lib/bench-hydrate.js`, dashboard Pro placeholder, `/api/agent-matrix`) verified intact.
- Historical references in `CHANGELOG.md`, `docs/specs/features/logs/*`, and `docs/specs/features/05-done/*` left untouched (historical records, not active docs).
- `docs/specs/features/01-inbox/feature-bench-monitor.md` references deleted `lib/perf-bench.js` but is an unrealized inbox spec; not blocking.
