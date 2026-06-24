---
complexity: medium
set: autonomous-controller-ux
depends_on: [567]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-18T04:03:40.892Z", actor: "cli/feature-prioritise" }
  - { from: "inbox", to: "backlog", at: "2026-06-18T04:01:10.815Z", actor: "cli/feature-prioritise" }
---

# Feature: autonomous-recovery-action-model

## Summary
Introduce a server-owned recovery action model for autonomous controller failures without creating a dead-end UI before the recovery surface exists. This feature adds the stable `Recover` action payload and recommended-operation model while keeping the existing primitive recovery actions visible; feature 569 then uses the payload to render the recovery surface and collapse the now-redundant peers.

## User Stories
- [ ] As an operator, I get a reliable recovery recommendation model before the final grouped recovery UI replaces the scattered actions.
- [ ] As a dashboard developer, I can route recovery UI from one action payload that includes recommended and secondary actions.

## Acceptance Criteria
- [ ] This feature evolves the existing recovery layer in `lib/feature-review-recovery-dashboard-actions.js` (already wired into `lib/workflow-read-model.js`) rather than adding a parallel one. The current module tags primitives with `metadata.recovery: true` and relabels them; this feature extends that module in place to also produce a stable recovery payload for the future grouped UI.
- [ ] Dashboard validActions include an `autonomous-recover` or equivalent action when `autonomousController.status` indicates failed/stopped recovery is relevant.
- [ ] The action payload includes the recommended recovery kind and a list of available recovery operations, such as cancel review, re-run review, take over manually, retry close, or reset.
- [ ] Existing primitive commands remain callable, testable, and visible as peer actions during this transitional feature so the dashboard has no dead-end state before feature 569 ships.
- [ ] The payload marks which primitive actions are recovery operations so feature 569 can hide or group those peers behind the recovery surface without re-deriving recovery semantics.
- [ ] For a feature like 560, the recommended action is cancel review, with re-run review as the next step after cancellation.
- [ ] Destructive actions remain marked destructive and are not promoted as the primary recovery recommendation.
- [ ] Existing non-autonomous feature action behavior remains unchanged.

## Validation
```bash
npm run test:core
```

## Technical Approach
- Evolve `lib/feature-review-recovery-dashboard-actions.js` rather than adding a sibling module. It already detects recovery context (`isFeatureReviewRecoveryContext`, `isFeatureAutonomousActive`) and tags/relabels primitives; this feature adds the grouped recovery payload there while preserving the primitive peer actions until feature 569 renders the grouped recovery UI.
- Drive the recommended recovery kind from `autonomousController` (introduced in 566) plus the current workflow snapshot, replacing the ad-hoc relabel logic currently keyed off `snapshot.currentSpecState`/`codeReview.cancelledAt`.
- Keep the frontend thin: it should render `Recover` and pass the payload into the recovery UI rather than infer failure semantics itself.
- Preserve action-command mapping for existing primitive commands; change the server-owned action model now, and defer final presentation collapse to feature 569.
- Add tests for failed review, stopped-by-user, running controller, and non-autonomous feature cases.

## Dependencies
- `autonomous-controller-card-status`

## Out of Scope
- Building the recovery popover UI
- Controller log access
- Adding resume/restart autonomy semantics

## Resolved Decisions
- This is a transitional model feature, not the final menu-collapse feature. The primitive recovery actions (e.g. `Cancel review`) remain visible/callable until the recovery popover ships in feature 569. Collapsing them behind `Recover` before there is a surface to expose them would create a dead-end state. Feature 569 owns hiding/grouping the redundant primitive peers once the recovery surface can execute the payload operations.

## Related
- Set: autonomous-controller-ux
- Prior features in set: autonomous-controller-read-model, autonomous-controller-card-status
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1468" height="132" viewBox="0 0 1468 132" role="img" aria-label="Feature dependency graph for feature 568" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-568" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-568)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-568)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-568)"/><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-568)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#566</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">autonomous controller rea…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#567</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">autonomous controller car…</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#f59e0b" stroke-width="3"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#568</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">autonomous recovery actio…</text><text x="636" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#569</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">autonomous recovery popov…</text><text x="936" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#570</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">autonomous controller log…</text><text x="1236" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
