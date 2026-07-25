---
complexity: medium
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
# set: my-slug  # optional — ONLY when creating 2+ inbox peers to ship together.
#              #   Run `aigon set list` / `aigon set show <slug>` first. NEVER tag into
#              #   a completed set (all members done). Follow-up work: standalone + depends_on.
---

# Feature: recover-stale-autonomous-set-conductors

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file changes, new public surfaces, judgment-heavy deletion work
       very-high — architectural shifts, contract-breaking changes, new invariants, cross-cutting work that spans multiple subsystems
     At start time, model and effort defaults come from each agent's complexity-defaults
     table (not from this spec). Do not put model IDs in the spec. -->

## Summary
Recover a feature-set autonomous run when its tmux conductor disappears, without misrepresenting already-completed feature work as failed.

## User Stories
- [ ] As an operator, I can see that a set conductor was interrupted rather than falsely shown as running.
- [ ] As an operator, I can resume the interrupted set with the same agents, choose a new pairing, or take over manually without losing completed work.

## Acceptance Criteria
- [ ] A persisted running set with no live tmux session is reconciled to an explicit interrupted state after the startup grace period.
- [ ] An interrupted set exposes Resume (same agents), Resume (choose agents…), Take over manually, and Reset through the server-owned set action contract.
- [ ] The gallery includes the interrupted-conductor recovery state and asserts its available actions.
- [ ] Regression coverage proves that a missing conductor never remains dashboard-running and that recovery actions are available.
- [ ]

## Validation
<!-- Optional: commands the iterate loop runs after each iteration (in addition to project-level validation).
     Use for feature-specific checks that don't fit in the project's general checks.
     All commands must exit 0 for the iteration to be considered successful.
     Leave the block below empty or remove it if there is nothing feature-specific to run. -->
```bash
npm run test:iterate
node tests/integration/auto-session-state.test.js
node tests/integration/dashboard-review-statuses.test.js
node tests/unit/dashboard-card-gallery.test.js
npm run test:gallery
```

## Pre-authorised
<!-- Optional: grant specific policy-gate skips for this feature only.
     Each line is a single bullet authorising one action. When an agent proceeds
     under a line, the commit footer must be `Pre-authorised-by: <slug>` where
     `<slug>` is the slugified line text (lowercase, non-alphanumerics → hyphens).
     Slugs are validated against this section at feature-close — invented footers block close. -->

## Technical Approach
Add a durable stale-running set reconciliation alongside the existing paused-set reconciliation. Project the resulting `interrupted` state through the canonical feature-set interaction definition, so the dashboard renders recovery actions rather than inferring them in browser code. Preserve the existing `set-autonomous-*` command handlers: same-agent resume, choose-agent restart, and stop-as-manual-takeover.

## Dependencies
<!-- Other features, external services, or prerequisites.
     For Aigon feature dependencies use: depends_on: feature-name-slug
     This enables ordering enforcement — dependent features can't start until deps are done. -->
- Existing feature/set autonomous state and dashboard contracts.

## Out of Scope
<!-- Explicitly list what this feature does NOT include -->
- Determining the external process that ended tmux in the historical F698 incident.
- Replaying or changing F698's committed implementation.

## Open Questions
<!-- Unresolved questions that may need clarification during implementation -->
-

## Related
<!-- Links to research topics, other features, or external docs -->
- Prior work: F698 AutoConductor interruption; F646 paused-conductor dashboard recovery.
<!-- Do NOT add `set:` here or in frontmatter to "join" a completed initiative.
     See .aigon/docs/feature-sets.md § Completed sets — do not rejoin. -->
