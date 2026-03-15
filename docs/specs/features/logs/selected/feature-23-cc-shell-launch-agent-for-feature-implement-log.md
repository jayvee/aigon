---
updated: 2026-03-15T22:41:40.073Z
startedAt: 2026-02-27T18:12:14+11:00
completedAt: 2026-02-27T18:13:11+11:00
autonomyRatio: 0.00
---

# Implementation Log: Feature 23 - shell-launch-agent-for-feature-implement
Agent: cc

## Plan

Explored `aigon-cli.js` (8000+ lines) to understand:
- `feature-implement` command structure and mode detection (solo/solo-wt/arena)
- `buildAgentCommand(wt, taskType)` — existing agent command builder using `getAgentCliConfig`
- `runRalphAgentIteration` — how agents are spawned via `spawnSync` with `CLAUDECODE` unset
- `detectEditor()` — existing precedent for environment-based detection (`CURSOR_TRACE_ID`)
- `openSingleWorktree` — terminal-launch reference for the same config resolution path

Design: add `detectActiveAgentSession()` as a shared helper, then bifurcate `feature-implement` into launch mode (plain shell) and instruction mode (inside agent session).

## Progress

1. Added `detectActiveAgentSession()` helper (lines ~66-100)
2. Replaced `feature-implement` command handler with two-path logic
3. Updated CLI usage string, help text, and examples
4. Updated `docs/GUIDE.md` for all three affected sections

## Decisions

**Session detection approach:**
- `CLAUDECODE` env var for Claude Code — already relied upon by `buildAgentCommand` to unset before spawning; most reliable signal
- `CURSOR_TRACE_ID` for Cursor — already used in `detectEditor()`; consistent with existing code
- Parent process name (`ps -p $PPID -o comm=`) for Gemini CLI and Codex — pragmatic heuristic for the open question in the spec; failures are silently swallowed

**Agent resolution in worktree context:**
- In a worktree (`feature-N-cc-*`), the default is the worktree's own agent, not `cc`. This avoids ambiguity.
- If `--agent` is explicitly passed and doesn't match, Aigon exits with a clear mismatch error rather than silently launching the wrong agent.

**Spawn mechanism:**
- Used `spawnSync` with `stdio: 'inherit'` — attaches the agent directly in the current shell, which is the natural behavior when launching from a plain terminal. This matches how `runRalphAgentIteration` works.
- `CLAUDECODE` is deleted from the env before spawning Claude, consistent with all other spawn sites in the codebase.

**Model injection:**
- Reused the same `getAgentCliConfig` → `cliConfig.models?.['implement']` path as `buildAgentCommand`, so model selection precedence (env var > project > global > template default) is automatically honored.

**Ralph compatibility:**
- `--ralph` check happens before any new logic; the Ralph path is completely unchanged.
- Ralph's own `--agent` handling is independent (parsed inside `runRalphCommand`).

**GUIDE.md updates:**
- Updated Fast-Track, Solo Mode step 4, and Arena Mode step 4 to describe the two-mode behavior.
- Arena mismatch protection documented inline.
