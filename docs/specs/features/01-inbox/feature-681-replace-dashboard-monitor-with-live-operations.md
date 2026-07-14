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
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1168" height="132" viewBox="0 0 1168 132" role="img" aria-label="Feature dependency graph for feature 681" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-681" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-681)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-681)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-681)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#679</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">build responsive dashboar…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#f3f4f6" stroke="#9ca3af" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#680</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">roll out responsive dashb…</text><text x="336" y="90" font-size="12" fill="#475569">inbox</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#f3f4f6" stroke="#f59e0b" stroke-width="3"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#681</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">replace dashboard monitor…</text><text x="636" y="90" font-size="12" fill="#475569">inbox</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#f3f4f6" stroke="#9ca3af" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#682</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">complete dashboard ui cut…</text><text x="936" y="90" font-size="12" fill="#475569">inbox</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
