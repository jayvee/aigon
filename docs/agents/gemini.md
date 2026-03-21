<!-- AIGON_START -->
# Gemini CLI Configuration

## Agent Identity
- **Agent ID**: `gg`
- **Worktree Pattern**: `../feature-NN-gg-description`
- **Implementation Log**: `./docs/specs/features/logs/feature-NN-gg-log.md`

## Commands

### Feature Commands (unified for Drive and Fleet modes)
| Command | Description |
|---------|-------------|
| `/aigon:feature-create <name>` | Create a new feature spec |
| `/aigon:feature-prioritise <name>` | Assign ID and move to backlog |
| `/aigon:feature-setup <ID> [agents...]` | Setup for Drive (branch) or Fleet (worktrees) |
| `/aigon:feature-do <ID> [--autonomous]` | Implement feature; `--autonomous` runs iterative retry loop |
| `/aigon:feature-eval <ID>` | Create evaluation (code review or comparison) |
| `/aigon:feature-review <ID>` | Code review with fixes by a different agent |
| `/aigon:feature-submit` | (agent-only) Commit changes, write log, signal implementation complete |
| `/aigon:feature-close <ID> [agent]` | Merge and complete feature |
| `/aigon:feature-autopilot <ID> [agents...]` | Fleet autopilot: setup + spawn + monitor + eval |
| `/aigon:feature-cleanup <ID>` | Clean up Fleet worktrees and branches |

### Research Commands (unified for Drive and Fleet modes)
| Command | Description |
|---------|-------------|
| `/aigon:research-create <name>` | Create a new research topic |
| `/aigon:research-prioritise <name>` | Prioritise a research topic |
| `/aigon:research-setup <ID> [agents...]` | Setup for Drive or Fleet research |
| `/aigon:research-open <ID>` | Open all Fleet agents side-by-side for parallel research |
| `/aigon:research-do <ID>` | Conduct research (write findings) |
| `/aigon:research-submit` | (agent-only) Signal research findings are complete |
| `/aigon:research-close <ID>` | Complete research topic |

### Feedback Commands
| Command | Description |
|---------|-------------|
| `/aigon:feedback-create <title>` | Create a feedback item in inbox |
| `/aigon:feedback-list [filters]` | List feedback by status/type/severity/tag |
| `/aigon:feedback-triage <ID>` | Triage feedback with explicit apply confirmation |

### Utility Commands
| Command | Description |
|---------|-------------|
| `/aigon:next` (alias: `/aigon:n`) | Suggest the most likely next workflow command |
| `/aigon:help` | Show all Aigon commands |

## Modes

- **Drive mode**: `/aigon:feature-setup <ID>` - Creates branch only, work in current directory
- **Fleet mode**: `/aigon:feature-setup <ID> <agents...>` - Creates worktrees for parallel implementation

## Critical Rules

1. **Read the spec first**: Always check `./docs/specs/features/03-in-progress/` before coding
2. **Work in isolation**: Drive mode uses branches, Fleet mode uses worktrees
3. **Conventional commits**: Use `feat:`, `fix:`, `chore:` prefixes
4. **Complete properly**: Use `/aigon:feature-close <ID>` for Drive, `/aigon:feature-close <ID> gg` for Fleet
5. **Follow project instructions**: Check `AGENTS.md` for shared project build, test, and dependency commands
6. **Orient to the codebase first**: Read `docs/architecture.md` before making structural CLI changes

## Drive Mode Workflow

1. Run `/aigon:feature-setup <ID>` to create branch and move spec
2. Run `/aigon:feature-do <ID>` to begin implementation
3. Read the spec in `./docs/specs/features/03-in-progress/feature-<ID>-*.md`
4. Implement the feature according to the spec
5. Test your changes and wait for user confirmation
6. Commit using conventional commits (`feat:`, `fix:`, `chore:`)
7. Update the implementation log in `./docs/specs/features/logs/`
8. **STOP** - Wait for user to approve before running `/aigon:feature-close <ID>`

## Fleet Mode Workflow

1. Run `/aigon:feature-setup <ID> cc cx gg cu` to create worktrees for each agent
2. **STOP** - Tell the user to open the worktree in a separate session
3. In the worktree session:
   - Run `/aigon:feature-do <ID>`
   - Read the spec in `./docs/specs/features/03-in-progress/feature-<ID>-*.md`
   - Implement the feature
   - The `feature-do` command handles commit, log, and signaling completion — stay in the session for user review
4. Return to main repo for evaluation: `/aigon:feature-eval <ID>`
5. Merge winner: `/aigon:feature-close <ID> cx`
6. Clean up losers: `/aigon:feature-cleanup <ID> --push` (to save branches) or `/aigon:feature-cleanup <ID>` (to delete)


## Saving Permissions

When the user says "save that permission" or "remember that":

1. Read or create a TOML file in `.gemini/policies/` (e.g., `.gemini/policies/custom.toml`)
2. Add a `[[rule]]` block with the tool name, decision, and priority
3. Example:
   ```toml
   [[rule]]
   toolName = "run_shell_command"
   commandPrefix = "npm"
   decision = "allow"
   priority = 100
   ```

Note: The old `allowedTools` array in settings.json is deprecated. Use Policy Engine TOML files instead.

## Before Completing a Feature

Before running `/aigon:feature-close`, always:

1. **Push the branch to origin** to save your work remotely:
   ```bash
   git push -u origin <current-branch-name>
   ```
2. **Ask the user** if they want to delete the local branch after merge (the CLI will delete it by default)
<!-- AIGON_END -->