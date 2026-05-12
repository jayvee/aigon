---
complexity: medium
set: fleet-startup
# agent: cc    # optional — id of the agent that owns this spec. Used as the
#              #   default reviewer for spec-revise cycles when the operator
#              #   does not pick one explicitly. Precedence at revision time:
#              #     event payload nextReviewerId > frontmatter agent:
#              #     > snapshot.authorAgentId > getDefaultAgent().
# research: 44 # optional — id (or list of ids) of the research topic that
#              #   spawned this feature. Stamped automatically by `research-eval`
#              #   on features it creates. Surfaced in the dashboard research
#              #   detail panel under Agent Log → FEATURES.
# planning_context: ~/.claude/plans/your-plan.md  # optional — path(s) to plan file(s)
#              #   generated during an interactive planning session (e.g. EnterPlanMode).
#              #   Content is injected into the agent's context at feature-do time and
#              #   copied into the implementation log at feature-start for durability.
#              #   Set this whenever you ran plan mode before writing the spec.
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-12T10:06:27.797Z", actor: "cli/feature-prioritise" }
---

# Feature: startup-phase-ui

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file changes, new public surfaces, judgment-heavy deletion work
       very-high — architectural shifts, contract-breaking changes, new invariants, cross-cutting work that spans multiple subsystems
     At start time, model and effort defaults come from each agent's complexity-defaults
     table (not from this spec). Do not put model IDs in the spec. -->

## Summary
The dashboard already moves a feature card from Backlog to In Progress optimistically as soon as the user clicks Start, but the card then sits there with no visible explanation while worktrees and agent sessions are being prepared. This feature adds a transient startup-phase label to the optimistic in-progress card so users can see that startup is actively underway rather than assuming the UI is stuck.

## User Stories
- [ ] As a user starting a feature from the dashboard, I immediately see that setup is in progress rather than a static in-progress card.
- [ ] As someone recording a demo, I can show visible progress during startup even before the first real agent heartbeat arrives.

## Acceptance Criteria
- [ ] When the dashboard sends a `feature-start` or `research-start` action, the optimistic card state carries a transient startup phase in addition to the optimistic stage move.
- [ ] The card renders one of three operator-approved labels during startup: `Setting up`, `Preparing worktrees`, or `Launching agents`.
- [ ] The transient startup phase is shown only while the start action is in flight or until authoritative runtime state supersedes it; it does not persist once real agent status/heartbeat data arrives.
- [ ] If the start action fails, the optimistic startup phase is cleared and the card rolls back consistently with the existing optimistic action error handling.
- [ ] Periodic `/api/status` and `/api/refresh` responses do not accidentally erase the startup-phase label while the action is still pending.
- [ ] The implementation does not introduce any new fake backend lifecycle states; this is a client-side render/status layer only.

## Validation
```bash
npm test
```

## Technical Approach
Extend the existing optimistic dashboard state for start actions so the pending action stores both an optimistic stage transition and a short-lived `startupPhase`. Keep the implementation frontend-only: no new engine states, no changes to workflow-core, and no server-owned lifecycle mutations. The render logic should prefer authoritative backend state when present, but retain the transient startup label while the start request is outstanding. Reuse the existing optimistic action plumbing added in the earlier kanban-start work rather than adding a second parallel status mechanism.

## Dependencies
- none

## Out of Scope
- Reducing actual `feature-start` wall-clock time.
- Changing workflow-core lifecycle states or adding a real `setup` lifecycle.
- Reducing agent boot time after tmux sessions already exist.

## Open Questions
- Should the UI advance through all three labels on a timer, or is a single stable label such as `Setting up` sufficient for v1?
- Should the same transient startup-phase treatment apply to set-level starts and autonomous starts in later work, or only direct feature/research starts for now?

## Related
- Research:
- Set: `fleet-startup`
- Prior features in set: none
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="132" viewBox="0 0 868 132" role="img" aria-label="Feature dependency graph for feature 527" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-527" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-527)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-527)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#527</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">startup phase ui</text><text x="36" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#528</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">feature start critical pa…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#529</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">agent ready latency</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
