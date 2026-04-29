# Implementation Log: Feature 447 - aigon-eval
Agent: cx

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Code Review

**Reviewed by**: assistant (code review pass)
**Date**: 2026-04-29

### Fixes Applied

- `docs/specs/features/02-backlog/feature-444-agent-quota-awareness.md`, `feature-446-handle-quota-failure.md`: restored to `main` — edits were unrelated to F447 (scope discipline).
- `lib/aigon-eval-runner.js`: canned workload bootstrap in the eval worktree (`eval-fixture.txt`, spec copy, `ensureEntityBootstrappedSync`, bootstrap commit) so `feature-do` / `research-do` target dedicated id **991** instead of colliding with real feature **99**; scope checks use `git diff <bootstrapSha>` so committed agent work is visible; telemetry `since` taken after bootstrap; `injectedRuns` no longer mutated with `.shift()`.
- `templates/aigon-eval/workloads/*/expected.json`: id **991**, `finalSpecPath`, research `allowedFiles` paths under `docs/specs/research-topics/logs/`, research `expectedFinalState: submitted`.
- `lib/commands/aigon-eval.js`: quarantine only when `runs >= 2` and `failed >= 2` (single-run eval no longer auto-quarantines on one failure).
- `tests/integration/aigon-eval.test.js`: paths and commands updated for id 991.

### Residual Issues

- **Forbidden-command check** still only observes the outer `aigon` spawn, not commands run inside the tmux session — matches current stub; real session capture would need log/tmux integration.
- **`--report` without prior matrix** still errors as before; acceptable.

### Notes

- See commits from this review for `fix(review):` / `docs(review):` messages and SHAs after commit.
