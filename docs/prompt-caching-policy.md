# Claude Code Prompt Caching Policy

## Summary

The Claude Code (CC) harness (`claude` CLI) handles Anthropic prompt caching **automatically and opaquely**. Aigon does not—and cannot—inject explicit `cache_control` breakpoints into the API requests the CC harness makes. The caching is working correctly: research #35 observed ~12M cache-read tokens vs. ~1.2K fresh input tokens per session, confirming the stable prefix is cached across back-to-back sessions.

## What the stable prefix contains

Each CC session starts with a fixed system prompt built by the CC harness from:

1. **Harness system-reminder** — tool list, policy text (harness-owned; not an Aigon lever)
2. **`CLAUDE.md`** — auto-loaded by CC from the project root on every session start
3. **`MEMORY.md` index** — the auto-memory index (`~/.claude/projects/<repo>/memory/MEMORY.md`)
4. **Skills index** — user-invocable skills summary injected via the system reminder

All four components are static within a session and across sessions **until one of them changes** (see Cache Invalidation below). The CC harness places its implicit cache breakpoint at the end of this system prompt.

## What lives after the breakpoint (variable content)

The first user message — the Aigon slash command, e.g. `/aigon:feature-do 290` — is always session-specific. The output of `aigon feature-do` (template body, inline spec, feature ID) follows in subsequent turns. This variable content is correctly positioned **after** the implicit cache breakpoint, so it never invalidates the stable-prefix cache.

## Why Aigon cannot make caching "more explicit"

Aigon launches CC sessions by passing a short slash-command string to the `claude` CLI binary:

```
claude --permission-mode acceptEdits --model sonnet '/aigon:feature-do 290'
```

The CC harness constructs the actual Anthropic API request internally. `cache_control` is an Anthropic API parameter embedded in the request body — it is not a flag or annotation that can be added to the CLI argument string or the prompt text. There is no stable public API for Aigon to inject `cache_control` breakpoints into the harness's API calls.

## Cache invalidation triggers

The stable-prefix cache entry is invalidated (and `cache_creation_input_tokens` spike) when:

| Change | Invalidates |
|--------|-------------|
| Any edit to `CLAUDE.md` | Entire stable prefix |
| Any edit to `MEMORY.md` index entries | Entire stable prefix |
| New Aigon version that ships a changed `CLAUDE.md` | Entire stable prefix |
| CC harness update that changes the system-reminder format | Entire stable prefix |

Routine edits (spec bodies, feature branches, code files) do not touch any of the above and do not invalidate the cache.

## Relationship to token-reduction-1

Feature 287 (`token-reduction-1-slim-always-on-context`) trimmed `CLAUDE.md` and the command templates. The smaller stable prefix means:

- Cache-creation events are cheaper (fewer bytes to write)
- Cache-read savings are proportionally maintained

Caching the slimmer prefix (after `1` landed) vs. the bloated one is why this feature was ordered after `1`.

## Monitoring

`lib/telemetry.js` captures per-session cache token fields from CC transcripts:

- **`cache_read_input_tokens`** — tokens served from cache (should be the large majority)
- **`cache_creation_input_tokens`** — tokens written to cache (spikes only on prefix change)

View these via `aigon feature-close <ID>` or by reading `stats.json` entries in `.aigon/telemetry/`. A healthy session shows `cache_read_input_tokens` orders of magnitude larger than `cache_creation_input_tokens` on the second and subsequent sessions. The first session in a new repo or after a `CLAUDE.md` edit will show elevated `cache_creation_input_tokens`.

## How to update this policy

When the stable prefix changes (e.g. a new `CLAUDE.md` section is added):

1. The cache automatically invalidates on the next session — no action needed.
2. Update this document if the nature of what's in the stable prefix changes structurally.
3. Check `cache_creation_input_tokens` in the next session's telemetry to confirm the new prefix size was cached successfully.

## Non-CC agents

This policy applies only to CC (`claude` CLI). Caching for cx (Codex/OpenAI), gg (Gemini), and cu (Cursor) is out of scope — each provider has different caching semantics and is addressed separately if at all.
