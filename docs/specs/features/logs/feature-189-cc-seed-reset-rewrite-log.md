# Implementation Log: Feature 189 - seed-reset-rewrite
Agent: cc

## Plan

Rewrite `seed-reset` in `lib/commands/setup.js` as three clearly separated phases:
1. **Nuke** — kill tmux sessions, agent processes, stragglers; remove Claude trust/permissions; GC dev-proxy; delete repo + worktree dirs
2. **Clone** — `git clone` from seed registry (only phase that can abort)
3. **Provision** — `aigon init`, rebuild manifests, install agents, update git exclude, auto-commit

## Progress

- Read and understood the full current implementation (~215 lines, single flat function)
- Rewrote as three phase functions + `removeDirectoryRobust` helper (+251/-141 lines)
- Verified syntax check passes
- Verified existing integration tests pass
- Committed: `0dfcff50`

## Decisions

- **Kept `rebuildSeedFeatureManifests`** — still needed to move any in-progress/paused specs back to backlog after clone, since seed repos may have drifted
- **Added `removeDirectoryRobust`** — retries up to 3x with delays for ENOTEMPTY/EBUSY/EPERM, then falls back to shell `rm -rf`. This handles the documented problem #9 (ENOTEMPTY from .git worktree references)
- **Added `try/finally` for `process.chdir`** — ensures cwd is always restored even if provision partially fails
- **Added parent dir creation** before clone — handles edge case where parent dir was removed
- **Dashboard crash protection is already sufficient** — `safeReadDir` + `uncaughtException` handler (5-exception threshold) means the dashboard survives repo deletion and auto-recovers on next poll
- **No test file written** — per user preference, skipped test theatre
- **Phase labels in dry-run** — `[nuke]`, `[clone]`, `[provision]` labels make the plan output scannable and match the spec's three-operation design
