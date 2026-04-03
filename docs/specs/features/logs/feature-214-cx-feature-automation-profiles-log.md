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
