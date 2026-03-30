# Feature: dashboard-auto-restart

## Summary

The AIGON server process dies and stays dead when it encounters uncaught exceptions (primarily EPIPE cascades from disconnected clients and double-header writes). Users must manually run `aigon server restart` repeatedly. The AIGON server should automatically restart after crashes, using a platform-appropriate process supervisor. This is a prerequisite for the orchestrator sweep (feature 167), which needs a persistent process to run periodic agent health checks.

## User Stories

- [ ] As a user, when the dashboard crashes, it automatically restarts within a few seconds without me noticing
- [ ] As a user on macOS, the dashboard starts on login and survives terminal closes (launchd)
- [ ] As a user on Linux, the dashboard stays alive via systemd or a simple watchdog
- [ ] As a user, `aigon dashboard status` tells me if auto-restart is enabled and how many restarts have occurred

## Acceptance Criteria

- [ ] `aigon server start` optionally registers a platform supervisor (launchd on macOS, systemd on Linux) that auto-restarts the AIGON server on crash
- [ ] Supervisor restarts the dashboard within 5 seconds of a crash
- [ ] Backoff: if the AIGON server crashes 5+ times in 60 seconds, the supervisor stops retrying and logs the failure
- [ ] `aigon server stop` cleanly unloads the supervisor
- [ ] `aigon server status` shows: running/stopped, uptime, restart count, supervisor type
- [ ] Works without a supervisor too — `aigon dashboard start` without `--persistent` works exactly as today (foreground process)
- [ ] Cross-platform: macOS (launchd plist) and Linux (systemd unit or simple watchdog loop)
- [ ] Dashboard log captures restart events with timestamps

## Validation

```bash
node --check lib/dashboard-server.js
npm test
```

## Technical Approach

### Option A: launchd/systemd integration
- macOS: generate a `~/Library/LaunchAgents/com.aigon.dashboard.plist` that runs `node aigon-cli.js dashboard` with `KeepAlive: true`
- Linux: generate a `~/.config/systemd/user/aigon-dashboard.service` with `Restart=on-failure`
- Pros: OS-native, battle-tested, survives reboots
- Cons: platform-specific code, plist/unit file management

### Option B: Simple watchdog wrapper
- A shell loop or Node.js parent process that restarts the child on exit
- `while true; do node aigon-cli.js dashboard; sleep 2; done`
- Pros: cross-platform, simple, no OS integration
- Cons: doesn't survive terminal close, no reboot persistence

### Recommendation
Option A for `--persistent` mode (explicit opt-in), Option B as the default fallback. Most users on macOS will want launchd.

### Bug fixes to ship alongside
- EPIPE suppression (already fixed — EPIPE from disconnected clients should not count toward crash limit)
- Double-header guard (`ERR_HTTP_HEADERS_SENT` — add a `res.headersSent` check before writing responses in async handlers)

## Dependencies

- None

## Out of Scope

- Orchestrator sweep logic (feature 167 — runs inside the persistent dashboard)
- Remote dashboard hosting
- Docker/container deployment

## Open Questions

- Should `--persistent` be the default, or always opt-in?
- Should the dashboard auto-start on `aigon init` or require explicit `aigon dashboard start --persistent`?

## Related

- Feature 167 (orchestrator sweep) — needs a persistent AIGON server process
- Feature 32 (conductor daemon) — original daemon feature, now superseded by dashboard
- Dashboard crash logs: `~/.aigon/dashboard.log`
