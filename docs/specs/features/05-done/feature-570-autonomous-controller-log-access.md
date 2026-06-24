---
complexity: medium
set: autonomous-controller-ux
depends_on: [569]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-18T04:03:41.603Z", actor: "cli/feature-prioritise" }
  - { from: "inbox", to: "backlog", at: "2026-06-18T04:01:11.909Z", actor: "cli/feature-prioritise" }
---

# Feature: autonomous-controller-log-access

## Summary
Make AutoConductor logs accessible from the dashboard recovery UI. When the controller fails, operators should be able to inspect the controller output that explains why it exited, without attaching to a dead tmux session or finding sidecar files manually.

## User Stories
- [ ] As an operator, when an autonomous run fails, I can open the controller log from the dashboard.
- [ ] As an operator, I can distinguish controller output from implementer, reviewer, and eval agent output.

## Acceptance Criteria
- [ ] Feature auto sidecar state or session metadata includes enough information to locate the last controller log after the tmux session exits.
- [ ] Dashboard recovery UI exposes `View controller log` when a log is available.
- [ ] The log view clearly labels controller status, feature ID, session name, and captured output.
- [ ] Missing logs produce a clear unavailable state, not a broken button.
- [ ] Existing agent session transcript/log surfaces are reused where appropriate instead of creating a parallel log system.
- [ ] Tests or fixtures cover available and missing controller log cases.

## Validation
```bash
npm run test:core
```

## Technical Approach
- **Gated pre-audit (do before committing implementation):** determine whether `role: auto` tmux sessions are captured durably enough to resolve their last output after the session exits. If they are not, this feature's scope changes — it splits into (a) extending capture/retention for `role: auto` and (b) the dashboard log-view surface. Resolve this before writing the UI.
- First audit existing tmux capture/session-sidecar behavior for `role: auto` sessions.
- Prefer storing or resolving a durable pointer from the existing `.aigon/sessions` sidecar or capture path rather than inventing a new log location.
- Wire the dashboard detail/recovery view to fetch and display the controller log through an existing safe route if possible.
- Keep this separate from the first four UX features because log plumbing can touch session capture and retention behavior.

## Dependencies
- `autonomous-recovery-popover`

## Out of Scope
- Live streaming controller logs while the run is still active
- Changing agent transcript capture for implementer/reviewer sessions
- Adding persistent cloud log storage

## Open Questions
- (Tracked as the gated pre-audit in Technical Approach above — must be answered before implementation, not carried through it.)

## Related
- Set: autonomous-controller-ux
- Prior features in set: autonomous-controller-read-model, autonomous-controller-card-status, autonomous-recovery-action-model, autonomous-recovery-popover
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1468" height="132" viewBox="0 0 1468 132" role="img" aria-label="Feature dependency graph for feature 570" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-570" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-570)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-570)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-570)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-570)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#566</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">autonomous controller rea…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#567</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">autonomous controller car…</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#568</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">autonomous recovery actio…</text><text x="636" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#569</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">autonomous recovery popov…</text><text x="936" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#f59e0b" stroke-width="3"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#570</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">autonomous controller log…</text><text x="1236" y="90" font-size="12" fill="#475569">done</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
