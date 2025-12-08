<!-- description: Implement bakeoff <ID> - implement feature in current worktree -->
# aigon-bakeoff-implement

Implement a feature in the current bakeoff worktree.

**IMPORTANT:** This command must be run from within a worktree directory (e.g., `../feature-55-{{AGENT_ID}}-dark-mode`), NOT from the main repository.

## Step 1: Verify you're in a worktree

Check the current directory name to confirm you're in a worktree:
```bash
basename $(pwd)
```

The directory name should match the pattern: `feature-<ID>-<agent>-<description>`

Extract your agent ID from the directory/branch name (e.g., `cc`, `gg`, `cx`).

If you're NOT in a worktree, tell the user to:
1. Open the worktree in a new editor window: `code ../feature-{{ARG1_SYNTAX}}-<agent>-*`
2. Run this command again from that window

## Step 2: Read the spec

Read the spec in `./docs/specs/features/03-in-progress/feature-{{ARG1_SYNTAX}}-*.md`

## Step 3: Implement

Implement the feature according to the spec.

## Step 4: Test your changes

- Check if the dev server is running (start it if needed)
- **IMPORTANT:** Each agent's worktree has a unique PORT in `.env.local` (cc=3001, gg=3002, cx=3003). Ensure the dev server uses this PORT to avoid conflicts with other agents.
- Ask the user to test the changes on the running dev server
- **STOP and WAIT for user confirmation before proceeding** - do NOT continue until the user confirms testing is complete

## Step 5: Commit your implementation

**IMPORTANT: You MUST commit before marking implementation complete.**

1. Stage and commit your code changes using conventional commits (`feat:`, `fix:`, `chore:`)
2. Verify the commit was successful by running `git log --oneline -1`

## Step 6: Update and commit the log

The implementation log should already exist at `./docs/specs/features/logs/feature-<ID>-<agent>-*-log.md`

Update it with:
- Key decisions made during implementation
- Summary of the conversation between you and the user
- Any issues encountered and how they were resolved
- Your approach and rationale (helps the evaluator compare implementations)

**Then commit the log file** - the evaluator needs this to compare implementations.

## Step 7: STOP - Implementation complete

**CRITICAL: Do NOT run `feature-done` from a worktree.**

After completing steps 1-6:
1. Tell the user: "Implementation complete in this worktree. Ready for evaluation."
2. **STOP** - The user needs to:
   - Complete implementations in other agent worktrees
   - Return to the main repository
   - Run `{{CMD_PREFIX}}feature-eval <ID>` to compare all implementations
   - Choose a winner and run `aigon feature-done <ID> <winning-agent>`

**This bakeoff worktree session is complete.**
