---
complexity: medium
set: autonomous-controller-ux
depends_on: [568]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-18T04:03:41.198Z", actor: "cli/feature-prioritise" }
  - { from: "inbox", to: "backlog", at: "2026-06-18T04:01:11.341Z", actor: "cli/feature-prioritise" }
---

# Feature: autonomous-recovery-popover

## Summary
Build the dashboard recovery popover or drawer section behind the single `Recover` action. The UI should explain what failed, recommend the next operator action, group secondary diagnostics, and keep destructive operations separated.

## User Stories
- [ ] As an operator, when an autonomous run fails, I can click `Recover` and see the specific next step rather than inspect logs manually.
- [ ] As an operator, I can tell which sessions are alive or dead before choosing whether to cancel, rerun, close, or reset.

## Acceptance Criteria
- [ ] Clicking the recovery action opens a focused recovery surface with controller status, raw reason, human reason, last update, and session liveness.
- [ ] The surface has a clear recommended action area, a secondary actions area, a diagnostics area, and a destructive area.
- [ ] For `review-exited-without-signal`, the recommended action is `Cancel review`, followed by a visible path to `Re-run code review`.
- [ ] For eval and close failure categories, the surface shows appropriate placeholders/actions based on available current commands and does not invent unsupported behavior.
- [ ] The popover/drawer works from both card actions and detail drawer action surfaces.
- [ ] The existing overflow menu remains smaller because controller-specific actions are grouped under recovery.

## Validation
```bash
npm run test:iterate
```
Run `npm run test:browser:smoke` when dashboard files change (the iterate gate triggers it automatically on dashboard edits).

## Technical Approach
- Consume the action payload produced by `autonomous-recovery-action-model`.
- Use existing dashboard modal/popover helpers and existing command execution routes.
- Keep visual design operational and compact: no new large panel unless the existing drawer is the chosen surface.
- Add targeted UI/module tests for the action payload mapping if the repo has suitable dashboard JS test coverage.

## Dependencies
- `autonomous-recovery-action-model`

## Out of Scope
- Durable controller log access
- New backend commands beyond already available recovery primitives
- Automatic recovery execution without operator confirmation

## Open Questions
- Popover-anchored-to-card vs modal? (A pure detail-drawer section is ruled out by the acceptance criterion that recovery must be reachable from both card actions and the detail drawer — the surface needs a card-side entry point. Choose between an anchored popover and a modal during implementation.)

## Related
- Set: autonomous-controller-ux
- Prior features in set: autonomous-controller-read-model, autonomous-controller-card-status, autonomous-recovery-action-model
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1468" height="132" viewBox="0 0 1468 132" role="img" aria-label="Feature dependency graph for feature 569" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-569" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-569)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-569)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-569)"/><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-569)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#566</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">autonomous controller rea…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#567</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">autonomous controller car…</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#568</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">autonomous recovery actio…</text><text x="636" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#f59e0b" stroke-width="3"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#569</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">autonomous recovery popov…</text><text x="936" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#570</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">autonomous controller log…</text><text x="1236" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
