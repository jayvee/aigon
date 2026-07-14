---
aigon_id: F681
complexity: very-high
set: dashboard-ui-rollout
depends_on:
  - 680
---

# Feature: Replace dashboard Monitor with live operations

## Summary

Re-imagine the production Monitor as a live-operations workspace rather than a second, less capable Pipeline. The Monitor should answer: what needs attention, what is running, what just finished, what stage is active, what comes next, and which session can be inspected. Use server-owned contract data and the shared card/session/action components, with a queue-and-detail desktop layout that becomes a clear stacked flow on mobile.

The candidate Monitor remains behind the dashboard preview switch until F682 completes the cutover.

## User Stories

- [ ] As an operator, I can immediately see running work and items requiring intervention across features, research, sets, autonomous controllers, and agent sessions.
- [ ] As an operator, I can select a run and understand its completed, current, and future stages without opening the Pipeline.
- [ ] As an operator, I can Peek at a running or retained completed/error session from the queue or selected-run detail.
- [ ] As an operator, I can take the workflow action that resolves an attention item without guessing what an internal status means.
- [ ] As a mobile operator, I can move between the queue and selected detail without a cramped desktop split view.

## Acceptance Criteria

- [ ] Monitor is organized around server-derived operational groups: needs attention, running, and recently completed. It is not a lane-for-lane duplicate of Pipeline.
- [ ] Group membership and urgency come from explicit contract state/presentation metadata. Browser code does not classify entities by matching status text, action labels, lane names, or agent counts.
- [ ] Summary metrics report actionable counts and update through the existing SSE/status path without a separate polling loop.
- [ ] Every operational-projection field that changes group membership, urgency, queue ordering, or recently-completed inclusion is covered by `computeStatusFingerprint` (`lib/dashboard-status-version.js`) so Monitor repaints on SSE pushes without a separate refresh trigger.
- [ ] Each queue item identifies the entity once, shows the specific current activity and responsible agent/controller, and exposes the relevant decision or Peek control.
- [ ] Selecting an item opens a persistent detail surface containing entity context, blockers, decisions, agents, inspectable sessions, recent events, and the complete autonomous plan where present.
- [ ] Autonomous detail shows the controller separately from its stage workers, with past, current, and future stages visually distinct.
- [ ] Stage rows align marker, name, agent, state, and Peek consistently. A worker is not repeated in a generic activity section when its autonomous stage already owns it.
- [ ] Feature-set autonomous detail shows overall member progress and embeds the full current feature contract, including any implementation, review, revision, recovery, or close sub-stage.
- [ ] All retained running, completed, stopped, lost, and failed agent sessions expose Peek from every Monitor representation in which that session appears.
- [ ] Attention states use domain language and a concrete resolution action. Labels such as `automation stopped`, `review session ended`, or `provider quota paused` are not shown without contract-provided explanation and the applicable next decision.
- [ ] Recently completed work remains inspectable for a bounded, documented window and clearly distinguishes workflow completion from an ended agent session.
- [ ] Queue selection survives keyed status refreshes when the entity still exists; if it disappears, selection moves predictably rather than leaving stale detail.
- [ ] Wide desktop presents queue and detail together. At 390px the content stacks with an explicit way to return to the queue, no horizontal overflow, and no clipped action bar.
- [ ] Empty, disconnected, loading, stale, error, no-running-work, multiple-running-agent, autonomous-review, set-current-member, and recently-completed states have intentional tested presentations.
- [ ] Existing Monitor actions, detail navigation, session attachment/Peek behavior, repo switching, notifications, and Pro hooks remain functional or are explicitly superseded by equivalent controls.
- [ ] The implementation is visually checked against the gallery Monitor and any intentional divergence is recorded in the implementation log.

## Technical Approach

1. Add a server-owned operational projection over entity contracts, either as a top-level Monitor contract or explicit per-entity operational metadata. It must remain a pure read model and must not introduce workflow policy.
2. Reuse the F679 identity, action, session, autonomous-stage, blocker, and current-member primitives. Monitor composition may differ; action semantics may not.
3. Build a keyed queue/detail controller with URL or view-state selection that tolerates SSE refresh and repository changes.
4. Reuse current status/events infrastructure. Do not add an independent Monitor poller or direct tmux inspection path.
5. Define and test the bounded recently-completed policy on the server so all clients receive the same set.
6. Keep the old Monitor selectable through the preview setting until final cutover.

## Validation

```bash
npm run test:gallery
npm run test:browser:smoke
npm run test:iterate
```

## Dependencies

- `depends_on: 680` - follows shared card adoption and Pipeline shell work so Monitor reuses proven responsive and action primitives.

## Out of Scope

- Changing workflow or autonomous-run semantics.
- Creating a new event store, tmux integration, or polling service.
- Turning Monitor into analytics/history reporting.
- Deleting the legacy Monitor or making the candidate default.

## Open Questions

- The recently-completed retention window should be selected during implementation from current event/status retention behavior and documented as part of the server projection; it must not be an untested browser-only constant.

## Related

- Prior work: F677 Monitor gallery.
- Set member: F679 shared cards; F680 responsive Pipeline; F682 cutover.
- Living reference: Monitor view in `npm run gallery`.
