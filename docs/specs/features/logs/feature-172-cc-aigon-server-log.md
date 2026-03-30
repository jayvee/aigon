# Implementation Log: Feature 172 - aigon-server
Agent: cc

## Plan

Split the dashboard process into two modules: HTTP (read-only) and supervisor (observe-only signals). Add `aigon server` CLI command with start/stop/status subcommands and system service installation.

## Progress

1. Created `lib/supervisor.js` (276 lines) — sweep loop checking tmux liveness and heartbeat expiry across all repos/features. Emits `signal.session_lost` and `signal.heartbeat_expired` via the workflow engine. Sends desktop notifications on macOS/Linux.

2. Created `lib/supervisor-service.js` — installs launchd plist (macOS) or systemd user unit (Linux) for auto-restart via `aigon server start --persistent`.

3. Added `server` command to `lib/commands/infra.js` — delegates to dashboard for start/stop, adds `status` subcommand that fetches supervisor health from the running server's `/api/supervisor/status` endpoint.

4. Stripped mutation logic from `lib/dashboard-server.js`:
   - Removed `/api/sessions/cleanup` endpoint (killed orphan tmux sessions)
   - Removed heartbeat sweep + recovery sweep from `pollStatus()`
   - Removed `sweepExpiredHeartbeats`, `sweepAgentRecovery`, `getRecoveryConfig` imports

5. Achieved zero imports between modules by injecting `startSupervisorLoop` and `getSupervisorStatus` via `serverOptions` from the infra.js command handler.

6. Wrote 15 unit tests covering snapshot scanning, session name construction, lifecycle, idempotency, and source-level module isolation invariants.

## Decisions

- **Zero-import via injection**: The spec's architecture diagram shows HTTP and supervisor sharing a process but never calling each other. Rather than having dashboard-server.js `require('./supervisor')` directly, infra.js injects the functions via `serverOptions`. This satisfies the acceptance criterion while keeping the one-line integration simple.

- **Self-contained tmux check**: Supervisor has its own `tmuxSessionAlive()` instead of importing from worktree.js, keeping its dependency footprint minimal.

- **Notification kept in both**: Dashboard's `emitNotification()` still handles status-change notifications (agent-waiting, all-submitted) since those are read-only observations from the poll loop. Supervisor handles only the liveness-related notifications (session lost, heartbeat expired).

- **8 insights test failures**: Pre-existing — caused by `@aigon/pro` not being npm-linked in the worktree. Not related to this feature.
