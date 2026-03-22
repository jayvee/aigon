# Evaluation: Feature 129 - background-agents-and-dashboard-settings

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-129-background-agents-and-dashboard-settings.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-129-cc-background-agents-and-dashboard-settings`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-worktrees/feature-129-cx-background-agents-and-dashboard-settings`

## Evaluation Criteria

| Criteria | cc | cx |
|---|---|---|
| Code Quality | 7/10 | 8/10 |
| Spec Compliance | 6/10 | 9/10 |
| Performance | 8/10 | 7/10 |
| Maintainability | 7/10 | 8/10 |
| **Total** | **28/40** | **32/40** |

## Summary

| Agent | Lines | Score |
|---|---|---|
| cc | 424 | 28/40 |
| cx | 1028 | 32/40 |

### Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - Compact implementation (424 lines) — lean and focused
  - `SETTINGS_SCHEMA` defined in `lib/config.js` and exported — clean separation of concerns
  - `writeAgentStatusFile` in dashboard-server uses atomic write (tmp + rename) — crash-safe
  - Settings UI is simple and functional with source badges (default/global/project)
  - "Finished (unconfirmed)" label for flagged agents is clearer than cx's "Session ended"
- Weaknesses:
  - **research-start background flag is broken**: parses `--background`/`--foreground` options but never computes or uses `skipTerminal` — research agents always open terminals regardless of flag
  - No `--background`/`--foreground` conflict detection (both flags accepted silently)
  - No `aigon doctor` integration for stale implementing detection
  - `worktreeHasImplementationCommits` only checks latest commit message — if agent's last commit happens to start with "chore: worktree setup", it returns false even though earlier commits have real work
  - `view-work` action copies a diff command to clipboard instead of opening a terminal — less useful UX
  - Settings UI only saves to global scope (no project-scope editing controls)
  - No read-only effective/computed config display
  - Empty implementation log (no plan or decisions documented)

#### cx (Codex)
- Strengths:
  - **Full spec compliance**: all three pillars implemented (background agents, session-end detection, settings UI) including research
  - Proper `--background`/`--foreground` conflict detection with clear error message
  - Research-start background mode actually works — spawns detached tmux sessions
  - `aigon doctor --fix` integration detects stale implementing sessions for both features and research
  - `maybeFlagEndedSession` abstraction cleanly handles both feature and research entity types
  - `worktreeHasImplementationCommits` uses `rev-list --count` (commit-ahead count) — more robust than checking one commit message
  - Settings UI has three-column layout (global/project/effective) with per-scope editing
  - Read-only computed config JSON section
  - `view-work` opens a terminal with git status/log/diff — actionable UX
  - `reopen-agent` kills old tmux session before creating new one — prevents orphans
  - Clears flags on `research-submit` and `validation.js` autonomous submit path
  - Well-documented implementation log with plan, progress, and design decisions
- Weaknesses:
  - Larger change (1028 lines) — more surface area to review
  - `DASHBOARD_SETTINGS_SCHEMA` defined inline in dashboard-server rather than in config.js — duplicates knowledge about settings structure
  - Duplicates `getNestedValue`/`setNestedValue` imports from config.js but also re-implements config merge logic in `buildDashboardSettingsPayload` instead of using `getEffectiveConfig()`
  - Research stale-session detection in doctor uses `feature-{id}-{agent}.json` path for research entities — naming collision risk
  - Flagged status label "Session ended" with warning icon could be confused with the existing "Session ended" status (different icon but same text)

## Recommendation

**Winner:** cx (Codex)

**Rationale:** cx delivers a substantially more complete implementation. The critical differentiator is that cc's research-start `--background` flag is broken (parsed but never used), while cx's works end-to-end including tmux session spawning. cx also covers `aigon doctor` integration, proper flag clearing across all submit paths, a richer settings UI with per-scope editing, and actionable `view-work` and `reopen-agent` behaviors. The extra 600 lines are justified by the breadth of coverage.

**Cross-pollination:** Before merging, consider adopting from cc: (1) the `SETTINGS_SCHEMA` definition in `lib/config.js` rather than inline in dashboard-server — keeps config knowledge centralized; (2) the "Finished (unconfirmed)" label text which is more distinct from the existing "Session ended" status than cx's same-text-different-icon approach; (3) the atomic tmp+rename write pattern for status files.
