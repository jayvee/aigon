---
agent: cu
---
# Implementation Log: Feature 625 - dash-arch-6-keyed-card-render
Agent: cu

Keyed kanban reconcile landed: `subscribeDataChange` + `schedulePipelineReconcile` replace column `x-effect`/`innerHTML` clears; per-card `cardFingerprint` surgical updates; set bundles keyed by slug; F525 array-identity bumps removed; monitor `x-for` keys audited OK (no change).

## Code Review

**Reviewed by**: cx
**Date**: 2026-07-08

### Fixes Applied
- 38c8d2061 fix(review): align kanban fingerprints and stats

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None.

### Notes
- Fixed stale-card risk by adding rendered/interactive card inputs to `cardFingerprint`, including autonomous controller/plan, spec path, lease state, and repo GitHub/storage inputs.
- Fixed reconcile telemetry double counting for root-level card creates/updates so the debug perf line reflects one root change per card.
