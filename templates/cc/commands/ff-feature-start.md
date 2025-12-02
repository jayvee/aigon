---
description: Start feature <ID> - solo mode (branch), then implement
---
# ff-feature-start

Start a feature in **solo mode** and begin implementation.

## Step 1: Run the CLI command

IMPORTANT: You MUST run this command first. This moves the spec file from backlog to in-progress and creates the git branch.

```bash
ff feature-start {{args}}
```

## Step 2: Read the spec

Read the spec in `./docs/specs/features/03-in-progress/feature-{{args}}-*.md`

## Step 3: Implement

Implement the feature according to the spec.

## Step 4: Test your changes

- Check if the dev server is running (start it if needed)
- Ask the user to test the changes on the running dev server
- **STOP and WAIT for user confirmation before proceeding** - do NOT continue until the user confirms testing is complete

## Step 5: Commit

Commit your changes using conventional commits (`feat:`, `fix:`, `chore:`)

## Step 6: Update the log

Update the implementation log in `./docs/specs/features/logs/`:
- Document key decisions made during implementation
- Summarize the conversation between you and the user
- Note any issues encountered and how they were resolved

## Step 7: Complete

Run the CLI command to complete the feature:

```bash
ff feature-done {{args}}
```

---

**Note:** For multi-agent mode (bake-offs with worktrees), run manually:
```
ff feature-start {{args}} cc
```
Then use `/ff-implement {{args}}` to switch context.
