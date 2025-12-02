---
description: Implement feature <ID> - switch context and code
---
# ff-feature-implement

Run this command followed by the Feature ID. Example: `/ff-feature-implement 55`

## Steps

1. **Find your workspace:**
   - Check if a worktree exists: look for `../feature-{{args}}-cc-*` directory
     - If worktree exists: `cd` to that directory (multi-agent mode)
   - If no worktree: run `git branch --show-current` to check your branch
     - If on `feature-{{args}}-*`: you're in solo mode, work in current directory
     - If not on feature branch: run `/ff-feature-start {{args}}` first

2. **Read the spec** in `./docs/specs/features/03-in-progress/feature-{{args}}-*.md`

3. **Implement** the feature according to the spec

4. **Test your changes:**
   - Check if the dev server is running (start it if needed)
   - Prompt the user to test the changes on the running dev server
   - Wait for user confirmation before proceeding

5. **Commit** your changes using conventional commits (`feat:`, `fix:`, `chore:`)

6. **Update the implementation log** in `./docs/specs/features/logs/`:
   - Document key decisions made during implementation
   - Summarize the conversation between you and the user
   - Note any issues encountered and how they were resolved

## When Done

- **Solo mode** (no worktree): Run `/ff-feature-done {{args}}` to merge and complete
- **Multi-agent mode** (worktree): Run `/ff-feature-eval {{args}}` to submit for evaluation, or `/ff-feature-done {{args}} cc` to merge directly

## VS Code Users

To open a worktree in VS Code, run: `code ../feature-{{args}}-cc-*`