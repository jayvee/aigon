# Implementation Log: Feature 636 - be-arch-8-deprecated-shim-sunset
Agent: cu

## Status
Phase A: `feature.js` 2228→1363 lines; extracted close/lifecycle/now/open/backfill; dissolved `misc.js` into `agent-signals.js`, `ops.js`, `insights.js`. Phase B: removed `/api/budget` + `/api/quota` shims, deleted `quota-poller.js`, trimmed `budget-poller.js` to scrape primitives; AGENTS.md refresh + `check-module-graph.js` path-existence guard.

## New API Surface
Removed: `GET /api/budget`, `POST /api/budget/refresh`, `GET /api/quota`, `POST /api/quota/refresh`. Surviving: `GET /api/agent-quota`, `POST /api/agent-quota/refresh`.

## Key Decisions
- Kept `lib/budget-poller.js` name (scrape-only) to limit import churn.
- `getFeatureSubmissionEvidence` moved to `lib/feature-command-helpers.js`; `misc-compat.js` preserves `createMiscCommands` for aigon-cli.
- F342 audit: no live `review-state.json` writers; migration 2.58.0 only.

## Gotchas / Known Issues
- `feature.js` still 1363 lines (target ~900) — remaining fat handlers: `feature-reset`, `sessions-close`, `feature-push/rebase`, `feature-code-review/revise`, `research.js` inline handlers (audited, not extracted this pass).

## Explicitly Deferred
- Research.js handler extractions (`research-autopilot` ~276 lines, etc.).
- Dead `reviewState` branches in `workflow-read-model.js` buildAutonomousStagePlan.

## For the Next Feature in This Set
- Module map uses size bands (small/medium/large/x-large) — run `wc -l` when planning; freshness guard catches missing paths only.

## Test Coverage
- `npm run test:iterate` green (lint + 45 scoped integration tests + browser smoke).
- `node scripts/check-module-graph.js` green with updated baseline.

## Code Review

**Reviewed by**: cx
**Date**: 2026-07-08

### Fixes Applied
- `fb0bdc260 fix(review): repair shim sunset docs and guards`

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None.

### Notes
- Fixed an extraction typo in `branchIsMerged`, strengthened the AGENTS.md module-map guard to inspect every backticked path in multi-module rows, and refreshed stale architecture/changelog route documentation.
