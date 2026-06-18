---
complexity: medium
set: review-recovery
depends_on:
  [561, 562]
  - cancel-and-rerun-code-review
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-18T02:05:19.192Z", actor: "cli/feature-prioritise" }
---

# Feature: dashboard-review-recovery-flow

## Summary
Build the operator-facing convenience flow on top of the new primitives: from a feature detail or card, the user can stop autonomy, cancel the bad review, and launch a replacement review from one coherent recovery UX. This keeps the core engine/session work separate from the final usability layer while making the feature discoverable enough to test directly on real failures like feature 560.

## User Stories
- [ ] As an operator staring at a failed autonomous review in the dashboard, I can see the recovery actions I need without remembering multiple CLI commands.
- [ ] As an operator, I can trigger a replacement review from the dashboard and choose a different reviewer/model from the same flow.

## Acceptance Criteria
- [ ] The dashboard exposes clear recovery actions for features with autonomous review trouble, using only server-owned valid-actions metadata rather than frontend-only branching.
- [ ] When autonomous state is running, the UI offers a `Take Over Manually` or equivalent action that stops the conductor.
- [ ] When code review is in progress, the UI offers a `Cancel review` action that uses the new code-review cancel primitive.
- [ ] After cancellation, the operator can launch a replacement review with the existing reviewer/model picker flow from the same feature surface.
- [ ] If implemented as a combined convenience action, it is built on top of the two primitives rather than bypassing them.
- [ ] The UI and detail drawer reflect the updated autonomous/review state within one status refresh cycle after each action.

## Validation
```bash
npm test
```

## Technical Approach
- Keep the frontend thin: derive recovery affordances from workflow/read-model state plus feature-auto sidecar state in server-generated `validActions`.
- Reuse existing dashboard action plumbing (`runInteractiveAction`, review launcher, agent-control endpoints) where possible.
- Prefer explicit primitive actions first; if a combined `Re-run review...` affordance is added, make it an orchestration wrapper that sequentially invokes stop autonomy, cancel review, and launch review, not a new workflow special case.
- Ensure wording is crisp enough that the operator can distinguish "stop the conductor" from "kill the reviewer".

## Dependencies
- `autonomous-review-takeover`
- `cancel-and-rerun-code-review`

## Out of Scope
- New workflow lifecycle states for "manual takeover"
- Automatic reviewer/model recommendation logic
- Non-dashboard UX surfaces beyond minimal CLI parity required by the underlying primitives

## Open Questions
- Should the first release stop at separate actions, or include a composed `Re-run review...` action immediately?
- Which surface is authoritative for the recovery flow: board card actions, detail drawer actions, or both?

## Related
- Research: none
- Set: review-recovery
- Prior features in set: autonomous-review-takeover, cancel-and-rerun-code-review
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="568" height="132" viewBox="0 0 568 132" role="img" aria-label="Feature dependency graph for feature 563" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-563" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-563)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#562</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">cancel and rerun code rev…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#563</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">dashboard review recovery…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
