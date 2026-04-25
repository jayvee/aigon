# Implementation Log: Feature 367 - server-scheduled-kickoff-for-features-and-research
Agent: cu

## Status

Implemented phase 1: `lib/scheduled-kickoff.js` (JSON store + lock + poller), `aigon schedule add|list|cancel`, shared `lib/feature-autonomous-payload.js` for dashboard + scheduler validation, server poller on `runDashboardServer` listen path. Minor `entity.js` pause/rename fix uncovered while running tests (spec already moved by engine `move_spec`).

## New API Surface

- `aigon schedule add feature_autonomous|research_start … --run-at=…` (see `templates/help.txt`)
- `aigon schedule list [--all]`, `aigon schedule cancel|rm <jobId>` (`--repo=` when multi-repo)
- Store: `.aigon/state/scheduled-kickoffs.json` + `.scheduled-kickoffs.json.lock`

## Key Decisions

- Single JSON file + exclusive lock (wx) with spin retry; claim uses `pending` → `firing` → `fired`/`failed` to avoid double spawn.
- `runAt` must include explicit `Z` or numeric offset (validated at CLI add).
- Poller uses registered conductor repos when configured, else `process.cwd()`; `catch-up` when `runAt <= now` and server starts later.
- `scheduled-kickoff.js` does not import `dashboard-server` (repo resolution inlined from conductor list + cwd rules).

## Gotchas / Known Issues

- Jobs stuck in `firing` if the process dies mid-flight (no auto-heal in phase 1).
- `feature-autonomous-start` still enforces Pro/tmux at fire time — failed jobs surface as `failed` with stderr snippet.

## Explicitly Deferred

- Dashboard UI for schedules; `schedule retry`; recurring / quota-aware scheduling.

## For the Next Feature in This Set

- Optional POST API reusing `addJob` validation when UI is added.

## Test Coverage

- Extended `tests/integration/token-window.test.js`: registry + `parseRunAt`, payload validation, poller single-fire + cancel with mocked spawn.
- Removed duplicate `tests/commands/token-window.test.js`; raised default `CEILING` in `scripts/check-test-budget.sh` (Pre-authorised in spec).
