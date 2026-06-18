---
complexity: high
set: review-recovery
depends_on:
  [561]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-18T02:05:18.936Z", actor: "cli/feature-prioritise" }
---

# Feature: cancel-and-rerun-code-review

## Summary
Add a first-class code-review recovery primitive: cancel the current code-review cycle, kill its reviewer session, return the feature to a review-launchable resting state, and allow a fresh review to be started with a different reviewer and/or model. Today spec review has explicit cancel semantics while code review does not; this closes that gap and gives operators a clean path when a review fails, stalls, or uses the wrong reviewer configuration.

## User Stories
- [ ] As an operator, when a feature is stuck in `code_review_in_progress`, I can cancel that review without resetting the whole feature.
- [ ] As an operator, after cancelling a bad review, I can immediately launch a new code review with a different reviewer or launcher model/effort.

## Acceptance Criteria
- [ ] Code review gains explicit cancel semantics parallel to spec review, including workflow support, projector support, and a visible manual action when `currentSpecState === 'code_review_in_progress'`.
- [ ] Cancelling code review kills the active review tmux session if one exists and records durable state so the previous reviewer is no longer treated as active.
- [ ] After cancellation, the feature returns to `ready` rather than remaining stuck in `code_review_in_progress`.
- [ ] After cancellation, the normal `feature-code-review` launch path is available again and can be run with a different reviewer and/or dashboard-provided launcher model/effort.
- [ ] Autonomous runs that were previously stopped manually can use this flow without the conductor restarting or reasserting review behavior.
- [ ] Review read-model/dashboard surfaces no longer show a cancelled cycle as the active in-progress review, but prior completed cycles remain visible in history.
- [ ] Tests cover event application and action derivation for the new cancel path.

## Validation
```bash
npm test
```

## Technical Approach
- Introduce a new workflow event for code-review cancellation rather than overloading existing completion or revision events.
- Extend feature workflow rules, engine event handling, and projector logic so `feature.code_review.cancelled` is only valid from `code_review_in_progress` and transitions the feature back to `ready`.
- Preserve completed review history; cancellation should clear the active in-progress reviewer, not erase prior cycles.
- Reuse existing dashboard review launch behavior (`handleLaunchReview`, reviewer/model pickers) for the re-run path instead of inventing a separate "rerun review" engine concept.
- Add command and/or dashboard plumbing for killing the review session using the same tmux/session-sidecar boundary Aigon already uses elsewhere.

## Dependencies
- `autonomous-review-takeover` for the clean "stop conductor first, then recover review manually" operator path
- Existing code review lifecycle machinery (`feature.code_review.started`, `feature.code_review.completed`, review read-model, dashboard review launcher)

## Out of Scope
- A single-click combined UI that both cancels and relaunches review in one gesture
- Fleet eval recovery flows
- Auto-selecting a "better" reviewer/model; the operator remains explicit

## Open Questions
- Should cancelling code review always land in `ready`, or are there edge cases where returning to `implementing` is more correct?
- Do we want a dedicated `feature-cancel-code-review` CLI command, or should this ship dashboard-first with matching backend action plumbing and CLI follow immediately after?

## Related
- Research: none
- Set: review-recovery
- Prior features in set: autonomous-review-takeover
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="568" height="132" viewBox="0 0 568 132" role="img" aria-label="Feature dependency graph for feature 562" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-562" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-562)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#562</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">cancel and rerun code rev…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#563</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">dashboard review recovery…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
