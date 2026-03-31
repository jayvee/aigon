# Feature: Introduce cmux as terminal option

## Summary

Add cmux (https://cmux.com/) as a first-class terminal option in Aigon alongside Warp, iTerm2, and Terminal.app. cmux is a native macOS terminal built on libghostty that treats AI agent sessions as first-class citizens — with workspace-level notifications, sidebar metadata (status pills, progress bars, git branch), a socket API for programmatic control, and an embedded browser. It's purpose-built for the exact multi-agent workflow Aigon runs.

## User Stories

- [ ] As a developer running multiple agents in Fleet mode, I want cmux to show each agent as a workspace with status metadata so I can monitor all agents from one sidebar
- [ ] As a developer, I want agent completion notifications to appear as cmux desktop notifications so I know when to review
- [ ] As a developer, I want `terminal: "cmux"` in my config to launch agent sessions in cmux workspaces instead of iTerm2/Warp
- [ ] As a developer, I want Aigon to generate a `cmux.json` workspace layout for Fleet features so I get a pre-configured multi-pane view

## Acceptance Criteria

### Core terminal support
- [ ] `terminal: "cmux"` is a valid option in global/project config (`~/.aigon/config.json` or `.aigon/config.json`)
- [ ] `feature-start` creates cmux workspaces instead of Warp launch configs or iTerm2 AppleScript windows
- [ ] `feature-open` attaches to existing cmux workspaces (or creates them if missing)
- [ ] tmux sessions are still created as the underlying session manager — cmux opens as the terminal emulator that attaches to them (same pattern as iTerm2)
- [ ] Detection: if `terminal: "cmux"` is set but cmux is not installed, fall back to iTerm2/Terminal.app with a warning

### cmux-specific enhancements (leverage the socket API)
- [ ] **Status metadata**: when an agent signals status changes (`aigon agent-status implementing/submitted/error`), push `cmux set-status` to update the workspace sidebar with current stage, feature ID, and agent ID
- [ ] **Notifications**: on agent completion (`agent-status submitted`) or error, fire `cmux notify` for desktop notification
- [ ] **Progress**: if the workflow engine knows step count, push `cmux set-progress` to show a progress bar
- [ ] **Workspace naming**: cmux workspaces use the same naming convention as tmux sessions (`aigon-f{id}-{agent}-{desc}`)

### Workspace layout generation
- [ ] `feature-start` in Fleet mode generates a `cmux.json` (or equivalent API calls) that creates a workspace with one split pane per agent
- [ ] Each pane runs `tmux attach -t {session}` for the respective agent
- [ ] Single-agent (Drive worktree) creates a single-pane workspace

### Configuration
- [ ] `AIGON_TERMINAL=cmux` environment variable override works (same as other terminals)
- [ ] `aigon doctor` checks cmux availability when configured and reports version

## Validation

```bash
node -c lib/worktree.js && node -c lib/config.js && node -c lib/commands/feature.js
```

## Technical Approach

### Architecture: cmux as terminal emulator, tmux as session manager

Aigon's existing pattern is: **create a detached tmux session** → **open a terminal app to attach to it**. cmux slots into the "terminal app" role. This means:

1. `createDetachedTmuxSession()` works unchanged
2. `openTerminalAppWithCommand()` gets a new `cmux` branch that uses the cmux CLI/socket API to create a workspace and run `tmux attach -t {session}`
3. All existing tmux session management (names, cleanup, `sessions-close`) works unchanged

### cmux socket API integration

cmux exposes a Unix socket at `/tmp/cmux.sock` with JSON-RPC. Key commands:

```bash
# Create workspace with command
cmux new-workspace --name "aigon-f55-cc-auth" --command "tmux attach -t aigon-f55-cc-auth"

# Update sidebar metadata
cmux set-status "stage" "implementing" --icon "hammer" --color "yellow"
cmux set-status "feature" "55" --icon "tag"
cmux set-progress 0.6

# Desktop notification
cmux notify --title "Agent cc submitted" --body "Feature 55 ready for review"

# Fleet layout
cmux new-workspace --name "aigon-f55-fleet"
cmux new-split right --command "tmux attach -t aigon-f55-cc-auth"
cmux new-split right --command "tmux attach -t aigon-f55-gg-auth"
```

Detection: `[ -S /tmp/cmux.sock ]` or `which cmux`.

### Files changed

1. **`lib/config.js`** — add `'cmux'` to valid terminal options, detect cmux availability
2. **`lib/worktree.js`** — add `cmux` branch in `openTerminalAppWithCommand()` and `openSingleWorktree()`; add helper functions for cmux socket API calls (`cmuxSetStatus`, `cmuxNotify`, `cmuxSetProgress`)
3. **`lib/commands/feature.js`** — in `feature-start` Fleet mode, generate cmux workspace layout if `terminal === 'cmux'`; in `feature-open`, handle cmux workspace attach
4. **`lib/agent-status.js`** or the shell trap wrapper — after writing agent status, call `cmux set-status` if cmux socket is available (opportunistic, no failure if cmux is not running)
5. **`lib/commands/infra.js`** — update `doctor` to check cmux availability

### Environment variables set by cmux

cmux automatically sets `CMUX_WORKSPACE_ID`, `CMUX_SURFACE_ID`, `CMUX_SOCKET_PATH` in child processes. Aigon can detect these to know it's running inside cmux.

## Dependencies

- cmux must be installed (`brew tap manaflow-ai/cmux && brew install --cask cmux`)
- macOS 14.0+ (cmux is macOS-only, same as Warp/iTerm2 AppleScript)
- No Aigon feature dependencies

## Out of Scope

- cmux embedded browser integration (could be used for dashboard preview — future feature)
- Custom cmux themes/styling for Aigon
- Linux support (cmux is macOS-only; Linux continues using existing terminal detection)
- Replacing tmux as the underlying session manager — cmux is a terminal emulator on top of tmux, not a replacement for it

## Open Questions

- Should cmux be the default terminal on macOS if detected, or remain opt-in via config?
- Should the `cmux.json` workspace layout be committed to the repo (like Warp launch configs) or generated transiently?
- Is the cmux CLI stable enough for production use, or should we use the socket API directly?

## Related

- cmux docs: https://cmux.com/
- cmux GitHub: https://github.com/manaflow-ai/cmux
- Existing terminal handling: `lib/worktree.js` lines 584-757, `lib/commands/feature.js` lines 3131-3310
- Warp launch config generation: `openInWarpSplitPanes()` in `lib/commands/feature.js`
