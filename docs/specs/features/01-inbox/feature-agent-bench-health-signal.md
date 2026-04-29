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
---

# Feature: agent-bench-health-signal

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file engine edits, new event types, new dashboard surfaces, judgment-heavy deletion work
       very-high — architectural shifts, write-path-contract changes, new XState transitions, cross-cutting template+engine+frontend
     At start time, model and effort defaults come from each agent's `cli.complexityDefaults[<complexity>]` in
     `templates/agents/<id>.json` (not from this spec). Do not put model IDs in the spec. -->

## Summary

Extend F444's quota state model with a benchVerdict dimension so the dashboard agent picker can distinguish 'API responds' from 'model can drive a multi-turn agent loop'. Triggered by 2026-04-29 op sweep where 5 of 11 models passed agent-probe (single-turn PONG) but failed the brewboard bench (10-min timeout): deepseek-chat-v3.1, deepseek-v4-flash, qwen3-next-80b-thinking, nemotron-3-super-120b, glm-5.1. Single-turn health is necessary but not sufficient. Concrete additions: (a) extend F444's per-(agent, model) state with benchVerdict (passed | failed | unknown), lastBenchAt (ISO timestamp), lastBenchSource (path to .aigon/benchmarks/<file>.json), benchTotalMs (number, optional). (b) hydrate from the most recent .aigon/benchmarks/brewboard-* per-pair JSON whose .agent and .model match — pick by timestamp desc, take .ok and .totalMs. (c) dashboard picker renders a third state alongside the existing probe states: green (probe ok + bench passed) → recommend; yellow (probe ok + bench failed OR no bench yet) → show 'never bench-tested' or 'last bench failed at <date>' tooltip; red (probe depleted/error) — unchanged from F444. (d) optional CLI flag aigon agent-probe --include-bench prints the bench column alongside the existing probe verdict. Out of scope: re-running bench from the dashboard (that's perf-bench's job); deciding when bench data is 'too old' to trust (heuristic, defer until needed); coupling bench to feature-start gate (probe gate already exists in F444; bench gate adds friction without obvious wins). Depends on F444 (shipped) and F441 (artifact policy). Pure data-model + read-path extension, no new event types.

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
