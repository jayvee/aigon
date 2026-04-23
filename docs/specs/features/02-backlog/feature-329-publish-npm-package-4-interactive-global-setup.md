---
complexity: medium
set: publish-npm-package
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-23T13:58:56.117Z", actor: "cli/feature-prioritise" }
---

# Feature: publish-npm-package-4-interactive-global-setup

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file engine edits, new event types, new dashboard surfaces, judgment-heavy deletion work
       very-high — architectural shifts, write-path-contract changes, new XState transitions, cross-cutting template+engine+frontend
     At start time, model and effort defaults come from each agent's `cli.complexityDefaults[<complexity>]` in
     `templates/agents/<id>.json` (not from this spec). Do not put model IDs in the spec. -->

## Summary
Add a first-run setup flow for globally installed Aigon that guides users through the minimum required preferences without requiring manual config editing. The setup should be interactive when a TTY is available and should fall back to deterministic defaults when it is not.

## User Stories
- As a first-time user, I want Aigon to ask me for the basics once so I do not have to hand-edit config files.
- As an automated install or agent-driven install, I want a non-interactive fallback so the setup can finish without waiting for prompts.

## Acceptance Criteria
- The setup flow is interactive only when a terminal is available.
- Non-interactive setup produces a valid default configuration without blocking.
- User preferences captured during setup are stored in Aigon's config layer and can be reused on later runs.
- The flow leaves the repo in a usable state for follow-on prerequisite checks and server startup.

## Validation
```bash
node -c aigon-cli.js
```

## Pre-authorised
<!-- Optional: standing orders the agent may enact without stopping to ask.
     Each line is a single bounded permission. The agent cites the matching line
     in a commit footer `Pre-authorised-by: <slug>` for auditability.
     Absent or blank = no pre-auths; agent stops on every policy gate as normal.
     Example lines:
       - May raise `scripts/check-test-budget.sh` CEILING by up to +40 LOC if regression tests require it.
       - May skip `npm run test:ui` when this feature touches only `lib/` and no dashboard assets.
-->

## Technical Approach
Build the setup as a guided wizard with a non-interactive code path that reuses the same defaults and persistence layer. That keeps global install behavior deterministic while still giving humans a low-friction onboarding path.

## Dependencies
<!-- Other features, external services, or prerequisites.
     For Aigon feature dependencies use: depends_on: feature-name-slug
     This enables ordering enforcement — dependent features can't start until deps are done. -->
- depends_on: publish-npm-package-1-package-structure-and-publishing

## Out of Scope
- prerequisite enforcement and release automation

## Open Questions
- Which preferences are mandatory at install time versus safely deferable to later?

## Related
- Research: #38 publish-npm-package
