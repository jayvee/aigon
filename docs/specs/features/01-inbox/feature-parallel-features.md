# Purpose
Open worktrees from multiple different features side-by-side in a single terminal window. This enables working on several features in parallel with one agent (e.g. Claude Code), each in its own pane, launched with a single command.

# Problem
Previously, opening multiple features required running `worktree-open` separately for each one. There was no way to open them all side-by-side in one step. The naming was also inconsistent (`worktree-open` vs `open-worktrees` vs a proposed `open-features`).

# Solution
Unified into `worktree-open` with mode detection based on arguments:

| Invocation | Mode | Behavior |
|---|---|---|
| `worktree-open 55` | Single | Open one worktree (picks most recent) |
| `worktree-open 55 cc` | Single | Open one worktree for specific agent |
| `worktree-open 55 --all` | Arena | Open all agents for feature 55 side-by-side |
| `worktree-open 100 101 102` | Parallel | Open one worktree per feature side-by-side |
| `worktree-open 100 101 102 --agent=cc` | Parallel | Explicit agent for parallel mode |

# Functionality

## Parallel mode (`worktree-open <ID> <ID> ...`)

Example:
```
aigon worktree-open 100 101 102 --agent=cc
```

This opens a single Warp window with three vertical panes, one per feature, each running Claude Code with the appropriate `/aigon-feature-implement <ID>` prompt.

### Behavior
1. Accept 2+ feature IDs as arguments
2. Accept an `--agent=<code>` flag (e.g. `cc`, `gg`) to specify which agent worktree to open for each feature. If omitted, auto-detect: if each feature has exactly one worktree, use it; if ambiguous, error with guidance.
3. For each feature ID, find the matching worktree (filtered by agent if specified)
4. Error clearly if any feature ID has no matching worktree
5. Build agent commands via shared `buildAgentCommand()` helper
6. Generate Warp launch config YAML with vertical split panes via shared `openInWarpSplitPanes()` helper
7. Open via `warp://launch/` URL scheme
8. Print summary of all features/panes being launched
9. For non-Warp terminals: print paths and commands for manual setup

## Warp YAML structure
```yaml
---
name: parallel-features-100-101-102
windows:
  - tabs:
      - title: "Parallel: Features 100, 101, 102"
        layout:
          split_direction: vertical
          panes:
            - cwd: "/path/to/feature-100-cc-dark-mode"
              commands:
                - exec: claude --dangerously-skip-permissions "/aigon-feature-implement 100"
            - cwd: "/path/to/feature-101-cc-auth-flow"
              commands:
                - exec: claude --dangerously-skip-permissions "/aigon-feature-implement 101"
            - cwd: "/path/to/feature-102-cc-settings-page"
              commands:
                - exec: claude --dangerously-skip-permissions "/aigon-feature-implement 102"
```

# Relationship to other modes
- `worktree-open <ID>` = single worktree (solo mode)
- `worktree-open <ID> --all` = one feature, multiple agents side-by-side (arena mode, replaces old `open-worktrees`)
- `worktree-open <ID> <ID> ...` = multiple features, one agent each, side-by-side (parallel mode)

All three modes share extracted helpers: `findWorktrees()`, `filterByFeatureId()`, `buildAgentCommand()`, `openInWarpSplitPanes()`, `openSingleWorktree()`.

# Edge cases
- Feature with no worktree: error listing which feature IDs are missing
- Feature with multiple agent worktrees and no `--agent` flag: error asking user to specify `--agent`
- Only 1 feature ID provided: uses single mode (or arena mode with `--all`)
- Very many panes (5+): Warp may get cramped, but still functional; no artificial limit needed
