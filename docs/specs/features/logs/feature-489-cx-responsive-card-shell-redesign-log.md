---
commit_count: 12
lines_added: 446
lines_removed: 277
lines_changed: 723
files_touched: 29
fix_commit_count: 9
fix_commit_ratio: 0.75
rework_thrashing: true
rework_fix_cascade: true
rework_scope_creep: false
input_tokens: 9702916
output_tokens: 20602
cache_creation_input_tokens: 0
cache_read_input_tokens: 9197696
thinking_tokens: 5111
total_tokens: 9723518
billable_tokens: 9728629
cost_usd: 21.4102
sessions: 1
model: "openai-codex"
tokens_per_line_changed: null
---
# Implementation Log: Feature 489 - responsive-card-shell-redesign
Agent: cx

## Status

**REVERTED 2026-05-07 (commit `d83994c2`)** — together with F490 (`8f0a5479`), F489's
merge was reverted to restore the pre-F480 legacy 3-zone card design. F489 was the
re-attempt of F480 (also reverted), and despite F490's follow-up patch the result still
exhibited multiple defects the user surfaced over the course of one extended session:
triple state-label rendering on solo cards, casing inconsistencies between sections,
duplicate eye/overflow on agent rows, ad-hoc tone palettes, missing autonomous stage
track, and engine-internal vocabulary leaking into the UI. The user concluded — correctly
— that pre-F480 legacy + the existing pre-F480 vocabulary work (commits `026058ff`,
`263c5eb7`, `7dfb9d74`, `8b996224`, `4d07c653`, `9bfbd87e`, `234bf3a4`, `e7b2dc69`,
`3aaab1e3`) was a better baseline than continuing to patch F489's shell. Card-redesign
is parked; vocabulary work remains in place.

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: cu
**Date**: 2026-05-07

### Fixes Applied

- `8e5a6461` fix(review): restore out-of-scope mainline changes mixed into feature 489
- `ebe5e18b` fix(review): show kcard peek only when agent tmux is running

### Escalated Issues (exceptions only)

- **ESCALATE:subsystem** — Spec asks for cross-width Playwright screenshots under `tests/dashboard-snapshots/` and manual viewport verification logged; not delivered in the implementation diff reviewed here — implementer should complete before merge.
- **ESCALATE:ambiguous** — Status label toggles between “Running” and “Implementing” in `buildAgentStatusHtml` paths (`pipeline.js`); confirm this matches wireframe vocabulary vs product copy expectations.

### Notes

- The branch had picked up a partial rollback of feature 488 (test tiering): `package.json` scripts, CI workflow, AGENTS/CLAUDE/docs testing prose, `@smoke`/`@deploy` tags, `pty-terminal` timer wiring, and feature 488 spec/log placement. Restored from `main` so 489 stays scoped to the card shell.
- Kanban/CSS/status-row work aligns with the stated column band (`minmax(300px, 380px)`) and removal of `buildCardHeadlineHtml` in favour of the two-row shell.
