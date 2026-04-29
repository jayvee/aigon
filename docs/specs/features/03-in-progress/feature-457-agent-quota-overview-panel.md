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
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-29T13:31:24.141Z", actor: "cli/feature-prioritise" }
---

# Feature: agent-quota-overview-panel

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file engine edits, new event types, new dashboard surfaces, judgment-heavy deletion work
       very-high — architectural shifts, write-path-contract changes, new XState transitions, cross-cutting template+engine+frontend
     At start time, model and effort defaults come from each agent's `cli.complexityDefaults[<complexity>]` in
     `templates/agents/<id>.json` (not from this spec). Do not put model IDs in the spec. -->

## Summary

Extend the dashboard's existing AGENT QUOTA USAGE panel to cover all 6 agents (cc, cx, gg, op, cu, km) instead of only the 4 with CLI-exposed subscription bars. Today op and cu are silently missing — F444 has verdict data for them at /api/quota but the panel never reads it, so users only discover op depletion when they go to start a feature and see the lock icon in the picker. Two view states: (1) Collapsed — one-line ambient peek showing 'AGENT QUOTA USAGE' + worst-of-all-agents dot + six tiny per-agent dots (cc● cx● gg● op✗ cu○ km●) so the user can scan all agent health without expanding. (2) Expanded — six-card grid (3-column wrap), with cc/cx/gg/km keeping their existing F445 numeric bars unchanged and op/cu getting new F444-verdict cards (status word, model count, reason text from lastProbeOutput / matchedPatternId for depleted; explicit 'not probeable / no headless CLI' for cu and km when they have no probe path). Header gets the worst-of-all dot prepended to the title (already present visually in current panel, just formalised). Five distinct verdict states the panel must render: available (green), depleted (red, with reason sub-line), unknown (yellow, classifier saw output but couldn't classify), error (orange, probe itself failed), not-probeable (grey, agent has no headless CLI). All 6 agents always appear; missing numeric quota is one column being blank, not a hidden row. Pure read-side: /api/quota already returns everything; no engine changes. Implementation footprint ~80-150 LOC of frontend in templates/dashboard/js/actions.js (or wherever the budget widget lives), plus probably some CSS for the new collapsed dot strip. Triggered by 2026-04-29 session where the user's OpenRouter monthly key limit hit and op silently disappeared from view despite F444 capturing the state correctly.

## User Stories
<!-- Specific, stories describing what the user is trying to acheive -->
- [ ]
- [ ]

## Acceptance Criteria
<!-- Specific, testable criteria that define "done" -->
- [ ]
- [ ]

## Validation
<!-- Optional: commands the iterate loop runs after each iteration (in addition to project-level validation).
     Use for feature-specific checks that don't fit in the general test suite.
     All commands must exit 0 for the iteration to be considered successful.
-->
```bash
# Example: node --check aigon-cli.js
```

## Pre-authorised
<!-- Standing orders the agent may enact without stopping to ask.
     Each line is a single bounded permission. The agent cites the matching line
     in a commit footer `Pre-authorised-by: <slug>` for auditability.
     The first line below is a project-wide default — keep it unless the feature
     explicitly demands Playwright runs mid-iterate. Add or remove other lines
     per feature.
     Example extras:
       - May raise `scripts/check-test-budget.sh` CEILING by up to +40 LOC if regression tests require it.
-->
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach
<!-- High-level approach, key decisions, constraints, non-functional requirements -->

## Dependencies
<!-- Other features, external services, or prerequisites.
     For Aigon feature dependencies use: depends_on: feature-name-slug
     This enables ordering enforcement — dependent features can't start until deps are done. -->
-

## Out of Scope
<!-- Explicitly list what this feature does NOT include -->
-

## Open Questions
<!-- Unresolved questions that may need clarification during implementation -->
-

## Related
<!-- Links to research topics, other features, or external docs -->
- Research: <!-- ID and title of the research topic that spawned this feature, if any -->
- Set: <!-- set slug if this feature is part of a set; omit line if standalone -->
- Prior features in set: <!-- feature IDs that precede this one, e.g. F314, F315; omit if standalone -->
