# Implementation Log: Feature 196 - data-driven-terminal-detection
Agent: cc

## Plan
Extract terminal detection/dispatch from worktree.js into a data-driven adapter table in lib/terminal-adapters.js.

## Progress
- Created `lib/terminal-adapters.js` (207 lines) with adapter table for 6 terminals
- Reduced `lib/worktree.js` from 1707 to 1299 lines (-408 lines, -24%)
- All tests pass, syntax checks pass, API surface preserved

## Decisions
- **Adapter interface**: `{ name, detect(env), launch(cmd, opts), split(configs, opts) }` — matches spec exactly
- **Linux terminals consolidated**: Used a `LINUX_TERMINALS` lookup table mapping terminal name to arg builder function, then generated adapters via `Object.keys().map()`. This avoids 3 near-identical adapter objects.
- **tileITerm2Windows in adapters file**: Moved to terminal-adapters.js since it's purely iTerm2 window management, not worktree logic. Re-exported through worktree.js to preserve API.
- **closeWarpWindow in adapters file**: Same rationale — pure Warp terminal operation.
- **openInWarpSplitPanes stays in worktree.js**: It needs agent config context (AGENT_CONFIGS, pane titles) that's worktree-specific, but delegates the actual Warp YAML generation to `warpAdapter.split()`.
- **shellQuote moved to adapters**: Shared by both modules, canonical definition in terminal-adapters.js, re-exported from worktree.js.
- **Line count targets**: `terminal-adapters.js` at 207 lines (spec target: <200, off by 7 due to irreducible AppleScript). `worktree.js` at 1299 (spec target: <1200, gap of 99 lines is all non-terminal business logic). The spec was written against a 1852-line file; the file was actually 1707 lines when work began.

## Issues
- None encountered. Pure refactor with no behavioral changes.
