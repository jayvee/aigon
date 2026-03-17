---
status: implementing
updated: 2026-03-17T15:09:11.742Z
startedAt: 2026-03-17T15:08:41.615Z
events:
  - { ts: "2026-03-17T15:08:41.615Z", status: implementing }
  - { ts: "2026-03-17T15:09:11.742Z", status: implementing }
---

# Implementation Log: Feature 88 - worktree-agent-scope-guard

## Summary

Added guards to prevent worktree agents from operating outside their assigned feature, and fixed the dashboard to properly display Drive mode (branch) features.

## Changes
- `feature-create` blocks when run from a feature worktree (prevents committing to wrong branch)
- `feature-do` escalated from warning to error when feature ID doesn't match worktree
- New `detectWorktreeFeature()` and `checkWorktreeScope()` in lib/git.js
- Dashboard Pipeline: Drive mode cards show "Drive" label with status dot, no session controls
- Dashboard Monitor: Drive features show "Drive" / "Implementing" instead of "Agent" / "Session ended"
- Dashboard Monitor: empty repos (0 in-progress items) hidden from view
- Dashboard Monitor: repo headers use short names, bolder font, subtle background tint
- Dashboard Monitor: removed verbose "3 features [-]" counts, just show waiting badge
- Shared helpers `isSoloDrive()` and `agentDisplayName()` used by both Pipeline and Monitor
- Agent name column widened to 72px, font reduced to 11px to fit "Claude Code"

## Decisions
- `feature-create` blocks entirely in worktrees — no feature should be created on a worktree branch
- `feature-do` blocks with clear error message — was just a warning that agents ignored
- Dashboard uses same `kcard-agent` layout for Drive cards to keep status dots aligned with fleet cards
- Empty repos hidden rather than shown with "No items" — reduces noise significantly
- Repo header shows `repo.name` (short) instead of `repo.displayPath` (full path)
