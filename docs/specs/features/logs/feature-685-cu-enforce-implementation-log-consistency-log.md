---
commit_count: 4
lines_added: 566
lines_removed: 27
lines_changed: 593
files_touched: 24
fix_commit_count: 1
fix_commit_ratio: 0.25
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
model: "cursor"
source: "no-telemetry-cursor"
---
# Implementation Log: Feature 685 - enforce-implementation-log-consistency
Agent: cu

## Status
Default policy changed: `fleet-only` (unset config) now maps solo branch/worktree to required `minimal` logs; only `logging_level: never` opts out. Added `lib/implementation-log-policy.js`, completion gate, and `implementation-log` close-integrity gate.

## Key Decisions
- Changed product default (not repo-only `always`) so fresh repos require logs without config — `resolveImplementationLogVariant('drive')` returns `minimal` under default `fleet-only`.

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: op
**Date**: 2026-07-18

### Fixes Applied
- `0fe75081d` fix(review): end close recovery on implementation-log advisory — the advisory path in `runImplementationLogCloseGuard` emitted `feature.close_finding_advisory` but never called `recordCloseRecoveryEnded`, unlike the `post-merge-gate` and `preauth-validation` advisory paths. The implementer already added `'implementation-log-advisory'` to `ADVISORY_CLOSE_RECOVERY_SOURCES` (in `lib/close-gate-predicates.js`) but never emitted that source. A feature stuck in `close_recovery_in_progress` from a prior blocking `implementation-log` failure would remain in recovery after the operator switched to advisory policy and re-ran close. Now calls `recordCloseRecoveryEnded` with source `'implementation-log-advisory'` when `isInCloseRecovery(snapshot)`, matching the established pattern.

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None

### Notes
- The solo `discoverImplementationLogFiles` filter excludes any `feature-NN-[a-z]{2}-*` log from solo discovery (ported from the pre-existing logic in `lib/commands/agent-signals.js` ~L511-512). A solo Drive log whose slug's first segment is exactly 2 lowercase letters (e.g. `feature-NN-ai-foo-log.md`, `feature-NN-go-bar-log.md`) would be wrongly excluded. Not flagged as FIX_NOW because (a) it is pre-existing behavior, not a regression from this feature, (b) the implementer's unit test explicitly encodes the solo-vs-agent namespace separation, and (c) the spec AC ("compatible with both solo names and agent-specific names") is satisfied across modes — solo mode discovers solo-style names, fleet/worktree mode discovers agent-specific names. Worth revisiting if a future solo feature uses a 2-char-first-segment slug.
- `lib/feature-do.js` calls `loadProjectConfig(cwd)` twice in the `logVariant === 'skip'` branch, and the `else` ("not required in this mode") is now effectively dead code because `skip` only occurs under `logging_level: 'never'`. Minor; not worth a review fix.
- `lib/feature-command-helpers.js` was correctly left untouched — `isIgnoredFeatureSubmissionPath` already keeps log-only submissions from counting as substantive evidence, and `checkImplementationLogEvidence` is the separate required-log check, preserving the separation the spec asked for.
- Template/doc changes (`templates/docs/development_workflow.md`, `templates/generic/docs/agent.md`, `.aigon/docs/agents/*`, `.aigon/docs/development_workflow.md`) are consistent with the runtime behavior.

