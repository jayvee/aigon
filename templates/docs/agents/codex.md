<!-- AIGON_START -->
# Codex Configuration

## Agent Identity
- **Agent ID**: `cx`
- **Worktree Pattern**: `../feature-NN-cx-description`
- **Implementation Log**: `./docs/specs/features/logs/feature-NN-cx-log.md`

## CLI Commands

Codex uses `aigon` CLI commands directly (no slash commands).

### Solo Mode (single agent)

| Command | Description |
|---------|-------------|
| `aigon feature-create <name>` | Create a new feature spec in inbox |
| `aigon feature-prioritise <name>` | Move feature to backlog, assign ID |
| `aigon feature-start <ID>` | Create branch, move spec to in-progress |
| `aigon feature-eval <ID>` | Move feature to evaluation (optional) |
| `aigon feature-done <ID>` | Merge branch and complete |

### Bakeoff Mode (multi-agent)

| Command | Description |
|---------|-------------|
| `aigon feature-start <ID> cx` | Create worktree for this agent |
| `aigon feature-start <ID> cx gg cc` | Create worktrees for multiple agents |
| `aigon feature-eval <ID>` | Move feature to evaluation |
| `aigon feature-done <ID> cx` | Merge this agent's branch |
| `aigon cleanup <ID>` | Remove losing worktrees and local branches |
| `aigon cleanup <ID> --push` | Push losing branches to origin first, then cleanup |

### Research

| Command | Description |
|---------|-------------|
| `aigon research-create <name>` | Create research topic in inbox |
| `aigon research-prioritise <name>` | Move research to backlog |
| `aigon research-start <ID>` | Move research to in-progress |
| `aigon research-done <ID>` | Complete research topic |

## Solo Mode Workflow

1. Run `aigon feature-start <ID>` to create branch and move spec
2. Read the spec in `./docs/specs/features/03-in-progress/feature-<ID>-*.md`
3. Implement the feature according to the spec
4. Test your changes and wait for user confirmation
5. Commit using conventional commits (`feat:`, `fix:`, `chore:`)
6. Update the implementation log in `./docs/specs/features/logs/`
7. **STOP** - Wait for user to approve before running `aigon feature-done <ID>`

## Bakeoff Mode Workflow

1. Run `aigon feature-start <ID> cx` (or with multiple agents) to create worktree(s)
2. **STOP** - Tell the user to open the worktree in a separate session
3. In the worktree session:
   - Read the spec in `./docs/specs/features/03-in-progress/feature-<ID>-*.md`
   - Implement the feature
   - Commit your changes
   - Update the implementation log
   - **STOP** - Do NOT run `feature-done` from worktree
4. Return to main repo for evaluation: `aigon feature-eval <ID>`
5. Merge winner: `aigon feature-done <ID> cx`
6. Clean up losers: `aigon cleanup <ID> --push` (to save branches) or `aigon cleanup <ID>` (to delete)

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
<!-- AIGON_END -->
