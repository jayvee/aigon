---
aigon_id: F742
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
transitions:
  - { from: "inbox", to: "backlog", at: "2026-08-04T13:46:44.727Z", actor: "cli/feature-prioritise" }
---

# Feature: research-dashboard-recent-first-ordering

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file changes, new public surfaces, judgment-heavy deletion work
       very-high — architectural shifts, contract-breaking changes, new invariants, cross-cutting work that spans multiple subsystems
     At start time, model and effort defaults come from each agent's complexity-defaults
     table (not from this spec). Do not put model IDs in the spec. -->

## Summary

Order active research pipeline cards by most recent creation time so newly
created topics are immediately visible above the Inbox overflow cap. Numeric
research IDs must not force old topics ahead of newer work.

## User Stories
<!-- Specific, stories describing what the user is trying to acheive -->
- [ ] As an operator, I see my newest research topic first in its active lane.
- [ ] As an operator, a newly created topic is not hidden behind older numbered cards and the overflow control.

## Acceptance Criteria
<!-- Specific, testable criteria that define "done" -->
- [ ] Non-closed research lanes sort by `createdAt`, falling back to `updatedAt`, newest first.
- [ ] Equal timestamps use deterministic ID/name tie-breakers.
- [ ] Feature ordering and closed-item ordering remain unchanged.
- [ ] Regression coverage pins R67 ahead of older numeric and unnumbered research topics.

## Validation
<!-- Optional: commands the iterate loop runs after each iteration (in addition to project-level validation).
     Use for feature-specific checks that don't fit in the project's general checks.
     All commands must exit 0 for the iteration to be considered successful.
     Leave the block below empty or remove it if there is nothing feature-specific to run. -->
```bash
node tests/unit/dashboard-pipeline-order.test.js
npm run test:iterate
```

## Pre-authorised
<!-- Optional: grant specific policy-gate skips for this feature only.
     Each line is a single bullet authorising one action. When an agent proceeds
     under a line, the commit footer must be `Pre-authorised-by: <slug>` where
     `<slug>` is the slugified line text (lowercase, non-alphanumerics → hyphens).
     Slugs are validated against this section at feature-close — invented footers block close. -->

## Technical Approach

- Pass the pipeline entity type into the existing card sorter.
- Apply recent-first timestamp ordering only to non-closed research lanes.
- Preserve the current feature priority and closed recency contracts.

## Dependencies
<!-- Other features, external services, or prerequisites.
     For Aigon feature dependencies use: depends_on: feature-name-slug
     This enables ordering enforcement — dependent features can't start until deps are done. -->
- Existing dashboard pipeline card sorter and overflow cap.

## Out of Scope
<!-- Explicitly list what this feature does NOT include -->
- Changing feature ordering.
- Changing lifecycle state, actions, or the server read model.

## Open Questions
<!-- Unresolved questions that may need clarification during implementation -->
- None.

## Related
<!-- Links to research topics, other features, or external docs -->
- Incident: restored R67 existed in the API but was hidden behind 15 older Inbox cards.
<!-- Do NOT add `set:` here or in frontmatter to "join" a completed initiative.
     See .aigon/docs/feature-sets.md § Completed sets — do not rejoin. -->
