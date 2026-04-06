---
name: aigon-feature-open
description: Open feature worktree in terminal and start agent
---

# feature-open

Open a feature worktree in terminal and automatically start the AI agent with `$aigon-feature-do`.

## Usage

```
$aigon-feature-open [feature-id] [agent-code]
```

- `$aigon-feature-open` — open the most recently created worktree
- `$aigon-feature-open 77` — open any worktree for feature 77
- `$aigon-feature-open 77 cx` — open specifically the cx (Codex) worktree for feature 77

## Agent Mappings

| Code | Agent | Command | Mode |
|------|-------|---------|------|
| cc | Claude Code | `claude --permission-mode acceptEdits` | Auto-edits, prompts for risky Bash |
| cu | Cursor | `agent --force` | Auto-approves commands (yolo mode) |
| gg | Gemini | `gemini --yolo` | Auto-approves all |
| cx | Codex | `codex --full-auto` | Workspace-write, smart approval |

Safe in worktrees since you can always `git reset --hard`.

## Permission Tips

When an agent asks for permission, here's how to quickly allow:

| Agent | Allow once | Allow always | Toggle full-auto |
|-------|-----------|-------------|-----------------|
| **Claude Code** | Press Enter at prompt | Choose "Always allow" at prompt | `Shift+Tab` cycles modes |
| **Gemini CLI** | Press `1` at prompt | Press `2` at prompt | `Ctrl+Y` toggles YOLO |
| **Cursor** | Click "Run" | Click "Add to allowlist" | Enable YOLO in settings |
| **Codex** | Approve at prompt | "Allow and remember" (session) | `/mode` command |

## Step 1: Run the CLI command

```bash
aigon feature-open $ARGUMENTS
```

This will:
1. Find the matching worktree
2. Create a Warp launch configuration
3. Open Warp with the worktree directory
4. Auto-run the agent CLI with `$aigon-feature-do <ID>`

## Step 2: Confirm to user

Tell the user:
- Which worktree was opened
- Which agent was launched with which feature ID
- That the agent should start implementing automatically
