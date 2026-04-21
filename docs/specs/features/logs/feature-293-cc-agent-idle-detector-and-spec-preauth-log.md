---
commit_count: 7
lines_added: 515
lines_removed: 15
lines_changed: 530
files_touched: 20
fix_commit_count: 2
fix_commit_ratio: 0.286
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 271
output_tokens: 57600
cache_creation_input_tokens: 754606
cache_read_input_tokens: 17295203
thinking_tokens: 0
total_tokens: 18107680
billable_tokens: 57871
cost_usd: 8.8831
sessions: 1
model: "claude-sonnet-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 293 - agent-idle-detector-and-spec-preauth
Agent: cc

## Plan

## Progress

## Decisions

## Code Review

**Reviewed by**: cu (Cursor agent)
**Date**: 2026-04-21

### Findings
- **P0 — Research snapshots from `initWorkflowSnapshot`**: Newly bootstrapped research entities wrote `featureId` instead of `researchId` / `entityType`, diverging from `bootstrapMissingWorkflowSnapshots` in `lib/commands/setup.js` and risking broken research read paths after prioritise.
- **P0 — F293 tests not executed in CI**: `tests/integration/supervisor-idle-and-preauth.test.js` existed but was omitted from the `npm test` script, so idle/pre-auth regressions would not run in the default suite.
- **P1 — Idle badge AC gap**: `idleState` was merged in `dashboard-status-collector.js` but the monitor UI never rendered it; Part A’s “awaiting input” dashboard signal was effectively API-only.
- **Scope / merge hygiene (no code revert in this pass)**: The branch diff vs `main` still bundles substantial unrelated work (e.g. autonomous modal reviewer triplet / workflow wiring removed from dashboard JS; deletion of unrelated inbox specs; `bootstrap-engine-state` test removed from `npm test`; doc edits about F296/create bootstrap). That should be split or reverted before merge so F293 stays reviewable and bisectable.

### Fixes Applied
- `fix(review): research prioritise snapshots, idle badge, run idle tests` — correct research snapshot + migrate id fields; add `buildWorkflowIdleBadgeHtml` + styles; wire `supervisor-idle-and-preauth.test.js` into `npm test`; tighten lifecycle assertion on bootstrapped feature snapshots.

### Notes
- **Still missing vs spec**: sticky idle level should add a row to the dashboard notifications panel (`/api/notifications`); only desktop notify + card badge are addressed here. Supervisor already logs at sticky transitions.
- **Visual verification**: Playwright screenshot of the monitor view with a forced `idleState` was not captured in this review session; recommend a quick manual check after deploy.
- **Dead-agent notifications** are now gated by `supervisorNotifications` alongside idle (existing branch behaviour) — confirm that matches product intent.

