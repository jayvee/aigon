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

# Feature: route-interrupted-set-recovery-to-current-lane

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file changes, new public surfaces, judgment-heavy deletion work
       very-high — architectural shifts, contract-breaking changes, new invariants, cross-cutting work that spans multiple subsystems
     At start time, model and effort defaults come from each agent's complexity-defaults
     table (not from this spec). Do not put model IDs in the spec. -->

## Summary
Render an interrupted feature set's recovery contract in the lane containing its current feature, so the active work and recovery controls cannot disappear from the Pipeline.

## User Stories
- [ ] As an operator, I can see an interrupted set's current feature in its actual workflow lane.
- [ ] As an operator, I can use the set-level recovery controls from that visible card.

## Acceptance Criteria
- [ ] A set whose contract lane has no Pipeline column renders its full contract in the current feature's lane.
- [ ] The embedded current feature and Resume (same agents) action are visible for an interrupted set.
- [ ] The normal running-set lane routing remains unchanged.
- [ ]

## Validation
<!-- Optional: commands the iterate loop runs after each iteration (in addition to project-level validation).
     Use for feature-specific checks that don't fit in the project's general checks.
     All commands must exit 0 for the iteration to be considered successful.
     Leave the block below empty or remove it if there is nothing feature-specific to run. -->
```bash
npm run test:iterate
npx playwright test --config tests/dashboard-e2e/playwright.config.js tests/dashboard-e2e/contract-cards-preview.spec.js
```

## Pre-authorised
<!-- Optional: grant specific policy-gate skips for this feature only.
     Each line is a single bullet authorising one action. When an agent proceeds
     under a line, the commit footer must be `Pre-authorised-by: <slug>` where
     `<slug>` is the slugified line text (lowercase, non-alphanumerics → hyphens).
     Slugs are validated against this section at feature-close — invented footers block close. -->

## Technical Approach
Keep the set contract server-owned. Adjust only Pipeline lane placement: when the contract lane is not a visible feature lane, use the current member's lane as the contract host. Cover the mixed-lane interrupted recovery card with the production renderer test.

## Dependencies
<!-- Other features, external services, or prerequisites.
     For Aigon feature dependencies use: depends_on: feature-name-slug
     This enables ordering enforcement — dependent features can't start until deps are done. -->
- F700 stale autonomous conductor recovery state.

## Out of Scope
<!-- Explicitly list what this feature does NOT include -->
- Changes to feature lifecycle or autonomous execution.

## Open Questions
<!-- Unresolved questions that may need clarification during implementation -->
-

## Related
<!-- Links to research topics, other features, or external docs -->
- Prior work: F700 stale-conductor recovery controls.
<!-- Do NOT add `set:` here or in frontmatter to "join" a completed initiative.
     See .aigon/docs/feature-sets.md § Completed sets — do not rejoin. -->
