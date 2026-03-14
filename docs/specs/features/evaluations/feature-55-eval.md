# Evaluation: Feature 55 - control-surface-radar-interactive-api

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-55-control-surface-radar-interactive-api.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-55-cc-control-surface-radar-interactive-api`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-worktrees/feature-55-cx-control-surface-radar-interactive-api`

## Evaluation Criteria

| Criteria | cc | cx |
|----------|---|---|
| Code Quality | 7/10 | 8/10 |
| Spec Compliance | 9/10 | 7/10 |
| Performance | 8/10 | 7/10 |
| Maintainability | 6/10 | 9/10 |

## Summary

### Approach Comparison

**cc** took a pragmatic, feature-rich approach: 6 separate endpoints (`/api/refresh`, `/api/eval`, `/api/launch`, `/api/attach`, `/api/attach/open`, `POST/DELETE /api/repos`) plus full dashboard UI with buttons for Refresh, Eval, Launch, and Attach. It also fixed the iTerm2 window-matching bug and added solo-agent tmux detection.

**cx** took an architectural approach: a single generic `POST /api/action` endpoint with a strict allowlist (`RADAR_INTERACTIVE_ACTIONS`), repo-path validation against registered repos, and well-factored helper functions (`resolveRadarActionRepoPath`, `parseRadarActionRequest`, `buildRadarActionCommandArgs`, `runRadarInteractiveAction`). Also hardened tmux session resolution and added unit tests. Minimal dashboard changes (just passing `tmuxSession` to attach).

### Strengths & Weaknesses

#### cc (Claude)
- Strengths: Complete end-to-end feature with full dashboard UI (Refresh, Eval, Launch buttons), solo-agent launch/attach support, `.env.local` duplication fix for iTerm2 window matching, two-step attach flow (copy first, open second) that works across environments
- Weaknesses: Lots of inline endpoint code in `runRadarServiceDaemon` without extraction into testable helpers, no unit tests, `.env.local` committed with duplicate config, attach split into two routes adds surface area

#### cx (Codex)
- Strengths: Clean architecture with extracted/tested helpers, single generic endpoint is extensible, repo-path safety validation prevents arbitrary command execution, `runTmux()` wrapper adds PATH resilience for daemon contexts, 61 passing tests including 6 new ones, `isTmuxSessionAttached()` dedup guard
- Weaknesses: No dashboard UI for the new action API (no Eval/Launch/Refresh buttons), the generic endpoint requires the dashboard to know action names (tighter coupling to CLI internals), `spawnSync` execution blocks the HTTP server during action execution

## Recommendation

**Winner:** cx (Codex)

**Rationale:** cx's implementation is architecturally stronger — the extracted helpers with tests, repo-path safety validation, tmux binary resolution fallback, and the single-endpoint design make it more maintainable and secure. cc delivered more visible features (dashboard buttons, solo launch) but with less structure and no tests.

**Cross-pollination:** Before merging cx, consider adopting from cc:
- The dashboard UI additions (Refresh button, Eval button, Launch button) — cx's `/api/action` endpoint can power these but cc already built the frontend wiring
- Solo-agent tmux detection in `collectDashboardStatusData` — cx didn't address this
- The two-step attach flow (copy-first, then optional open) is a nice UX pattern
