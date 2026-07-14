---
aigon_id: F678
complexity: very-high
set: dashboard-ui-rollout
depends_on:
  [677]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-14T22:10:06.941Z", actor: "cli/feature-prioritise" }
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
- [ ] The status fingerprint (`computeStatusFingerprint` in `lib/dashboard-status-version.js`) includes every contract field whose change must repaint a card, including research, set, autonomous-stage, nested-member, and session inspection changes. Research and set contracts get fingerprint helpers equivalent to the existing `featureUiContractFingerprint`.
- [ ] Malformed or incomplete contracts fail deterministically in tests and produce a diagnosable collector error rather than a partially inferred browser state.
- [ ] Current Pipeline and Monitor visuals and action behavior remain unchanged in this feature.
- [ ] Contract and gallery coverage includes every production resting state and every operator-visible action for feature, research, and feature-set entities.

## Technical Approach

1. Audit the F677 gallery facts against real collector payloads from `lib/dashboard-collect/feature-poll.js`, `collect-research.js`, and `set-cards.js`; add normalized runtime facts rather than gallery-specific exceptions.
2. Project all three entity types through `feature-ui-contract`, `research-ui-contract`, and `feature-set-ui-contract` at the collector boundary.
3. Keep compatibility DTO fields as pure projections from the same contract/action definitions. `buildSetValidActions` survives only as a generated projection of the set contract, per F677. Add assertions that action IDs, target stages, agent ownership, and inspection targets cannot diverge.
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
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1468" height="132" viewBox="0 0 1468 132" role="img" aria-label="Feature dependency graph for feature 678" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-678" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-678)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-678)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-678)"/><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-678)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#678</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">adopt dashboard interacti…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#f3f4f6" stroke="#9ca3af" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#679</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">build responsive dashboar…</text><text x="336" y="90" font-size="12" fill="#475569">inbox</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#f3f4f6" stroke="#9ca3af" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#680</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">roll out responsive dashb…</text><text x="636" y="90" font-size="12" fill="#475569">inbox</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#f3f4f6" stroke="#9ca3af" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#681</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">replace dashboard monitor…</text><text x="936" y="90" font-size="12" fill="#475569">inbox</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#f3f4f6" stroke="#9ca3af" stroke-width="2"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#682</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">complete dashboard ui cut…</text><text x="1236" y="90" font-size="12" fill="#475569">inbox</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
