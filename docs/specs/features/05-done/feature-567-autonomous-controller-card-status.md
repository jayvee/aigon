---
complexity: medium
set: autonomous-controller-ux
depends_on: [566]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-18T04:03:40.601Z", actor: "cli/feature-prioritise" }
  - { from: "inbox", to: "backlog", at: "2026-06-18T04:01:10.290Z", actor: "cli/feature-prioritise" }
---

# Feature: autonomous-controller-card-status

## Summary
Render AutoConductor controller status directly on feature cards so operators can see when autonomy is running, stopped, completed, or failed. The goal is to make a state like feature 560 legible: workflow review is stuck, but the autonomous controller has already failed and exited.

## User Stories
- [ ] As an operator, when an autonomous run fails, I can see the controller failure on the card without opening files or guessing from workflow state.
- [ ] As an operator, I can distinguish `Review failed` from `Autonomous failed` and understand which layer needs recovery.

## Acceptance Criteria
- [ ] Cards render a compact controller status block when `autonomousController` is present and relevant.
- [ ] Failed controller state shows `Autonomous failed`, a short user-facing reason, last update, and session liveness.
- [ ] Running controller state remains compact and does not crowd normal workflow stage display.
- [ ] Stopped-by-user state reads as manual mode/taken over, not as an error.
- [ ] Completed controller state does not add noise to done features.
- [ ] When the controller DTO reports `status: failed`, it reconciles with the `autonomousPlan.stages`-derived headline produced by `lib/card-headline.js` so the card does not render two contradictory failure strings (e.g. `Review failed` from the stage plan alongside `Autonomous failed` from the controller). Controller terminal status is authoritative.
- [ ] The card still fits current board dimensions without pushing core action buttons off the visible card.

## Validation
```bash
npm run test:iterate
```
Run `npm run test:browser:smoke` when dashboard files change (the iterate gate triggers it automatically on dashboard edits).

## Technical Approach
- Render from the server-owned controller DTO introduced by `autonomous-controller-read-model`.
- Treat controller status as a sibling to workflow stage display, not as another flat action row.
- Use existing dashboard CSS patterns and compact card typography; do not introduce a new visual system.
- Include a targeted dashboard/read-model test or fixture for a failed controller with `review-exited-without-signal`.

## Dependencies
- `autonomous-controller-read-model`

## Out of Scope
- Recovery popover behavior
- Controller log viewing
- Changing which actions are exposed

## Open Questions
- Should the status block appear only for non-running terminal controller states, or also while autonomy is actively running?

## Related
- Set: autonomous-controller-ux
- Prior features in set: autonomous-controller-read-model
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1468" height="132" viewBox="0 0 1468 132" role="img" aria-label="Feature dependency graph for feature 567" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-567" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-567)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-567)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-567)"/><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-567)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#566</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">autonomous controller rea…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#567</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">autonomous controller car…</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#568</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">autonomous recovery actio…</text><text x="636" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#569</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">autonomous recovery popov…</text><text x="936" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#570</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">autonomous controller log…</text><text x="1236" y="90" font-size="12" fill="#475569">in-progress</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
