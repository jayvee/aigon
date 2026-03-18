---
status: submitted
updated: 2026-03-18T21:15:44.750Z
startedAt: 2026-03-18T20:56:14.928Z
events:
  - { ts: "2026-03-18T20:56:14.928Z", status: implementing }
  - { ts: "2026-03-18T21:06:23.996Z", status: implementing }
  - { ts: "2026-03-19T00:00:00.000Z", status: submitted }
  - { ts: "2026-03-18T21:15:44.750Z", status: submitted }
---

# Implementation Log: Feature 102 - idempotent-outbox-transitions
Agent: cc

## Plan

Read the spec, explored existing state-machine.js (pure, no I/O), manifest.js (atomic JSON read/write, locking), and feature.js commands. The spec called for:
1. `requestTransition()` in state-machine.js — validates + records transition + pending ops
2. Commands using requestTransition instead of direct moveFile calls
3. Crash recovery via outbox replay at command start
4. Idempotent side effects

Key decision: `requestTransition` lazy-requires `./manifest` to avoid circular dependency at load time (state-machine is pure at import, gains I/O only when requestTransition is called).

## Progress

- Added `TRANSITION_DEFS` map (action → from stages, to stage, sideEffects fn)
- Added `requestTransition(featureId, action, opts)` — validates current stage, acquires lock, writes new stage + pending ops atomically, returns ops list
- Added `completePendingOp(featureId, op)` — removes first occurrence of completed op from manifest.pending
- Made `setupWorktreeEnvironment` log creation idempotent (added `if (!fs.existsSync(logPath))` guard)
- Modified `feature-setup`: outbox replay check, requestTransition before spec move, completePendingOp calls after each op
- Modified `feature-eval`: outbox replay check, requestTransition before spec move, completePendingOp after spec move
- Modified `feature-close`: outbox replay fast-path at top, requestTransition after merge succeeds, completePendingOp after spec move
- Added 14 tests covering TRANSITION_DEFS structure, valid/invalid requestTransition calls, completePendingOp behavior
- Fixed existing feature-eval test to set up manifest state before running (test used feature 51 which had a 'done' manifest from bootstrap)

## Decisions

- **requestTransition placement in feature-close**: Called AFTER the merge succeeds (not before), so the stage advances to 'done' only after the git work is done. The replay path handles crashes after this point.
- **feature-close graceful re-run**: If requestTransition throws "Invalid transition" on re-run (already closed), the error is swallowed and completePendingOp is still called — this handles the case where someone runs feature-close twice.
- **TRANSITION_DEFS in state-machine.js**: Kept co-located with the state machine logic per spec ("Extend lib/state-machine.js"), despite breaking the "pure" invariant. The lazy require('./manifest') inside functions keeps the module's default import side-effect-free.
- **Scope**: feature-prioritise was NOT included in requestTransition integration (spec only listed feature-setup, feature-close, feature-eval, feature-submit; feature-submit is a slash command not a CLI command).
