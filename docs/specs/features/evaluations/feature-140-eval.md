# Evaluation: Feature 140 - flagged-feature-close-on-new-workflow-engine

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-140-flagged-feature-close-on-new-workflow-engine.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-140-cc-flagged-feature-close-on-new-workflow-engine`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-worktrees/feature-140-cx-flagged-feature-close-on-new-workflow-engine`

## Evaluation Criteria

| Criteria | cc | cx |
|---|---|---|
| Code Quality | 9/10 | 7/10 |
| Spec Compliance | 9/10 | 7/10 |
| Performance | 8/10 | 8/10 |
| Maintainability | 9/10 | 6/10 |
| **Total** | **35/40** | **28/40** |

## Summary

| Agent | Lines | Score |
|---|---|---|
| cc | 1106 | 35/40 |
| cx | 271 | 28/40 |

### Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - Clean separation: new `lib/workflow-close.js` bridge module (303 lines) isolated from feature.js
  - Feature flag via config (`workflow.closeEngine`) + env var (`AIGON_WORKFLOW_CLOSE_ENGINE`) -- matches existing Aigon config patterns
  - Full effect lifecycle: bootstrap from manifest, close with durable effects, resume interrupted close, blocked retry detection, reclaim with `--reclaim`
  - 25 dedicated tests in `lib/workflow-close.test.js` covering all spec acceptance criteria
  - All tests pass (25/25), syntax clean, no regressions
  - Dual-write to legacy manifest for backward compatibility
  - Thorough documentation: CLAUDE.md module map updated, architecture.md migration plan updated, new "Workflow-Close Bridge" section
  - Smart `bridge.` effect ID prefix to avoid engine path conflicts
  - Complete implementation log with clear design decisions
- Weaknesses:
  - `defaultCloseExecutor` does `require('fs/promises')` inside function body instead of at module top -- minor style issue
  - Bootstrap function synthesizes 5+ events to reach `ready_for_review` -- works but is somewhat fragile if the engine's event vocabulary changes

#### cx (Codex)
- Strengths:
  - Lean approach: no new file, all logic inline in feature.js (~92 lines of new functions + 25 lines of integration)
  - Good engine-level fix: changed `||` to `??` for `claimTimeoutMs`/`lockRetryDelayMs`/`maxBusyRetries` in `runPendingEffects` -- this is a real bug fix that allows passing `0` values (critical for `--reclaim`)
  - Tests added to both `workflow-core.test.js` (3 tests: close, blocked retry, reclaim) and `aigon-cli.test.js` (4 tests: flag gating, fallback error detection)
  - All new tests pass, no regressions introduced
  - Explicit `workflowPathEligible` guard: only uses workflow path for solo closes (no agent, no adopt, no keep-branch) -- thoughtful scoping
  - Sets `process.exitCode = 1` on non-complete workflow results -- good for automation
  - Fallback error detection (`isWorkflowCloseFallbackError`) gracefully falls back to legacy path when workflow state doesn't exist
  - Architecture docs updated with flag enablement instructions
- Weaknesses:
  - **No bootstrap from manifest**: calls `tryCloseFeatureWithEffects` directly -- this will fail for any feature that was started under the old system (no workflow-core events exist). The fallback catches this, but it means the workflow path is effectively dead for all existing features
  - **No CLAUDE.md update**: module map not updated to reflect the new exports from feature.js
  - Config key naming inconsistency: uses `workflow.featureClose.useWorkflowEngine` AND `workflow.useWorkflowEngineFeatureClose` (two paths) vs cc's simpler `workflow.closeEngine`
  - Flag env var uses different name (`AIGON_FEATURE_CLOSE_WORKFLOW_ENGINE`) than cc's (`AIGON_WORKFLOW_CLOSE_ENGINE`) -- cc's is more consistent with the `AIGON_WORKFLOW_*` namespace
  - Helper functions (`parseBooleanFlag`, `isWorkflowCloseFallbackError`, `runWorkflowEngineFeatureClose`) exported from feature.js rather than in a dedicated module -- pollutes the command module's API surface
  - No implementation log decisions section -- log was filled in but decisions are thin

## Recommendation

**Winner:** cc

**Rationale:** cc delivers a more complete and maintainable solution. The dedicated bridge module is well-separated, tests are comprehensive (25 vs 7), and critically, the bootstrap-from-manifest logic means the workflow path actually works for existing features. cx's implementation would silently fall back to the legacy path for every feature started before the flag was enabled, making the new path untestable in practice.

**Cross-pollination:** Before merging cc, adopt cx's `||` to `??` fix in `engine.js:runPendingEffects` (lines 582-584). This is a genuine bug: `claimTimeoutMs: 0` and `maxBusyRetries: 0` are valid values that `||` incorrectly treats as falsy. cc's `--reclaim` feature relies on passing `claimTimeoutMs: 1` to work around this, but `0` is the correct value. Also consider cx's `workflowPathEligible` guard that scopes the workflow path to solo closes only -- this is a reasonable safety boundary for a first migration.
