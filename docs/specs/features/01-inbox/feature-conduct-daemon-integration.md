# Feature: conduct Daemon Integration

## Summary

`aigon conduct` uses a blocking foreground poll loop. When you Ctrl+C, all monitoring state is lost and there's no way to resume. The `conductor` daemon already exists as a persistent background process (`aigon conductor start/stop/status`) but `conduct` doesn't use it. Conduct should hand off monitoring to the daemon so it survives terminal closure, Ctrl+C, and laptop sleep.

## User Stories

- [ ] As a developer, I want to run `aigon conduct 44 cc gg` and close my terminal without losing monitoring — the conductor daemon keeps watching and notifies me when done
- [ ] As a developer, I want to run `aigon conduct status 44` from any terminal at any time to see the current state, not just while the blocking process is running
- [ ] As a developer, I want to run `aigon conduct resume 44` to re-attach to a monitoring session I previously cancelled or lost
- [ ] As a developer, I want conduct to automatically trigger `feature-eval` (via CLI launch) when all agents submit, even if my terminal is closed

## Acceptance Criteria

- [ ] `aigon conduct <ID> [agents...]` starts the daemon if not running, registers the feature, sets up worktrees, spawns agents — then exits (does not block)
- [ ] The conductor daemon handles all polling and notifications from that point
- [ ] `aigon conduct status <ID>` works independently at any time (reads from daemon state or log files directly)
- [ ] `aigon conduct resume <ID>` re-attaches to live status output for a running conductor session
- [ ] `aigon conduct stop <ID>` stops agents and unregisters the feature from daemon monitoring
- [ ] When all agents submit, daemon triggers `aigon feature-eval <ID>` automatically (using the new CLI launch capability)
- [ ] Ctrl+C during `conduct resume` stops the display but leaves the daemon and agents running
- [ ] If no agents are lost/stuck, the full arena loop runs end-to-end with zero terminal interaction after the initial `aigon conduct` command

## Out of Scope

- Multi-machine / remote daemon
- Web dashboard
