---
updated: 2026-03-15T22:41:40.800Z
startedAt: 2026-03-02T11:45:08+11:00
completedAt: 2026-03-02T11:49:53+11:00
autonomyRatio: 0.00
---

# Implementation Log: Feature 26 - update-docs-prompt-to-done

## Plan
Add a "Update Documentation" section to `feature-done.md` template so agents automatically check and update project docs after merging a feature.

## Progress
- Added new "Update Documentation" section to `templates/generic/commands/feature-done.md`
- Positioned after "Important Notes" and before "Suggest Next Action" — runs after merge/adoption, before pipeline check
- Lists 7 specific doc files to check (README, AGENTS, GUIDE, workflow, agent docs, agent template, help template)
- Provides clear "What to update" and "What NOT to update" guidance to prevent over-documentation
- Instructs a separate `docs:` commit when changes are needed

## Decisions
- **Placed in feature-done only, not feature-submit** — feature-submit runs from worktrees where the agent may lack full context of all project docs. feature-done runs from main after the merge, which is the right time to assess doc impact.
- **Explicit skip guidance** — included "What NOT to update" to prevent agents from making unnecessary doc changes on internal refactors.
- **No changes to feature-implement or feature-eval** — those stages are about building and reviewing code, not post-merge documentation.
