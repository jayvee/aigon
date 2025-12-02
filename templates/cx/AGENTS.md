# Codex Agent Configuration

## Farline Flow Commands

Run these commands in the terminal:

### Feature Start (two modes)

**Solo mode** (default) - work in current directory with a branch:
```bash
ff feature-start <ID>
```

**Multi-agent mode** - create isolated worktree for bake-offs:
```bash
ff feature-start <ID> cx
```

### Other Commands

- `ff feature-create <name>` - Create a new feature spec
- `ff feature-prioritise <name>` - Assign ID and move to backlog
- `ff feature-eval <ID>` - Submit feature for evaluation (optional)
- `ff feature-done <ID>` - Complete solo mode feature
- `ff feature-done <ID> cx` - Complete multi-agent mode feature
- `ff research-create <name>` - Create a new research topic
- `ff research-start <ID>` - Start a research topic
- `ff research-done <ID>` - Complete a research topic

## Feature Implement

When starting implementation on a feature:

### Step 1: Find your workspace

- Check if a worktree exists: look for `../feature-<ID>-cx-*` directory
  - If worktree exists: `cd` to that directory (multi-agent mode)
- If no worktree: run `git branch --show-current` to check your branch
  - If on `feature-<ID>-*`: you're in solo mode, work in current directory
  - If not on feature branch: run `ff feature-start <ID>` first (this is required!)

### Step 2: Read the spec

Read the spec in `./docs/specs/features/03-in-progress/feature-<ID>-*.md`

### Step 3: Implement

Implement the feature according to the spec.

### Step 4: Test your changes

- Check if the dev server is running (start it if needed)
- Ask the user to test the changes on the running dev server
- **STOP and WAIT for user confirmation before proceeding** - do NOT continue until the user confirms testing is complete

### Step 5: Commit

Commit your changes using conventional commits (`feat:`, `fix:`, `chore:`)

### Step 6: Update the log

Update the implementation log in `./docs/specs/features/logs/`:
- Document key decisions made during implementation
- Summarize the conversation between you and the user
- Note any issues encountered and how they were resolved

### Step 7: Complete

Run the CLI command to complete the feature:

- **Solo mode**: `ff feature-done <ID>`
- **Multi-agent mode**: `ff feature-done <ID> cx`

## Critical Rules

1. **Read the spec first**: Always check `./docs/specs/features/03-in-progress/` before coding
2. **Work in isolation**: Use worktrees or feature branches, never commit directly to main
3. **Update implementation log**: Document your progress before running `ff feature-done`
4. **Conventional commits**: Use `feat:`, `fix:`, `chore:` prefixes
