---
commit_count: 0
lines_added: 0
lines_removed: 0
lines_changed: 0
files_touched: 0
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 184
output_tokens: 107397
cache_creation_input_tokens: 249311
cache_read_input_tokens: 15228729
thinking_tokens: 0
total_tokens: 15585621
billable_tokens: 107581
cost_usd: 7.115
sessions: 1
model: "claude-sonnet-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 357 - record-agent-session-ids
Agent: cc

## Status
Implemented and committed (975e7ac2).

## New API Surface
- `lib/session-sidecar.js` — new module: `updateSessionSidecar`, `findNewAgentSession`, `spawnCaptureProcess`, `readLatestSidecarWithSession`, `resolveResumeArgs`
- `.aigon/sessions/{name}.json` schema gains `agentSessionId` (string) and `agentSessionPath` (absolute path)
- `aigon feature-do <ID> --resume [--agent <id>]` — resumes via live-tmux-first, then sidecar-UUID

## Key Decisions
- **Detached background process** rather than async/await in the main process: aigon CLI exits seconds after spawning tmux. A `child.unref()` approach wouldn't survive that exit. The capture process runs `node lib/session-sidecar.js --capture ...` and exits cleanly after finding the file or timing out (12s ceiling).
- **Synchronous poll loop in the capture child**: avoids needing the child to have an event loop running. Uses `execSync('sleep 0.8')` between polls — acceptable in a dedicated single-purpose child.
- **Reuse telemetry.js helpers exactly**: `resolveClaudeProjectDir`, `resolveGeminiChatsDir`, `findCodexSessionFiles` already implement the cwd-matching logic. No duplication.
- **Gemini session ID** read from `data.sessionId` field in the chat JSON when present; falls back to filename stem.
- **Codex resume** uses the `resume` subcommand (`codex resume <id>`), not a flag.

## Gotchas / Known Issues
- Gemini `--resume` flag name not verified against live CLI (no Gemini binary available during impl); stored as `--resume` matching the spec assumption. Mark for verification.
- The background capture process inherits no env overrides — `HOME` is the real home, which is correct for locating `~/.claude/projects/`.

## Explicitly Deferred
- Cursor (`cu`) and OpenCode (`op`) capture: no discoverable session ID mechanism found.
- Dashboard "Open transcript" affordance: spec called this out-of-scope; `agentSessionPath` in the sidecar is the prerequisite.
- `--resume` for research-do, feature-eval, research-eval, and spec-review commands: the core `_handleResume` logic is in `lib/session-sidecar.js` and re-usable; wiring into those command handlers is straightforward follow-up.

## For the Next Feature in This Set
Standalone feature.

## Test Coverage
- `agent-session-id-capture.test.js`: cc/gg/cx capture via fake HOME override; null-guard for old files; sidecar patch atomicity
- `feature-do-resume.test.js`: sidecar lookup (found/missing/multi/agent-filter); resolveResumeArgs per agent
