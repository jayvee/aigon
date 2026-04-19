# Implementation Log: Feature 270 - single-source-1-engine-only-spec-transitions
Agent: cc

## Plan
Make the workflow-core engine the single source of truth for lifecycle spec
transitions. Normal state-changing commands must refuse to infer state from
folder position — they fail with explicit migration guidance. Drift between
the engine's expected folder and the spec's actual folder is warned and
auto-corrected at transition time. Reset paths (`feature-reset`,
`research-reset`) remain out of scope — destructive flows still use direct
filesystem moves intentionally.

## Progress
- Removed silent auto-bootstrap from `aigon update` (was calling
  `bootstrapMissingWorkflowSnapshots` on every update). Replaced with a
  warning that points to `aigon doctor --fix`.
- `feature-close` (`lib/feature-close.js closeEngineState`): replaced silent
  `migrateEntityLifecycleIfNeeded` fallback with an explicit error pointing
  to `aigon doctor --fix` when the snapshot is missing.
- `feature-close` (`lib/feature-close.js commitSpecMove`): kept the stuck-spec
  force-move as a drift-correction fallback and added a warning log so drift
  is visible.
- `research-start`: removed silent migration for "folder says in-progress,
  engine has no snapshot". Now prints an error and exits.
- `research-eval` / `research-review` / `research-close`: `ensureResearchEngineState`
  now throws if the snapshot is missing, instead of silently migrating.
- `feature-eval` (`lib/commands/feature.js`): kept the idempotent fallback
  that moves a stuck in-progress spec into 04-in-evaluation, but added a
  drift warning so operators know the engine's effect didn't land.
- `entityCloseFinalize` (`lib/entity.js`): the post-engine "move to 05-done"
  fallback now logs a drift warning when it triggers.

## Decisions
- `aigon doctor --fix` remains the only explicit migration path for pre-engine
  entities. Every other normal state-changing command (close, eval, review,
  research-start, update) now refuses to silently reconstruct workflow state
  from folder position.
- Drift-correction fallbacks (stuck-spec force-moves after engine effects)
  were preserved — they exist to recover from rare effect failures, not to
  paper over missing snapshots. They now log `⚠️ Drift: ...` so investigators
  have a trail.
- `ensureResearchEngineState` signature simplified: it no longer accepts
  `mode` / `lifecycle` options because it no longer reconstructs state. All
  three callers were updated.
- Tests: pre-existing `scripts/check-test-budget.sh` overage (2866/2000 LOC)
  was present before this feature and was not increased by it. No new tests
  were added — the feature's regression surface is covered by existing
  migration and lifecycle tests (`tests/integration/migration.test.js`,
  `lifecycle.test.js`). Pro-gate tests required `npm link @aigon/pro` in the
  worktree to pass; that environment issue is unrelated to this feature.
