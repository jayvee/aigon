<!-- description: Implement feature <ID> - solo mode (branch, implement, complete) -->
# aigon-feature-implement

Implement a feature in **solo mode** (single agent, no worktree).

## Step 1: Run the CLI command

IMPORTANT: You MUST run this command first. This moves the spec file from backlog to in-progress and creates the git branch.

```bash
aigon feature-implement {{ARG_SYNTAX}}
```

## Step 2: Read the spec

Read the spec in `./docs/specs/features/03-in-progress/feature-{{ARG1_SYNTAX}}-*.md`

## Step 3: Implement

Implement the feature according to the spec.

## Step 4: Test your changes

- Check if the dev server is running (start it if needed)
- Ask the user to test the changes on the running dev server
- **STOP and WAIT for user confirmation before proceeding** - do NOT continue until the user confirms testing is complete

## Step 5: Commit your implementation

**IMPORTANT: You MUST commit before proceeding.**

1. Stage and commit your code changes using conventional commits (`feat:`, `fix:`, `chore:`)
2. Verify the commit was successful by running `git log --oneline -1`

## Step 6: Update and commit the log

Update the implementation log at `./docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-*-log.md`:
- Key decisions made during implementation
- Summary of the conversation between you and the user
- Any issues encountered and how they were resolved

**Then commit the log file.**

## Step 7: STOP - Wait for user approval

**CRITICAL: Do NOT proceed to feature-done automatically.**

After completing steps 1-6:
1. Tell the user: "Implementation complete. Ready for your review."
2. **STOP and WAIT** for the user to explicitly request `feature-done`
3. The user may want to:
   - Review the code changes
   - Test the feature themselves
   - Request changes before merging

## Step 8: Complete (only after user approval)

When the user approves, run the CLI command to complete the feature:

```bash
aigon feature-done {{ARG_SYNTAX}}
```

---

**Note:** For multi-agent bakeoffs, use `aigon bakeoff-setup {{ARG_SYNTAX}}` followed by the `aigon bakeoff-implement {{ARG_SYNTAX}}` command instead.
