---
complexity: low
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-07T05:13:29.059Z", actor: "cli/feature-prioritise" }
---

# Feature: agent-spec-creation-guardrails

## Summary

Agents (including Claude Code in the main conversation) have been observed writing spec files directly to `docs/specs/features/01-inbox/` using the `Write` tool, bypassing `aigon feature-create`. This produces snapshotless specs — files that appear on the board but lack workflow engine state, so they can't be started, tracked, or closed correctly. The fix is layered: a `PreToolUse` hook that blocks the wrong path at the moment of the tool call, a `pre-commit` hook that catches anything that slips through, and explicit rules added to `CLAUDE.md` so worktree agents understand the constraint.

## The Problem

`aigon feature-create <name>` does two things: creates the spec file AND bootstraps workflow engine state (a record in `.aigon/workflow/`). The `Write` tool only does the first. When an agent uses `Write` directly, the spec appears in the inbox and on the board, but with no engine state behind it — it shows only a "Prioritise" button and cannot be started, evaluated, or closed through normal workflow transitions.

This happened in practice: F432 and F433 (aigon-pro) and the initial F485/F486 (aigon) were all written directly, discovered only when John noticed the board looked wrong.

Root cause: the rule "never move spec files manually" exists in CLAUDE.md but covers *moving*, not *creating*. No mechanical enforcement existed for creation.

## Proposed Solutions (for reviewer to evaluate)

Three layers are proposed. The reviewer should decide which to implement and whether the approach is right.

### Option A — PreToolUse hook (highest impact)

Add a hook to `.claude/settings.json` that intercepts `Write` and `Edit` tool calls where the file path matches `docs/specs/features/*/feature-*.md` and exits 1 with a clear error:

```
ERROR: Do not write spec files directly.
Use: aigon feature-create <name>
```

This makes the wrong path mechanically impossible rather than relying on agent judgment. Tradeoff: adds a hook that runs on every Write/Edit call — needs to be fast (a simple path-match bash check, <5ms).

### Option B — Pre-commit hook

Add `aigon doctor` (or a scoped equivalent) to `.git/hooks/pre-commit` to detect any newly staged spec files in `01-inbox/` that lack workflow state, and block the commit with a message pointing at `aigon feature-create`. Catches anything that slips past Option A, or cases where Option A is not in effect (e.g. a human edits directly in their editor).

### Option C — CLAUDE.md hot rule additions

Add two explicit lines to the hot rules section:

```
- **Spec creation**: never write spec files directly — always use `aigon feature-create <name>` 
  via Bash or the `afc` skill. Direct writes produce snapshotless specs.
- **Cross-repo specs**: when creating specs in aigon-pro, `cd /Users/jviner/src/aigon-pro` first, 
  then `aigon feature-create <name>`.
```

This helps worktree agents and any context where hooks may not fire. Lowest enforcement strength but zero runtime cost.

## Recommendation

All three layers, in order of implementation: C (zero cost, do first), then B (pre-commit is durable), then A (strongest, worth the hook overhead). If only one can be done: A.

## User Stories

- [ ] As John, when an agent tries to `Write` a file to `docs/specs/features/*/feature-*.md`, the tool call is blocked with a clear error pointing at `aigon feature-create`
- [ ] As John, if a snapshotless spec somehow reaches a commit, the pre-commit hook catches it before it lands in git
- [ ] As a worktree agent reading CLAUDE.md, the spec creation rule is explicit enough that I don't have to infer it

## Acceptance Criteria

- [ ] Writing directly to `docs/specs/features/01-inbox/feature-foo.md` via the `Write` tool is blocked by a hook with a clear error message
- [ ] The hook does not fire on legitimate edits to existing spec files (e.g. filling in the Summary section after `aigon feature-create`)
- [ ] `git commit` with a staged snapshotless spec in `01-inbox/` is blocked and explains how to fix it
- [ ] CLAUDE.md hot rules section contains an explicit spec-creation rule and a cross-repo note
- [ ] `aigon feature-create foo` still works correctly after all hook additions

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
