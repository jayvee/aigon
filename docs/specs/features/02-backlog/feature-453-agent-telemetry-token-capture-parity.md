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
  - { from: "inbox", to: "backlog", at: "2026-04-29T10:23:57.500Z", actor: "cli/feature-prioritise" }
---

# Feature: agent-telemetry-token-capture-parity

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file engine edits, new event types, new dashboard surfaces, judgment-heavy deletion work
       very-high — architectural shifts, write-path-contract changes, new XState transitions, cross-cutting template+engine+frontend
     At start time, model and effort defaults come from each agent's `cli.complexityDefaults[<complexity>]` in
     `templates/agents/<id>.json` (not from this spec). Do not put model IDs in the spec. -->

## Summary

Bring token-usage capture to cc, gg, op (and km when probeable) so F443's tokens-in / tokens-out / $ columns aren't sparse. Currently only cx has a working path: lib/telemetry.parseCodexTranscripts() reads ~/.codex/sessions/*.jsonl files (filtered by session_meta.cwd matching the worktree path, with F438's afterMs cutoff to ignore pre-bench sessions) and aggregates input/cacheReadInput/output/thinking/total/billable tokens plus costUsd and model per session. cc/gg/op runs land tokenUsage: null, which is why the matrix column work (F443) will be mostly empty until this lands. Implementation pattern: mirror parseCodexTranscripts for each agent — parseClaudeCodeTranscripts (reads ~/.claude/projects/<project>/<sessionId>.jsonl, each line has message.usage with input_tokens, cache_read_input_tokens, cache_creation_input_tokens, output_tokens), parseGeminiTranscripts (Gemini CLI session log location TBD — research as part of implementation), parseOpenCodeTranscripts (~/.opencode/ or wherever OpenCode persists sessions). Each returns the same normalised shape so captureAgentTelemetry's dispatch table just adds new entries. Pricing per model needs lookup tables (cx already has these); reuse the same pricing JSON shape. Out of scope: a direct-API-call fallback to bypass the CLI for richer signal (deferred per F442's open question — that's a 'v2' for both quota awareness and telemetry capture). Out of scope: km until it has a headless probe path. Triggered by 2026-04-29 bench sweep where the F438 token-axis only populated for cx, leaving F443 with no data to render for the other agents.

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
