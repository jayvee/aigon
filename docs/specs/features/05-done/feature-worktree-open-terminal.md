# Feature: worktree-open-terminal

## Summary

The `aigon worktree-open` command opens a worktree in a new Warp terminal tab and automatically runs the associated AI agent CLI with the feature-implement command.

## User Stories

- [x] As a developer, I want to quickly open a worktree in Warp so I can start implementing a feature
- [x] As a developer, I want the agent CLI to auto-start with the feature-implement command so I don't have to type it manually
- [x] As a developer, I want to customize which CLI command is used for each agent via config

## Acceptance Criteria

- [x] `aigon worktree-open` opens the most recent worktree
- [x] `aigon worktree-open 77` opens any worktree for feature 77
- [x] `aigon worktree-open 77 cc` opens the specific cc (Claude) worktree for feature 77
- [x] Warp terminal opens with the correct working directory
- [x] Agent CLI starts automatically with feature-implement prompt
- [x] Global config at `~/.aigon/config.json` allows CLI command overrides

## Technical Approach

Uses Warp's native features:
1. **Launch Configurations** - YAML files in `~/.warp/launch_configurations/`
2. **URI scheme** - `warp://launch/{config-name}` to open the config
3. **Dynamic config creation** - Creates YAML on-the-fly with worktree path and agent command

### Warp Launch Config Format
```yaml
---
name: aigon-feature-77-cc-my-feature
windows:
  - tabs:
      - layout:
          cwd: "/absolute/path/to/worktree"
          commands:
            - exec: claude --print "/aigon-feature-implement 77"
```

## Dependencies

- Warp terminal installed
- Git worktrees created via `aigon feature-setup`

## Out of Scope

- Support for other terminals (iTerm2, Terminal.app, etc.) - future enhancement
- Tab management (always opens new tab)

## Open Questions

- None

## Related

- `aigon feature-setup` - Creates the worktrees that this command opens
