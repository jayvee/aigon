---
aigon_id: F680
complexity: high
set: dashboard-ui-rollout
depends_on:
  - 679
---

# Feature: Roll out responsive dashboard Pipeline

## Summary

Apply the contract-driven card renderer to a full-width, responsive production Pipeline. Match information density to the lifecycle stage: Inbox and Backlog remain compact for scanning, while active, review, and recovery stages receive enough width for agents, autonomous plans, blockers, sessions, and actions. Preserve every existing Pipeline workflow, especially drag-and-drop, filters, repository selection, set grouping, detail navigation, and action execution.

The candidate Pipeline remains covered by the preview switch until F682 completes the cutover.

## User Stories

- [ ] As an operator on a wide display, I can use the full window to compare the complete workflow without cards being constrained to an arbitrary centered width.
- [ ] As an operator, I can scan many Inbox and Backlog items compactly while active work shows the richer detail required to make decisions.
- [ ] As an operator, I can drag an entity only to contract-approved stages and receive clear feedback when a move is unavailable.
- [ ] As an operator on mobile, I can review and act on every stage without horizontal page scrolling or clipped controls.
- [ ] As an operator of feature sets, I can see set progress and the full current feature workflow without losing member-level actions or Peek controls.

## Acceptance Criteria

- [ ] The Pipeline uses the available viewport width while retaining bounded gutters and readable card content; it is not capped by the old dashboard-wide content maximum (the `.wrap` `max-width: 1400px` rule in `templates/dashboard/styles/base.css`), which is scoped away for operational views rather than deleted globally.
- [ ] At wide desktop widths the six lifecycle lanes are simultaneously useful: compact lanes prioritize queue density and active/review lanes receive larger minimum widths.
- [ ] At medium widths the Pipeline reflows to a stable multi-row layout instead of compressing cards below their supported width.
- [ ] At 390px mobile width stages form one ordered vertical flow, the document has no horizontal overflow, and all card actions, menus, and Peek controls remain reachable.
- [ ] Breakpoints and lane/card dimensions use stable grid constraints rather than viewport-scaled font sizes or content-dependent control sizing.
- [ ] Inbox and Backlog cards use the compact contract view. In-progress, evaluation, review, recovery, blocked, and ready-to-close cards use the expanded view when their content requires it.
- [ ] Feature, research, and feature-set Pipelines retain correct entity-specific lane labels, filters, empty states, counts, and actions.
- [ ] Drag-and-drop derives valid targets from `uiContract.allowedDrops`; the browser does not recreate a transition table.
- [ ] Keyboard and pointer drag paths preserve existing confirmation, API dispatch, refresh, error, and optimistic-state behavior.
- [ ] Set rows/cards do not duplicate member cards incoherently. An active set exposes overall progress plus the complete current member, including autonomous Implement, Review, Revise, and Close stages and their session actions.
- [ ] Long entity names, multiple agents, quota/recovery blockers, action menus, and detailed autonomous plans do not overlap adjacent content or change lane width unexpectedly.
- [ ] Repo switcher, Pipeline/Monitor navigation, search/filter controls, settings, detail drawer, notifications, and Pro extension points continue to work under both legacy and preview rendering.
- [ ] Keyed updates preserve focus, expansion, selected card, open menus where valid, and scroll position across SSE/status refreshes.
- [ ] Automated screenshots and overflow assertions cover wide desktop, medium desktop/tablet, and 390px mobile for representative queue, active Fleet, autonomous review, set, error, and empty states.
- [ ] The implementation is visually checked against the gallery Pipeline composition and any intentional divergence is recorded in the implementation log.

## Technical Approach

1. Separate Pipeline composition and lane layout from card rendering. Use the F679 renderer's compact/expanded contract variants rather than branching markup by lifecycle state.
2. Scope full-width behavior to operational dashboard views so settings and other focused surfaces retain appropriate reading widths.
3. Implement a responsive CSS grid with explicit wide, medium, and mobile tracks. Avoid nested horizontal scrollers as the primary mobile solution. New layout stylesheets live in `templates/dashboard/styles/` and are listed in `styles/manifest.json`.
4. Adapt the existing keyed reconciliation and drag listeners around the new card roots. Preserve contract action IDs and stable DOM keys so status refreshes do not recreate the entire board.
5. Add layout fixtures with realistic maximum content: long names, two or more active agents, stage-owned Peek controls, blockers, and current-member set detail.
6. Keep the legacy Pipeline selectable through the preview setting until final cutover.

## Validation

```bash
npm run test:gallery
npm run test:browser:smoke
npm run test:iterate
```

## Dependencies

- `depends_on: 679` - requires the shared production contract card renderer and preview switch.

## Out of Scope

- Redesigning lifecycle semantics or adding new transitions.
- Replacing Monitor; that is F681.
- Deleting the legacy Pipeline or enabling the new Pipeline by default.
- Changing Pro product behavior beyond preserving existing extension points.

## Open Questions

- None. Responsive compositions are approved in the F677 Pipeline gallery; implementation should validate them with production data.

## Related

- Prior work: F677 Pipeline gallery.
- Set member: F679 shared cards; F681 live-operations Monitor; F682 cutover.
- Living reference: Pipeline view in `npm run gallery`.
