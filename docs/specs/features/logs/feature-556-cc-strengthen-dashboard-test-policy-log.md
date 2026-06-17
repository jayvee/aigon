---
commit_count: 7
lines_added: 532
lines_removed: 59
lines_changed: 591
files_touched: 12
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 48837
output_tokens: 181270
cache_creation_input_tokens: 446665
cache_read_input_tokens: 20568177
thinking_tokens: 0
total_tokens: 21244949
billable_tokens: 230107
cost_usd: 17.8517
sessions: 1
model: "claude-opus-4-8"
tokens_per_line_changed: null
---
# Implementation Log: Feature 556 - strengthen-dashboard-test-policy
Agent: cc

## Status
Done. ESLint now lints `templates/dashboard/js/**` (`no-undef` catches the undeclared-global incident class; cross-file globals allowlisted in `eslint.config.js`, `AUTONOMOUS_AGENT_IDS` deliberately excluded so it stays caught); `lint` npm glob broadened. New `tests/dashboard-e2e/critical-actions.spec.js` (@smoke) opens start/autonomous-start/eval/close surfaces with a console-error+toast guard (`watchBrowserErrors`/`assertActionSurfaceClean` in `_helpers.js`); folded in & removed `action-lazy-load.spec.js`; resolve-and-close stays covered by `close-failure-event.spec.js`. `DASHBOARD_PATH_RE` broadened to state/rules/workflow-core modules. CI adds a PR-eligible `browser-smoke` job. Docs (PR template, CONTRIBUTING, AGENTS) document the three tiers. Verified: `npm run test:quick` + full `@smoke` suite green; lint flags a deliberately-undeclared global.

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cu
**Date**: 2026-06-17

### Fixes Applied
- None — implementation was clean

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None

### Notes
- `critical-actions.spec.js` covers the F556 incident path (autonomous-start modal + console/toast guard) and folds in the former lazy-load regression under the `@smoke` describe. Eval/close use deterministic `/api/status` mocks with settings/recommendation stubbed; action-module routes are deliberately left live.
- `close-failure-event.spec.js` keeps resolve-and-close as a rendering regression (button + failure info visible) without opening the surface — matches the spec's technical approach.
- `DASHBOARD_PATH_RE`, ESLint dashboard blocks, CI `browser-smoke` job, and three-tier docs all align with acceptance criteria.
