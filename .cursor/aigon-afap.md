# aigon-feature-autopilot

Run a fully autonomous Fleet pipeline for a feature. Sets up worktrees, spawns agents in autonomous mode, monitors progress, and optionally runs evaluation when all agents submit.

```bash
aigon feature-autopilot <args> [agents...]
```

## Argument Resolution

If no ID is provided, or the ID doesn't match an existing feature in backlog or in-progress:
1. Run `aigon feature-list`
2. If a partial ID or name was given, filter to matches
3. Present the matching features and ask the user to choose one

## Usage

### Basic usage (use configured default agents)
```bash
aigon feature-autopilot <args>
```

### Specify agents explicitly
```bash
aigon feature-autopilot <args> cc gg cx
```

### With options
```bash
aigon feature-autopilot <args> cc gg cx --max-iterations=8
aigon feature-autopilot <args> cc gg cx --auto-eval
```

## What it does

1. **Setup phase**: If no worktrees exist, runs `feature-start` to create them
2. **Spawn phase**: Creates a tmux session for each agent, running `feature-do --autonomous --auto-submit`
3. **Monitor phase**: Polls agent log files every 30s, prints status table, detects completion
4. **Eval phase**: If `--auto-eval`, runs `feature-eval` automatically; otherwise prints the command to run

## Subcommands

```bash
aigon feature-autopilot status <args>        # Check agent statuses
aigon feature-autopilot stop <args>          # Stop all agents
aigon feature-autopilot attach <args> cc     # Attach to cc's tmux session
```

## Options

- `--max-iterations=N` — Maximum autonomous retry iterations (default: 5)
- `--auto-eval` — Automatically run `feature-eval` when all agents submit
- `--poll-interval=N` — Seconds between status checks (default: 30)

## Requirements

- tmux must be installed (`brew install tmux`)
- At least 2 agents must be specified (or configured as defaults)
- Feature must be in backlog or in-progress

## Prompt Suggestion

After all agents submit, suggest the evaluation command:

`/aigon-feature-eval <args>`

ARGUMENTS: <args>
