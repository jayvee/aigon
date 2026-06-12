---
complexity: high
set: detail-fidelity
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-12T04:40:57.645Z", actor: "cli/feature-prioritise" }
---

# Feature: reviewer-surfacing-in-detail-view

## Summary

In solo_worktree mode the code reviewer is a different agent than the implementer
(e.g. cc implements, cx reviews). The reviewer is tracked **only** in
`snapshot.codeReview.reviewerId` and is never added to `snapshot.agents`. Because the
dashboard feature-detail view builds its Agents tab and `costByAgent` from `snapshot.agents`,
the reviewer is structurally invisible:

- **Agents tab** shows only the implementer (cc), not the reviewer (cx).
- **Stats / costByAgent** lists only cc; the reviewer has no row.
- **Events** timeline *does* contain `feature.code_review.started/completed` and
  `feature.code_revision.completed`, but the renderer reads the actor as
  `ev.agent || ev.agentId || 'system'` while these events carry the agent in a
  **`reviewerId`** / `revisionAgentId` field — so they render as actor `system` with a raw
  `feature.code_review.started` label instead of attributing "cx".

Observed on brewboard feature 09: events.jsonl and the merged commits both prove cx
reviewed and requested a revision that cc applied — none of it surfaces in the UI.

## User Stories
- [ ] As an operator reviewing a closed feature, I see the code reviewer listed in the
      Agents tab alongside the implementer, with their role indicated (reviewer).
- [ ] As an operator, the Events timeline attributes review/revision events to the actual
      reviewer/revision agent, with a human-readable label.
- [ ] As an operator, the Stats tab shows the reviewer as a distinct participant (even if
      cost is unavailable for non-transcript agents), so I can confirm who reviewed.

## Acceptance Criteria
- [ ] The Agents tab includes a row for `snapshot.codeReview.reviewerId` (and
      `revisionAgentId` if distinct) in addition to `snapshot.agents`, marked as a reviewer
      role. Works in solo_worktree mode where reviewer ≠ implementer.
- [ ] Events of type `feature.code_review.started`, `feature.code_review.completed`,
      `feature.code_revision.completed` render with the correct actor (reviewerId /
      revisionAgentId) and a humanized label (e.g. "Code review started — cx").
- [ ] Stats lists the reviewer as a participant; where no transcript cost exists, it is
      shown explicitly (e.g. "no cost data" / cli agent) rather than omitted.
- [ ] Read-only: no engine state is mutated by the dashboard; surfacing is derived in the
      read-model / payload builder.

## Technical Approach
- **Source of truth**: reviewer lives in `snapshot.codeReview` (`reviewerId`,
  `revisionAgentId`), populated by `lib/workflow-core/projector.js:188-218`. The implementer
  agents map is built at `feature.started` (`:126-156`) and never gains the reviewer.
- **Read-model**: extend the detail payload builder (`lib/dashboard-server.js:357`) and/or
  `lib/workflow-read-model.js deriveReviewStateFromSnapshot()` (`:217-312`) to emit reviewer
  participant rows. Decide whether to inject into the agents list at the read-model layer
  (preferred — keeps the engine/agents map semantics intact) vs. the projector.
- **Agents tab render**: `templates/dashboard/js/detail-tabs.js renderAgents()` (`:238-267`)
  consumes `payload.agentFiles`; add reviewer rows / a role badge.
- **Events render**: `detail-tabs.js renderEvents()` (`:187-236`) — map `reviewerId` /
  `revisionAgentId` into the actor, and add labels for the three code_review/code_revision
  event types (currently they fall through to raw type + `system`).
- Follow the Write-Path Contract: the read path here must only surface what the engine
  already records; do not invent agent entries that the engine doesn't track.

## Dependencies
depends_on: none

## Out of Scope
- Capturing real token cost for codex/non-transcript reviewers — surfacing the participant
  is in scope; populating their USD cost is a separate concern (note it where cost is shown).
- Changing how the engine assigns reviewers.

## Open Questions
- Should the reviewer be injected into the agents list at the read-model layer (preferred,
  non-invasive) or become a first-class entry in `snapshot.agents` (larger blast radius,
  affects analytics/lifecycle)? Lean read-model.
- For multi-cycle reviews, should each reviewer in `reviewCycles` get a row, or just the
  latest? (feature 09 had a single cycle.)

## Related
- Set: detail-fidelity
- Sibling features: close-cost-telemetry-race (set_lead), postclose-detail-panel-fallbacks
- Origin: brewboard feature 09 autonomous-run investigation (2026-06-12)
