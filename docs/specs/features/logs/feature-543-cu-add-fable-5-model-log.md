---
commit_count: 3
lines_added: 206
lines_removed: 0
lines_changed: 206
files_touched: 3
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
model: "cursor"
source: "no-telemetry-cursor"
---
# Implementation Log: Feature 543 - add-fable-5-model
Agent: cu

## Status

Added `claude-fable-5` and `claude-fable-5[1m]` to `templates/agents/cc.json` after Opus 4.7 entries; pricing $10/$50 MTok per Anthropic docs. Created `docs/adding-models.md` maintainer guide. `complexityDefaults` unchanged.

## New API Surface

None — config and docs only.

## Key Decisions

- Placed Fable 5 entries after the last non-quarantined Opus row per spec technical approach.
- Included `[1m]` variant — Anthropic documents 1M context for Fable 5; both variants probe PASS.
- Used `lastRefreshAt: 2026-06-10T00:00:00.000Z` for both entries.

## Gotchas / Known Issues

- Open questions resolved: CLI accepts `--model claude-fable-5` and `claude-fable-5[1m]` (agent-probe PASS 5.7s / 14.0s). Pricing from Anthropic platform docs ($10 input / $50 output per MTok).

## Explicitly Deferred

- Promoting Fable 5 into `cli.complexityDefaults` (requires scored eval per policy).
- Full feature-task smoke benchmark — `aigon agent-probe cc --model claude-fable-5` used as existence/sanity check instead (PASS, PONG). Formal implement-quality scoring deferred to maintainer eval sweep.

## For the Next Feature in This Set

N/A — standalone config change.

## Test Coverage

- `node -e JSON.parse(cc.json)` — valid JSON
- `aigon server restart` — success
- `getDashboardAgents()` — Fable 5 + Fable 5 (1M) present for cc
- `aigon agent-probe cc --model claude-fable-5` — PASS
- `aigon agent-probe cc --model claude-fable-5[1m]` — PASS

## Code Review

**Reviewed by**: cc
**Date**: 2026-06-10

### Fixes Applied
- None — implementation was clean.

### Validation
- Validation not run by reviewer per policy.

### Escalated Issues (exceptions only)
- ESCALATE:ambiguous — AC asks for "qualitative implement quality" from a real feature task; implementer used `agent-probe` (PASS/PONG) as an existence check and deferred formal quality scoring. The spec itself labels this step "an existence-and-sanity check," making the deferral defensible for a config-only change.

### Notes
- All required fields present in both Fable 5 entries (value, label, pricing, score, notes, lastRefreshAt).
- `docs/adding-models.md` covers all AC-required sections (eligibility, required fields, file to edit, server restart, complexityDefaults promotion, quarantine process).
- Placement after Opus 4.7 [1m] is correct — array follows ascending cheap→capable order; most capable goes last.
- JSON parses cleanly; no deleted files; no out-of-scope changes.
