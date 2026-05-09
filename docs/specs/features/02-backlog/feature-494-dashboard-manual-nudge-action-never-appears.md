---
complexity: low
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-09T22:10:33.461Z", actor: "cli/feature-prioritise" }
---

# Feature: dashboard-manual-nudge-action-never-appears

## Summary

The dashboard's manual `Nudge agent…` action (kind `FEATURE_NUDGE` / `RESEARCH_NUDGE`) never appears as a menu item on any feature or research card, even when an agent's tmux session is running and the agent is in a "running"/"researching"/"idle" state. The action's eligibility guard checks `context.tmuxSessionStates`, but the dashboard's action-derivation pipeline never populates that field — so the guard always evaluates to `false` and the action is filtered out server-side before reaching the client.

The auto-nudge / idle-ladder path is unaffected (it uses `tmuxRunning` directly on the per-agent dashboard object). Only the **manual** menu item is broken.

## Regression introduced by

**Commit `ae207994` (2026-05-08):** `fix(dashboard): remove nudge from no-tmux mode, improve pending-completion UX` (Co-Authored-By: Claude Sonnet 4.6). The commit's stated intent was correct — *"avoids offering an action that has no target when running in solo Drive mode (no worktree/tmux)"* — but the implementation introduced a write-path-contract violation: the new guard read path consumes `context.tmuxSessionStates`, a field nothing in the dashboard's action-derivation pipeline writes.

Diff that introduced the bug (identical shape in both files):

```diff
 guard: ({ context }) => {
     const agents = Object.values(context.agents || {});
+    const tmuxStates = context.tmuxSessionStates || {};
     return context.currentSpecState !== 'done'
-        && agents.some(agent => ['running', 'idle', 'waiting', 'ready'].includes(agent.status));
+        && agents.some(agent => ['running', 'idle', 'waiting', 'ready'].includes(agent.status))
+        && Object.values(tmuxStates).some(state => state === 'running');
 },
```

(The research-rules guard added the same check, with `'researching'` also accepted in the agent-status list.)

**Why the regression was invisible to tests:** the existing tests for these guards likely passed `tmuxSessionStates` in their fixture context (so the check passes in tests) but the dashboard's runtime context is built from a workflow snapshot via `lib/workflow-snapshot-adapter.js:418` (`{...snapshot, entityType}`), which never carries tmux state. Snapshot fixtures in tests don't reflect this gap. The fix in this feature must include an integration-level test that exercises the actual dashboard path (read-model → adapter → guard), not just a fixture context.

**Pattern this matches:** see `AGENTS.md § Write-Path Contract` and the F294 / b1db12d3 incident — a guard read path was added that assumes state nobody writes. The original commit should have either (a) added the producer in `enrichSnapshotWithInfraData` at the same time, or (b) read `context.agents[id].tmuxRunning` from a field that *is* already populated.

## User Stories

- [ ] As an Aigon user, when I see an agent stuck running on a feature or research card, I can click `Nudge agent…` from the card menu, pick an agent + role, and send the agent a message — without dropping into the terminal.
- [ ] As an Aigon maintainer, the manual nudge action's eligibility is consistent with the rest of the action-rule pipeline: tmux state is sourced from the same data the dashboard already collects per agent.

## Acceptance Criteria

- [ ] On a research card with at least one agent in a running tmux session, the entity-level `…` menu lists `Nudge agent…`. Tested with R48 in its current state (cx tmux session running, cu/cc completed).
- [ ] On a feature card with at least one agent in a running tmux session, the entity-level `…` menu lists `Nudge agent…`.
- [ ] The action remains hidden when no tmux session is running for any agent on the card (status quo for that case is correct).
- [ ] The action remains hidden when `currentSpecState === 'done'` (status quo for that case is correct).
- [ ] No change to the auto-nudge / idle-ladder path — it continues to work as today.
- [ ] Test: an integration test that builds a research dashboard state with one agent's `tmuxRunning: true` asserts `validActions` includes `research-nudge`. A second test with `tmuxRunning: false` for all agents asserts `research-nudge` is absent.
- [ ] Test: equivalent integration test for `feature-nudge`.

