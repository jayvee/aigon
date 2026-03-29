# Evaluation: Feature 138 - import-aigon-next-workflow-core

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-138-import-aigon-next-workflow-core.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-138-cc-import-aigon-next-workflow-core`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-worktrees/feature-138-cx-import-aigon-next-workflow-core`

## Evaluation Criteria

| Criteria | cc | cx |
|---|---|---|
| Code Quality | 9/10 | 7/10 |
| Spec Compliance | 9/10 | 8/10 |
| Performance | 8/10 | 7/10 |
| Maintainability | 9/10 | 7/10 |
| **Total** | **35/40** | **29/40** |

## Summary

| Agent | Lines | Score |
|---|---|---|
| cc | 2270 (1708 source + 562 test) | 35/40 |
| cx | 1057 (863 source + 194 test) | 29/40 |

### Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - **Full XState integration**: Uses `xstate@^5` with a proper state machine (`machine.js`) for lifecycle transitions and `snapshot.can()` for action derivation — the machine is the single source of truth for validity
  - **Comprehensive effect orchestration**: Engine includes `claimNextEffect`, `completeClaimedEffect`, `runPendingEffects` with retry/timeout logic, claim expiry, and an `EffectExecutionInterruptedError` — this is the full durable effect loop from Aigon Next
  - **Real effect implementations**: `effects.js` implements `ensure_feature_layout`, `move_spec`, `write_eval_stub`, `write_close_note`, and stubs `ensure_agent_session` — effects actually do filesystem work
  - **Extensive tests**: 39 tests covering types, paths, event-store, snapshot-store, lock, projector, actions, and engine persistence round-trips
  - **Clean types module**: Frozen enum-like objects (`FeatureMode`, `LifecycleState`, etc.) with JSDoc and factory helpers
  - **Well-structured barrel export** in `index.js` — explicit named exports with clear categories
  - **Documentation updated**: CLAUDE.md module map and `docs/architecture.md` both updated with workflow-core docs and migration plan
- Weaknesses:
  - **xstate dependency**: Adds a runtime dependency (~150KB). The spec doesn't mention xstate, and Aigon is otherwise dependency-light
  - **Engine is 755 lines**: The close/claim/effect orchestration is thorough but adds complexity that won't be exercised until future features wire it up
  - **Test harness uses setTimeout(2000)**: Async tests complete via a 2-second delay rather than proper awaiting — fragile under load

#### cx (Codex)
- Strengths:
  - **No new dependencies**: Avoids xstate entirely; implements state validation as plain `validateEvent()` switch statement
  - **Compact**: 863 source lines vs cc's 1708 — roughly half the code for the same feature surface
  - **ctx wiring**: Added `workflowCore` to `buildCtx()` in `shared.js` and created `lib/workflow-core.js` re-export facade — immediately usable by commands
  - **Derived effect events**: `buildDerivedEffectEvents()` automatically generates `effect.requested` events from lifecycle transitions, keeping the event stream self-documenting
  - **Properly awaited tests**: Uses `async function run()` with sequential `await testAsync()` — no setTimeout hack
  - **Effect lifecycle granularity**: Exposes `markEffectClaimed`, `expireEffectClaim`, `reclaimEffect`, `markEffectSucceeded`, `markEffectFailed` as individual public APIs
- Weaknesses:
  - **No XState machine**: State validity is hand-coded in `validateEvent()` — a parallel, manually-maintained truth source that can drift from the projector
  - **Effect runner is a no-op stub**: `effects/runner.js` defaults to `async () => {}` — no actual effect implementations. The spec says "effect lifecycle model" should be included; this only models the events, not the execution
  - **Only 8 tests**: Covers the happy path but misses edge cases (pause/resume, agent signals, dropped agents, session lost, heartbeat expired, lock contention on the happy path)
  - **Types as arrays**: `FEATURE_MODES`, `LIFECYCLE_STATES` are plain arrays of strings — no named constants, no factory helpers, harder to use as documentation
  - **showFeature reads snapshot first**: Uses cached snapshot.json if available, which could serve stale data if events were appended without updating the snapshot (e.g., external tooling or crash recovery)
  - **AGENTS.md modified**: Spec says "no command migration" — editing AGENTS.md is minor but unnecessary for a foundational-only feature

## Recommendation

**Winner:** cc (Claude)

**Rationale:** cc delivers a faithful, production-quality port of the Aigon Next workflow engine with a proper XState state machine as the single source of truth, real effect implementations, and thorough test coverage. cx is notably more compact, but the lack of effect implementations, minimal test coverage, and hand-coded state validation mean it would need significant additional work before consumers can rely on it.

**Cross-pollination:** Before merging cc, consider adopting from cx: the `ctx.workflowCore` wiring in `shared.js` + `lib/workflow-core.js` facade. This makes the module immediately accessible to commands via the ctx pattern without any consumer having to know the internal path. cc's implementation is isolated but not yet wired into ctx.
