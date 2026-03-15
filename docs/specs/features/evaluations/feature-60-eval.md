# Evaluation: Feature 60 - dashboard-sessions-command-runner

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-60-dashboard-sessions-command-runner.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-60-cc-dashboard-sessions-command-runner`
- [x] **gg** (Gemini): `/Users/jviner/src/aigon-worktrees/feature-60-gg-dashboard-sessions-command-runner`

## Evaluation Criteria

| Criteria | cc | gg |
|----------|---|---|
| Code Quality | 9/10 | 6/10 |
| Spec Compliance | 9/10 | 5/10 |
| Performance | 8/10 | 6/10 |
| Maintainability | 8/10 | 5/10 |
| **Total** | **34/40** | **22/40** |

## Summary

### CC (Claude) — 1228 lines changed, 2 commits

**Comprehensive implementation covering all three execution tiers:**

- `inferDashboardNextActions()` — full multi-action array with mode classification, correct fleet detection fix (`filter().length > 1` instead of `some()`)
- Five new API endpoints: `/api/sessions`, `/api/session/run`, `/api/session/start`, `/api/session/stop`, `/api/session/status`
- WebSocket terminal relay (`/ws/terminal`) — manual RFC 6455 handshake, no external dependencies. Uses tmux `pipe-pane` + 50ms polling (Option B from spec, avoids node-pty)
- Run next split button with dropdown, fire-and-forget spinner + toast, terminal panel with xterm.js
- Split-view layout when terminal and spec drawer are both open
- Stale file indicator (polls for spec changes, amber pulse animation)
- Sessions tab showing all tmux sessions with Attach/Kill
- Use AI button with agent picker modal + localStorage persistence
- Inline stop confirmation (no browser `confirm()`)
- Settings tab visibility bug fix

**Strengths:**
- Thorough — implements virtually every acceptance criterion
- WebSocket relay is well-designed: deferred snapshot until after first resize, JSON control protocol for resize messages
- Split-view is a nice UX touch not in the spec
- Sessions tab adds useful visibility into running tmux sessions
- Detailed implementation log with clear decisions

**Weaknesses:**
- WebSocket relay is ~200 lines of manual frame parsing — will need maintenance
- Both `inferDashboardNextCommand()` AND `inferDashboardNextActions()` exist (old function not removed)
- CC's worktree branched before the bug fixes made on main today (solo next-command fix, bash -lc wrapper, iTerm2 tmux path fix)

### GG (Gemini) — 913 lines changed, 1 commit

**Partial implementation, never submitted:**

- `inferDashboardNextActions()` — replaces `inferDashboardNextCommand()` entirely (cleaner than CC keeping both). Fleet detection correct (`>= 2`). Good detail on per-agent focus commands for waiting state.
- API endpoints: `/api/session/start`, `/api/session/stop`, `/api/session/run`, `/api/session/status` — similar structure to CC
- WebSocket relay present but less mature
- Dashboard UI changes: split button, terminal panel, xterm.js
- Created `.env.local` file (shouldn't be committed)
- Empty implementation log — never wrote plan/progress/decisions
- Status never updated from "implementing" to "submitted"

**Strengths:**
- Cleaner replacement of `inferDashboardNextCommand()` (removed old function entirely)
- Agent picker includes specific waiting-agent ID in focus command
- In-progress state checks `tmuxRunning` before showing Attach option (defensive)

**Weaknesses:**
- Never submitted — log is empty, agent stalled mid-implementation
- `.env.local` committed (should be gitignored)
- Less thorough spec coverage — no split-view, no stale indicator, no Sessions tab
- No inline stop confirmation (likely still uses browser `confirm()`)

## Recommendation

**Winner:** cc (Claude)

**Rationale:** CC delivered a complete, submitted implementation covering all spec criteria with thoughtful extras (split-view, stale file indicator, Sessions tab). GG produced a partial implementation but stalled — likely hit by the tmux empty-shell bug that prevented the agent from launching properly. The core architectural decisions (WebSocket relay via pipe-pane, JSON control protocol, deferred snapshot) are sound. CC's is the only viable implementation.

**Cross-pollination:** GG's `inferDashboardNextActions()` is marginally cleaner — it removes the old `inferDashboardNextCommand()` function entirely rather than keeping both. When merging CC, the old function should be removed and callers updated. GG also includes the waiting-agent ID in focus commands (`terminal-focus 60 gg` instead of just `terminal-focus 60`), which is worth adopting.

`/aigon:feature-close 60 cc`
