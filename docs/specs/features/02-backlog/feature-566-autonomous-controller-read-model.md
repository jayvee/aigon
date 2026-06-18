---
complexity: medium
set: autonomous-controller-ux
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-18T04:03:40.282Z", actor: "cli/feature-prioritise" }
  - { from: "inbox", to: "backlog", at: "2026-06-18T04:01:09.692Z", actor: "cli/feature-prioritise" }
---

# Feature: autonomous-controller-read-model

## Summary
Expose a stable dashboard read-model DTO for feature AutoConductor state so the UI can distinguish workflow state from controller state. The current card can say `Review failed` while the controller has already failed and exited; this feature creates the server-owned data contract needed to show `Autonomous failed`, the failure reason, timestamps, and recommended recovery context.

## User Stories
- [ ] As an operator, I can tell whether a feature is still autonomously controlled or already in manual recovery.
- [ ] As a dashboard developer, I can consume one normalized controller object instead of reading raw auto sidecar fields in multiple frontend places.

## Acceptance Criteria
- [ ] Feature dashboard payloads include a normalized `autonomousController` object for features with feature-auto sidecar state.
- [ ] The DTO includes at least `status`, `running`, `reason`, `reasonLabel`, `error` (the raw `error.message` written for `uncaught-error` and similar), `sessionName`, `sessionRunning`, `startedAt`, `updatedAt`, `endedAt`, `workflowState`, `mode`, `agents`, `reviewAgent`, and `evalAgent`.
- [ ] The DTO distinguishes `running`, `stopped`, `failed`, `completed`, and quota-paused controller states without relying on workflow lifecycle alone.
- [ ] Failure reasons are mapped to user-facing categories such as setup failure, reviewer exited, timeout, quota, eval failure, and close failure.
- [ ] The DTO includes a `recommendedRecoveryKind` or equivalent stable enum that later UI features can use without parsing labels.
- [ ] Existing `autonomousPlan` data remains backward compatible while the new controller DTO is introduced.

## Validation
```bash
npm run test:core
```

## Technical Approach
- Add a focused read-model helper near the existing auto-state/dashboard read path rather than deriving controller state in frontend code.
- Use `.aigon/state/feature-<id>-auto.json` as the source of truth for controller status, with live tmux lookup only for session liveness.
- Keep raw reason strings available for diagnostics, but expose human labels and categories from server-owned mapping.
- Cover representative sidecar fixtures for `running`, `failed: review-exited-without-signal`, `stopped-by-user`, `completed`, and missing state.

## Dependencies
- Existing feature-auto sidecar state written by `lib/feature-autonomous.js`
- Existing dashboard read-model plumbing in `lib/workflow-read-model.js` / `lib/dashboard-status-collector.js`

## Out of Scope
- Rendering the controller state on cards
- Changing action menu behavior
- Adding controller log access

## Resolved Decisions
- The DTO lives directly on each feature row as `autonomousController`. Nesting it under `autonomousPlan.controller` would couple it to the legacy plan object and threaten the backward-compatibility requirement above; downstream features 567/568 also depend on a stable top-level shape.

## Related
- Set: autonomous-controller-ux
- Prior features in set: none
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1468" height="132" viewBox="0 0 1468 132" role="img" aria-label="Feature dependency graph for feature 566" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-566" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-566)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-566)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-566)"/><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-566)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#566</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">autonomous controller rea…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#567</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">autonomous controller car…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#568</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">autonomous recovery actio…</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#569</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">autonomous recovery popov…</text><text x="936" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#570</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">autonomous controller log…</text><text x="1236" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
