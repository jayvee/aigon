# Claude Code Prompt Caching Policy

## Summary

The Claude Code (CC) harness (`claude` CLI) handles Anthropic prompt caching **automatically and opaquely**. Aigon does not—and cannot—inject explicit `cache_control` breakpoints into the API requests the CC harness makes. The caching is working correctly: research #35 observed ~12M cache-read tokens vs. ~1.2K fresh input tokens per session, confirming the stable prefix is cached across back-to-back sessions.

## What the stable prefix contains

Each CC session starts with a fixed system prompt built by the CC harness from:

1. **Harness system-reminder** — tool list, policy text (harness-owned; not an Aigon lever)
2. **`CLAUDE.md`** — auto-loaded by CC from the project root on every session start
3. **`MEMORY.md` index** — the auto-memory index (`~/.claude/projects/<repo>/memory/MEMORY.md`)
4. **Skills index** — user-invocable skills summary injected via the system reminder

**`AGENTS.md`** is the long-form repo orientation; Aigon surfaces pointers via the **SessionStart** hook (`aigon project-context`), not as part of the same auto-loaded file bundle as `CLAUDE.md`. It still lands in early conversation context, separate from the slash-command line Aigon passes on the CLI.

The harness-owned block above is what stays stable across routine feature work. The CC harness’s implicit cache breakpoint sits at the end of that **system** stack; anything after it (hook output, first user message, expanded slash-command content) does not live in that same system prefix.

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

View rolled-up totals via `aigon feature-close <ID>` (written to `.aigon/workflows/features/<id>/stats.json`). For per-session values, read normalized JSON under `.aigon/telemetry/` (`feature-<id>-<agent>-<sessionId>.json`, produced from CC transcripts). A healthy run shows `cache_read_input_tokens` orders of magnitude larger than `cache_creation_input_tokens` on the second and subsequent sessions in the same repo after the prefix is warm. The first session in a new repo or after a `CLAUDE.md` edit will show elevated `cache_creation_input_tokens`.

## How to update this policy

When the stable prefix changes (e.g. a new `CLAUDE.md` section is added):

1. The cache automatically invalidates on the next session — no action needed.
2. Update this document if the nature of what's in the stable prefix changes structurally.
3. Check `cache_creation_input_tokens` in the next session's telemetry to confirm the new prefix size was cached successfully.

## Non-CC agents

This policy applies only to CC (`claude` CLI). Caching for cx (Codex/OpenAI), gg (Gemini), and cu (Cursor) is out of scope — each provider has different caching semantics and is addressed separately if at all.
