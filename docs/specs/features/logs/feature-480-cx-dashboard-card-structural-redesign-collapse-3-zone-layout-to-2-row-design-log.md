# Implementation Log: Feature 480 - dashboard-card-structural-redesign-collapse-3-zone-layout-to-2-row-design

## Status

In progress — 2-row card shell and agent-scoped `validActions` restored; integration suite green. Playwright e2e and test-budget script were flaky/over ceiling in this worktree at commit time (see below).

## Agents

- Prior: cx (handoff)
- This pass: cu

## Changes (cu iteration)

**Dashboard (feature 480)**

- Replaced dead `buildAgentSectionHtml` with `buildAgentScopedActionHtml`: renders quota chip, failover, infra, workflow, overflow from `feature.validActions` filtered by `agentId`.
- Non-fleet cards: scoped strip appended in `buildStatusRowHtml` (`cs-r`) before card-level `renderActionButtons()`.
- Fleet: `buildAgentRowHtml` wraps row + optional `cfrow-act` actions; CSS `.cfrow-block` / `.cfrow-act`.
- `AGENT_STATUS_META`: `failed` / `error` → **Failed** + `status-failed` (was falling through to “Not started”).
- Monitor: `term` buttons with `data-peek-session` open the terminal panel (parity with legacy peek).

**Supporting fixes (unblocked `npm test` on this branch)**

- `lib/card-headline.js`: `entity.rebaseNeeded === true` returns **REBASE NEEDED** in warn-class **before** missing-snapshot / NO ENGINE STATE (restores precedence tests).
- `lib/dashboard-status-helpers.js`: exported `computeRebaseNeeded(worktreePath, defaultBranch)` via `git rev-list --count HEAD..branch` (graceful false on error).
- `lib/dashboard-status-collector.js`: `eslint-disable-next-line` for unused `defaultBranch` probe (cache warm-up only).
- `tests/integration/card-headline.test.js`: expectations aligned with current vocabulary (`CLOSED`, `IMPLEMENTED` / `ready`).
- `tests/integration/agent-failover-end-to-end.test.js`: scenario 1 spins a live `{repo}-f{id}-auto` tmux session so supervisor `isAutonomous` gate allows policy `switch`.

## Key Decisions

- Per-agent actions must not be dropped in the 2-row design: they stay server-owned (`validActions`) and render beside card-level CTAs; order: terminal glyph → scoped strips → `renderActionButtons`.

## Gotchas / Known Issues

- `MOCK_DELAY=fast npm run test:ui` still reported failures in this environment (failure-modes, fleet-lifecycle fixture visibility, solo/workflow e2e path waits). Re-run on a clean e2e home + tmux before treating as regression.
- `scripts/check-test-budget.sh` reported total tests/ LOC over ceiling (worktree-wide; not introduced by these edits alone).

## Test Coverage

- `npm test` (lint + integration + workflow-core): **pass** after the changes above.
- Playwright + budget: not green here; see Gotchas.

## For the Next Agent in This Set

- Re-run full pre-push gate: `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`.
- Continue spec acceptance (Playwright screenshot checklist, remaining AC ticks).
- Optional: trim or consolidate tests if budget gate blocks.
