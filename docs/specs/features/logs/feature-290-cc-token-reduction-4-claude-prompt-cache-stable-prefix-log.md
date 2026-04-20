# Implementation Log: Feature 290 - token-reduction-4-claude-prompt-cache-stable-prefix
Agent: cc

## Decisions

- The CC harness (`claude` CLI) handles Anthropic prompt caching automatically and opaquely; Aigon cannot inject `cache_control` breakpoints — downgraded to documented-confirmation deliverable per spec.
- Implicit caching is confirmed working: research #35 measured ~12M cache-read vs ~1.2K fresh input tokens per session.
- Stable prefix is correctly structured: `CLAUDE.md` + `MEMORY.md` index in system prompt; feature-specific slash command in user message — variable content is already after the implicit cache breakpoint.
- `docs/prompt-caching-policy.md` documents what's stable, what invalidates the cache, and how to monitor via `cache_read_input_tokens` / `cache_creation_input_tokens` in telemetry.

## Code Review

**Reviewed by**: Composer (Cursor feature-review)
**Date**: 2026-04-21

### Findings
- Implementation matches the spec’s downgrade path: no `cache_control` injection is possible from Aigon through the CC CLI; documentation + telemetry pointers are the right deliverable.
- **Doc bug (fixed)**: Monitoring section incorrectly placed `stats.json` under `.aigon/telemetry/`. Rollups live at `.aigon/workflows/features/<id>/stats.json`; per-session normalized records live under `.aigon/telemetry/`.
- **Spec alignment (fixed)**: Policy now mentions **`AGENTS.md`** via SessionStart `aigon project-context`, distinct from the CC-auto-loaded `CLAUDE.md` bundle in the harness system stack.

### Fixes Applied
- `fix(review): correct telemetry paths and AGENTS.md context in prompt-caching-policy`

### Notes
- Non-CC agents unchanged (docs only). `npm test` passed after the doc edits.
