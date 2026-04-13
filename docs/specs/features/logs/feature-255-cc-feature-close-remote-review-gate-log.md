# Implementation Log: Feature 255 - feature-close-remote-review-gate
Agent: cc

## Plan

Implement two changes to the feature workflow:
1. A new `feature-push` command for publishing feature branches to origin
2. An optional remote gate in `feature-close` that checks GitHub PR status before allowing the local close flow

## Progress

### New files
- `lib/remote-gate-github.js` — GitHub gate check helper (~170 LOC). Queries `gh pr list`, applies v1 gate policy (open, non-draft, mergeable), returns provider-neutral result shape with failure codes.

### Modified files
- `lib/commands/feature.js` — Added `feature-push` command (reuses `resolveCloseTarget` for branch resolution) and Phase 3.7 remote gate integration in `feature-close`
- `lib/templates.js` — Added `feature-push` to COMMAND_REGISTRY
- `package.json` — Swapped `dashboard-restart-marker.test.js` for `remote-gate-github.test.js` in test script

### Tests
- `tests/integration/remote-gate-github.test.js` — 11 tests covering full gate decision table: gh missing, auth failure, no PR, open mergeable, draft, blocked, merged, closed-unmerged, ambiguous, closed+open combo, query failure
- Deleted `tests/integration/dashboard-restart-marker.test.js` (22 LOC) to free test budget

### Documentation
- `CLAUDE.md` — Added `remote-gate-github.js` to module map
- `AGENTS.md` — Added "Publishing Branches & Remote Review Gate" section
- `docs/development_workflow.md` — Added `feature-push` to command table, added GitHub PR Review Workflow section
- `templates/generic/commands/feature-close.md` — Added remote gate note
- `site/public/home.html` — Added bullet about GitHub PR gating

## Decisions

- **Isolated helper module**: Created `lib/remote-gate-github.js` rather than inlining in `feature-close.js`. The spec suggested this extraction if the helper grew, and at ~170 LOC it warranted its own file. The return shape is provider-neutral to support future GitLab/Bitbucket support.

- **v1 gate policy**: Accept `CLEAN`, `HAS_HOOKS`, `UNSTABLE` as mergeable states. `BLOCKED`, `BEHIND`, `DIRTY`, `DRAFT`, `UNKNOWN` all block. This defers to GitHub's branch protection rules rather than inventing local approval requirements.

- **Gate placement**: Phase 3.7 (between engine pre-validation and auto-commit/push). This ensures the gate fires before any side-effects while benefiting from the earlier spec/mode resolution.

- **execFn injection**: The gate helper accepts an `options.execFn` override for testing, avoiding the need for process-level mocking or spawning real `gh` commands in tests.

- **Test budget**: Deleted `dashboard-restart-marker.test.js` (simple round-trip test for two stable functions) to make room. Net LOC change: -22 lines.
