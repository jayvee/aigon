---
description: Implement feature <ID> - switch context and code
args: feature_id
---
# ff-feature-implement

Run this command followed by the Feature ID. Example: `/prompts:ff-feature-implement 55`

## Step 1: Find your workspace

- Check if a worktree exists: look for `../feature-$1-cx-*` directory
  - If worktree exists: `cd` to that directory (multi-agent mode)
- If no worktree: run `git branch --show-current` to check your branch
  - If on `feature-$1-*`: you're in solo mode, work in current directory
  - If not on feature branch: run `ff feature-start $ARGUMENTS` first (this is required!)

## Step 2: Read the spec

Read the spec in `./docs/specs/features/03-in-progress/feature-$1-*.md`

## Step 3: Implement

Implement the feature according to the spec.

## Step 4: Test your changes

- Check if the dev server is running (start it if needed)
- Ask the user to test the changes on the running dev server
- **STOP and WAIT for user confirmation before proceeding** - do NOT continue until the user confirms testing is complete

## Step 5: Commit

Commit your changes using conventional commits (`feat:`, `fix:`, `chore:`)

## Step 6: Update the log

Create or update the implementation log at `./docs/specs/features/logs/feature-$1-log.md`:
- Document key decisions made during implementation
- Summarize the conversation between you and the user
- Note any issues encountered and how they were resolved

## Step 7: Complete

Run the CLI command to complete the feature:

- **Solo mode**: `ff feature-done $ARGUMENTS`
- **Multi-agent mode**: `ff feature-done $ARGUMENTS cx`

## VS Code Users

To open a worktree in VS Code, run: `code ../feature-$1-cx-*`
