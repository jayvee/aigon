# Evaluation: Feature 40 - tmux-terminal-sessions

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-40-tmux-terminal-sessions.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-40-cc-tmux-terminal-sessions`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-worktrees/feature-40-cx-tmux-terminal-sessions`

## Evaluation Criteria

| Criteria | cc | cx |
|----------|----|----|
| Code Quality | 7/10 | 9/10 |
| Spec Compliance | 10/10 | 10/10 |
| Error Handling | 6/10 | 8/10 |
| Maintainability | 7/10 | 9/10 |
| Testing | 0/10 | 8/10 |

## Summary

### Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - Clean architecture — all tmux logic flows through `openSingleWorktree()`, single point of control
  - Correct config hierarchy using `getEffectiveConfig()` for project > global > default
  - Placeholder detection — skips sending `echo` commands to tmux
  - All 12 acceptance criteria met
- Weaknesses:
  - **Shell injection vulnerability** — `sessionName` interpolated directly into osascript without escaping
  - **No tmux availability check** — users get cryptic errors if tmux isn't installed
  - **Hardcoded agent list** in `sessions-close` (`['cc', 'gg', 'cx', 'cu', 'solo']`) — not maintainable
  - **No unit tests** added
  - No helper functions for tmux operations (inline logic)
  - ~116 lines net added

#### cx (Codex)
- Strengths:
  - **Well-factored helper functions** — `buildTmuxSessionName()`, `tmuxSessionExists()`, `createDetachedTmuxSession()`, `shellQuote()`, `openTerminalAppWithCommand()`, `ensureTmuxSessionForWorktree()`, `assertTmuxAvailable()`
  - **Shell escaping** via `shellQuote()` — handles apostrophes safely
  - **tmux availability check** upfront (`assertTmuxAvailable()`) with helpful "brew install tmux" message
  - **5 unit tests** for tmux helpers, all passing
  - **GUIDE.md updated** with config documentation
  - **Idempotent** — running feature-setup twice doesn't break (checks session existence first)
  - All 12 acceptance criteria met
  - ~182 lines net added
- Weaknesses:
  - No nested tmux detection (same as cc — spec left this as open question)
  - macOS-only Terminal.app assumption without platform check (same as cc)
  - Empty command in branch mode for tmux (user gets blank session)

### Neither implementation addresses:
- Nested tmux detection/warning (spec open question)
- Platform detection for non-macOS (both use Terminal.app + osascript)

## Recommendation

**Winner: cx (Codex)**

**Rationale:**

Codex's implementation is clearly superior in code quality and maintainability. Both implementations meet all 12 acceptance criteria equally, but Codex wins on:

1. **Safety** — `shellQuote()` helper prevents shell injection; cc has a latent vulnerability with unescaped `sessionName` in osascript
2. **Robustness** — `assertTmuxAvailable()` gives users a clear error with install instructions; cc fails with cryptic errors
3. **Maintainability** — 7 well-named helper functions vs inline logic; sessions-close uses dynamic session discovery vs hardcoded agent list
4. **Testing** — 5 unit tests vs zero
5. **Documentation** — GUIDE.md updated with config examples

**Cross-pollination:** Before merging cx, consider adopting nothing specific from cc. The cc implementation's single-entry-point architecture through `openSingleWorktree()` is a reasonable alternative design, but cx already achieves the same through `ensureTmuxSessionForWorktree()` with better factoring. The other implementations don't have particular features or aspects worth adopting beyond what the winner already provides.
