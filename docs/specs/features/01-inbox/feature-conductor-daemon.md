# Feature: conductor-daemon

## Summary

A lightweight background daemon (`aigon conductor start`) that polls log file front matter across one or more repos and sends macOS desktop notifications when agent status changes. Closes the loop between "agents running silently" and "developer knows when to come back." Also introduces a global multi-repo registry so a single daemon instance monitors all your Aigon projects at once.

## User Stories

- [ ] As a developer, I want to close my Warp tabs and get a macOS notification when any agent finishes and is ready for my input
- [ ] As a developer across multiple projects, I want one daemon watching all my repos — not one per project
- [ ] As a developer, I want `aigon conductor stop` to cleanly shut down the daemon when I'm done for the day
- [ ] As a developer, I want `aigon conductor status` to tell me if the daemon is running and what it's watching

## Acceptance Criteria

- [ ] `aigon conductor start` spawns a background daemon process (persists after terminal close)
- [ ] `aigon conductor stop` terminates the daemon
- [ ] `aigon conductor status` shows: running/stopped, watched repos, last poll time, any agents currently `waiting`
- [ ] Daemon polls log file front matter every 30 seconds across all watched repos
- [ ] When any agent transitions to `waiting`: sends a macOS notification via `osascript` with feature name, agent, and repo
- [ ] When all agents on a feature reach `submitted`: sends a single "ready for eval/review" notification
- [ ] Global repo registry at `~/.aigon/config.json` under a `repos` array
- [ ] `aigon conductor add [path]` registers current (or specified) repo — defaults to `cwd`
- [ ] `aigon conductor remove [path]` unregisters a repo
- [ ] `aigon conductor list` lists all watched repos
- [ ] Daemon PID stored at `~/.aigon/conductor.pid`
- [ ] Daemon logs to `~/.aigon/conductor.log`
- [ ] `node --check aigon-cli.js` passes

## Validation

```bash
node --check aigon-cli.js
```

## Technical Approach

### Daemon process

A detached Node.js child process started with `{detached: true, stdio: 'ignore'}` and `child.unref()` so it survives terminal close. The daemon script is either inlined in `aigon-cli.js` or extracted to a small separate file invoked via `node`.

### Poll loop

Every 30 seconds:
1. For each registered repo, glob `docs/specs/features/logs/feature-*-log.md` in `03-in-progress/` features
2. Parse front matter from each
3. Compare to last-seen state (stored in memory)
4. On transition → send `osascript` notification

### Notification format

```
osascript -e 'display notification "cc is waiting on #30 board-action-hub" with title "Aigon · ~/src/myapp"'
```

### Multi-repo registry

```json
// ~/.aigon/config.json
{
  "repos": [
    "/Users/jviner/src/aigon",
    "/Users/jviner/src/my-web-app"
  ]
}
```

`aigon conductor add` appends cwd to the array. `aigon conductor remove` removes it.

### Daemon lifecycle

- Start: write PID to `~/.aigon/conductor.pid`, begin poll loop
- Stop: read PID, `process.kill(pid)`, delete PID file
- Status: check if PID file exists and process is alive

## Dependencies

- Feature: log-status-tracking (required — daemon reads log front matter)

## Out of Scope

- Windows/Linux support (macOS notifications only for now)
- Auto-triggering `feature-eval` (user still drives evaluation)
- tmux session management
- Web dashboard UI (conductor-web-dashboard)

## Open Questions

- Should the daemon be registered as a launchd service (survive reboots) or just a manual-start process? Start with manual, add launchd support later.

## Related

- Feature: log-status-tracking (prerequisite)
- Feature: conductor-menubar (visual layer on top of this daemon)
- Feature: conductor-web-dashboard (richer UI on top of same data)
