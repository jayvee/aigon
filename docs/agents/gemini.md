<!-- AIGON_START -->
# Gemini CLI Configuration

## Agent Identity
- **Agent ID**: `gg`
- **Worktree Pattern**: `../feature-NN-gg-description`
- **Implementation Log**: Mode-conditional — Fleet requires a short log under `./docs/specs/features/logs/`; solo Drive (branch) skips it by default; solo Drive worktree uses a one-line log when a starter file exists. Override with `"logging_level": "fleet-only" | "always" | "never"` in `.aigon/config.json` (see `docs/development_workflow.md`).

## Commands

### Feature Commands (unified for Drive and Fleet modes)
| Command | Description |
|---------|-------------|
| `/aigon:feature-create <name>` | Create a new feature spec |
| `/aigon:feature-prioritise <name>` | Assign ID and move to backlog |
| `/aigon:feature-start <ID> [agents...]` | Setup for Drive (branch) or Fleet (worktrees) |
| `/aigon:feature-do <ID> [--iterate]` | Implement feature; `--iterate` runs Autopilot retry loop |
| `/aigon:feature-eval <ID>` | Create evaluation (code review or comparison) |
| `/aigon:feature-code-review <ID>` | Code review with fixes by a different agent |
| `/aigon:feature-close <ID> [agent]` | Merge and complete feature |
| `/aigon:feature-push [ID] [agent]` | Push feature branch to origin for PR review |
| `/aigon:feature-autonomous-start <ID> <agents...>` | Start autonomous feature flow with explicit stop-after control |
| `/aigon:feature-cleanup <ID>` | Clean up Fleet worktrees and branches |

### Research Commands (unified for Drive and Fleet modes)
| Command | Description |
|---------|-------------|
| `/aigon:research-create <name>` | Create a new research topic |
| `/aigon:research-prioritise <name>` | Prioritise a research topic |
| `/aigon:research-start <ID> [agents...]` | Setup for Drive or Fleet execution |
| `/aigon:research-open <ID>` | Re-open or attach Fleet research sessions when needed |
| `/aigon:research-do <ID>` | Conduct research (write findings) |
| `/aigon:research-review <ID>` | Review research findings with a different agent |
| `/aigon:research-eval <ID>` | Synthesize findings before close |
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

- **Drive mode**: `/aigon:feature-start <ID>` - Creates branch only, work in current directory
- **Fleet mode**: `/aigon:feature-start <ID> <agents...>` - Creates worktrees for parallel implementation

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

1. Run `/aigon:feature-start <ID>` to create branch and move spec
2. Run `/aigon:feature-do <ID>` to begin implementation
3. Read the spec path returned by `aigon feature-spec <ID>`
4. Implement the feature according to the spec
5. Test your changes and wait for user confirmation
6. Commit using conventional commits (`feat:`, `fix:`, `chore:`)
7. Update the implementation log in `./docs/specs/features/logs/`
8. **STOP** - Wait for user to approve before running `/aigon:feature-close <ID>`

## Fleet Mode Workflow

1. Run `/aigon:feature-start <ID> cc cx gg cu` to create worktrees for each agent
2. **STOP** - Tell the user to open the worktree in a separate session
3. In the worktree session:
   - Run `/aigon:feature-do <ID>`
   - Read the spec path returned by `aigon feature-spec <ID>`
   - Implement the feature
   - The `feature-do` command handles commit, log, and signaling completion — stay in the session for user review
4. Return to main repo for evaluation: `/aigon:feature-eval <ID>`
5. Merge winner: `/aigon:feature-close <ID> cx`
6. Clean up losers: `/aigon:feature-cleanup <ID> --push` (to save branches) or `/aigon:feature-cleanup <ID>` (to delete)

## Research Workflow

Research follows the same lifecycle shape as features: `start -> do -> submit -> review/eval -> close`.

### Drive Mode

1. Run `/aigon:research-start <ID>` to move the topic to in-progress
2. Run `/aigon:research-do <ID>` to conduct the research
3. Write findings directly in the main research document
4. Optionally run `/aigon:research-review <ID>` for a second-agent review pass
5. Run `aigon agent-status submitted` when your research pass is complete
6. Run `/aigon:research-close <ID>` when ready to finish

### Fleet Mode

1. Run `/aigon:research-start <ID> cc cx gg cu` to prepare and launch parallel research
2. In each agent session, run `/aigon:research-do <ID>`
3. Each agent writes only to its own findings file and signals completion
4. Optionally run `/aigon:research-review <ID>` for a separate review pass
5. Return to the main repo for synthesis: `/aigon:research-eval <ID>`
6. Finish the topic: `/aigon:research-close <ID>`
7. Use `/aigon:research-open <ID>` only to re-open or attach Fleet research sessions after setup

## Saving Permissions

When the user says "save that permission" or "remember that":

1. Read or create a TOML file in `~/.gemini/policies/` (e.g., `~/.gemini/policies/custom.toml`)
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

1. **If you want GitHub PR review, publish the branch**:
   ```bash
   /aigon:feature-push
   ```
2. **Ask the user** if they want to delete the local branch after merge (the CLI will delete it by default)

## Common Pitfalls — READ THIS FIRST

These are recurring mistakes that derail Gemini sessions. Check yourself against this list before and during every task.

### 1. Using the wrong workspace for the task
**Symptom**: You commit feature work to `main`, or you treat a research session like a feature branch task.
**Prevention**: Check both `pwd` and `git branch --show-current` before you start.
- For feature work, do NOT work on `main`; use the feature branch or worktree created by Aigon.
- For research work, staying on `main` is normal unless Aigon launched a separate session.
**Recovery**: If you worked in the wrong place, tell the user immediately — do not try to hide it.

### 2. Forgetting lifecycle commands
**Symptom**: Dashboard shows agent as idle when it's actually working, or work is never marked as done.
**Prevention**: Run these in order, every time:
1. `aigon agent-status implementing` — before you start work
2. `aigon agent-status submitted` — after your final commit
These are NOT optional. They are mandatory signals.

### 3. Modifying files you don't own (research)
**Symptom**: Research commit includes code changes or other agents' findings.
**Prevention**: In research mode, you write ONLY to `research-{ID}-gg-findings.md`. Stage only that file: `git add docs/specs/research-topics/logs/research-*-gg-findings.md`. Never use `git add .`.

### 4. Using `git add .` or `git add -A`
**Symptom**: Unrelated files (`.env.local`, other agents' work, IDE config) get committed.
**Prevention**: Always stage specific files by path. Run `git status` first to review what changed, then `git add <specific-file>`.

### 5. Running commands you weren't asked to run
**Symptom**: Running `feature-close`, `research-close`, `feature-eval`, or `research-eval` when the user didn't ask.
**Prevention**: After submitting, STAY in the session and wait. The user decides what happens next — close, eval, review, or more changes.

### 6. Not reading the active spec first
**Symptom**: The work doesn't match the actual task, or you pull the wrong CLI context.
**Prevention**: Resolve the matching spec before changing anything:
- Features: `aigon feature-spec <ID>`
- Research: read the spec from `docs/specs/research-topics/03-in-progress/`

### 7. Ignoring the working directory in worktree mode
**Symptom**: Editing files in the main repo instead of the worktree, or vice versa.
**Prevention**: Run `pwd` and verify you're in the correct directory. Aigon-created worktrees and session directories must match the task you are handling.

<!-- AIGON_END -->
