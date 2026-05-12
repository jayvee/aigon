---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-12T04:38:22.468Z", actor: "cli/feature-prioritise" }
---

# Feature: optimistic-start-ui

## Summary
Make `feature-start` and `research-start` feel instant from the dashboard. Today the card stays in BACKLOG while the entire `aigon feature-start` CLI runs synchronously — ~20–24s for a 2–3 agent fleet — because the dashboard only re-renders after the HTTP response. The actual workflow snapshot write (`wf.startFeature()` in `lib/feature-start.js:392`) finishes within ~1s; the rest is per-agent worktree/tmux setup that doesn't conceptually block the state transition. Move the card optimistically the moment Start is clicked and reconcile when the response lands.

## User Stories
- [ ] As an operator, when I click Start in the Select Agents modal, the card moves to IN-PROGRESS within one frame so I know my click registered.
- [ ] As an operator, if the start fails server-side (worktree conflict, git error), the card rolls back to BACKLOG and the error toast tells me what happened.

## Acceptance Criteria
- [ ] Clicking Start on a fleet feature visually moves the card from BACKLOG → IN-PROGRESS before the `/api/action` response returns (measured: card present in IN-PROGRESS column within ≤ 250ms of click).
- [ ] Existing `card-starting` shimmer remains visible during the spawn window (currently triggered at `templates/dashboard/js/api.js:67`).
- [ ] On HTTP non-2xx or `exitCode !== 0`, the card returns to BACKLOG and the existing error toast fires.
- [ ] Solo Drive-mode start has the same instant feel (same code path).
- [ ] `research-start` gets the same treatment (same `requestAction` entrypoint).
- [ ] The next `requestRefresh()` (already wired at line 134) reconciles with server truth; if server state disagrees with optimistic state, server wins without flicker.

## Validation
```bash
```

## Technical Approach
**Single touch point**: `requestAction` in `templates/dashboard/js/api.js` (line 57).

1. When `action` is `feature-start` or `research-start`, before the `fetch('/api/action', …)` call, apply an optimistic mutation to `state.data`:
   - Locate the entity by id within `state.data.repos[].features[]` / `…research[]`.
   - Snapshot its current `status` / column-determining fields for rollback.
   - Set the fields the pipeline render uses to place the card in IN-PROGRESS (likely the workflow-status / folder field that the column grouper keys on — locate via the existing pipeline render; it lives in `templates/dashboard/js/pipeline.js` or similar).
   - Call `render()` synchronously so the card jumps columns immediately.
2. On `!res.ok` or `exitCode !== 0` (existing branches at lines 99, 103): restore the snapshot, call `render()`, then let the existing error toast fire.
3. On success: leave the optimistic state in place; `requestRefresh()` at line 134 will reconcile.
4. Server reconciliation must be idempotent — if `/api/status` returns a card that disagrees, the next render trusts the server. No special merge logic needed beyond the existing refresh.

**Why frontend-only**: the server's first write (`wf.startFeature()` snapshot) already moves the card *conceptually* within ~1s — we're just stopping the UI from waiting for the rest of the CLI to finish. No server change needed; no SSE; no parallelisation.

**Edge cases**:
- User clicks Start twice rapidly → already guarded by `state.pendingActions.has(key)` (line 59).
- Server takes >30s and times out → caught by existing `try/catch`; rollback runs.
- User navigates away mid-request → optimistic state lives in `state.data`; next page load fetches fresh.

## Dependencies
-

## Out of Scope
- Server-side SSE early-broadcast after `wf.startFeature()`.
- Parallelising the per-agent worktree loop in `lib/feature-start.js` (`git worktree add`, `setupWorktreeEnvironment`, tmux spawn currently serial — separate feature).
- The stale "Finished (unconfirmed)" banner on freshly-started features (root cause: `clearSessionEndedFlag` only fires when a new tmux session is `created` — see `lib/feature-start.js:599,687`). Tracked separately.
- Background polling cadence / SSE upgrade.

## Open Questions
- Which exact field does the pipeline column grouper key on for IN-PROGRESS placement? (resolve during implementation by reading the pipeline render module)

## Related
- Research:
- Set:
- Prior features in set:
