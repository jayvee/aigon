# Implementation Log: Feature 489 - responsive-card-shell-redesign
Agent: cx

## Status

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
