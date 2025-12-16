<!-- description: Implement bakeoff <ID> - implement feature in current worktree -->
# aigon-bakeoff-implement

Implement a feature in the current bakeoff worktree.

**IMPORTANT:** This command must be run from within a worktree directory (e.g., `../feature-55-{{AGENT_ID}}-dark-mode`), NOT from the main repository.

## Step 1: Verify you're in a worktree

**CRITICAL: Before proceeding, verify you're in the worktree directory.**

Check your current working directory:
```bash
pwd
```

The path should end with: `.../feature-<ID>-<agent>-<description>`

Also check the directory name:
```bash
basename $(pwd)
```

The directory name should match the pattern: `feature-<ID>-<agent>-<description>`

Extract your agent ID from the directory/branch name (e.g., `cc`, `gg`, `cx`).

**If you're NOT in a worktree, STOP immediately and tell the user:**
1. You cannot proceed - this command must run from within the worktree
2. They need to open the worktree in a new editor window: `code ../feature-{{ARG1_SYNTAX}}-<agent>-*`
3. They should run this command again from that window

**Do not proceed with Steps 2-7 if you're not in the worktree directory.**

## Step 2: Read the spec

Read the spec in `./docs/specs/features/03-in-progress/feature-{{ARG1_SYNTAX}}-*.md`

## Step 3: Implement

Implement the feature according to the spec.

**CRITICAL:** Maintain the worktree directory as your working directory throughout implementation. Use relative paths (e.g., `./src/file.js`) not absolute paths to the main repository.

## Step 4: Test your changes

- Check if the dev server is running (start it if needed)
- **IMPORTANT:** Each agent's worktree has a unique PORT in `.env.local` (cc=3001, gg=3002, cx=3003). Read the PORT value from `.env.local` and start the dev server with: `PORT=<port> npm run dev`
- Ask the user to test the changes on the running dev server at `http://localhost:<port>`
- **STOP and WAIT for user confirmation before proceeding** - do NOT continue until the user confirms testing is complete

## Step 5: Commit your implementation

**IMPORTANT: You MUST commit before marking implementation complete.**

**Before committing, verify you're in the worktree directory:**
```bash
pwd
```
Expected output should show: `.../ feature-{{ARG1_SYNTAX}}-<agent>-<description>`

If you're not in the worktree directory, navigate to it or inform the user of the issue.

**Now commit your changes:**
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
