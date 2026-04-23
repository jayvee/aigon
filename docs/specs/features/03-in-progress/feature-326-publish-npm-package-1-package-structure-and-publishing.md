---
complexity: medium
set: publish-npm-package
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-23T13:58:54.766Z", actor: "cli/feature-prioritise" }
---

# Feature: publish-npm-package-1-package-structure-and-publishing

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file engine edits, new event types, new dashboard surfaces, judgment-heavy deletion work
       very-high — architectural shifts, write-path-contract changes, new XState transitions, cross-cutting template+engine+frontend
     At start time, model and effort defaults come from each agent's `cli.complexityDefaults[<complexity>]` in
     `templates/agents/<id>.json` (not from this spec). Do not put model IDs in the spec. -->

## Summary
Define the npm package boundary for Aigon so the CLI can be published and installed as `@aigon/cli` without leaking internal workspace content. This feature establishes the allowlisted publish surface, the entrypoints that remain public, and the safeguards that prevent accidental release of unsupported files.

## User Stories
- As a maintainer, I want to publish only the runtime files needed by the CLI so the npm package stays small and predictable.
- As a maintainer, I want a dry-run and allowlist check before publish so accidental file drift is caught before release.

## Acceptance Criteria
- The package name, bin entrypoint, and public runtime surface are defined for `@aigon/cli`.
- The publish path rejects unallowlisted files and fails before a release is created.
- `npm pack --dry-run` shows only the intended runtime artifacts, not repo-local docs, tests, or workflow state.
- The package documents the supported install and execution entrypoints so downstream release work can rely on them.

## Validation
```bash
npm pack --dry-run
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
Establish a strict file allowlist for published artifacts, keep the CLI entrypoint explicit, and make the publish path verify the packed output before anything is pushed to npm. The implementation should favor fail-fast publish safeguards over broad include patterns so the package stays reproducible.

## Dependencies
- none

## Out of Scope
- release automation, update checks, and onboarding flows

## Open Questions
- Should the package expose any helper libraries publicly, or remain CLI-only?
- Which files, if any, need to remain accessible for global install diagnostics?

## Related
- Research: #38 publish-npm-package
