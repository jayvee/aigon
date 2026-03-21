---
commit_count: 5
lines_added: 530
lines_removed: 1
lines_changed: 531
files_touched: 8
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
---

# Implementation Log: Feature 120 - security-scan-merge-gate
Agent: cc

## Plan

Add an un-bypassable security scan gate to three CLI commands: `feature-close`, `feature-submit` (via `agent-status submitted`), and `research-close`. Create a new `lib/security.js` module with pluggable scanner architecture. Extend the existing security config schema to support stage-to-scanner mappings and named scanner definitions.

## Progress

- Created `lib/security.js` — core module with `runSecurityScan(stage)` and `isBinaryAvailable(binary)`
- Extended `DEFAULT_SECURITY_CONFIG` in `lib/config.js` with `mergeGateStages` and `scannerDefs`
- Updated `mergeSecurityConfig()` to deep-merge nested objects (stages + scanner defs)
- Integrated scan into `feature-close` in `lib/commands/feature.js` — runs after branch push, before git merge
- Integrated scan into `agent-status submitted` in `lib/commands/misc.js` — gates feature-submit completion
- Integrated scan into `research-close` in `lib/commands/research.js` — runs before spec move to done
- Re-exported security module from `lib/utils.js`
- Created `lib/security.test.js` with 13 tests (all passing)
- All existing tests unaffected (7 pre-existing failures, 0 regressions)

## Decisions

- **Separate module vs inline**: Created `lib/security.js` rather than adding to `lib/utils.js` — keeps the module focused and testable
- **feature-submit integration point**: Since `feature-submit` is a template-based command (agent prompt), the security gate is placed in `agent-status submitted` (the CLI handler it calls), not in the template itself. This makes it un-bypassable.
- **Scan timing in feature-close**: Scan runs while still on the feature branch (before checkout to default), so gitleaks can scan the branch diff via `--log-opts`
- **Graceful degradation**: If gitleaks binary isn't installed, we warn and continue — doesn't break workflows for users who haven't set up scanners
- **Config design**: Used `mergeGateStages` (not overloading existing `stages` array) to avoid breaking the pre-commit hook config. `scannerDefs` holds named scanner definitions with `{{defaultBranch}}` placeholder interpolation.
- **Mode semantics**: `enforce` blocks the operation; `warn` prints warnings but allows it; `off` skips entirely. The `passed` return value accounts for mode — in warn mode, `passed` returns true even with findings.

## Code Review

**Reviewed by**: cx
**Date**: 2026-03-22

### Findings
- The default gitleaks command only scanned `defaultBranch..HEAD`, which misses staged-but-uncommitted changes and makes `research-close` effectively a no-op on the default branch.

### Fixes Applied
- Switched the default gitleaks integration to scan a temporary snapshot of changed files built from committed branch diff plus the staged index.
- Added tests covering changed-path collection and snapshot content resolution.

### Notes
- Custom scanners still work as configured; the built-in gitleaks path now matches the spec’s staged-plus-committed requirement.
