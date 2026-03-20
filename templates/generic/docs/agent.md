<!-- AIGON_START -->
# {{AGENT_TITLE}}

## Agent Identity
- **Agent ID**: `{{AGENT_ID}}`
- **Worktree Pattern**: `../feature-NN-{{AGENT_ID}}-description`
- **Implementation Log**: `./docs/specs/features/logs/feature-NN-{{AGENT_ID}}-log.md`

## Commands

### Feature Commands (unified for Drive and Fleet modes)
| Command | Description |
|---------|-------------|
| `{{CMD_PREFIX}}feature-create <name>` | Create a new feature spec |
| `{{CMD_PREFIX}}feature-prioritise <name>` | Assign ID and move to backlog |
| `{{CMD_PREFIX}}feature-start <ID> [agents...]` | Setup for Drive (branch) or Fleet (worktrees) |
| `{{CMD_PREFIX}}feature-do <ID> [--autonomous]` | Implement feature; `--autonomous` runs iterative retry loop |
| `{{CMD_PREFIX}}feature-eval <ID>` | Create evaluation (code review or comparison) |
| `{{CMD_PREFIX}}feature-review <ID>` | Code review with fixes by a different agent |
| `{{CMD_PREFIX}}feature-submit` | (you must run this) Commit changes, write log, signal implementation complete |
| `{{CMD_PREFIX}}feature-close <ID> [agent]` | Merge and complete feature |
| `{{CMD_PREFIX}}feature-autopilot <ID> [agents...]` | Fleet autopilot: setup + spawn + monitor + eval |
| `{{CMD_PREFIX}}feature-cleanup <ID>` | Clean up Fleet worktrees and branches |

### Research Commands (unified for Drive and Fleet modes)
| Command | Description |
|---------|-------------|
| `{{CMD_PREFIX}}research-create <name>` | Create a new research topic |
| `{{CMD_PREFIX}}research-prioritise <name>` | Prioritise a research topic |
| `{{CMD_PREFIX}}research-start <ID> [agents...]` | Setup for Drive or Fleet research |
| `{{CMD_PREFIX}}research-open <ID>` | Open all Fleet agents side-by-side for parallel research |
| `{{CMD_PREFIX}}research-do <ID>` | Conduct research (write findings) |
| `{{CMD_PREFIX}}research-submit` | (you must run this) Signal research findings are complete |
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

A feature is NOT complete until you run these commands yourself:

1. `aigon agent-status implementing` — when you start coding
2. `aigon agent-status submitted` — after committing all code and log updates

These are CLI commands you run directly — not slash commands, not auto-invoked. The `aigon agent-status` command writes state to the **main repo** (not the worktree), so you won't see state files locally. Just run the command and trust the output.

## Critical Rules

1. **Read the spec first**: Always check `./docs/specs/features/03-in-progress/` before coding
2. **Work in isolation**: Drive mode uses branches, Fleet mode uses worktrees
3. **Conventional commits**: Use `feat:`, `fix:`, `chore:` prefixes
4. **Complete properly**: Use `{{CMD_PREFIX}}feature-close <ID>` for Drive, `{{CMD_PREFIX}}feature-close <ID> {{AGENT_ID}}` for Fleet
5. **Follow project instructions**: Check `AGENTS.md` for shared project build, test, and dependency commands
6. **Orient to the codebase first**: Read `docs/architecture.md` before making structural CLI changes

## Drive Mode Workflow

1. Run `{{CMD_PREFIX}}feature-start <ID>` to create branch and move spec
2. Run `{{CMD_PREFIX}}feature-do <ID>` to begin implementation
3. Read the spec in `./docs/specs/features/03-in-progress/feature-<ID>-*.md`
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
   - Read the spec in `./docs/specs/features/03-in-progress/feature-<ID>-*.md`
   - Implement the feature
   - The `feature-do` command handles commit, log, and signaling completion — stay in the session for user review
4. Return to main repo for evaluation: `{{CMD_PREFIX}}feature-eval <ID>`
5. Merge winner: `{{CMD_PREFIX}}feature-close <ID> cx`
6. Clean up losers: `{{CMD_PREFIX}}feature-cleanup <ID> --push` (to save branches) or `{{CMD_PREFIX}}feature-cleanup <ID>` (to delete)

{{PERMISSION_SAVE_NOTE}}
## Before Completing a Feature

Before running `{{CMD_PREFIX}}feature-close`, always:

1. **Push the branch to origin** to save your work remotely:
   ```bash
   git push -u origin <current-branch-name>
   ```
2. **Ask the user** if they want to delete the local branch after merge (the CLI will delete it by default)
<!-- AIGON_END -->
