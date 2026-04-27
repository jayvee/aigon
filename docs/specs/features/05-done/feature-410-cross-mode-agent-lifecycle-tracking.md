---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-27T13:05:01.862Z", actor: "cli/feature-prioritise" }
---

# Feature: cross-mode-agent-lifecycle-tracking

## Summary

Surface execution mode badge in dashboard monitor view for Drive branch, Drive worktree, and Fleet modes.

## User Stories

- [ ] As a fleet operator, I can see at a glance whether a feature is running in Drive or Fleet mode from the monitor view.
- [ ] As a solo developer, I can confirm my feature is in Drive mode (branch or worktree) from the dashboard card.

## Acceptance Criteria

- [ ] `lib/dashboard-status-collector.js` includes `mode` (from the workflow snapshot) in the feature object sent to the dashboard API.
- [ ] `templates/dashboard/js/monitor.js` renders a mode badge next to the feature title when `feature.mode` is present.
- [ ] The mode badge displays "Drive" for `drive`, `drive-wt`, `solo_branch`, and `solo_worktree` modes; "Fleet" for `fleet` mode.
- [ ] `templates/dashboard/styles.css` includes `.mode-badge` styling consistent with other badges (complexity, autonomous).
- [ ] `node --check` passes for all modified dashboard JS files.
- [ ] `npm test` passes.

## Validation

```bash
node --check templates/dashboard/js/monitor.js
node --check lib/dashboard-status-collector.js
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

The workflow snapshot already stores `mode` (e.g. `drive`, `drive-wt`, `fleet`, `solo_branch`, `solo_worktree`). The dashboard status collector does not currently pass this field through to the frontend. Adding it is a one-line change in the feature object builder. The monitor view's `featureTitle()` helper already renders badges (complexity, autonomous, eval); adding a mode badge follows the same pattern.

## Dependencies

-

## Out of Scope

- Research mode badges (research topics don't have the same mode concept).
- Changing the pipeline view (only monitor view gets the badge).
- Any engine or workflow state changes.

## Open Questions

-

## Related

- Research: —
- Set: —
- Prior features in set: —
