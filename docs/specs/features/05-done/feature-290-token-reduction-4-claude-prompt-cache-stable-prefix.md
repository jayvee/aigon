# Feature: token-reduction-4-claude-prompt-cache-stable-prefix

## Summary
Introduce explicit Anthropic prompt-caching around the stable Aigon startup prefix for Claude Code sessions, after `token-reduction-1-slim-always-on-context` has trimmed that prefix down. Research 35 observed recent cc logs averaging ~1.2K fresh input tokens and ~12M cache-read tokens per session, which confirms the prefix is already being cached implicitly — the point of this feature is to make caching deliberate and measurable, placing the cache breakpoint around the content that is genuinely stable (system prompt, `AGENTS.md`, command template body) so we both minimise cache churn and maximise reuse across sessions. Caching the current bloated prefix would reduce churn but lock in bytes we don't want; the ordering (`1` before `4`) is intentional.

## User Stories
- [ ] As a Claude Code operator running many back-to-back sessions in the same repo, my stable prefix stays in the Anthropic cache across sessions so I pay fresh tokens only on the delta.
- [ ] As a maintainer measuring the win, I can see cache-read vs. cache-creation token split per session from the telemetry introduced in feature `2`.

## Acceptance Criteria
- [ ] The Aigon CC launch path emits an explicit `cache_control` breakpoint at the end of the stable prefix (system + `AGENTS.md` + template body) — i.e. the prefix is marked cache-eligible, and feature-specific content (spec body, feature id, per-run args) lives after the breakpoint so it does not invalidate the cache.
- [ ] Cache-creation tokens occur only when the stable prefix actually changes (new Aigon version, new template, AGENTS.md edit); routine back-to-back sessions show cache-read on the prefix portion.
- [ ] A short note in `docs/` records the chosen cache-breakpoint policy and how to update it when the prefix changes.
- [ ] Non-Claude agents (cx, gg, cu) are unaffected.
- [ ] If `@aigon/pro` or the CC harness does not expose a stable way to set `cache_control`, the feature documents that limitation and downgrades to a "confirm current implicit caching continues to work" deliverable rather than forcing a workaround.

## Validation
```bash
node -c aigon-cli.js
npm test
```

## Technical Approach
This feature only ships after `token-reduction-1-slim-always-on-context` lands — caching the bloated prefix is worse than caching the slim one, because any invalidation forces re-creation of a bigger blob. Review how Aigon currently hands the system prompt to the Claude Code CLI (via `lib/agent-prompt-resolver.js` / `lib/worktree.js`) and decide whether we set `cache_control` ourselves or whether the CC harness handles it internally. If the harness handles caching opaquely, the deliverable becomes a documented confirmation rather than a code change — call that out clearly in the feature log. Use the per-turn telemetry from feature `2` to verify the cache-read vs. cache-creation split pre/post.

## Dependencies
- depends_on: token-reduction-1-slim-always-on-context

## Out of Scope
- Caching for cx / gg / cu — provider-specific, not on the near-term roadmap.
- Changing the Anthropic cache TTL strategy beyond what the SDK / harness exposes.
- Caching non-prefix (mid-conversation) content.

## Open Questions
- Does the CC CLI expose a hook for setting `cache_control` on the injected system prompt, or is caching entirely handled by the harness and invisible to Aigon? If invisible, the feature becomes a documented confirmation task rather than a code change.
- What is the right cache-invalidation signal when we ship a new Aigon version that edits `AGENTS.md` or a template — do we need to do anything, or does the content-hash-based cache key handle it automatically?

## Related
- Research: #35 token-and-context-reduction
