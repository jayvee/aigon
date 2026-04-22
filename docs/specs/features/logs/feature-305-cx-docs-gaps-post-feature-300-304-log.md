# Implementation Log: Feature 305 - docs-gaps-post-feature-300-304
Agent: cx

## Plan

## Progress

## Decisions

## Code Review

**Reviewed by**: cc
**Date**: 2026-04-22

### Fixes Applied
- `fix(review): correct agent-status link path in nudge reference` — `See also` in `reference/commands/infra/nudge.mdx` pointed to `/docs/reference/commands/misc/agent-status` but the page lives under `infra/`. Updated to match the canonical path used in `reference/commands/index.mdx`.

### Residual Issues
- **`aigon nudge` is not reachable from the CLI dispatcher.** The handler is defined at `lib/commands/misc.js:180`, but the `names` allowlist in the `createMiscCommands` back-compat wrapper (same file, bottom) omits `nudge`, so `aigon nudge …` currently prints `Unknown command: nudge`. This is a pre-existing implementation bug (F295 regression, not introduced by F305) and is out of scope for a docs-only review pass. The docs as written still describe the intended UX; a follow-up feature should re-register `nudge` (add `'nudge'` to the `names` array) before users act on this reference page.

### Notes
- `npm run build --prefix site` exits 0 on this branch (verified during review).
- Spec acceptance criteria verified: all six new/updated pages exist, placeholders use the `{/* PLACEHOLDER: … */}` format, `feedback-workflow.mdx` has no surviving `feature-review` references (only `feature-code-review` / `feature-code-review-check`), and the `infra/nudge.mdx` + `feature-rename.mdx` + `research-rename.mdx` `_meta.tsx` entries are wired up.
- `feature-rename` and `research-rename` CLI commands are live and print the same Usage lines the new reference pages document.
- Consider filing a feedback item for the `nudge` CLI regression so it doesn't live as ghost prose here (per the "fix the class, not the instance" rule).
