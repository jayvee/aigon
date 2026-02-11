<!-- description: Open all arena research agents side-by-side in terminal -->
# aigon-research-open

Open all arena research agents side-by-side in Warp terminal, each pre-loaded with the research-conduct command.

## Usage

```bash
{{CMD_PREFIX}}research-open <research-id>
```

- `{{CMD_PREFIX}}research-open 05` — opens all arena agents side-by-side for research 05

## When to Use

This command is for **arena mode research only**. It opens multiple terminal panes (one per agent) so you can run parallel research.

**Prerequisites:**
- Research must be set up in arena mode: `aigon research-setup <ID> cc gg cx`
- Findings files must exist in `docs/specs/research-topics/logs/`

## What It Does

1. Detects which agents are set up by scanning findings files
2. Opens Warp terminal with horizontal split panes (one per agent)
3. Each pane is pre-loaded with the agent CLI and `{{CMD_PREFIX}}research-conduct <ID>` command
4. All panes use the main repository directory (not separate worktrees)

## Example

After running:
```bash
aigon research-setup 05 cc gg cx
```

You can open all agents side-by-side:
```bash
aigon research-open 05
```

This opens Warp with 3 panes:
- **Pane 1 (cc)**: `claude --permission-mode acceptEdits "/aigon:research-conduct 05"`
- **Pane 2 (gg)**: `gemini --sandbox --yolo "/aigon:research-conduct 05"`
- **Pane 3 (cx)**: `codex --full-auto "/prompts:aigon-research-conduct 05"`

## Terminal Support

- **Warp**: Opens split panes automatically (recommended)
- **VS Code / Cursor**: Prints manual setup instructions with commands for each agent

## Error Cases

- **Not in arena mode**: Shows error with instructions to run `research-setup` with agents
- **Research not found**: Shows error if research ID doesn't exist or isn't in progress
- **Agent not configured**: Lists which agents need to be installed

## Step 1: Run the CLI command

```bash
aigon research-open {{ARG_SYNTAX}}
```

## Step 2: Confirm to user

Tell the user:
- Which agents are being opened
- That each pane will have the research-conduct command pre-loaded
- That they should run the command in each pane to start research

ARGUMENTS: {{ARG_SYNTAX}}
