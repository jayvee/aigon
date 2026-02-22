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

## Step 2.5: Consider Plan Mode

For non-trivial features, **use plan mode** before implementation to explore the codebase and design your approach:

**Use plan mode when**:
- Feature touches 3+ files
- Architectural decisions required (choosing between patterns, libraries, approaches)
- Multiple valid implementation approaches exist
- Complex acceptance criteria requiring coordination across components
- Unclear how to integrate with existing codebase

**Skip plan mode for**:
- Single-file changes with obvious implementation
- Clear, detailed specifications with one straightforward approach
- Simple bug fixes or small tweaks
- Very specific user instructions with implementation details provided

**In plan mode, you should**:
- Explore the codebase thoroughly (Glob, Grep, Read existing files)
- Understand existing patterns and conventions
- Design your implementation approach
- Identify files that need changes
- Present your plan for user approval
- Exit plan mode when ready to implement

## Step 3: Implement and break into tasks from acceptance criteria

Before writing code, create a task for each **Acceptance Criterion** from the spec. This gives the user visibility into implementation progress via the task list.

Then implement the feature according to the spec. Mark tasks as in-progress when you start working on them, and completed when satisfied. If you discover sub-tasks during implementation, add them to the list.
{{AGENT_TEAMS_FEATURE_NOTE}}

**For worktree modes (solo worktree or arena):** Use relative paths throughout implementation. Maintain the worktree directory as your working directory.

## Step 3.5: Install dependencies (worktree only)

{{WORKTREE_DEP_CHECK}}

> **Project-specific steps?** Check your root instructions file (e.g. CLAUDE.md) for dependency commands.

## Step 4: Test your changes

### Solo Mode (branch)
- Start the dev server if needed
- Test the changes
- Ask the user to verify

### Worktree Mode (solo worktree or arena)
{{WORKTREE_TEST_INSTRUCTIONS}}
{{AGENT_DEV_SERVER_NOTE}}
> **Project-specific steps?** Check your root instructions file (e.g. CLAUDE.md) for test commands.

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

After completing steps 1-4, **STOP and WAIT** for the user. They will run `{{CMD_PREFIX}}feature-submit` to trigger steps 5-6 (commit + log). Do NOT commit or write the log until the user runs that command.

### Arena Mode

**CRITICAL: Do NOT run `aigon feature-done` from a worktree.**

After completing steps 1-4, **STOP and WAIT** for the user. They will run `{{CMD_PREFIX}}feature-submit` to trigger steps 5-6 (commit + log). Do NOT commit or write the log until the user runs that command.

**This implementation session is complete after the user runs `{{CMD_PREFIX}}feature-submit`.**

## Prompt Suggestion

End your response with the suggested next command on its own line. This influences Claude Code's prompt suggestion (grey text). Use the actual ID:

- **Solo mode:** `{{CMD_PREFIX}}feature-done <ID>`
- **Arena / worktree:** `{{CMD_PREFIX}}feature-submit`
