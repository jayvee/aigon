---
commit_count: 4
lines_added: 1254
lines_removed: 13
lines_changed: 1267
files_touched: 21
fix_commit_count: 1
fix_commit_ratio: 0.25
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
model: "cursor"
source: "no-telemetry-cursor"
---
# Implementation Log: Feature 578 - specstore-sync-leases-and-reporting
Agent: cu

## Status
Shipped advisory lease events (TTL 30m / renew 10m), pre-write git-ref sync, `aigon storage doctor|report`, and lease guards on feature/research mutating commands.

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: feature-578-am
**Date**: 2026-06-25

### Fixes Applied
- 3f490efd0 fix(review): make storage report bare-mirror path functional — `ensureBareMirror` cloned the git remote *name* (e.g. `origin`) which is not cloneable, and `readSpecsFromMirror` read events with `git cat-file blob <ref>` while 577 stores events as a commit whose tree holds `events.json`. Both producer/read-path mismatches were masked by the checkout fallback, leaving the bare-mirror reporting path (a 578 AC + the stated technical approach) effectively dead. Now resolves the remote name to a URL and reads the ref payload the same way `readRefPayload` does.

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- ESCALATE:ambiguous — `storage doctor`'s `conflicting_lease_holders` check is effectively unreachable: `deriveActiveLease` is deterministic last-event-wins, so a single merged log can only ever yield one active holder per key/role. Surfacing genuine cross-holder conflicts would require defining what a conflicting-holder state looks like in the append-only model (e.g. comparing pre-merge holders) — a detection-semantics decision, not a local patch.

### Notes
- Mixing `lease.*` events into the canonical/projection event log is benign for the workflow engine: both `projectContext` and `applyTransition` ignore unknown event types (no `default` throw), so feature/research replay is unaffected.
- Minor: `lib/commands/feature.js` close path imports `formatLeaseConflict` but uses `error.message` directly — cosmetic, left as-is.
- Lease/sync interface additions are wired on both backends and pass `assertSpecStoreInterface`; all new lease-api/sync-guard imports resolve against existing exports.
