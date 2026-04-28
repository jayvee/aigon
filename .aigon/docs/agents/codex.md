<!-- AIGON_START -->
# Codex Configuration

## Agent Identity
- **Agent ID**: `cx`
- **Worktree Pattern**: `../feature-NN-cx-description`
- **Implementation Log**: Mode-conditional — Fleet requires a short log under `./docs/specs/features/logs/`; solo Drive (branch) skips it by default; solo Drive worktree uses a one-line log when a starter file exists. Override with `"logging_level": "fleet-only" | "always" | "never"` in `.aigon/config.json` (see `.aigon/docs/development_workflow.md`).

## Commands

### Feature Commands (unified for Drive and Fleet modes)
| Command | Description |
|---------|-------------|
| `$aigon-feature-create <name>` | Create a new feature spec |
| `$aigon-feature-prioritise <name>` | Assign ID and move to backlog |
| `$aigon-feature-start <ID> [agents...]` | Setup for Drive (branch) or Fleet (worktrees) |
| `$aigon-feature-do <ID> [--iterate]` | Implement feature; `--iterate` runs Autopilot retry loop |
| `$aigon-feature-eval <ID>` | Create evaluation (code review or comparison) |
| `$aigon-feature-code-review <ID>` | Code review with fixes by a different agent |
| `$aigon-feature-close <ID> [agent]` | Merge and complete feature |
| `$aigon-feature-push [ID] [agent]` | Push feature branch to origin for PR review |
| `$aigon-feature-autonomous-start <ID> <agents...>` | Start autonomous feature flow with explicit stop-after control |
| `$aigon-feature-cleanup <ID>` | Clean up Fleet worktrees and branches |

### Research Commands (unified for Drive and Fleet modes)
| Command | Description |
|---------|-------------|
| `$aigon-research-create <name>` | Create a new research topic |
| `$aigon-research-prioritise <name>` | Prioritise a research topic |
| `$aigon-research-start <ID> [agents...]` | Setup for Drive or Fleet execution |
| `$aigon-research-open <ID>` | Re-open or attach Fleet research sessions when needed |
| `$aigon-research-do <ID>` | Conduct research (write findings) |
| `$aigon-research-review <ID>` | Review research findings with a different agent |
| `$aigon-research-eval <ID>` | Synthesize findings before close |
| `$aigon-research-close <ID>` | Complete research topic |

### Feedback Commands
| Command | Description |
|---------|-------------|
| `$aigon-feedback-create <title>` | Create a feedback item in inbox |
| `$aigon-feedback-list [filters]` | List feedback by status/type/severity/tag |
| `$aigon-feedback-triage <ID>` | Triage feedback with explicit apply confirmation |

### Utility Commands
| Command | Description |
|---------|-------------|
| `$aigon-next` (alias: `$aigon-n`) | Suggest the most likely next workflow command |
| `$aigon-help` | Show all Aigon commands |

## Modes

- **Drive mode**: `$aigon-feature-start <ID>` - Creates branch only, work in current directory
- **Fleet mode**: `$aigon-feature-start <ID> <agents...>` - Creates worktrees for parallel implementation

## Mandatory Lifecycle Commands

Feature and research work are NOT complete until you run these commands yourself:

1. `aigon agent-status implementing` — when you start coding or begin active research
2. `aigon agent-status implementation-complete` — after committing all code, log updates, or research findings

These are direct lifecycle commands you run yourself in the agent host — slash commands for some agents, skills for Codex, and never auto-invoked. The `aigon agent-status` command writes state to the **main repo** (not the worktree), so you won't see state files locally. Just run the command and trust the output.

