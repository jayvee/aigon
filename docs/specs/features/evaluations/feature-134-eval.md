# Evaluation: Feature 134 - unified-pipeline-stages

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-134-unified-pipeline-stages.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-134-cc-unified-pipeline-stages`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-worktrees/feature-134-cx-unified-pipeline-stages`

## Evaluation Criteria

| Criteria | cc | cx |
|---|---|---|
| Code Quality | 8/10 | 7/10 |
| Spec Compliance | 9/10 | 7/10 |
| Performance | 8/10 | 8/10 |
| Maintainability | 8/10 | 7/10 |
| **Total** | **33/40** | **29/40** |

## Summary

| Agent | Lines | Score |
|---|---|---|
| cc | +319 / -194 | 33/40 |
| cx | +410 / -422 | 29/40 |

### Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - Added `research-eval` and `research-close` to `TRANSITION_DEFS` — required for the outbox/manifest pattern (`requestTransition()`)
  - Clean Drive/Fleet distinction in state-machine actions (solo → close, fleet → eval)
  - Comprehensive `research-eval.md` template (149 lines) with detailed step-by-step synthesis workflow, deduplication rules, feature creation with backlinks, and user approval flow
  - `--force` flag preserved on `research-eval` for edge cases (agents unfinished)
  - `research-close` explicitly searches `04-in-evaluation` first, then falls back to `03-in-progress`
  - Monitor badge shows "evaluating" for in-evaluation stage
- Weaknesses:
  - Did not update `findEntityStage` in worktree.js for research stages (only changed `buildResearchAgentCommand`)
  - Did not add `research-synthesize` → `research-eval` deprecation alias in shared.js
  - Did not update `docs/architecture.md` or `docs/development_workflow.md`

#### cx (Codex)
- Strengths:
  - Added `research-synthesize` → `research-eval` deprecation alias in `shared.js` (smooth upgrade path)
  - Updated `lib/board.js` comprehensively for new research folder numbering
  - Updated `findEntityStage` in `worktree.js` with new research stage dirs
  - Added `research-eval` as a dashboard drag-drop action in `actions.js` and `pipeline.js`
  - Updated `docs/architecture.md` and `docs/development_workflow.md`
  - Added `research-pause` from `in-evaluation` transition (extra flexibility)
- Weaknesses:
  - **Critical: Missing `research-eval` and `research-close` in `TRANSITION_DEFS`** — `requestTransition()` will throw `Unknown action` when these are called through the manifest/outbox pattern. This breaks the core state management flow.
  - Removed `--force` flag from `research-eval` — no way to proceed when agents are stuck
  - Duplicate `'04-in-evaluation'` keys in `board.js` object literals (harmless but sloppy)
  - `research-eval.md` template is minimal (70 lines) vs cc's thorough 149-line template
  - `evalPrefix` matching in dashboard-server.js uses `s === evalPrefix || s.startsWith(...)` pattern that could false-match session names

## Recommendation

**Winner:** cc

**Rationale:** cc's implementation is more correct where it matters most — the `TRANSITION_DEFS` entries are essential for the outbox/manifest pattern that powers crash-safe state transitions. cx's omission of these is a blocking bug. cc also delivers a significantly more detailed eval template that will produce better synthesis sessions.

**Cross-pollination:** Before merging, consider adopting from cx:
- The `research-synthesize` → `research-eval` deprecation alias in `shared.js` (smooth migration for existing users)
- The `lib/board.js` updates for research folder numbering (cc didn't touch board.js)
- The `findEntityStage` update in `worktree.js` for new research stage dirs
- The `research-eval` drag-drop action in `dashboard/js/actions.js` and `pipeline.js`

