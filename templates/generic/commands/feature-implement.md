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

## Step 5: Commit

Commit your changes using conventional commits (`feat:`, `fix:`, `chore:`)

## Step 6: Update the log

Create or update the implementation log at `./docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-log.md`:
- Document key decisions made during implementation
- Summarize the conversation between you and the user
- Note any issues encountered and how they were resolved

## Step 7: Complete

Run the CLI command to complete the feature:

- **Solo mode**: `ff feature-done {{ARG_SYNTAX}}`
- **Multi-agent mode**: `ff feature-done {{ARG_SYNTAX}} {{AGENT_ID}}`

## VS Code Users

To open a worktree in VS Code, run: `code ../feature-{{ARG1_SYNTAX}}-{{AGENT_ID}}-*`
