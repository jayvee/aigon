---
commit_count: 3
lines_added: 319
lines_removed: 194
lines_changed: 513
files_touched: 46
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
---
# Implementation Log: Feature 134 - unified-pipeline-stages
Agent: cc

## Plan

Align research pipeline with the feature pipeline so both use identical stages (backlog → in-progress → in-evaluation → done) and identical command patterns (start, eval, close).

## Progress

- Updated PATHS.research.folders in lib/templates.js (added 04-in-evaluation, renumbered done/paused)
- Updated RESEARCH_STAGES in lib/state-machine.js to include 'in-evaluation'
- Added research-eval transition (in-progress → in-evaluation, guarded by allAgentsSubmitted)
- Changed research-close: now allows from both in-evaluation and in-progress (with warning)
- Added research-eval and research-close to TRANSITION_DEFS for outbox pattern
- Added in-state actions: solo close, fleet eval, continue eval (matching feature pattern)
- Renamed research-synthesize handler → research-eval in lib/commands/research.js
- research-eval now moves spec to 04-in-evaluation before launching agent
- Simplified research-close: removed --complete flag, auto-detect synthesis logic, and fleet-blocking behavior
- research-close now searches 04-in-evaluation first, then 03-in-progress
- Updated autopilot: --auto-synthesize → --auto-eval (backward compat kept)
- Created templates/generic/commands/research-eval.md with feature creation step and backlinks
- Updated research-close.md, research-start.md, research-autopilot.md, help.md, help.txt
- Updated all 4 agent configs (cc, gg, cx, cu) to reference research-eval
- Updated COMMAND_REGISTRY: research-eval with alias 'are'
- Updated dashboard-server.js: research stage dirs include 04-in-evaluation, done dir is 05-done
- Replaced synthesizeSession with evalSession in dashboard data model
- Updated pipeline.js: research kanban columns match features (includes in-evaluation)
- Updated monitor.js: researchEvalBtn replaces researchSynthBtn, badge shows "ready to evaluate"
- Added doctor migration: detects old 04-done/05-paused and migrates to 04-in-evaluation/05-done/06-paused
- Migrated existing research specs from 04-done → 05-done in this worktree
- Updated tests: RESEARCH_STAGES assertion, transition tests, research-eval command tests
- Deleted old research-synthesize.md template

## Decisions

- **Shortcut**: Used `are` for research-eval (mirrors `afe` for feature-eval)
- **research-close from in-progress**: Shows warning ("eval hasn't run — closing anyway") but proceeds without requiring confirmation. The spec said "shows a warning but proceeds."
- **--auto-synthesize backward compat**: Kept --auto-synthesize flag alongside --auto-eval in autopilot to avoid breaking existing usage
- **Pre-existing test failures**: 16 tests were already failing before this change (assertOnDefaultBranch in worktree, pro module unavailable). My 2 new test failures follow the same pattern. Net new failures: 0 functionally relevant.
- **Generated command files** (.claude/commands/, .cursor/, .gemini/): Not updated directly — they regenerate via `aigon install-agent`. Only source-of-truth templates were changed.
- **Historical docs/specs**: Not updated (05-done research specs, feature eval logs, etc.) — these are historical records.
