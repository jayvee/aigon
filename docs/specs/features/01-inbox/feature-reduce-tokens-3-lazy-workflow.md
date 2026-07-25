---
complexity: high
research: 26
set: reduce-tokens
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-08T02:26:25.623Z", actor: "cli/feature-prioritise" }
---

# Feature: reduce-tokens-3-lazy-workflow

## Summary

Two complementary lazy-loading mechanisms that defer workflow context until it's actually needed. **(a) Workflow Skills extraction:** move Drive/Fleet/Research step-by-step how-to out of agent CLAUDE.md (and the equivalent files for other agents) into dedicated `aigon:*-workflow` Skills. Skills use Anthropic's progressive disclosure model — only ~100 tokens of metadata loads at session start; the full body (<5KB) only loads when the skill triggers. **(b) Feature-spec lazy injection:** add a `UserPromptSubmit` hook that detects `feature N` references in user prompts and injects active feature-spec context once per session, instead of having the whole spec tagging along every turn.

## User Stories
- [ ] As an agent, I do not load Drive/Fleet workflow how-to into my context until the user actually starts that workflow.
- [ ] As a maintainer, when I run `aigon feature-do 42`, the relevant feature spec context arrives via a hook that fires only when the prompt mentions feature 42 — not eagerly attached to every turn from session start.
- [ ] As a maintainer, the cost dashboard (feature 1) shows a per-session input drop on sessions that don't trigger the lazy paths, with no quality regression on sessions that do.

## Acceptance Criteria
- [ ] `aigon:drive-workflow`, `aigon:fleet-workflow`, `aigon:research-workflow` (and any agent-specific equivalents) registered as Skills with concise metadata (name + description ≤ 80 chars).
- [ ] Skill bodies contain the step-by-step content moved out of agent core files in feature 2; both files cross-reference each other.
- [ ] `UserPromptSubmit` hook implemented (in the Aigon CLI / `.claude/settings.json`) that scans the user's submitted prompt for `feature N` (or `feat N` / `#N`) references and injects spec context for the matched feature(s) via `additionalContext`. Once-per-session dedup via session-state file.
- [ ] Hook gracefully no-ops when no feature reference is found, when the spec is missing, or when the spec is already in context.
- [ ] Telemetry (feature 1) shows the lazy injection fires only on relevant turns and the per-session input total drops on idle sessions.
- [ ] Existing slash commands continue to work — Skills metadata is additive, not replacing the user-invocable slash entry points.

## Technical Approach

**Skills extraction** is mostly a content move plus a manifest update. Anthropic's docs are explicit: the metadata is what's always-loaded; the body fetches on trigger via the Skill tool. This pairs naturally with feature 2's slim agent files — the extracted content needs a home.

**UserPromptSubmit hook** is new plumbing. The hook reads the user prompt, regex-matches feature references, looks up the matching spec under `docs/specs/features/**/feature-{slug}.md` (or by id if numeric), and emits `additionalContext` containing the spec body. State file at `.aigon/workflows/features/{id}/.lazy-injected` (per session) prevents double-injection. Per Anthropic's Hooks docs, this is the right primitive — `PreCompact` cannot rewrite the transcript, only `UserPromptSubmit` and friends can shape what enters context.

For non-Claude agents (Codex, Cursor, Gemini), follow each agent's hook surface (`SessionStart` / `sessionStart` / `AfterAgent` per cx's findings) — feature parity may be partial; document gaps.

## Dependencies
- depends_on: reduce-tokens-2-slim-instructions

## Out of Scope
- `PreCompact` snapshot hook (deferred to a follow-up; pattern noted from context-mode).
- LLMLingua / lossy compression of spec content. Specs stay verbatim; only when they enter context changes.
- Auto-detecting "implicit" feature references (e.g. spec slug mentions). Stick to explicit `feature N` / `#N` patterns.

## Open Questions
- Should the hook also lazy-inject the implementation log when the user references an in-progress feature? Open — would help iteration but doubles the footprint per match.

## Related
- Research: #26 reduce-token-usage
- Set: reduce-tokens
- Prior features in set: reduce-tokens-1-cost-dashboard, reduce-tokens-2-slim-instructions
