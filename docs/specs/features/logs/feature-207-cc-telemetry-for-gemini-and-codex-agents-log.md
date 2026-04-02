# Implementation Log: Feature 207 - telemetry-for-gemini-and-codex-agents
Agent: cc

## Progress

- Added Gemini and GPT-5 pricing to the PRICING table in `lib/telemetry.js`
- Implemented `parseGeminiSessionFile()` — parses `~/.gemini/tmp/{hash-or-slug}/chats/session-*.json`
- Implemented `parseCodexSessionFile()` — parses `~/.codex/sessions/**/*.jsonl` with cumulative `total_token_usage`
- Implemented `findCodexSessionFiles()` — scans all Codex sessions matching a worktree by `session_meta.cwd`
- Implemented `resolveGeminiChatsDir()` — supports both SHA256 hash and basename slug directory naming
- Implemented `parseGeminiTranscripts()` and `parseCodexTranscripts()` — aggregate parsers that write normalized records
- Updated `captureAgentTelemetry()` to route gg→Gemini parser, cx→Codex parser, cu→no-telemetry record
- Set `transcriptTelemetry: true` in `templates/agents/gg.json` and `templates/agents/cx.json`
- Updated `writeNormalizedTelemetryRecord()` to preserve `null` values for CU's explicit no-data signals
- Updated CLAUDE.md module map

## Decisions

- **Gemini directory lookup**: Gemini stores transcripts in `~/.gemini/tmp/{dir}/chats/` where `{dir}` is either a SHA256 hash of the project path OR the basename slug (directory name). We try both strategies and use whichever exists.
- **Codex session matching**: Codex stores sessions by date (`YYYY/MM/DD/`) not by project. We scan all sessions and match by the `cwd` field in the `session_meta` line. Used a regex-based 4KB buffer read instead of full JSON parsing for efficiency (the first line can be huge due to embedded base_instructions).
- **Codex cumulative tokens**: Token counts in Codex event_msg lines are cumulative. We take the last occurrence's `total_token_usage` as the session total.
- **Cursor (cu)**: Explicitly marked with `source: "no-telemetry-cursor"` and all token fields as `null` (not 0) to distinguish from zero-cost sessions.
- **Gemini token mapping**: `cached` → `cache_read_input_tokens`, `thoughts` → `thinking_tokens`. No cache creation equivalent in Gemini.
- **Codex token mapping**: `cached_input_tokens` → `cache_read_input_tokens`, `reasoning_output_tokens` → `thinking_tokens`.
