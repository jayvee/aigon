<!-- description: Transfer feature <ID> from its current agent to a different agent — preserves commits and in-flight work -->
# aigon-feature-transfer

Hand a stuck or paywalled in-progress feature from its current agent to a different agent, **without** losing commits or in-flight work. Intended for:
- An agent hitting a usage/token limit mid-implementation (Codex paywall, Claude 5h limit).
- An agent stalling on a prompt, auth flow, or tool confusion that won't resolve itself.
- A human deciding that a different agent (e.g. Claude Code) should take over from here.

The worktree, commits, branch, and workflow history are all preserved. Only the active agent changes.

## Usage

```bash
aigon feature-transfer {{ARG1_SYNTAX}} --to=<agent> [--reason="..."] [--no-launch]
```

Flags:
- `--to=<agent>` (required) — target agent id (e.g. `cc`, `cx`, `gg`, `cu`).
- `--reason="..."` — free-text reason recorded in the transfer briefing.
- `--no-launch` — do the transfer but don't auto-spawn the new agent; handy for scripted orchestration.

## What it does (in order)

1. **Captures** the last ~3000 lines from every live tmux pane for the feature.
2. **Writes a briefing** to `docs/specs/features/logs/feature-<ID>-transfer-<timestamp>.md` — last commits, uncommitted diff, pane tails, and next-steps for the new agent.
3. **Commits** any uncommitted work in the worktree as `wip(transfer): save <old> state before handoff to <new>` so nothing is lost by the directory move.
4. **Kills** the old agent's tmux sessions and removes its heartbeat file.
5. **Moves** the worktree with `git worktree move` — directory renames from `feature-<ID>-<old>-<desc>/` to `feature-<ID>-<new>-<desc>/`. The branch name is preserved (it encodes who originally started the work — not a problem, it's cosmetic after merge).
6. **Re-seeds** the workflow engine by emitting a fresh `feature.started` event so the dashboard and snapshot reflect the new agent. Prior events stay in history.
7. **Launches** the new agent with `aigon feature-do <ID> --agent=<new>` unless `--no-launch` was passed.

The new agent's first task is to read the briefing and the `wip(transfer)` commit before doing anything else — the briefing lays out exactly where the previous agent stopped and why.

## Examples

```bash
# Codex hit its usage limit — pick up with Claude Code.
aigon feature-transfer 306 --to=cc --reason="cx hit GPT-5 usage limit, 8h wait"

# Same thing, but don't auto-start cc — useful in scripts that want to
# do their own launch or schedule it for later.
aigon feature-transfer 308 --to=cc --reason="auto-failover" --no-launch
```

## Related

- `aigon feature-reset <ID>` — nukes the feature back to backlog (destroys commits). Use this only when you want to start over.
- `aigon sessions-close <ID>` — only kills tmux sessions. The transfer command calls this internally.
- Planned: F308 ("auto failover agent on token exhaustion") will invoke this command automatically when it detects a usage-limit panel in an agent's output.
