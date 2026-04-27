<!-- description: Start research <ID> [agents...] - create workspace and begin research -->
# aigon-research-start

Prepare your workspace to conduct research in either Drive or Fleet mode.

**CRITICAL:** You MUST use the CLI command below to perform setup. Do NOT manually move topic files or create worktrees — the CLI handles committing the spec move before worktree setup, which is essential for parallel modes.

## Usage

## Argument Resolution

If no ID is provided, or the ID doesn't match an existing topic in the backlog:
1. List all files in `./docs/specs/research-topics/02-backlog/` matching `research-*.md`
2. If a partial ID or name was given, filter to matches
3. Present the matching topics and ask the user to choose one

## Step 1: Run the CLI command

**CRITICAL: Run EXACTLY the arguments the user provided. Do NOT add agents that weren't specified.**

```bash
# Drive mode — user passes only an ID
aigon research-start {{ARG1_SYNTAX}}

# Drive worktree mode — user passes ID + agent
aigon research-start {{ARG1_SYNTAX}} <agent>

# Fleet mode — user passes ID + 2+ agents
aigon research-start {{ARG1_SYNTAX}} <agent1> <agent2> [agent3...]
```

The mode is determined automatically based on what the user provides:
- **No agents**: Drive mode - conduct research in the current repo
- **1 agent**: Drive worktree mode - create one research worktree
- **2+ agents**: Fleet mode - create parallel research worktrees/findings contexts

The CLI will:
- Move the topic from `02-backlog` to `03-in-progress`
- **Commit the topic move** before any worktree setup
- Create findings files for agents when needed
- Create worktree/session context for parallel research

## Step 2: Confirm setup and next steps

Research now follows the same lifecycle shape as features: `start -> do -> submit -> eval -> close`.

### Drive Mode

After the CLI completes, run:

```bash
{{CMD_PREFIX}}research-do <ID>
```

When the research pass is complete, signal completion with `aigon agent-status research-complete`, then close with:

```bash
{{CMD_PREFIX}}research-close <ID>
```

### Drive Worktree Mode

After the CLI completes, the research agent session is ready in the worktree context. Run:

```bash
{{CMD_PREFIX}}research-do <ID>
```

When the research pass is complete, signal completion with `aigon agent-status research-complete`, then close from the main repo:

```bash
{{CMD_PREFIX}}research-close <ID>
```

### Fleet Mode

After the CLI completes, all agents conduct research in parallel and submit their findings. When all agents finish:

```bash
{{CMD_PREFIX}}research-eval <ID>
```

Then finish with:

```bash
{{CMD_PREFIX}}research-close <ID>
```

### Re-opening a crashed or ended Fleet session

If research sessions need to be reopened or attached after setup, use:

```bash
{{CMD_PREFIX}}research-open <ID>
```

## Important Notes

- **Drive mode**: Write findings directly to the main research doc
- **Drive worktree / Fleet mode**: Agents write only to their own findings files
- `research-open` is a session-attach/reopen tool, not the primary next step after `research-start`
- Findings files live in `docs/specs/research-topics/logs/`


## Prompt Suggestion

End your response with the suggested next command on its own line. This helps agent UIs surface the next suggested Aigon command. Use the actual ID and choose based on mode:

- **Drive mode:** `{{CMD_PREFIX}}research-do <ID>`
- **Drive worktree:** `{{CMD_PREFIX}}research-do <ID>`
- **Fleet:** `{{CMD_PREFIX}}research-eval <ID>`

ARGUMENTS: {{ARG_SYNTAX}}
