---
status: implementing
updated: 2026-03-18T01:16:12.687Z
startedAt: 2026-03-18T01:12:49.765Z
events:
  - { ts: "2026-03-18T01:12:49.765Z", status: implementing }
  - { ts: "2026-03-18T01:16:12.687Z", status: implementing }
---

# Implementation Log: Feature 91 - fix-feature-87-ctx-regressions
Agent: cc

## Summary

Found and fixed 5 board.js functions incorrectly placed in `ctx.utils` destructuring across 4 command files. These would all crash at runtime with `TypeError: X is not a function`.

## Decisions

**Investigation approach**: Compared each command file's destructure list against actual module exports via `node -e "Object.keys(require('./lib/X'))"`. This revealed the mismatches cleanly without needing to run commands.

**Fix scope**: Only moved the misrouted functions to their correct `ctx.board` destructure. Did not refactor or consolidate beyond what was necessary.

**getGitStatusPorcelain**: Was dead code in the `ctx.utils` destructure (undefined, but only accessed with a guard `u.getGitStatusPorcelain ? ...`). Removed the dead destructure. The alias `gitStatusPorcelain` from `ctx.validation` was already correct on line 90.

## Regressions Fixed

| Function | File | Was in | Should be in |
|---|---|---|---|
| `loadBoardMapping` | feature.js | ctx.utils | ctx.board |
| `loadBoardMapping` | research.js | ctx.utils | ctx.board |
| `displayBoardKanbanView` | infra.js | ctx.utils | ctx.board |
| `displayBoardListView` | infra.js | ctx.utils | ctx.board |
| `ensureBoardMapInGitignore` | setup.js | ctx.utils | ctx.board |
| `getGitStatusPorcelain` (dead) | feature.js | ctx.utils (wrong) | ctx.validation (already aliased) |

## Results

- All 159 tests pass
- 4 command files fixed
- Spec filled out (was empty template)
