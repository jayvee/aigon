<!-- description: Implement feature <ID> - switch context and code -->
# ff-feature-implement

Run this command followed by the Feature ID. Example: `{{CMD_PREFIX}}feature-implement 55`

## Step 1: Find your workspace

- Check if a worktree exists: look for `../feature-{{ARG1_SYNTAX}}-{{AGENT_ID}}-*` directory
  - If worktree exists: `cd` to that directory (multi-agent mode)
- If no worktree: run `git branch --show-current` to check your branch
  - If on `feature-{{ARG1_SYNTAX}}-*`: you're in solo mode, work in current directory
  - If not on feature branch: run `ff feature-start {{ARG_SYNTAX}}` first (this is required!)

## Step 2: Read the spec

Read the spec in `./docs/specs/features/03-in-progress/feature-{{ARG1_SYNTAX}}-*.md`

## Step 3: Implement

Implement the feature according to the spec.

## Step 4: Test your changes

- Check if the dev server is running (start it if needed)
- Ask the user to test the changes on the running dev server
- **STOP and WAIT for user confirmation before proceeding** - do NOT continue until the user confirms testing is complete

## Step 5: Commit your implementation

**IMPORTANT: You MUST commit before marking implementation complete.**

1. Stage and commit your code changes using conventional commits (`feat:`, `fix:`, `chore:`)
2. Verify the commit was successful by running `git log --oneline -1`

## Step 6: Update and commit the log

Create the implementation log:
- **Solo mode**: `./docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-log.md`
- **Multi-agent mode**: `./docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-{{AGENT_ID}}-log.md`

Include:
- Key decisions made during implementation
- Summary of the conversation between you and the user
- Any issues encountered and how they were resolved
- Your approach and rationale (helps the evaluator compare implementations)

**Then commit the log file** - the evaluator needs this to compare implementations.

## Step 7: STOP - Wait for user approval

**CRITICAL: Do NOT proceed to feature-done automatically.**

After completing steps 1-6:
1. Tell the user: "Implementation complete. Ready for your review."
2. **STOP and WAIT** for the user to explicitly request `feature-done`
3. The user may want to:
   - Review the code changes
   - Test the feature themselves
   - Compare implementations from other agents (in multi-agent mode)
   - Request changes before merging

**NEVER run `feature-done` without explicit user approval.**

## VS Code Users

To open a worktree in VS Code, run: `code ../feature-{{ARG1_SYNTAX}}-{{AGENT_ID}}-*`
