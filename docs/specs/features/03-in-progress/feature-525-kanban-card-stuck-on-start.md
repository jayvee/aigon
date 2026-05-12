---
complexity: low
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-12T07:00:32.591Z", actor: "cli/feature-prioritise" }
---

# Feature: kanban-card-stuck-on-start

## Summary
The optimistic stage move shipped previously (intent: card jumps from BACKLOG → IN-PROGRESS the instant the user clicks Start in the Select Agents modal) **never actually re-renders the DOM**. The Alpine store mutation succeeds — reading `Alpine.store('dashboard').data.repos[i].features[j].stage` back returns `'in-progress'` — but the kanban column re-render bound by `x-effect="renderKanbanColCards($el, repo, stage)"` at `templates/dashboard/index.html:230` does not fire. The result: users sit through the full CLI runtime + `/api/refresh` window with the card frozen in BACKLOG, exactly the experience the optimistic move was meant to eliminate. Measured 2026-05-12 on brewboard f09 fleet (cc+gg) from `~/.aigon/dashboard.log`: POST `/api/action` 17.2s + POST `/api/refresh` 3.0s = **~20s of dead UI**.

## User Stories
- [ ] As an operator clicking Start (solo or fleet), the card visibly leaves its source column within one frame, even though the CLI keeps running for another 17s in the background.
- [ ] As an operator whose start fails server-side, the card rolls back to its source column and an error toast appears.

## Acceptance Criteria
- [ ] A repro test (Playwright or unit) mutates a feature's `stage` via the Alpine store proxy and asserts the matching `.card` element changes column within 250ms. This test fails on `main` today and passes after the fix.
- [ ] Live verification with Playwright: clicking Start on a BACKLOG card on the live dashboard moves it to IN-PROGRESS within 250ms of click. Snapshot saved in the worktree's review notes.
- [ ] HTTP error rollback: with a simulated 4xx/5xx response (via route mocking/interception), the card returns to its source column within one frame after the error toast fires.
- [ ] Works for both `feature-start` and `research-start` actions.
- [ ] Works whether the source column is BACKLOG, INBOX, or has a set-grouping wrapper around the card.
- [ ] The existing `card-starting` shimmer animation at `templates/dashboard/styles.css:65` still plays during the spawn window.
- [ ] No regression to `reapplyPendingOptimisticEntityStarts` in `templates/dashboard/js/api.js:92` and `templates/dashboard/js/init.js:510` — the card must stay in IN-PROGRESS through subsequent poll cycles until the server agrees.
- [ ] No imperative DOM manipulation introduced. The fix uses Alpine's standard reactivity primitive only.

## Validation
```bash
npm run test:quick
# plus the new Playwright assertion added in this feature
```

## Root cause (verified before writing this spec)

Architecture confirmed at `templates/dashboard/index.html:204`:
```html
<template x-for="repo in visibleRepos" :key="repo.path">
  <template x-for="stage in currentStages" :key="stage">
    <div x-effect="renderKanbanColCards($el, repo, stage)"></div>
```

Each column's effect calls `renderKanbanColCards` (`templates/dashboard/js/pipeline.js:1441`), which iterates `repo[pType]` and reads each `f.stage` to bucket by stage. So **every feature's `.stage` IS a tracked dep of every column's effect — but only for features that existed at the effect's last execution**. A previously-empty IN-PROGRESS column's `forEach` over an empty array reads nothing, so Alpine has nothing to invalidate when a single feature's stage changes elsewhere. That is the bug: per-item mutation doesn't reliably trigger downstream columns whose effects didn't iterate the moved item.

## Technical Approach

**Single fix path. ~4 lines of diff. Uses the same reactive primitive the polling path uses.**

In `applyOptimisticEntityStart` (`templates/dashboard/js/api.js:62`), after mutating `entity.stage`, bump the array reference:

```js
const previousStage = entity.stage;
const previousFeatures = repo[entityKey];
entity.stage = 'in-progress';
repo[entityKey] = previousFeatures.slice();    // identity-bump fires set-trap → every column re-runs
render();
return () => {
  if (entity.stage === 'in-progress') {
    entity.stage = previousStage;
    repo[entityKey] = repo[entityKey].slice();  // symmetric on rollback
    render();
  }
};
```

Apply the same pattern in `reapplyPendingOptimisticEntityStarts` (api.js:92) so poll-reapply matches.

**Why this is not a hack:**
- `repo[entityKey] = newArray` triggers Alpine's set trap on `repo.features` — the same primitive every other reactive update in the dashboard uses.
- Effects that read `repo.features` (every column's `x-effect`) re-run via Alpine's normal mechanism — identical to a poll-driven update.
- No imperative DOM manipulation, no bypassing the reactive system, no comment-explained workaround.
- `arr = arr.slice()` to force list reactivity is a documented Vue 3 / Alpine idiom for the exact case where per-item mutation doesn't fan out to downstream listeners.

**Why this won't add brittleness:**
Today the optimistic path mutates `entity.stage` directly while the polling path replaces `state.data` wholesale. The two paths use *different* reactivity triggers, and only one of them actually works. This fix unifies them: both paths now flow through Alpine's normal set-trap-on-array-property mechanism. Net surface area decreases.

## Implementation steps

1. **Add a Playwright repro test first.** Pick a backlog feature, call `window.applyOptimisticEntityStart(...)`, assert the card's parent column changed within 250ms. Confirm it fails on `main`.
2. **Apply the 4-line diff** to `applyOptimisticEntityStart` and `reapplyPendingOptimisticEntityStarts`.
3. **Run the repro test** — it should pass.
4. **Visual verification with Playwright** on the live dashboard: start a real backlog feature on brewboard, capture a screenshot 100ms after click, confirm card is in IN-PROGRESS.
5. **Rollback path verification:** simulate a server error and confirm the card returns to its source column within a frame.

If step 3 fails — i.e. Alpine's reactivity is not picking up the array reassignment — **do not patch around it with imperative DOM**. File a follow-up feature to investigate Alpine's proxy depth in the store. The kanban has a deeper bug at that point that affects more than optimistic UI, and a one-off imperative re-render here would mask it.

## Confidence

~85% the array-identity bump works first try. The remaining 15% is "Alpine's proxy on `repo` is shallow in some edge case" — in which case the right response is the follow-up investigation, not a workaround.

## Time estimate

Drive mode, one agent: **20–40 minutes wall-clock**. Diff is ~4 lines plus the repro test. The hard work (architecture confirmation) is already done in this spec.

## Dependencies
- None. All files involved are dashboard frontend: `templates/dashboard/js/api.js`, `templates/dashboard/index.html` (read-only reference), `templates/dashboard/js/pipeline.js` (read-only reference).

## Out of Scope
- The remaining ~17s of CLI runtime per fleet start. This feature only masks it; cutting it is a separate follow-up (async iTerm tab opening, parallel per-agent worktree setup).
- Stale "Finished (unconfirmed)" / `clearSessionEndedFlag` bug — tracked separately.
- Any change to the polling / refresh path. The fix unifies behaviour but doesn't restructure that path.

## Open Questions
- None.

## Related
- Research:
- Set:
- Prior features in set: this is the actual implementation of the optimistic-start UI that was previously shipped non-functional.
