---
description: Start feature <ID> - solo mode (branch), then implement
---
# ff-feature-start

Start a feature in **solo mode** and begin implementation.

## Steps

1. Run: `ff feature-start {{args}}`

2. Read the spec in `./docs/specs/features/03-in-progress/feature-{{args}}-*.md`

3. Implement the feature according to the spec

4. **Test your changes:**
   - Check if the dev server is running (start it if needed)
   - Prompt the user to test the changes on the running dev server
   - Wait for user confirmation before proceeding

5. Commit your changes using conventional commits (`feat:`, `fix:`, `chore:`)

6. **Update the implementation log** in `./docs/specs/features/logs/`:
   - Document key decisions made during implementation
   - Summarize the conversation between you and the user
   - Note any issues encountered and how they were resolved

## When Done

Run `/ff-feature-done {{args}}` to merge and complete.

---

**Note:** For multi-agent mode (bake-offs with worktrees), run manually:
```
ff feature-start {{args}} cc
```
Then use `/ff-implement {{args}}` to switch context.