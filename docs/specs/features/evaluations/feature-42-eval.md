# Evaluation: Feature 42 - conductor

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-42-conductor.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-42-cc-conductor`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-worktrees/feature-42-cx-conductor`
- [x] **gg** (Gemini): `/Users/jviner/src/aigon-worktrees/feature-42-gg-conductor`

## Evaluation Criteria

| Criteria | cc | cx | gg |
|----------|---|---|---|
| Code Quality | 9 | 7 | 7 |
| Spec Compliance | 7 | 9 | 8 |
| Performance | 8 | 7 | 7 |
| Maintainability | 9 | 6 | 7 |

## Summary

### Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - Recognised the conduct command was already ~95% implemented and did a gap analysis instead of rewriting
  - Minimal, surgical change: only added per-agent notifications (the one missing AC)
  - Added 8 unit tests for the helper logic used in the monitor loop
  - Created 3 follow-up feature specs capturing real limitations found during live testing
  - Smallest diff (356 lines added) — high signal-to-noise ratio
- Weaknesses:
  - Did not add `feature-signal` command (relies on existing log frontmatter instead)
  - Did not update the `feature-submit.md` template
  - The gap analysis approach means no new architectural capability was added

#### cx (Codex)
- Strengths:
  - Most comprehensive implementation: full conduct state persistence, task decomposition, run spawning, status refresh, failure detection/reassignment, synthesis report
  - Added `feature-signal` command with proper main-repo-relative path resolution
  - Added `sessions-close` pre-close status check warning
  - Added conduct state persistence under `.aigon/conduct/` for resumability
  - Updated `feature-submit.md` template to signal on submit
- Weaknesses:
  - Largest diff (668 lines in aigon-cli.js) with significant complexity
  - Duplicated `.env.local` entries (appended instead of updated)
  - Uses `spawn` with detached processes rather than tmux sessions, diverging from established patterns
  - `async` conduct command — the CLI command handler system may not handle async properly
  - Task decomposition is deterministic from AC section rather than LLM-based (spec says LLM)
  - Many new helper functions (getConductStatePath, loadConductState, saveConductState, isPidAlive, extractMarkdownSectionBody) add maintenance surface

#### gg (Gemini)
- Strengths:
  - Added `feature-signal` command with git common-dir resolution for worktree visibility
  - Added generic `llmCall` helper and `decomposeFeature` using LLM as spec intended
  - Implemented both pipeline and arena modes
  - Enhanced Ralph loop to accept task objects via `--task-file` flag
  - Updated `sessions-close` with status file checks
  - Updated `feature-submit.md` template
- Weaknesses:
  - `async` conduct command — same concern as cx about CLI handler compatibility
  - `createAgentWorktree` duplicates existing `feature-setup` logic instead of reusing it
  - Arena mode doesn't use tmux sessions (uses `spawn` with detached processes)
  - Pipeline orchestration logic is complex but untested
  - `llmCall` shells out to `claude` CLI which is fragile and slow
  - No unit tests added

## Recommendation

**Winner:** cc (Claude)

**Rationale:**

CC recognised the critical insight: the `conduct` command was already implemented in the codebase. Rather than building a parallel implementation, CC did a gap analysis, found the one missing acceptance criterion (per-agent notifications), implemented it cleanly, and added tests. The diff is minimal (356 lines vs 668/448) and the code follows existing patterns.

More importantly, CC's live testing surfaced the real problem the user hit: **`--auto-submit` doesn't bypass the manual testing gate in `feature-implement`**. The agent stops and waits for human confirmation before submitting, which defeats autonomous conduction. CC captured this as a follow-up feature (`feature-autonomous-submit.md`), which is the actual fix needed.

CX and GG both built significant new infrastructure (state persistence, task decomposition, signal files) but introduced `async` command handlers that may not work with the synchronous CLI dispatcher, and both use `spawn` with detached processes instead of the established tmux session pattern.

**Cross-pollination:** Before merging CC, consider adopting from CX/GG:
- The `feature-signal` command (both CX and GG implemented this cleanly) — it's specified in the spec's "Agent Status Signal" section and provides a cleaner contract than relying on log frontmatter
- The `feature-submit.md` template update to call `aigon feature-signal` (both CX and GG added this)
- The `sessions-close` pre-close status check from CX — warns before killing sessions with non-submitted agents

