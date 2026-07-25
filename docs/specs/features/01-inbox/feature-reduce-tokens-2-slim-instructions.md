---
complexity: medium
research: 26
set: reduce-tokens
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-08T02:26:25.436Z", actor: "cli/feature-prioritise" }
---

# Feature: reduce-tokens-2-slim-instructions

## Summary

The always-loaded agent instruction files are the largest steady-state token sink. `.aigon/docs/agents/claude.md` (auto-loaded by Claude Code as project memory) is 144 lines / ~1,900 tokens. Codex `AGENTS.md` is 327 lines / ~7,800 tokens. Audit shows ~70-75% of that content is workflow how-to (Drive/Fleet step-by-steps, command tables) that's only relevant when actually running a command — it doesn't need to be in the always-on context. This feature trims those files to a 30-50-line core and ships an `instructions_verbosity: compact | standard | verbose` config option that also drives compact/standard/verbose rendering of the inlined command templates non-slash agents (cx, op, km) receive at launch via `lib/agent-prompt-resolver.js`.

This feature also includes a one-time cleanup of the aigon-pro `AGENTS.md`: the repo-split reference block (~35 lines of counter behaviour, backup paths, pre-split HEAD hash) is static archive material that rarely needs to be in active context. It should be condensed to a pointer and moved to an on-demand doc at `.aigon/docs/repo-split-context.md`.

## User Stories
- [ ] As a maintainer, I can set `instructions_verbosity: compact` in `.aigon/config.json` and every agent session loads a slim core without losing universal rules.
- [ ] As a Codex / OpenCode / Kimi user, I can see that the inlined command template I receive at launch is rendered in the requested verbosity.
- [ ] As a maintainer, after enabling compact mode, the cost dashboard shows a measurable drop in per-session input tokens with no regression in agent task success.

## Acceptance Criteria
- [ ] `.aigon/docs/agents/{claude,codex,gemini,cursor,opencode,kimi}.md` files have a slim core (~30-50 lines / ~400-500 tokens) covering: identity, modes, universal rules, "where to look for X" pointers.
- [ ] All workflow how-to content removed from those core files lives in on-demand docs (the lazy-workflow feature consumes these).
- [ ] `instructions_verbosity` config knob accepted in `.aigon/config.json` with values `compact | standard | verbose`; default = `standard` (current behaviour).
- [ ] `lib/agent-prompt-resolver.js` renders command templates at the requested verbosity for non-slash agents.
- [ ] Existing tests pass; a new test verifies the slim files stay under the line budget so future drift triggers CI failure.
- [ ] Token-cost dashboard (feature 1) shows per-agent input drop after toggling to `compact`.
- [ ] **aigon-pro**: `AGENTS.md` repo-split block condensed to a single pointer line; full split context (counter behaviour, backup paths, pre-split HEAD hash, recovery notes) moved to `.aigon/docs/repo-split-context.md` (on-demand, not auto-loaded). `AGENTS.md` line count drops from ~74 to ~40.

## Technical Approach

Two parts: content audit and rendering plumbing.

**Content audit.** For each `.aigon/docs/agents/*.md`, identify the universal/always-needed content (~14% of current bulk per cc's audit). Move the rest into on-demand docs that lazy-workflow (#3) will reference via Skills metadata. Keep `CLAUDE.md` as a small import/pointer pattern per Anthropic's recommendation — but the imported targets must stay compact.

**aigon-pro AGENTS.md cleanup.** The repo-split section is reference material (it documents the 2026-04-07 split, counter seeding, backup tarball paths, pre-split HEAD hash). None of this is needed during normal agent operation — only when onboarding or recovering. Extract to `.aigon/docs/repo-split-context.md` and replace the section in `AGENTS.md` with a one-liner: `Repo split context (counter behaviour, backup paths): .aigon/docs/repo-split-context.md`. This is a one-time content move with no config plumbing required.

**Rendering plumbing.** `lib/agent-prompt-resolver.js` already inlines command templates for non-slash agents. Thread a verbosity parameter through the resolver and templating layer. Templates expose conditional sections (e.g. `<!-- if verbose -->`) that the renderer keeps or strips. Deterministic template rendering, not lossy model-side compression.

Validate by toggling `compact` and running a baseline workflow (feature-do, research-do, code-review) end-to-end — telemetry from feature 1 confirms savings and surfaces any task-quality regression.

## Dependencies
- depends_on: reduce-tokens-1-cost-dashboard

## Out of Scope
- Skills extraction of workflow how-to (covered by feature 3, lazy-workflow).
- Lossy model-side compression (rejected by both research agents — caveman-speak corrupts downstream document-driven workflow).
- Fleet context sharing between agents.

## Open Questions
- Should `compact` be the default once stable, or stay opt-in indefinitely? Recommend: stay opt-in until feature 1's data backs the case.

## Related
- Research: #26 reduce-token-usage
- Set: reduce-tokens
- Prior features in set: reduce-tokens-1-cost-dashboard
