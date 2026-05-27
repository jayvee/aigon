---
complexity: medium
---

# Feature: amp-transcript-telemetry

## Summary

Enable transcript telemetry capture for Amp (agent `am`) by wiring into the existing session-sidecar + telemetry pipeline. Amp stores thread data as local JSON files at `~/.local/share/amp/threads/T-<uuid>.json` and supports `amp threads export <thread-id>` for server-enriched output. This feature adds a session finder to discover the local thread file during the session, a parser to extract token usage / turn counts / tool calls from the Amp thread JSON format, and the telemetry strategy plumbing so normalized records are written to `.aigon/telemetry/` at session end — the same pipeline CC, GG, CX, and OP already use.

## User Stories

- [ ] As an Aigon user running Amp for feature implementation, I want token usage and cost captured automatically so I can see Amp's telemetry in the dashboard alongside other agents.
- [ ] As an Aigon user closing a feature that used Amp, I want the transcript archived to durable storage (`~/.aigon/transcripts/`) so I retain the session history after worktree deletion.

## Acceptance Criteria

- [ ] `am.json` declares `transcriptTelemetry: true`, `sessionStrategy: "amp-threads"`, and `telemetryStrategy: "amp-transcript"`
- [ ] `session-sidecar.js` has an `amp-threads` session finder that scans `~/.local/share/amp/threads/` for `T-*.json` files created after session start, and binds the thread ID + file path to the sidecar record
- [ ] `telemetry.js` has a `parseAmpThreadFile(filePath)` function that extracts `input_tokens`, `output_tokens`, `thinking_tokens`, `total_tokens`, `model`, `cost_usd`, `turn_count`, `tool_calls`, `start_at`, `end_at`, `turns[]`, and `context_load_tokens` from the Amp thread JSON
- [ ] `telemetry.js` `captureAgentTelemetry` dispatches to `parseAmpTranscripts` when `telemetryStrategy === 'amp-transcript'` (following the GG/CX/OP pattern at ~line 1546)
- [ ] After an Amp session exits normally, a normalized telemetry record appears in `.aigon/telemetry/` with `source: 'amp-transcript'`
- [ ] `feature-close` archives Amp transcripts to durable hot tier via `finaliseEntityTranscripts()` (no special code — sidecar path is sufficient)
- [ ] Dashboard transcript list (`GET /api/features/:id/transcripts`) includes Amp sessions
- [ ] Unit tests cover: parser with a representative Amp thread JSON fixture, session finder with mocked `~/.local/share/amp/threads/` directory, pricing fallback for Amp's multi-model routing

## Validation

```bash
node -e "require('./lib/telemetry').parseAmpThreadFile && console.log('parser exported')"
node -e "const s = require('./lib/session-sidecar'); const f = require('./lib/agent-registry').getSessionStrategy('am'); console.log('strategy:', f)"
```

## Technical Approach

### 1. Agent config (`templates/agents/am.json`)

Flip `transcriptTelemetry` to `true`. Set `sessionStrategy` to `"amp-threads"` and `telemetryStrategy` to `"amp-transcript"`. This is the only config change — the rest is plumbing.

### 2. Session finder (`lib/session-sidecar.js`)

Add `'amp-threads'` to `SESSION_FINDERS`. The finder:
- Resolves the Amp threads directory: `~/.local/share/amp/threads/` (macOS/Linux standard XDG path)
- Scans for `T-*.json` files with mtime after `threshold` (session creation - 3s tolerance, matching existing pattern)
- Uses `_newestFile()` with `.json` extension filter and `T-` prefix check
- Returns `{ sessionId: 'T-<uuid>', sessionPath: '/full/path/T-<uuid>.json' }`

No CWD validation in the finder itself — time-based matching with `_newestFile` is sufficient (matches CC/GG/CX pattern). If Fleet mode concurrency becomes an issue, CWD validation can be added as a follow-up by reading the thread JSON's environment metadata.

### 3. Transcript parser (`lib/telemetry.js`)

Add `parseAmpThreadFile(filePath)` returning the standard `{ input_tokens, output_tokens, ... }` shape. The Amp thread JSON contains messages with `usage` fields (same structure as Claude API responses — `input_tokens`, `output_tokens`, `cache_read_input_tokens`). The parser:
- Reads the JSON file (not JSONL — Amp uses a single JSON object)
- Iterates `messages[]` array, aggregating `usage` from assistant messages
- Counts `tool_use` content blocks for `tool_calls`
- Extracts `model` from assistant message metadata or top-level thread `agentMode`
- Maps Amp mode names to model IDs for pricing: `rush` → `gpt-5.5`, `smart` → `claude-opus-4-7`, `deep` → `gpt-5.5`
- Computes `start_at`/`end_at` from first/last message timestamps
- Builds per-turn `turns[]` array from sequential assistant messages

Add `parseAmpTranscripts(worktreePath, options)` as the aggregation wrapper (matching `parseGeminiTranscripts`/`parseCodexTranscripts` pattern) that finds and parses the session file, writes normalized records, and returns aggregated telemetry.

### 4. Telemetry strategy dispatch (`lib/telemetry.js` ~line 1544)

Add `else if (tStrat === 'amp-transcript' && hasTranscript)` branch in `captureAgentTelemetry` that calls `parseAmpTranscripts(worktreePath, opts)`. This is a 5-line addition matching the existing GG/CX/OP branches.

### 5. Pricing

Amp routes to multiple underlying models. The parser extracts the actual model ID from per-message metadata when available. For cost computation:
- If message-level model IDs are present → use `getModelPricing(modelId)` per existing logic
- If only Amp mode name is available → map to known model: `smart` → `claude-opus-4-7`, `rush`/`deep` → `gpt-5.5`
- Fallback → `getModelPricing('claude-opus-4-7')` (conservative for Amp's default mode)

### 6. No EXIT trap changes

The sidecar capture process already runs as a detached background poller. The existing EXIT trap calls `agent-status` which triggers telemetry capture via the normalized-record path. No shell wrapper changes are needed — the existing pipeline handles Amp once the finder and parser exist.

## Dependencies

- None (all infrastructure exists; this is additive)

## Out of Scope

- `amp threads export <id>` CLI integration (server-enriched data) — local file is sufficient for v1
- Amp resume support (`runtime.resume` config) — separate feature
- CWD-based thread matching for Fleet concurrency — follow-up if needed
- Markdown export of Amp threads — third-party tooling handles this

## Open Questions

- Exact JSON schema of Amp's local thread files (`T-*.json`) — needs validation against a real session. The parser should be defensive and handle missing fields gracefully.
- Whether Amp's `usage` fields match the Claude API convention (likely yes since Amp uses Claude as one of its backends, but needs verification for GPT-5.5 modes).
- XDG path on macOS: verify `~/.local/share/amp/threads/` is the actual location (could also be `~/Library/Application Support/amp/threads/` on macOS — needs checking).

## Related

- Prior: Feature F536 (onboard Amp agent) — established the TUI-inject pattern and `am.json` config
- Pattern: CC transcript telemetry (F229), GG transcript telemetry, CX transcript telemetry — this follows the same architecture
