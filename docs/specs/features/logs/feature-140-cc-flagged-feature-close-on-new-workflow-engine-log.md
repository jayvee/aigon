# Implementation Log: Feature 140 - flagged-feature-close-on-new-workflow-engine
Agent: cc

## Plan

Route `feature-close` through the workflow-core engine's effect lifecycle behind a feature flag, keeping the legacy path as fallback.

## Progress

- Explored workflow-core engine (11 files, ~2500 lines): event-sourced state, XState machine, effect lifecycle with claim/reclaim semantics
- Explored existing feature-close handler (~600 lines): security scan, git merge, telemetry, state transition, spec move, worktree/branch cleanup
- Created `lib/workflow-close.js` bridge module (~280 lines)
- Integrated flagged path into `lib/commands/feature.js` feature-close handler
- Exported `persistEvents` and `runPendingEffects` from engine for bridge use
- Wrote 25 tests covering all acceptance criteria scenarios
- Updated CLAUDE.md module map and docs/architecture.md

## Decisions

### Feature flag surface
Chose `.aigon/config.json` `workflow.closeEngine` + env var `AIGON_WORKFLOW_CLOSE_ENGINE`. Config is the natural place (alongside `workflow.deployAfterDone`), env var allows per-run overrides for testing.

### Bridge architecture (not full replacement)
The workflow-core engine's close flow only handles spec-move and closeout-note effects. The existing close command does much more (security scan, git merge, telemetry, worktree cleanup). Rather than modeling all steps as effects, the bridge replaces only the **state transition + spec move** portion with the engine's durable effect lifecycle. Pre-merge and post-merge logic remain unchanged.

### Bootstrap from manifest
Since features started under the old system have no workflow-core events, the bridge synthesizes events (started → agent_ready → eval → winner.selected) to bootstrap the engine to `ready_for_review` state. This is idempotent — second calls are no-ops.

### `bridge.` effect IDs
Used `bridge.move_spec_to_done` instead of `close.move_spec_to_done` to avoid the engine's `materializePendingEffects` function overwriting custom payload paths with `.aigon/workflows/specs/` paths. The bridge operates on the real `docs/specs/features/` paths.

### Dual-write to legacy manifest
The flagged path also updates the legacy manifest for backward compatibility, so the dashboard and other commands continue to work regardless of the flag state.

### Async handler
Made the `feature-close` command handler `async` since the workflow-core API is promise-based. The CLI dispatcher already supports async handlers (checks for `.catch`).

## Issues

- Vercel Workflow DevKit validation hook fires false positives on all `require()` usage in this codebase since files contain "workflow" in their paths. These are Aigon's own Node.js modules, not Vercel Workflow sandbox code.
- One pre-existing test failure (`feature-eval --force`) in this worktree due to dependency version differences — not caused by this feature's changes.
