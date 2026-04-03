<!-- AIGON_START -->
# Codex Configuration

## Agent Identity
- **Agent ID**: `cx`
- **Worktree Pattern**: `../feature-NN-cx-description`
- **Implementation Log**: `./docs/specs/features/logs/feature-NN-cx-log.md`

## Commands

### Feature Commands (unified for Drive and Fleet modes)
| Command | Description |
|---------|-------------|
| `/prompts:aigon-feature-create <name>` | Create a new feature spec |
| `/prompts:aigon-feature-prioritise <name>` | Assign ID and move to backlog |
| `/prompts:aigon-feature-start <ID> [agents...]` | Setup for Drive (branch) or Fleet (worktrees) |
| `/prompts:aigon-feature-do <ID> [--autonomous]` | Implement feature; `--autonomous` runs iterative retry loop |
| `/prompts:aigon-feature-eval <ID>` | Create evaluation (code review or comparison) |
| `/prompts:aigon-feature-review <ID>` | Code review with fixes by a different agent |
| `/prompts:aigon-feature-close <ID> [agent]` | Merge and complete feature |
| `/prompts:aigon-feature-autonomous-start <ID> <agents...>` | Start autonomous feature flow with explicit stop-after control |
| `/prompts:aigon-feature-cleanup <ID>` | Clean up Fleet worktrees and branches |

### Research Commands (unified for Drive and Fleet modes)
| Command | Description |
|---------|-------------|
| `/prompts:aigon-research-create <name>` | Create a new research topic |
| `/prompts:aigon-research-prioritise <name>` | Prioritise a research topic |
| `/prompts:aigon-research-start <ID> [agents...]` | Setup for Drive or Fleet execution |
| `/prompts:aigon-research-open <ID>` | Re-open or attach Fleet research sessions when needed |
| `/prompts:aigon-research-do <ID>` | Conduct research (write findings) |
| `/prompts:aigon-research-submit [ID] [agent]` | Signal research findings are complete |
| `/prompts:aigon-research-review <ID>` | Review research findings with a different agent |
| `/prompts:aigon-research-eval <ID>` | Synthesize findings before close |
| `/prompts:aigon-research-close <ID>` | Complete research topic |

### Feedback Commands
| Command | Description |
|---------|-------------|
| `/prompts:aigon-feedback-create <title>` | Create a feedback item in inbox |
| `/prompts:aigon-feedback-list [filters]` | List feedback by status/type/severity/tag |
| `/prompts:aigon-feedback-triage <ID>` | Triage feedback with explicit apply confirmation |

### Utility Commands
| Command | Description |
|---------|-------------|
| `/prompts:aigon-next` (alias: `/prompts:aigon-n`) | Suggest the most likely next workflow command |
| `/prompts:aigon-help` | Show all Aigon commands |

## Modes

- **Drive mode**: `/prompts:aigon-feature-start <ID>` - Creates branch only, work in current directory
- **Fleet mode**: `/prompts:aigon-feature-start <ID> <agents...>` - Creates worktrees for parallel implementation

## Mandatory Lifecycle Commands

Feature and research work are NOT complete until you run these commands yourself:

1. `aigon agent-status implementing` — when you start coding or begin active research
2. `aigon agent-status submitted` — after committing all code, log updates, or research findings

These are CLI commands you run directly — not slash commands, not auto-invoked. The `aigon agent-status` command writes state to the **main repo** (not the worktree), so you won't see state files locally. Just run the command and trust the output.

## Critical Rules

1. **Read the active spec first**: Use `aigon feature-spec <ID>` for features and `aigon research-spec <ID>` for research
2. **Use the correct workspace model**: Feature Drive uses a branch, Feature Fleet uses worktrees, Research usually runs in the main repo unless explicitly launched as parallel sessions
3. **Use conventional commits when you commit**: Prefer `feat:`, `fix:`, `chore:`, or `docs:` as appropriate
4. **Complete with the matching command**: Use the `feature-*` or `research-*` close/review/eval command for the entity you are working on
5. **Follow project instructions**: Check `AGENTS.md` for shared project build, test, and dependency commands
6. **Orient to the codebase first**: Read `docs/architecture.md` before making structural CLI changes

## Drive Mode Workflow

1. Run `/prompts:aigon-feature-start <ID>` to create branch and move spec
2. Run `/prompts:aigon-feature-do <ID>` to begin implementation
3. Read the spec path returned by `aigon feature-spec <ID>`
4. Implement the feature according to the spec
5. Test your changes and wait for user confirmation
6. Commit using conventional commits (`feat:`, `fix:`, `chore:`)
7. Update the implementation log in `./docs/specs/features/logs/`
8. **STOP** - Wait for user to approve before running `/prompts:aigon-feature-close <ID>`

## Fleet Mode Workflow

1. Run `/prompts:aigon-feature-start <ID> cc cx gg cu` to create worktrees for each agent
2. **STOP** - Tell the user to open the worktree in a separate session
3. In the worktree session:
   - Run `/prompts:aigon-feature-do <ID>`
   - Read the spec path returned by `aigon feature-spec <ID>`
   - Implement the feature
   - The `feature-do` command handles commit, log, and signaling completion — stay in the session for user review
4. Return to main repo for evaluation: `/prompts:aigon-feature-eval <ID>`
5. Merge winner: `/prompts:aigon-feature-close <ID> cx`
6. Clean up losers: `/prompts:aigon-feature-cleanup <ID> --push` (to save branches) or `/prompts:aigon-feature-cleanup <ID>` (to delete)

## Research Workflow

Research follows the same lifecycle shape as features: `start -> do -> submit -> review/eval -> close`.

### Drive Mode

1. Run `/prompts:aigon-research-start <ID>` to move the topic to in-progress
2. Run `/prompts:aigon-research-do <ID>` to conduct the research
3. Write findings directly in the main research document
4. Optionally run `/prompts:aigon-research-review <ID>` for a second-agent review pass
5. Run `aigon agent-status submitted` when your research pass is complete
6. Run `/prompts:aigon-research-close <ID>` when ready to finish

### Fleet Mode

1. Run `/prompts:aigon-research-start <ID> cc cx gg cu` to prepare and launch parallel research
2. In each agent session, run `/prompts:aigon-research-do <ID>`
3. Each agent writes only to its own findings file and signals completion
4. Optionally run `/prompts:aigon-research-review <ID>` for a separate review pass
5. Return to the main repo for synthesis: `/prompts:aigon-research-eval <ID>`
6. Finish the topic: `/prompts:aigon-research-close <ID>`
7. Use `/prompts:aigon-research-open <ID>` only to re-open or attach Fleet research sessions after setup


## Before Completing a Feature

Before running `/prompts:aigon-feature-close`, always:

1. **Push the branch to origin** to save your work remotely:
   ```bash
   git push -u origin <current-branch-name>
   ```
2. **Ask the user** if they want to delete the local branch after merge (the CLI will delete it by default)

<!-- AIGON_END -->
