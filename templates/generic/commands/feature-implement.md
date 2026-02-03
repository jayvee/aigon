<!-- description: Implement feature <ID> - works in both solo and arena modes -->
# aigon-feature-implement

Implement a feature. Works in solo mode (branch), solo worktree mode (parallel development), and arena mode (competition).

**IMPORTANT:** Run `{{CMD_PREFIX}}feature-setup <ID>` first to prepare your workspace.

## Argument Resolution

If no ID is provided, or the ID doesn't match an existing feature in progress:
1. List all files in `./docs/specs/features/03-in-progress/` matching `feature-*.md`
2. If a partial ID or name was given, filter to matches
3. Present the matching features and ask the user to choose one

## Step 1: Run the CLI command

This command detects whether you're in solo or arena mode and provides guidance.

```bash
aigon feature-implement {{ARG1_SYNTAX}}
```

The command will:
- Detect your mode: solo (branch), solo worktree, or arena
- Display the spec location and log file
- Show implementation steps

**If the CLI fails with "Could not find feature in in-progress"** and you're in a worktree: the spec move was likely not committed before the worktree was created. Fix by running these commands from the worktree:
```bash
# Bring the spec into this worktree from the main branch
git checkout main -- docs/specs/features/03-in-progress/
git commit -m "chore: sync spec to worktree branch"
```
Then re-run `aigon feature-implement`.

## Step 2: Read the spec

Read the spec in `./docs/specs/features/03-in-progress/feature-{{ARG1_SYNTAX}}-*.md`

## Step 3: Implement and break into tasks from acceptance criteria

Before writing code, create a task for each **Acceptance Criterion** from the spec. This gives the user visibility into implementation progress via the task list.

Then implement the feature according to the spec. Mark tasks as in-progress when you start working on them, and completed when satisfied. If you discover sub-tasks during implementation, add them to the list.

**For worktree modes (solo worktree or arena):** Use relative paths throughout implementation. Maintain the worktree directory as your working directory.

## Step 3.5: Install dependencies (worktree only)

**Worktrees do not share `node_modules/` with the main repo.** Before running or testing, check if dependencies need to be installed:

```bash
# Check if node_modules exists
test -d node_modules && echo "Dependencies installed" || echo "Need to install dependencies"
```

If missing, install them using the project's package manager:
```bash
# Detect and run the appropriate install command
if [ -f "pnpm-lock.yaml" ]; then pnpm install
elif [ -f "yarn.lock" ]; then yarn install
elif [ -f "bun.lockb" ]; then bun install
elif [ -f "package-lock.json" ]; then npm install
elif [ -f "package.json" ]; then npm install
fi
```

## Step 4: Test your changes

### Solo Mode (branch)
- Start the dev server if needed
- Test the changes
- Ask the user to verify

### Worktree Mode (solo worktree or arena)
- Check `.env.local` for your agent-specific PORT
- Start dev server: `PORT=<port> npm run dev`
- Test on `http://localhost:<port>`
- Ask the user to verify

**STOP and WAIT for user confirmation before proceeding** - do NOT continue until the user confirms testing is complete

## Step 5: Commit your implementation

**IMPORTANT: You MUST commit before proceeding.**

**Before committing, verify your working directory:**
```bash
pwd
```

Expected output:
- Solo mode (branch): Main repository path
- Worktree mode: `.../feature-{{ARG1_SYNTAX}}-<agent>-<description>`

**Now commit your changes:**
1. Stage and commit your code changes using conventional commits (`feat:`, `fix:`, `chore:`)
2. Verify the commit was successful by running `git log --oneline -1`

## Step 6: Update and commit the log

Find your implementation log:
- Solo mode (branch): `./docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-*-log.md`
- Worktree mode: `./docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-<agent>-*-log.md`

Update it with:
- Key decisions made during implementation
- Summary of the conversation between you and the user
- Any issues encountered and how they were resolved
- Your approach and rationale (for arena mode, helps evaluator compare)

**Then commit the log file.**

## Step 7: STOP - Implementation complete

### Solo Mode (branch)

**CRITICAL: Do NOT proceed to feature-done automatically.**

After completing steps 1-6:
1. Tell the user: "Implementation complete. Ready for your review."
2. **STOP and WAIT** for the user to:
   - Review the code changes
   - Test the feature themselves
   - Optionally run `{{CMD_PREFIX}}feature-eval {{ARG1_SYNTAX}}` for evaluation
   - Optionally run `{{CMD_PREFIX}}feature-review {{ARG1_SYNTAX}}` with a different agent for cross-agent code review
   - Approve with `{{CMD_PREFIX}}feature-done {{ARG1_SYNTAX}}`

### Solo Worktree Mode

**CRITICAL: Do NOT run `aigon feature-done` from a worktree.**

After completing steps 1-6:
1. Tell the user: "Implementation complete in this worktree. Ready for your review."
2. **STOP** - The user needs to:
   - Optionally run `{{CMD_PREFIX}}feature-review {{ARG1_SYNTAX}}` with a different agent (in this worktree) for cross-agent code review
   - Return to the main repository
   - Optionally run `{{CMD_PREFIX}}feature-eval {{ARG1_SYNTAX}}` for evaluation
   - Approve with `{{CMD_PREFIX}}feature-done {{ARG1_SYNTAX}}` (auto-detects the worktree)

### Arena Mode

**CRITICAL: Do NOT run `aigon feature-done` from a worktree.**

After completing steps 1-6:
1. Tell the user: "Implementation complete in this worktree. Ready for evaluation."
2. **STOP** - The user needs to:
   - Complete implementations in other agent worktrees
   - Optionally run `{{CMD_PREFIX}}feature-review {{ARG1_SYNTAX}}` with a different agent on each worktree for cross-agent code review
   - Return to the main repository
   - Run `{{CMD_PREFIX}}feature-eval {{ARG1_SYNTAX}}` to compare all implementations
   - Choose a winner and run `{{CMD_PREFIX}}feature-done {{ARG1_SYNTAX}} <winning-agent>`

**This implementation session is complete.**
