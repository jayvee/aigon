---
aigon_id: F678
complexity: very-high
set: dashboard-ui-rollout
depends_on:
  - 677
---

# Feature: Adopt dashboard interaction contracts

## Summary

Make the versioned feature, research, and feature-set interaction contracts from F675/F677 the production dashboard's complete read contract. Wire those projectors into the status collector without changing the current visual renderer, and close any remaining contract gaps exposed by real repositories. After this feature, browser code must not infer lifecycle policy, action eligibility, stage ownership, autonomous progress, session inspectability, or set-member state from unrelated fields.

This is an additive backend/read-model change. Compatibility fields remain available for the current dashboard until the later cutover feature removes them.

## Problem Statement

F677 proved the contract and gallery approach, but only the feature contract is currently emitted by the production status collector. Research and feature-set cards still rely on legacy DTOs, and production browser code still combines fields to decide what to show. That split makes the UI difficult to render consistently and allows valid actions or session inspection paths to disappear when a new workflow state is added.

## User Stories

- [ ] As an operator, I see the same available actions for a real feature, research topic, or set that its workflow definition permits.
- [ ] As an operator, I can inspect every retained agent session that is running, completed, stopped, lost, or failed.
- [ ] As a dashboard developer, I can render entity identity, current activity, autonomous stages, blockers, actions, tools, drag targets, agents, and sessions from one versioned contract.
- [ ] As a workflow developer, adding a resting state or operator action fails a contract/gallery test until its UI projection is defined.

## Acceptance Criteria

- [ ] `/api/status` emits a validated, versioned `uiContract` for every feature, research topic, and feature-set card that the dashboard can render.
- [ ] Feature contracts remain backward-compatible with F675 while research and set contracts use the common envelope from `lib/entity-ui-contract.js`.
- [ ] Contract identity distinguishes entity title, numeric ID, entity kind, set membership, and machine slug without requiring the renderer to reconstruct or duplicate labels.
- [ ] Contracts expose server-owned state, presentation, primary and secondary decisions, tools, blockers, allowed drops, agents, inspectable sessions, autonomous plans, and nested current-set-member detail where applicable.
- [ ] A set autonomous run embeds the complete current member contract, including review and revision stages, instead of reducing it to a generic `working` row.
- [ ] Session DTOs include a stable inspection action for retained output in running, completed, stopped, lost, and failed states. Live sessions target the live pane; ended sessions target the saved console snapshot.
- [ ] Stage-owned worker sessions appear once in their owning autonomous stage and are not repeated as peer activity rows.
- [ ] Internal-only workflow signals remain in contract metadata for coverage but are not exposed as operator actions.
- [ ] `validActions`, existing stage fields, and other documented compatibility fields are generated from the same source as `uiContract`; there is no second hand-maintained action policy.
- [ ] The status fingerprint includes every contract field whose change must repaint a card, including research, set, autonomous-stage, nested-member, and session inspection changes.
- [ ] Malformed or incomplete contracts fail deterministically in tests and produce a diagnosable collector error rather than a partially inferred browser state.
- [ ] Current Pipeline and Monitor visuals and action behavior remain unchanged in this feature.
- [ ] Contract and gallery coverage includes every production resting state and every operator-visible action for feature, research, and feature-set entities.

## Technical Approach

1. Audit the F677 gallery facts against real collector payloads from `lib/dashboard-collect/feature-poll.js`, `collect-research.js`, and `set-cards.js`; add normalized runtime facts rather than gallery-specific exceptions.
2. Project all three entity types through `feature-ui-contract`, `research-ui-contract`, and `feature-set-ui-contract` at the collector boundary.
3. Keep compatibility DTO fields as pure projections from the same contract/action definitions. Add assertions that action IDs, target stages, agent ownership, and inspection targets cannot diverge.
4. Extend `computeStatusFingerprint` with a stable entity-contract fingerprint that covers repaint-relevant fields without hashing volatile or presentation-irrelevant data.
5. Add fixture-driven parity tests comparing legacy action availability to the contract for every current production state. Any mismatch must be resolved in the workflow definition/projector, not patched in the browser.
6. Preserve the F677 gallery as the exhaustive contract harness. New real-world scenarios discovered during adoption must be added as generated facts and retained permanently.

## Validation

```bash
node tests/integration/feature-ui-contract.test.js
node tests/unit/dashboard-card-gallery.test.js
npm run test:gallery
npm run test:iterate
```

## Dependencies

- `depends_on: 677` - F677 supplies the approved executable contracts, generated state gallery, and design guardrails.

## Out of Scope

- Changing production card markup or CSS.
- Replacing the Pipeline or Monitor layouts.
- Changing workflow eligibility, lifecycle transitions, or autonomous orchestration policy.
- Removing compatibility status fields used by the current dashboard.

## Open Questions

- None. Contract ownership and gallery guardrails were decided in F675/F677.

## Related

- Prior work: F675 Unify dashboard interaction contract.
- Prior work: F677 Complete dashboard UI contract and state gallery.
- Living reference: `npm run gallery` on port 3700.