> **CRITICAL — Codex dev server rules:**
>
> **NEVER run `npm run dev`, `next dev`, or any dev command directly.** Running dev commands directly bypasses port allocation and will cause port conflicts.
>
> The PORT is already set in `.env.local` by the worktree setup. If you must start a dev server, use `aigon dev-server start`.
>
> Because Codex kills background processes when shell commands exit, use `--register-only` mode:
>
> 1. Run `aigon dev-server start --register-only` — allocates your agent's port and writes it to `.env.local`
> 2. Read the allocated port: `grep ^PORT= .env.local`
> 3. Start the server in a **persistent terminal session** using `/terminal`: `PORT=<the-port> npm run dev`
> 4. Get your app URL: `aigon dev-server url`
> 5. Use that URL for all testing

## Critical Rules

1. **Read the active spec first**: Use `aigon feature-spec <ID>` for features. For research, read the spec directly from `docs/specs/research-topics/03-in-progress/`
2. **Use the correct workspace model**: Feature Drive uses a branch, Feature Fleet uses worktrees, Research usually runs in the main repo unless explicitly launched as parallel sessions
3. **Use conventional commits when you commit**: Prefer `feat:`, `fix:`, `chore:`, or `docs:` as appropriate
4. **Complete with the matching command**: Use the `feature-*` or `research-*` close/review/eval command for the entity you are working on
5. **Follow project instructions**: Check `AGENTS.md` for shared project build, test, and dependency commands
6. **Orient to the codebase first**: Read `docs/architecture.md` before making structural CLI changes

## Drive Mode Workflow

1. Run `$aigon-feature-start <ID>` to create branch and move spec
2. Run `$aigon-feature-do <ID>` to begin implementation
3. Read the spec path returned by `aigon feature-spec <ID>`
4. Implement the feature according to the spec
5. Test your changes and wait for user confirmation
6. Commit using conventional commits (`feat:`, `fix:`, `chore:`)
7. Update the implementation log in `./docs/specs/features/logs/`
8. **STOP** - Wait for user to approve before running `$aigon-feature-close <ID>`

## Fleet Mode Workflow

1. Run `$aigon-feature-start <ID> cc cx gg cu` to create worktrees for each agent
2. **STOP** - Tell the user to open the worktree in a separate session
3. In the worktree session:
   - Run `$aigon-feature-do <ID>`
   - Read the spec path returned by `aigon feature-spec <ID>`
   - Implement the feature
   - The `feature-do` command handles commit, log, and signaling completion — stay in the session for user review
4. Return to main repo for evaluation: `$aigon-feature-eval <ID>`
5. Merge winner: `$aigon-feature-close <ID> cx`
6. Clean up losers: `$aigon-feature-cleanup <ID> --push` (to save branches) or `$aigon-feature-cleanup <ID>` (to delete)

## Research Workflow

Research follows the same lifecycle shape as features: `start -> do -> submit -> review/eval -> close`.

### Drive Mode

1. Run `$aigon-research-start <ID>` to move the topic to in-progress
2. Run `$aigon-research-do <ID>` to conduct the research
3. Write findings directly in the main research document
4. Optionally run `$aigon-research-review <ID>` for a second-agent review pass
5. Run `aigon agent-status implementation-complete` when your research pass is complete (from outside the tmux session, use the explicit form: `aigon agent-status implementation-complete <ID> <agent>`)
6. Run `$aigon-research-close <ID>` when ready to finish

### Fleet Mode

1. Run `$aigon-research-start <ID> cc cx gg cu` to prepare and launch parallel research
2. In each agent session, run `$aigon-research-do <ID>`
3. Each agent writes only to its own findings file and signals completion
4. Optionally run `$aigon-research-review <ID>` for a separate review pass
5. Return to the main repo for synthesis: `$aigon-research-eval <ID>`
6. Finish the topic: `$aigon-research-close <ID>`
7. Use `$aigon-research-open <ID>` only to re-open or attach Fleet research sessions after setup

## Before Completing a Feature

Before running `$aigon-feature-close`, always:

1. **If you want GitHub PR review, publish the branch**:
   ```bash
   $aigon-feature-push
   ```
2. **Ask the user** if they want to delete the local branch after merge (the CLI will delete it by default)

<!-- AIGON_END -->
