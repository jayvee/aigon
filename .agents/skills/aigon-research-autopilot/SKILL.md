---
name: aigon-research-autopilot
description: Research autopilot <ID> [agents...] - Fleet setup + spawn + monitor + evaluate
---

# aigon-research-autopilot

Run a fully autonomous Fleet research pipeline. Sets up findings files, spawns agents in parallel, monitors progress, and optionally runs synthesis when all agents submit.

```bash
aigon research-autopilot $ARGUMENTS [agents...]
```

## Argument Resolution

If no ID is provided, or the ID doesn't match an existing topic in backlog or in-progress:
1. List all files in `./docs/specs/research-topics/02-backlog/` and `03-in-progress/` matching `research-*.md`
2. If a partial ID or name was given, filter to matches
3. Present the matching topics and ask the user to choose one

## Usage

### Basic usage (use configured default agents)
```bash
aigon research-autopilot $ARGUMENTS
```

### Specify agents explicitly
```bash
aigon research-autopilot $ARGUMENTS cc gg cx
```

### With auto-eval
```bash
aigon research-autopilot $ARGUMENTS cc gg cx --auto-eval
```

## What it does

1. **Setup phase**: If no findings files exist, runs `research-start` to create them
2. **Spawn phase**: Creates a tmux session for each agent, running `research-do`
3. **Monitor phase**: Polls agent findings files every 30s for `submitted` status, prints status table
4. **Evaluate phase**: If `--auto-eval`, runs `research-eval` automatically; otherwise prints the command

## Subcommands

```bash
aigon research-autopilot status $ARGUMENTS    # Check agent statuses
aigon research-autopilot stop $ARGUMENTS      # Stop all agents
```

## Options

- `--auto-eval` — Automatically run `research-eval` when all agents submit
- `--poll-interval=N` — Seconds between status checks (default: 30)

## Requirements

- tmux must be installed (`brew install tmux`)
- At least 2 agents must be specified (or configured as defaults)
- Research topic must be in backlog or in-progress

## Agent Workflow

Each spawned agent will:
1. Run `research-do` to conduct their research
2. Write findings to their findings file
3. Run `research-submit` to signal completion

## Prompt Suggestion

After all agents submit, suggest the eval command:

`$aigon-research-eval $ARGUMENTS`

ARGUMENTS: $ARGUMENTS