## Validation

```bash
node -c lib/workflow-read-model.js
node -c lib/feature-workflow-rules.js
node -c lib/research-workflow-rules.js
npm run test:iterate
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

### Root cause

Both nudge actions have the same guard shape:

```js
// lib/feature-workflow-rules.js:268-274
// lib/research-workflow-rules.js:194-200
guard: ({ context }) => {
    const agents = Object.values(context.agents || {});
    const tmuxStates = context.tmuxSessionStates || {};
    return context.currentSpecState !== 'done'
        && agents.some(agent => /* running/idle/etc */)
        && Object.values(tmuxStates).some(state => state === 'running');
}
```

`context.tmuxSessionStates` is read by the guard but never written by the dashboard's action-derivation path:

- `lib/workflow-snapshot-adapter.js:418` builds the action context as `{...snapshot, entityType}`.
- Workflow snapshots never carry tmux state (it's a live-runtime concern, not engine state).
- `enrichSnapshotWithInfraData` (`lib/workflow-read-model.js:297-321`) bridges per-agent dashboard data into `enriched.agents[id]` (flags, findingsPath, devServer fields) — but never adds `tmuxSessionStates`.
- The guard runs server-side at `lib/workflow-core/actions.js:65` before the `validActions` payload is sent to the client. Result: `Object.values({}).some(...)` → `false` → action filtered out.

### Recommended fix

In `enrichSnapshotWithInfraData` (`lib/workflow-read-model.js:297`), add a one-line bridge that builds `tmuxSessionStates` from the dashboard agents already passed in:

```js
enriched.tmuxSessionStates = Object.fromEntries(
  dashboardAgents.map(da => [da.id, da.tmuxRunning ? 'running' : 'none'])
);
```

Place it inside the existing `if (dashboardAgents && dashboardAgents.length > 0)` block. This keeps the bridge in the read-model layer where dashboard agents are already in scope; no new data flows or types.

The two callers (`getFeatureDashboardState`, `getResearchDashboardState`) both already pass `agents` (the dashboard's per-agent objects) into `enrichSnapshotWithInfraData`, so no caller change is required.

### Alternative considered

Rewriting the guards to read `context.agents[id].tmuxRunning` instead of `context.tmuxSessionStates`. Smaller in one sense (touches only the two guards), but it would also require the enrich function to propagate `tmuxRunning` per agent — and it changes the field the guards rely on, which has cross-cutting implications (other places read `tmuxSessionStates`, e.g. `lib/state-queries.js`, `lib/dashboard-server.js:784`). The bridge in `enrichSnapshotWithInfraData` is the minimal-diff fix.

## Dependencies

- No feature dependencies.

## Out of Scope

- Auto-nudge / idle-ladder UX changes (they work today via a different code path).
- Adding new tmux-state collection paths. The `tmuxRunning` boolean is already computed per agent in `lib/dashboard-status-collector.js` (research at line 1137; the equivalent feature path computes the same).
- Changing any guard for a non-nudge action.
- Snapshot schema changes (tmux state remains live-runtime; we just bridge it into the action context).

## Open Questions

None.

## Related

- Discovered while running R48 (aigon-versioning-model-and-multi-repo-update-ux) — the user expected to nudge the still-running Codex agent and noticed no menu item.
- Regression commit: `ae207994` (2026-05-08, "fix(dashboard): remove nudge from no-tmux mode, improve pending-completion UX").
- Code: `lib/workflow-read-model.js`, `lib/feature-workflow-rules.js`, `lib/research-workflow-rules.js`, `lib/workflow-snapshot-adapter.js`, `lib/workflow-core/actions.js`, `lib/dashboard-status-collector.js`.
