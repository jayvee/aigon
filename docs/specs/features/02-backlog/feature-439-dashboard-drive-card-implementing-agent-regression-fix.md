---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-28T13:46:44.300Z", actor: "cli/feature-prioritise" }
---

# Feature: dashboard-drive-card-implementing-agent-regression-fix

## Summary

Restore `driveToolAgentId` on Drive (solo_branch) kanban cards. When the engine row carries a synthetic `solo` agent, the real implementing CLI (cc, op, cx, …) is inferred from per-agent status files and, as a secondary fallback, live tmux `do-<agent>` sessions. Surface `driveToolAgentId` in the `/api/status` payload and render it next to the "Drive" label on the card header.

REGRESSION: solo_branch Drive cards hide which agent is implementing. This cherry-picks the intent of commit `f8dcd0e7` from the abandoned `feat/dashboard-drive-tool-label` branch; `specCheckSessions` and `buildReviewerSectionHtml` refactors from that commit are already in `main`.

## User Stories

- [ ] As a user monitoring a Drive-mode feature, I can see which CLI agent (e.g. "Claude Code") is doing the work on the kanban card without opening the feature detail.
- [ ] As a user returning after a break, I can glance at the board and know at a glance that Drive is running under, say, Gemini, not just an anonymous "Drive" label.

## Acceptance Criteria

- [ ] `/api/status` response includes `driveToolAgentId: "<agentId>"` (non-null) for any in-progress solo_branch feature whose per-agent status file shows a live status (`implementing`, `waiting`, `reviewing`, `addressing-review`, `feedback-addressed`, `awaiting-input`).
- [ ] `/api/status` response includes `driveToolAgentId: null` for features that are not solo_branch or have no live per-agent status.
- [ ] The kanban card Drive header reads `Drive <AgentDisplayName>` (e.g. "Drive  Claude Code") when `driveToolAgentId` is set; the label is omitted when it is null.
- [ ] Existing regression test (from `f8dcd0e7`) passes: `collectRepoStatus sets driveToolAgentId for solo_branch from tool agent status file` — this test must be added to `tests/integration/dashboard-review-statuses.test.js` and pass with `npm test`.
- [ ] No regressions in the existing `npm test` suite.
- [ ] Dashboard renders correctly for fleet-mode features (non-solo_branch) — their cards show no Drive label change.

## Validation

```bash
npm test
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

**Files to change:**

1. **`lib/dashboard-status-collector.js`** — add `resolveDriveBranchToolAgentId(featureId, absRepoPath)`:
   - Import `agent-registry` (already available in the module, add `require` inline if needed).
   - Get all non-`solo` agent IDs from `agentRegistry.getAllAgentIds()`.
   - Primary: iterate IDs and call `agentStatus.readAgentStatus(featureId, agentId, 'feature', { mainRepoPath: absRepoPath })`; return the first ID whose `status` is in the live-state set (`implementing`, `waiting`, `reviewing`, `addressing-review`, `feedback-addressed`, `awaiting-input`).
   - Secondary fallback: if no status file is live, iterate IDs and call `safeTmuxSessionExists(featureId, agentId)`; return first with `running === true`.
   - Returns `null` when no live agent is found.
   - In `collectFeatures`, compute `driveToolAgentId` when `snapshot.mode === 'solo_branch' && agents.length === 1 && agents[0].id === 'solo'`; include it in the `features.push({…})` payload (both the main push and the error-recovery push).

2. **`templates/dashboard/js/pipeline.js`** — in the `isSoloDriveBranch` branch of `buildKanbanCard`:
   - Read `feature.driveToolAgentId`.
   - Resolve the display name via `AGENT_DISPLAY_NAMES[driveToolId] || driveToolId`.
   - Inject a `<span class="kcard-agent-triplet">` element (matching the existing pattern) between the "Drive" label and `soloDevSlot` in the card header — omit the span entirely when `driveToolAgentId` is null.

3. **`tests/integration/dashboard-review-statuses.test.js`** — port the regression test from `f8dcd0e7`:
   - `testAsync('collectRepoStatus sets driveToolAgentId for solo_branch from tool agent status file', …)`: bootstrap feature 88 with `engine.startFeature(repo, '88', 'solo_branch', ['solo'])`, write an `op` status file with `status: 'implementing'`, call `collectRepoStatus`, assert `feature.driveToolAgentId === 'op'`.

**Ordering preference:** status file over tmux (tmux lags). Do not change the order between primary and fallback.

**No new modules.** All helpers (`agentStatus`, `safeTmuxSessionExists`, `agentRegistry`) are already imported in `dashboard-status-collector.js` or available via `require`.

**Server restart required** after editing `lib/dashboard-status-collector.js` (per project rule).

## Dependencies

- None. `specCheckSessions` and `buildReviewerSectionHtml` from the same abandoned branch are already merged to main.

## Out of Scope

- Fleet-mode features (multi-agent, non-solo_branch) — their cards are unaffected.
- Showing `driveToolAgentId` in the feature detail panel or the API response schema docs.
- Inferring the agent from git commit author or worktree directory name.
- Any CSS restyling of the card header beyond the `kcard-agent-triplet` span.

## Open Questions

- None.

## Related

- Research: none
- Set: none
- Prior features in set: none
- Abandoned branch: `feat/dashboard-drive-tool-label` (stale, source commit `f8dcd0e7`)
