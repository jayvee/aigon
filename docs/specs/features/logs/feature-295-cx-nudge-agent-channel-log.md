# Implementation Log: Feature 295 - nudge-agent-channel
Agent: cx

## Plan

## Progress

## Decisions

## Code Review

**Reviewed by**: cc (opus)
**Date**: 2026-04-22

### Fixes Applied
- `lib/nudge.js` — `resolveSessions` was calling `buildTmuxSessionName` without a `repo` option, so the session name fell back to `path.basename(process.cwd())`. When the CLI is run from a worktree (or the dashboard from a different repo), this produces a wrong session name like `feature-295-cx-nudge-agent-channel-f295-do-cx-…` instead of `aigon-f295-do-cx-…`, and the `tmuxSessionExists` probe always returns false → `No active do sessions`. Fix: thread `repoPath` into the entity object in `resolveEntity` and pass `{ repo: basename(entity.repoPath) }` into `buildTmuxSessionName`. Added a regression test in `tests/integration/misc-command-wrapper.test.js` asserting the session name derives from `entity.repoPath` rather than cwd.
- (The review edits were persisted by the auto-commit system under existing `feat: implementation` commits rather than a dedicated `fix(review):` commit. The content is in `lib/nudge.js` + `tests/integration/misc-command-wrapper.test.js` at HEAD.)

### Residual Issues
- **Branch is ~24 commits behind `main`**: The diff vs. `main` looks catastrophic — F293 (idle detection) and F300 (rebase gate) appear as deletions, the `## Pre-authorised` mechanism looks removed, `bootstrap-engine-state.test.js` is gone, etc. Those are all artifacts of the stale merge base (`ab35cd43`), not real changes in this PR. The actual F295 diff is ~690 additions across 26 files. **Before `feature-close`, this branch must be rebased onto `main` (F300's own warning will fire).** Left unresolved because rebasing with likely conflicts in `lib/workflow-core/engine.js`, `lib/workflow-core/projector.js`, `docs/architecture.md`, `AGENTS.md`, `scripts/check-test-budget.sh`, and `package.json` (test script) is a product decision the implementer should own.
- **Spec said CLAUDE.md should reference `aigon nudge`** (Quick Facts). This branch only updates `AGENTS.md`. CLAUDE.md is a short pointer to AGENTS.md in this repo, so the intent is arguably satisfied, but if you want the shortcut in both files, add a line to CLAUDE.md's Hot Rules.
- **`sleepMs` in `lib/nudge.js:178` is a busy-wait loop** that blocks the event loop for up to 160ms across 3 confirm attempts. Fine for a one-shot CLI, but the same helper is called from the dashboard POST handler — a second operator-triggered nudge during confirmation would wait behind it. Not a correctness issue; flagging for follow-up if the dashboard path ever needs concurrency.

### Notes
- The atomic `load-buffer` + `paste-buffer` + `send-keys <submitKey>` sequence is clean and matches the `d471d213` launch fix the spec referenced.
- The `operator.nudge_sent` event is mapped symmetrically in both `applyTransition` (feature) and `applyResearchTransition` (research), and projected via `projectContext` — the read-model surfaces a bounded `snapshots.nudges[]` ring of 20.
- Rate limit (10/min per session) is enforced by scanning recent events — correct but O(events) each nudge; fine at current scale.
- `cu` gets `submitKey: null` which makes the CLI error cleanly with "nudge not supported for cu" per spec intent. Good.
- Dashboard modal (`templates/dashboard/index.html` + `templates/dashboard/js/actions.js`) wires through the central action registry (CLAUDE.md rule 8) via `ManualActionKind.FEATURE_NUDGE`. Good.
