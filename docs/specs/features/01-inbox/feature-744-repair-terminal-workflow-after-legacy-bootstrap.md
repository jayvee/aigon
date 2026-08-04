---
aigon_id: F744
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

# Feature: repair-terminal-workflow-after-legacy-bootstrap

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file changes, new public surfaces, judgment-heavy deletion work
       very-high — architectural shifts, contract-breaking changes, new invariants, cross-cutting work that spans multiple subsystems
     At start time, model and effort defaults come from each agent's complexity-defaults
     table (not from this spec). Do not put model IDs in the spec. -->

## Summary

Prevent missing-snapshot recovery from resurrecting completed entities, and let repair restore terminal lifecycle history without deleting work.

## User Stories

- [ ] As an operator, I can rebuild a missing workflow snapshot without completed work reappearing as active.
- [ ] As an operator, I can repair a legacy terminal-state regression while preserving the spec, findings, and append-only audit history.

## Acceptance Criteria

- [ ] When `events.jsonl` exists but `snapshot.json` is missing, bootstrap recovery projects the existing events instead of synthesising state from the lifecycle folder.
- [ ] `aigon repair research <ID>` detects a completed research stream followed only by a legacy bootstrap/lease tail and restores it to Done with an auditable correction event.
- [ ] Repair reconciles the visible spec to Done and preserves research findings.
- [ ] Other mismatches remain subject to the existing conservative repair behavior.
- [ ] Focused regression tests cover missing-snapshot replay and terminal-state repair.

## Validation
<!-- Optional: commands the iterate loop runs after each iteration (in addition to project-level validation).
     Use for feature-specific checks that don't fit in the project's general checks.
     All commands must exit 0 for the iteration to be considered successful.
     Leave the block below empty or remove it if there is nothing feature-specific to run. -->
```bash
npm run test:iterate
```

## Pre-authorised
<!-- Optional: grant specific policy-gate skips for this feature only.
     Each line is a single bullet authorising one action. When an agent proceeds
     under a line, the commit footer must be `Pre-authorised-by: <slug>` where
     `<slug>` is the slugified line text (lowercase, non-alphanumerics → hyphens).
     Slugs are validated against this section at feature-close — invented footers block close. -->

## Technical Approach

- Rebuild missing snapshots by projecting the existing canonical event stream through workflow-core.
- Extend the repair command with a narrowly guarded terminal-regression diagnosis: a prior terminal event followed only by bootstrap and lease metadata.
- Append a normal bootstrap correction at lifecycle `done` through workflow-core persistence, then run existing spec reconciliation and stale-state cleanup.

## Dependencies

- Existing workflow-core projection, SpecStore persistence, and `aigon repair` reconciliation.

## Out of Scope

- Rewriting or deleting historical events.
- General automatic resolution of ambiguous workflow drift.
- Resetting or deleting research findings.

## Open Questions

- None.

## Related
- Incident: restored Machine B showed completed R29 and R52 as active after vault recovery.
- Prior work: F740-F742 backup integrity and dashboard recency fixes.
<!-- Do NOT add `set:` here or in frontmatter to "join" a completed initiative.
     See .aigon/docs/feature-sets.md § Completed sets — do not rejoin. -->
