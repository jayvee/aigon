# Feature: telemetry-for-gemini-and-codex-agents

## Summary
Gemini (gg) and Codex (cx) agents both store per-turn token counts in local files but Aigon doesn't currently parse them at feature-close time. Cursor (cu) has no accessible token data. This feature implements transcript parsers for GG and CX so that cost and token counts appear in the Stats tab for all participating agents. Each agent's data is already present on disk — this is purely a parsing + normalization layer.

## Data Sources (confirmed by inspection)

### Gemini (gg)
- **Path**: `~/.gemini/tmp/{worktree-slug}/chats/session-{date}-{id}.json`
- **Worktree slug**: the worktree directory name, e.g. `feature-01-gg-dark-mode`
- **Token format per message**:
  ```json
  "tokens": { "input": 11287, "output": 52, "cached": 0, "thoughts": 557, "tool": 0, "total": 11896 }
  ```
- **Model**: `"model": "gemini-3-flash-preview"` (per message)
- **Pricing**: apply PRICING table from `telemetry.js` using `gemini-2.5-flash` / `gemini-2.5-pro` keys
- **Note**: `cached` tokens are Gemini's cache read (equivalent to CC's `cache_read_input_tokens`)

### Codex (cx)
- **Path**: `~/.codex/sessions/YYYY/MM/DD/rollout-{timestamp}-{id}.jsonl`
- **Feature matching**: `session_meta` line has `"cwd": "/path/to/worktree"` — match against the expected worktree path
- **Token format per line**:
  ```json
  "input_tokens": 11061, "output_tokens": 333, "total_tokens": 11394
  ```
- **Note**: tokens repeat per turn with cumulative values — use the **last occurrence** per session, or deduplicate by taking max
- **Model**: from `session_meta.model_provider` + Codex API pricing (GPT-5)

### Cursor (cu)
- No accessible token data. Cursor manages billing internally. Mark as `n/a` permanently.

## Acceptance Criteria
- [ ] At feature-close time, GG telemetry is read from `~/.gemini/tmp/{slug}/chats/` and written as a normalized record to `.aigon/telemetry/feature-{id}-gg-{sessionId}.json`
- [ ] At feature-close time, CX telemetry is read from `~/.codex/sessions/` (matched by worktree `cwd`) and written as a normalized record to `.aigon/telemetry/feature-{id}-cx-{sessionId}.json`
- [ ] CU telemetry records are written with `source: "no-telemetry-cursor"` and all token fields `null` (not 0) to distinguish from zero-cost sessions
- [ ] `supportsTranscriptTelemetry` is set to `true` for `gg` and `cx` in their agent JSON configs
- [ ] `captureAgentTelemetry` in `telemetry.js` routes to the correct parser per agent
- [ ] Per-agent cost shows correctly in Stats tab (depends on `per-agent-cost-breakdown-in-stats`)

## Technical Approach
Add parser functions to `telemetry.js`:
- `parseGeminiTranscripts(worktreePath)` — finds `~/.gemini/tmp/{slug}/chats/*.json`, sums tokens across all messages, returns normalized fields
- `parseCodexTranscripts(worktreePath)` — finds `~/.codex/sessions/**/*.jsonl` where `session_meta.cwd` matches worktree, takes last token values per session (cumulative), returns normalized fields
- `captureAgentTelemetry` dispatches to the right parser based on `agentId`
- Pricing: add `gemini-2.5-flash`, `gemini-2.5-pro`, and `codex` (GPT-5) keys to the PRICING table

## Dependencies
- depends_on: per-agent-cost-breakdown-in-stats

## Out of Scope
- Cursor token counts (not feasible without Cursor API access)
- Real-time/incremental telemetry for GG or CX (capture only at feature-close)
- Research telemetry for GG/CX (can be added in a follow-up)

## Open Questions
- Codex token values appear cumulative per message — need to verify if the last line per session is correct, or if they reset per turn

## Related
- depends_on: telemetry-reads-stophook-records-not-transcripts
