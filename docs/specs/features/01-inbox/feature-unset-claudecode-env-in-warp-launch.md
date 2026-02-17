# Feature: unset-claudecode-env-in-warp-launch

## Summary
When `worktree-open` launches a Claude Code session in Warp, the new shell inherits the `CLAUDECODE` environment variable from the parent session. Claude Code detects this and refuses to start with: "Claude Code cannot be launched inside another Claude Code session."

## Problem
The Warp launch configuration YAML runs `claude --permission-mode acceptEdits "/aigon:feature-implement <ID>"` directly. If the user invoked `aigon worktree-open` from within an existing Claude Code session, Warp inherits that session's environment — including `CLAUDECODE`. The child `claude` process sees this variable and exits immediately.

This affects both solo worktree and arena modes when launched from inside Claude Code.

## Reproduction
1. Open a Claude Code session in a project
2. Run `/aigon:worktree-open <ID>` (or `--all` for arena)
3. Warp opens but the `cc` pane fails with the nested session error

## Technical Approach
In `aigon-cli.js`, wherever the Warp launch YAML is generated with a `claude` command (`openInWarpSplitPanes` and `openSingleWorktree`), prefix the exec command with `unset CLAUDECODE &&`:

```yaml
- exec: unset CLAUDECODE && claude --permission-mode acceptEdits "/aigon:feature-implement 116"
```

### Files to change
- `aigon-cli.js` — `openInWarpSplitPanes()` (~line 651) and `openSingleWorktree()` (~line 705)
- Anywhere else agent commands are constructed for the `cc` agent

### Alternative approach
Instead of prefixing every command, add an `env:` block to the Warp YAML if supported:
```yaml
env:
  CLAUDECODE: ""
```
Check Warp launch config docs to see if `env` is supported at the pane level.

## Acceptance Criteria
- [ ] `aigon worktree-open <ID>` from inside a Claude Code session successfully launches a new Claude Code instance in Warp
- [ ] Arena mode (`--all`) successfully launches the `cc` pane without the nested session error
- [ ] Other agents (cu, gg, cx) are unaffected
- [ ] The fix works regardless of whether the parent session is Claude Code or a plain terminal

## Dependencies
- None

## Out of Scope
- Fixing the same issue for other terminals (VS Code, Cursor) — they may not inherit env the same way

## Related
- Warp launch configurations: `~/.warp/launch_configurations/`
- `openInWarpSplitPanes()` in `aigon-cli.js` (~line 642)
- `openSingleWorktree()` in `aigon-cli.js` (~line 679)
