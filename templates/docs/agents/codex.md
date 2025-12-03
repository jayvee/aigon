<!-- FARLINE_FLOW_START -->
# Codex Configuration

## Agent Identity
- **Agent ID**: `cx`
- **Worktree Pattern**: `../feature-NN-cx-description`
- **Implementation Log**: `./docs/specs/features/logs/feature-NN-cx-log.md`

## CLI Commands

Codex uses `ff` CLI commands directly (no slash commands).

### Solo Mode (single agent)

| Command | Description |
|---------|-------------|
| `ff feature-create <name>` | Create a new feature spec in inbox |
| `ff feature-prioritise <name>` | Move feature to backlog, assign ID |
| `ff feature-start <ID>` | Create branch, move spec to in-progress |
| `ff feature-eval <ID>` | Move feature to evaluation (optional) |
| `ff feature-done <ID>` | Merge branch and complete |

### Bakeoff Mode (multi-agent)

| Command | Description |
|---------|-------------|
| `ff feature-start <ID> cx` | Create worktree for this agent |
| `ff feature-start <ID> cx gg cc` | Create worktrees for multiple agents |
| `ff feature-eval <ID>` | Move feature to evaluation |
| `ff feature-done <ID> cx` | Merge this agent's branch |
| `ff cleanup <ID>` | Remove remaining worktrees |

### Research

| Command | Description |
|---------|-------------|
| `ff research-create <name>` | Create research topic in inbox |
| `ff research-prioritise <name>` | Move research to backlog |
| `ff research-start <ID>` | Move research to in-progress |
| `ff research-done <ID>` | Complete research topic |

## Solo Mode Workflow

1. Run `ff feature-start <ID>` to create branch and move spec
2. Read the spec in `./docs/specs/features/03-in-progress/feature-<ID>-*.md`
3. Implement the feature according to the spec
4. Test your changes and wait for user confirmation
5. Commit using conventional commits (`feat:`, `fix:`, `chore:`)
6. Update the implementation log in `./docs/specs/features/logs/`
7. **STOP** - Wait for user to approve before running `ff feature-done <ID>`

## Bakeoff Mode Workflow

1. Run `ff feature-start <ID> cx` (or with multiple agents) to create worktree(s)
2. **STOP** - Tell the user to open the worktree in a separate session
3. In the worktree session:
   - Read the spec in `./docs/specs/features/03-in-progress/feature-<ID>-*.md`
   - Implement the feature
   - Commit your changes
   - Update the implementation log
   - **STOP** - Do NOT run `feature-done` from worktree
4. Return to main repo for evaluation: `ff feature-eval <ID>`
5. Merge winner: `ff feature-done <ID> cx`

## Critical Rules

1. **Read the spec first**: Always check `./docs/specs/features/03-in-progress/` before coding
2. **Work in isolation**: Solo mode uses branches, multi-agent mode uses worktrees
3. **Conventional commits**: Use `feat:`, `fix:`, `chore:` prefixes
4. **Wait for approval**: Never run `feature-done` without user confirmation

## Before Completing a Feature

Before running `feature-done`, always:

1. **Push the branch to origin** to save your work remotely:
   ```bash
   git push -u origin <current-branch-name>
   ```
2. **Ask the user** if they want to delete the local branch after merge
<!-- FARLINE_FLOW_END -->
