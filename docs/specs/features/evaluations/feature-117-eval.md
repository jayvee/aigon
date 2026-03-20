# Evaluation: Feature 117 - rename-setup-to-start

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-117-rename-setup-to-start.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-117-cc-rename-setup-to-start`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-worktrees/feature-117-cx-rename-setup-to-start`

## Evaluation Criteria

| Criteria | cc | cx |
|---|---|---|
| Code Quality | 8/10 | 7/10 |
| Spec Compliance | 8/10 | 9/10 |
| Performance | 8/10 | 7/10 |
| Maintainability | 9/10 | 6/10 |
| **Total** | **33/40** | **29/40** |

## Summary

| Agent | Lines | Score |
|---|---|---|
| cc | 504 (52 files) | 33/40 |
| cx | 2321 (128 files) | 29/40 |

### Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - Clean, minimal diff — only touched source-of-truth files, correctly skipped generated working copies (.claude/commands/, .cursor/commands/, .gemini/commands/)
  - Thorough shortcut reassignment: `afs` → feature-start, `afsb` → feature-submit, `ars` → research-start, `arsy` → research-synthesize (no conflicts)
  - Dashboard simplification done cleanly — removed `requestFeatureOpen` chaining as spec requires
  - Good implementation log documenting decisions
  - Preserved historical content (CHANGELOG, done specs)
- Weaknesses:
  - Did not implement the "already running" guard from the spec (AC: "Running feature-start on an already in-progress feature prints clear message")
  - Did not implement the behavioral change to auto-open terminals after workspace creation (AC: "feature-start creates worktree/branch AND opens terminal")

#### cx (Codex)
- Strengths:
  - Implemented the "already running" guard for both feature-start and research-start (spec AC item)
  - Implemented the behavioral change — feature-start now calls `feature-open` to auto-launch terminals after workspace creation (both Drive worktree and Fleet)
  - Updated dashboard tests to reflect new patterns
  - Updated sidebar.js default button label to "Start"
  - Updated board.js shortcut reference
- Weaknesses:
  - Committed 86 generated working copy files (.claude/commands/, .cursor/commands/, .gemini/commands/) — these are gitignored and should not be in the diff (breaks the install-agent regeneration model)
  - Alias conflict: kept `arse` for research-start AND kept `ars` for research-synthesize — didn't reassign cleanly
  - Sparse implementation log (empty sections)
  - Some dashboard test rewrites go beyond the rename scope (changed feature-create flow to use ask sessions instead of action API)
  - Changed FEATURE_ACTIONS label from `'Start feature'` to `'Start'` — a minor deviation from cc's preservation of the descriptive label

## Recommendation

**Winner:** cc

**Rationale:** cc's implementation is cleaner and more maintainable — it correctly avoids committing generated files (saving ~1800 lines of noise), has no alias conflicts, and provides a thorough implementation log. However, cx implemented two important spec acceptance criteria that cc missed: the "already running" guard and the auto-open terminal chaining.

Before merging, consider adopting from cx: (1) the "already running" guard in feature-start (lines ~497-501 in cx's feature.js) and research-start (lines ~142-146 in cx's research.js), and (2) the terminal auto-open chaining where feature-start calls `feature-open` after workspace creation instead of printing manual "next steps" instructions.
