<!-- AIGON_START -->
# {{AGENT_TITLE}}

## Agent Identity
- **Agent ID**: `{{AGENT_ID}}`
- **Worktree Pattern**: `../feature-NN-{{AGENT_ID}}-description`
- **Implementation Log**: Mode-conditional — Fleet requires a short log under `./docs/specs/features/logs/`; solo Drive (branch) skips it by default; solo Drive worktree uses a one-line log when a starter file exists. Override with `"logging_level": "fleet-only" | "always" | "never"` in `.aigon/config.json` (see `docs/development_workflow.md`).

## Commands

### Feature Commands (unified for Drive and Fleet modes)
| Command | Description |
|---------|-------------|
| `{{CMD_PREFIX}}feature-create <name>` | Create a new feature spec |
| `{{CMD_PREFIX}}feature-prioritise <name>` | Assign ID and move to backlog |
| `{{CMD_PREFIX}}feature-start <ID> [agents...]` | Setup for Drive (branch) or Fleet (worktrees) |
| `{{CMD_PREFIX}}feature-do <ID> [--iterate]` | Implement feature; `--iterate` runs Autopilot retry loop |
| `{{CMD_PREFIX}}feature-eval <ID>` | Create evaluation (code review or comparison) |
| `{{CMD_PREFIX}}feature-code-review <ID>` | Code review with fixes by a different agent |
| `{{CMD_PREFIX}}feature-close <ID> [agent]` | Merge and complete feature |
| `{{CMD_PREFIX}}feature-push [ID] [agent]` | Push feature branch to origin for PR review |
| `{{CMD_PREFIX}}feature-autonomous-start <ID> <agents...>` | Start autonomous feature flow with explicit stop-after control |
| `{{CMD_PREFIX}}feature-cleanup <ID>` | Clean up Fleet worktrees and branches |

### Research Commands (unified for Drive and Fleet modes)
| Command | Description |
|---------|-------------|
| `{{CMD_PREFIX}}research-create <name>` | Create a new research topic |
| `{{CMD_PREFIX}}research-prioritise <name>` | Prioritise a research topic |
| `{{CMD_PREFIX}}research-start <ID> [agents...]` | Setup for Drive or Fleet execution |
| `{{CMD_PREFIX}}research-open <ID>` | Re-open or attach Fleet research sessions when needed |
| `{{CMD_PREFIX}}research-do <ID>` | Conduct research (write findings) |
| `{{CMD_PREFIX}}research-submit [ID] [agent]` | Signal research findings are complete |
| `{{CMD_PREFIX}}research-review <ID>` | Review research findings with a different agent |
| `{{CMD_PREFIX}}research-eval <ID>` | Synthesize findings before close |
| `{{CMD_PREFIX}}research-close <ID>` | Complete research topic |

### Feedback Commands
| Command | Description |
|---------|-------------|
| `{{CMD_PREFIX}}feedback-create <title>` | Create a feedback item in inbox |
| `{{CMD_PREFIX}}feedback-list [filters]` | List feedback by status/type/severity/tag |
| `{{CMD_PREFIX}}feedback-triage <ID>` | Triage feedback with explicit apply confirmation |

### Utility Commands
| Command | Description |
|---------|-------------|
| `{{CMD_PREFIX}}next` (alias: `{{CMD_PREFIX}}n`) | Suggest the most likely next workflow command |
| `{{CMD_PREFIX}}help` | Show all Aigon commands |

## Modes

- **Drive mode**: `{{CMD_PREFIX}}feature-start <ID>` - Creates branch only, work in current directory
- **Fleet mode**: `{{CMD_PREFIX}}feature-start <ID> <agents...>` - Creates worktrees for parallel implementation

## Mandatory Lifecycle Commands

Feature and research work are NOT complete until you run these commands yourself:

1. `aigon agent-status implementing` — when you start coding or begin active research
2. `aigon agent-status submitted` — after committing all code, log updates, or research findings

