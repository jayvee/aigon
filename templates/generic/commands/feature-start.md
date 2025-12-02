<!-- description: Start feature <ID> - solo mode (branch), then implement -->
# ff-feature-start

Start a feature in **solo mode** and begin implementation.

## Step 1: Run the CLI command

IMPORTANT: You MUST run this command first. This moves the spec file from backlog to in-progress and creates the git branch.

**Solo mode** (default):
```bash
ff feature-start {{ARG_SYNTAX}}
```

**Multi-agent mode** (for bake-offs):
```bash
ff feature-start {{ARG_SYNTAX}} {{AGENT_ID}}
```

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

IMPORTANT: Run the CLI command to complete the feature:

- **Solo mode**: `ff feature-done {{ARG_SYNTAX}}`
- **Multi-agent mode**: `ff feature-done {{ARG_SYNTAX}} {{AGENT_ID}}`

---

**Note:** For multi-agent mode (bake-offs with worktrees), use `{{CMD_PREFIX}}feature-implement {{ARG_SYNTAX}}` to switch context.
