---
complexity: low
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-07T05:13:29.059Z", actor: "cli/feature-prioritise" }
---

# Feature: agent-spec-creation-guardrails

## Summary

Agents (including Claude Code in the main conversation) have been observed writing spec files directly to `docs/specs/features/01-inbox/` using the `Write` tool, bypassing `aigon feature-create`. This produces snapshotless specs — files that appear on the board but lack workflow engine state, so they can't be started, tracked, or closed correctly. The fix is a single rule added to `templates/docs/development_workflow.md` (the doc every target repo receives), making the constraint explicit where all agents will read it.

## The Problem

`aigon feature-create <name>` does two things: creates the spec file AND bootstraps workflow engine state (a record in `.aigon/workflow/`). The `Write` tool only does the first. When an agent uses `Write` directly, the spec appears in the inbox and on the board, but with no engine state behind it — it shows only a "Prioritise" button and cannot be started, evaluated, or closed through normal workflow transitions.

This happened in practice: F432 and F433 (aigon-pro) and the initial F485/F486 (aigon) were all written directly, discovered only when John noticed the board looked wrong.

Root cause: the rule "never move spec files manually" exists in CLAUDE.md but covers *moving*, not *creating*. No mechanical enforcement existed for creation.

## Solution

Add Key Rule 5 to `templates/docs/development_workflow.md`:

> **Spec creation**: never write spec files directly to `docs/specs/` — always use `aigon feature-create <name>`. Direct writes produce snapshotless specs that appear on the board but cannot be started, tracked, or closed correctly.

This file is installed into every target repo and is the first place all agents read workflow instructions. No hooks, no pre-commit checks — the problem occurs rarely enough that a clear written rule is the proportionate fix.

## User Stories

- [ ] As a worktree agent reading `development_workflow.md`, the spec creation rule is explicit enough that I don't have to infer it

## Acceptance Criteria

- [ ] `templates/docs/development_workflow.md` Key Rules contains an explicit spec-creation rule
- [ ] `aigon feature-create foo` still works correctly

## Validation

```bash
node -c aigon-cli.js
npm test
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Dependencies

- None

## Out of Scope

- Blocking direct writes to other spec folders (02-backlog, 05-done etc.) — those are managed by the CLI and are less error-prone
- Automated repair of existing snapshotless specs (already handled by `aigon doctor --fix`)
