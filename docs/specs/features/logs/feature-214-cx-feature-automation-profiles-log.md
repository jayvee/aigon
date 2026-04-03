# Implementation Log: Feature 214 - feature-automation-profiles
Agent: cx

## Plan

- Replace `feature-autopilot` with `feature-autonomous-start` and implement an `auto` tmux AutoConductor loop.
- Wire backlog dashboard action to a new autonomous-start modal and server endpoint.
- Surface `auto` tmux liveness as a `Running autonomously` indicator.
- Remove legacy feature-autopilot references from command templates/help/docs.

## Progress

- Added `feature-autonomous-start` command with:
  - `status <id>` subcommand (tmux auto-session liveness + workflow state).
  - Detached AutoConductor tmux session creation (`{repo}-f{id}-auto(-desc)`).
  - Internal `__run-loop` flow that polls workflow snapshots every 30s and:
    - stops at implement when requested,
    - runs `feature-eval --no-launch` in Fleet for eval stop point,
    - runs `feature-close` automatically in Solo for close stop point,
    - exits on first stage-command failure (no retries).
- Replaced `feature-autopilot` behavior with an explicit removal error pointing to `feature-autonomous-start`.
- Added workflow/manual-action plumbing for `feature-autonomous-start`:
  - `ManualActionKind.FEATURE_AUTONOMOUS_START`
  - feature workflow rules and snapshot action mapping
  - action command mapper entry.
- Added dashboard API endpoint:
  - `POST /api/features/:id/run`
  - validates payload and spawns detached `aigon feature-autonomous-start ...`.
- Added dashboard UX:
  - backlog action wired to `feature-autonomous-start`,
  - new `Start Autonomously` modal with implementation agent multi-select, evaluator select, and stop-after selector,
  - monitor/pipeline `Running autonomously` badge when `auto` tmux session is alive.
- Extended dashboard read-side/status helpers to detect `auto` role tmux sessions.
- Updated templates/docs/help to remove feature-autopilot command surface and add `feature-autonomous-start`.
- Captured required dashboard screenshot after `templates/dashboard/index.html` change:
  - `dashboard-feature-214.png`.
- Restarted server after backend edits:
  - `aigon server restart` (running at `http://0.0.0.0:4100`).
- Validation completed:
  - `node -c` on modified backend files,
  - `npm test` (pass).

## Decisions

- Kept `feature-autopilot` as a hard-error command (not a compatibility wrapper) to provide clear migration messaging while preventing old behavior.
- Implemented AutoConductor orchestration in tmux/session space only; no new persistent orchestration metadata was introduced.
- Implemented Fleet `--stop-after=close` fallback to eval with explicit console messaging, matching v1 scope limits.

## Code Review

**Reviewed by**: cc (Claude Opus 4.6)
**Date**: 2026-04-03

### Findings

1. **CRITICAL — `runAigonCliCommand` uses wrong CLI path**: The helper built the path as `path.join(mainRepoPath, 'aigon-cli.js')` which points to the user's project directory, not the aigon installation directory. Would fail for any repo that isn't aigon itself.

2. **CRITICAL — AutoConductor infinite loop after triggered stage**: After `feature-close` or `feature-eval` succeeded (exit 0), the loop re-polled waiting for state to reach `done`/`evaluating`. If the state didn't transition immediately, the loop spun forever — `closeTriggered`/`evalTriggered` prevented re-triggering but no exit condition existed.

3. **MEDIUM — No agent ID validation in dashboard endpoint**: The `/api/features/:id/run` endpoint accepted arbitrary strings as agent identifiers. While spawn uses an array (no shell injection), strings like `--malicious-flag` would be interpreted as CLI flags by the downstream command.

4. **MEDIUM — `feature-autonomous-start` action guard only matches `backlog` state**: The workflow rule guard (`context.currentSpecState === 'backlog'`) prevents the dashboard from showing the action for in-progress features where worktrees exist but users may want to attach an AutoConductor. Not fixed — acceptable for v1 scope.

5. **MEDIUM — `--stop-after` normalization duplicated**: Both the outer command and the `__run-loop` normalize `--stop-after` values. Currently harmless since the outer command normalizes before passing to the loop, but a maintenance risk if the two copies drift. Not fixed — low risk for now.

6. **LOW — No body size limit on POST endpoint**: Pre-existing pattern across all dashboard endpoints; not specific to this feature.

### Fixes Applied

- `ffc0a31d` fix(review): fix runAigonCliCommand path, add post-trigger timeout, validate agent IDs

### Notes

- The implementation is solid overall — the AutoConductor design is clean, correctly lightweight, and the dashboard integration follows existing patterns well.
- The `feature-autopilot` removal is clean — replaced with a clear error message.
- The `status` subcommand, `__run-loop` internal command, and tmux session management all follow established patterns.
- The duplicated `--stop-after` normalization (finding #5) should be consolidated in a future cleanup pass but is not a correctness issue today.
