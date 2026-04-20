# Implementation Log: Feature 290 - token-reduction-4-claude-prompt-cache-stable-prefix
Agent: cc

## Decisions

- The CC harness (`claude` CLI) handles Anthropic prompt caching automatically and opaquely; Aigon cannot inject `cache_control` breakpoints — downgraded to documented-confirmation deliverable per spec.
- Implicit caching is confirmed working: research #35 measured ~12M cache-read vs ~1.2K fresh input tokens per session.
- Stable prefix is correctly structured: `CLAUDE.md` + `MEMORY.md` index in system prompt; feature-specific slash command in user message — variable content is already after the implicit cache breakpoint.
- `docs/prompt-caching-policy.md` documents what's stable, what invalidates the cache, and how to monitor via `cache_read_input_tokens` / `cache_creation_input_tokens` in telemetry.
