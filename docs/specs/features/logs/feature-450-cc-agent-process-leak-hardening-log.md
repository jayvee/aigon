# Implementation Log: Feature 450 - agent-process-leak-hardening
Agent: cc

## Status
Complete. Four root causes fixed in one commit (9e61fcb1).

## New API Surface
- `aigon doctor --reap-orphans [--dry-run] [--min-age=<secs>]` — finds and kills orphaned agent wrapper shells, their descendants, and hanging agent-status invocations.
- `AIGON_STATUS_TIMEOUT_SECS` env var — override the 5s kill timeout on agent-status calls in the EXIT trap.
- `AIGON_HEARTBEAT_MAX_SECS` env var — override the 6h max-runtime ceiling for the heartbeat sidecar.

## Key Decisions
- Fix A used a portable pure-bash timeout pattern (`"$@" & sleep N && kill $!`) rather than GNU `timeout` (not available on all macOS versions). Implemented as `_aigon_run_timed` shell function defined before `_aigon_cleanup` in the wrapper script.
- Fix C throws from `resolveTmuxBinary` on EAGAIN/EMFILE and broken-symlink cases (actionable), returning null only for genuine not-installed. `runTmux` catches the throw and returns it as `{ status: 1, error }` so the return-type contract is unchanged.
- Fix D uses `ps -axo pid,ppid,etime,args` which is cross-platform enough for macOS. The `--min-age` default (3600s) avoids killing recently-started sessions during normal use.

## Gotchas / Known Issues
- Two pre-existing stale tests in `worktree-state-reconcile.test.js` referenced Cursor-specific `_aigon_agent_rc` / `--print` / `--trust` code removed in b80de8ed. Updated to match current behavior.
- The heartbeat `$$` in a bash subshell correctly refers to the parent shell PID (bash semantics since 4.x). This is intentional — we want to stop when the parent exits.

## Explicitly Deferred
- Interactive TTY prompt for `--reap-orphans` (currently just dry-run flag). Could add `read -p "Kill these? [y/N]"` in a future pass.
- Heartbeat subshell detection in `--reap-orphans`: bash shows subshells as `sleep N` or `bash` processes, making them hard to fingerprint without the heartbeat file path. Current approach catches the wrapper and all descendants.

## For the Next Feature in This Set
None — this is standalone hardening.

## Test Coverage
Added two regression tests: Fix A (trap uses `_aigon_run_timed`, AIGON_STATUS_TIMEOUT_SECS present) and Fix B (three guards: `kill -0 $$`, `AIGON_HEARTBEAT_MAX_SECS`, `tmux has-session`). Total: 9 passing in worktree-state-reconcile.test.js.

## Code Review

**Reviewed by**: cc (Cursor code-review pass)
**Date**: 2026-04-29

### Fixes Applied
- `fix(review): tighten F450 hardening edge cases` (9d18dd1f) — `--reap-orphans` now walks descendants for hanging `aigon agent-status` roots (not only PPID=1 wrappers); Homebrew “symlink missing” hint only when a standard brew `tmux` bin path failed with ENOENT; `--min-age` NaN/negative falls back to 3600; `runShellCapture` throws on EAGAIN/EMFILE like `runShell`; reverted accidental `feature-442` spec folder move off `main`.

### Residual Issues
- **Start-path `agent-status`**: the pre-trap `AIGON_TASK_TYPE=… aigon agent-status <start>` line is still unbounded; the spec’s recurrence vector was the EXIT trap, so this is lower risk but a long-hang edge remains if the server never responds on start.
- **`--reap-orphans` UX**: spec called for interactive confirmation before kill; implementation remains dry-run vs destructive only (already noted as deferred in the implementation log).

### Notes
- Implementation otherwise matches the spec’s A/B/C/D bundle: timed trap, triple heartbeat guards, fork/symlink diagnostics, reap tooling, and integration test updates.