These are direct lifecycle commands you run yourself in the agent host — slash commands for some agents, skills for Codex, and never auto-invoked. The `aigon agent-status` command writes state to the **main repo** (not the worktree), so you won't see state files locally. Just run the command and trust the output.

## Critical Rules

1. **Read the active spec first**: Use `aigon feature-spec <ID>` for features. For research, read the spec directly from `docs/specs/research-topics/03-in-progress/`
2. **Use the correct workspace model**: Feature Drive uses a branch, Feature Fleet uses worktrees, Research usually runs in the main repo unless explicitly launched as parallel sessions
3. **Use conventional commits when you commit**: Prefer `feat:`, `fix:`, `chore:`, or `docs:` as appropriate
4. **Complete with the matching command**: Use the `feature-*` or `research-*` close/review/eval command for the entity you are working on
5. **Follow project instructions**: Check `AGENTS.md` for shared project build, test, and dependency commands
6. **Orient to the codebase first**: Read `docs/architecture.md` before making structural CLI changes

## Drive Mode Workflow

1. Run `{{CMD_PREFIX}}feature-start <ID>` to create branch and move spec
2. Run `{{CMD_PREFIX}}feature-do <ID>` to begin implementation
3. Read the spec path returned by `aigon feature-spec <ID>`
4. Implement the feature according to the spec
5. Test your changes and wait for user confirmation
6. Commit using conventional commits (`feat:`, `fix:`, `chore:`)
7. Update the implementation log in `./docs/specs/features/logs/`
8. **STOP** - Wait for user to approve before running `{{CMD_PREFIX}}feature-close <ID>`

## Fleet Mode Workflow

1. Run `{{CMD_PREFIX}}feature-start <ID> cc cx gg cu` to create worktrees for each agent
2. **STOP** - Tell the user to open the worktree in a separate session
3. In the worktree session:
   - Run `{{CMD_PREFIX}}feature-do <ID>`
   - Read the spec path returned by `aigon feature-spec <ID>`
   - Implement the feature
   - The `feature-do` command handles commit, log, and signaling completion — stay in the session for user review
4. Return to main repo for evaluation: `{{CMD_PREFIX}}feature-eval <ID>`
5. Merge winner: `{{CMD_PREFIX}}feature-close <ID> cx`
6. Clean up losers: `{{CMD_PREFIX}}feature-cleanup <ID> --push` (to save branches) or `{{CMD_PREFIX}}feature-cleanup <ID>` (to delete)

## Research Workflow

Research follows the same lifecycle shape as features: `start -> do -> submit -> review/eval -> close`.

### Drive Mode

1. Run `{{CMD_PREFIX}}research-start <ID>` to move the topic to in-progress
2. Run `{{CMD_PREFIX}}research-do <ID>` to conduct the research
3. Write findings directly in the main research document
4. Optionally run `{{CMD_PREFIX}}research-review <ID>` for a second-agent review pass
5. Run `aigon agent-status submitted` when your research pass is complete
6. Run `{{CMD_PREFIX}}research-close <ID>` when ready to finish

### Fleet Mode

1. Run `{{CMD_PREFIX}}research-start <ID> cc cx gg cu` to prepare and launch parallel research
2. In each agent session, run `{{CMD_PREFIX}}research-do <ID>`
3. Each agent writes only to its own findings file and signals completion
4. Optionally run `{{CMD_PREFIX}}research-review <ID>` for a separate review pass
5. Return to the main repo for synthesis: `{{CMD_PREFIX}}research-eval <ID>`
6. Finish the topic: `{{CMD_PREFIX}}research-close <ID>`
7. Use `{{CMD_PREFIX}}research-open <ID>` only to re-open or attach Fleet research sessions after setup

{{PERMISSION_SAVE_NOTE}}
## Before Completing a Feature

Before running `{{CMD_PREFIX}}feature-close`, always:

1. **If you want GitHub PR review, publish the branch**:
   ```bash
   {{CMD_PREFIX}}feature-push
   ```
2. **Ask the user** if they want to delete the local branch after merge (the CLI will delete it by default)
{{AGENT_PITFALLS}}
<!-- AIGON_END -->
