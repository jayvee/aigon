# Feature: Dashboard Evaluation UX

## Summary
Complete the fleet evaluation flow in the dashboard so users can review eval results, pick a winner, and optionally review losing agent diffs — all without dropping to the CLI. Currently the dashboard shows eval cards with status badges but has no way to view results, select a winner, or close a fleet feature properly.

## User Stories
- [ ] As a user with a completed fleet eval, I want to read the evaluation summary (scores, winner, rationale) in the dashboard without opening a file manually
- [ ] As a user, I want to accept the recommended winner and close the feature from the dashboard with one click
- [ ] As a user, I want to override the recommended winner if I disagree with the eval
- [ ] As a user, I want to view diffs from losing agents before closing, so I can decide whether to cherry-pick anything

## Acceptance Criteria
- [ ] When `evalStatus === 'pick winner'`, the card shows the winner name and total scores
- [ ] Clicking "Accept & Close" on a fleet eval card opens a winner picker (single-select agent picker showing competing agents)
- [ ] The winner picker pre-selects the eval's recommended winner if one exists
- [ ] After selecting a winner, the dashboard dispatches `feature-close <id> <winner-agent>` correctly
- [ ] An "View Eval" button/link opens the eval file in the spec drawer (or a new tab in the drawer)
- [ ] The eval viewer renders the markdown evaluation with scores table, summary, and recommendation
- [ ] Dragging from in-evaluation to done also triggers the winner picker before closing
- [ ] Syntax check passes: `node -c lib/dashboard-server.js && node -c lib/state-machine.js`

## Validation
```bash
node -c lib/dashboard-server.js
node -c lib/state-machine.js
node -c templates/dashboard/js/pipeline.js
node -c templates/dashboard/js/sidebar.js
node -c templates/dashboard/js/api.js
```

## Technical Approach

### 1. Expose winner data from server (dashboard-server.js)
- In `collectDashboardStatusData`, when parsing the eval file for `evalStatus`, also extract:
  - `winnerAgent` — the recommended agent ID parsed from `**Winner:** cc (Claude)` or similar
  - `evalPath` — path to the eval file (for the drawer to load)
- Add these to the feature object sent to the frontend

### 2. Winner picker on close (pipeline.js + sidebar.js)
- When `feature-close` action is triggered on a fleet eval card:
  - Call `showAgentPicker(featureId, featureName, { single: true, title: 'Pick winner to merge', submitLabel: 'Close & Merge', preselect: feature.winnerAgent })`
  - Pass the selected agent as the second arg: `requestAction('feature-close', [featureId, winnerAgent], repoPath)`
- Add `preselect` support to `showAgentPicker` — auto-check the recommended winner's radio button
- Apply same picker to drag-to-done from in-evaluation column

### 3. Eval viewer in spec drawer (pipeline.js + index.html)
- Add a "View Eval" button to cards where `evalStatus` is truthy
- Clicking opens the spec drawer with `evalPath` instead of `specPath`
- Reuse existing drawer markdown preview — the eval file is already markdown

### 4. Card enhancements (pipeline.js)
- When `evalStatus === 'pick winner'` and `winnerAgent` exists, show on the card:
  - Winner badge: "Winner: cc" with a green highlight
  - Score summary if parseable

## Dependencies
- `showAgentPicker` already supports `single: true` mode (built earlier today)
- Spec drawer already renders markdown preview
- `feature-close` CLI already accepts `<id> <agent>` for fleet mode

## Out of Scope
- Adoption diff viewer in dashboard (CLI `--adopt` only for now — would need a diff rendering component)
- Re-running eval from dashboard with different parameters
- Editing the eval file from the dashboard
- Auto-closing when eval recommends a winner (user must explicitly accept)

## Open Questions
- Should "Accept & Close" auto-select the winner without showing a picker if the eval has a clear recommendation? Or always show the picker for explicit confirmation?
- Should the eval viewer be a tab in the spec drawer or a separate drawer?

## Related
- Actor tracking on stage transitions (built today, commit 011607e)
- Drag-to-evaluation agent picker (built today, commit 011607e)
