# Feature: Update aigon-site for Dashboard and Paused

## Summary

Update the aigon-site (marketing/docs site) to reflect the new dashboard capabilities, paused column, review flow, create-from-dashboard flow, and other recent changes. The site should accurately represent the current state of Aigon's features.

## Acceptance Criteria

- [ ] Document the Dashboard view (Pipeline, Monitor, Sessions, Console, Logs, Settings)
- [ ] Document the Paused column and pause/resume workflow (drag-and-drop, CLI commands)
- [ ] Document the three setup modes: Drive branch (CLI-only), Drive worktree, Fleet
- [ ] Document the Create Feature flow from dashboard (agent picker, spec refinement)
- [ ] Document the Review flow (agent picker, review in worktree)
- [ ] Document the Close & Merge modal (winner picker, adoption from losing agents)
- [ ] Update any screenshots or GIFs that show outdated dashboard UI
- [ ] Update command reference table with new commands (feature-pause, feature-resume, feature-review)
- [ ] Remove references to deprecated command names (feature-implement, feature-done, arena mode)

## Technical Approach

Review the aigon-site repo (`~/src/aigon-site`) for content pages that describe:
- Dashboard features and screenshots
- Workflow modes (was "Solo" and "Arena", now "Drive" and "Fleet")
- Command reference
- Getting started / quickstart guides

Update text and imagery to match current behaviour. Use the demo guide (`test/demo-guide.md`) as reference for the current flows.

## Out of Scope

- No new pages or site restructuring
- No design changes to the site itself
- No aigon CLI code changes
