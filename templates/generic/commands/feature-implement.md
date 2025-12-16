<!-- description: Implement feature <ID> - works in both solo and arena modes -->
# aigon-feature-implement

Implement a feature. Works in both solo mode (branch) and arena mode (worktree).

**IMPORTANT:** Run `{{CMD_PREFIX}}feature-setup <ID>` first to prepare your workspace.

## Step 1: Run the CLI command

This command detects whether you're in solo or arena mode and provides guidance.

```bash
aigon feature-implement {{ARG1_SYNTAX}}
```

The command will:
- Detect if you're in a worktree (arena mode) or on a branch (solo mode)
- Display the spec location and log file
- Show implementation steps

## Step 2: Read the spec

Read the spec in `./docs/specs/features/03-in-progress/feature-{{ARG1_SYNTAX}}-*.md`

## Step 3: Implement

Implement the feature according to the spec.

**For arena mode:** Use relative paths throughout implementation. Maintain the worktree directory as your working directory.

## Step 4: Test your changes

### Solo Mode
- Start the dev server if needed
- Test the changes
- Ask the user to verify

### Arena Mode
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
- Solo mode: Main repository path
- Arena mode: `.../feature-{{ARG1_SYNTAX}}-<agent>-<description>`

**Now commit your changes:**
1. Stage and commit your code changes using conventional commits (`feat:`, `fix:`, `chore:`)
2. Verify the commit was successful by running `git log --oneline -1`

## Step 6: Update and commit the log

Find your implementation log:
- Solo mode: `./docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-*-log.md`
- Arena mode: `./docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-<agent>-*-log.md`

Update it with:
- Key decisions made during implementation
- Summary of the conversation between you and the user
- Any issues encountered and how they were resolved
- Your approach and rationale (for arena mode, helps evaluator compare)

**Then commit the log file.**

## Step 7: STOP - Implementation complete

### Solo Mode

**CRITICAL: Do NOT proceed to feature-done automatically.**

After completing steps 1-6:
1. Tell the user: "Implementation complete. Ready for your review."
2. **STOP and WAIT** for the user to:
   - Review the code changes
   - Test the feature themselves
   - Optionally run `{{CMD_PREFIX}}feature-eval {{ARG1_SYNTAX}}` for code review
   - Approve with `{{CMD_PREFIX}}feature-done {{ARG1_SYNTAX}}`

### Arena Mode

**CRITICAL: Do NOT run `aigon feature-done` from a worktree.**

After completing steps 1-6:
1. Tell the user: "Implementation complete in this worktree. Ready for evaluation."
2. **STOP** - The user needs to:
   - Complete implementations in other agent worktrees
   - Return to the main repository
   - Run `{{CMD_PREFIX}}feature-eval {{ARG1_SYNTAX}}` to compare all implementations
   - Choose a winner and run `aigon feature-done {{ARG1_SYNTAX}} <winning-agent>`

**This implementation session is complete.**
