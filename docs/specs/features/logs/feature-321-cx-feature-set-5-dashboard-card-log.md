# Implementation Log: Feature 321 - feature-set-5-dashboard-card
Agent: cx

## Plan

## Progress

## Decisions

## Code Review

**Reviewed by**: cx
**Date**: 2026-04-23

### Fixes Applied
- Reverted out-of-scope deletion of `feature-322-agent-budget-awareness` spec (unrelated to F321)
- Reverted out-of-scope deletion of `research-37-state-machine-review-cycle-redesign` spec (unrelated to F321)
- Removed out-of-scope addition of `feature-role-specific-agent-config` spec to 01-inbox (unrelated to F321)
- Reverted out-of-scope move of `feature-320-recurring-features` from 03-in-progress to 02-backlog (unrelated to F321)
- Fixed duplicate `[mcp_servers.playwright]` TOML section in `templates/cx/config.toml` — the section was duplicated after the `# --- Aigon Configuration End ---` marker, causing a TOML parsing error

### Residual Issues
- **Out-of-scope removal of `addressing-review` status and spec-check badge system**: The branch removes `writeAgentStatus(id, implAgent, { status: 'addressing-review' })` from the review-check handler in `lib/commands/feature.js`, removes the `addressing-review` case from `deriveFeatureDashboardStatus` in `lib/dashboard-status-helpers.js`, removes `specCheckSessions`/`activeReviewers`/`activeCheckers` from the collector payload, removes `buildSpecCheckBadgeHtml` from `templates/dashboard/js/utils.js`, removes its call from `pipeline.js`, and removes associated CSS classes from `styles.css`. These are all part of the spec-review-cycle redesign (research-37), not the F321 dashboard card spec. Not safely patchable in this review pass — reverting would require touching 6+ files across frontend and backend, and the changes form a coherent producer→consumer chain that should be handled in a dedicated feature branch for the review-cycle work.
- **Completed sets filtered out**: `collectFeatures` now filters `sets` with `.filter(s => !s.isComplete)`, hiding completed sets from the dashboard. The F321 spec doesn't mention this filtering; it says cards render "per active set." Whether "active" includes completed sets for visibility is ambiguous — leaving as-is since the spec uses "active" and this is a reasonable interpretation.

### Notes
- The core F321 implementation (set dashboard card, action registry, dep-graph SVG, collector payload, frontend rendering) is solid and well-structured. The action registry pattern is followed correctly with `lib/feature-set-workflow-rules.js`.
- The test coverage is good — action eligibility, collector payload integration, and dashboard action dispatch are all tested.
- The main concern is scope creep: the branch includes changes from a different feature area (spec-review-cycle cleanup) that should be in its own branch.
