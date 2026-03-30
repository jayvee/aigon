# Implementation Log: Feature 175 - research-workflow-engine-migration
Agent: cx

## Plan
- Move research lifecycle writes (`start/eval/close`) onto workflow-core snapshots + events.
- Reuse shared workflow rules/machine/action derivation for both feature and research.
- Generalize workflow snapshot read adapters so dashboard research actions are engine-derived.
- Keep fallback read paths for legacy/non-engine records.
- Update architecture docs for unified feature+research engine ownership.

## Progress
- Added shared workflow rules layer:
  - `lib/workflow-rules.js`
  - `lib/research-workflow-rules.js`
- Generalized workflow-core machine/action derivation:
  - `lib/workflow-core/machine.js`
  - `lib/workflow-core/actions.js`
- Extended workflow-core pathing for research state:
  - `lib/workflow-core/paths.js`
- Extended projector to understand research lifecycle events:
  - `lib/workflow-core/projector.js`
- Added research workflow engine module (event log + snapshot + projection moves):
  - `lib/workflow-core/research-engine.js`
- Wired research lifecycle commands to engine-backed sync APIs:
  - `lib/commands/research.js` (`research-start`, `research-eval`, `research-close`)
- Generalized snapshot read adapter for feature + research:
  - `lib/workflow-snapshot-adapter.js`
- Added research snapshot-backed read model:
  - `lib/workflow-read-model.js`
- Updated dashboard status/detail reads to consume research snapshots:
  - `lib/dashboard-status-collector.js`
  - `lib/dashboard-server.js`
- Added/updated tests:
  - `lib/workflow-core/workflow-core.test.js`
  - `lib/workflow-snapshot-adapter.test.js`
- Regenerated workflow diagrams:
  - `docs/generated/workflow/*.svg`
- Restarted AIGON server:
  - `aigon server restart`

## Decisions
- Kept feature engine behavior intact and added research support through the same workflow-core primitives (paths, projector, machine/action derivation, snapshots).
- Used synchronous research engine wrappers for command handlers so existing command/test call patterns remain compatible.
- Preserved fallback read behavior for non-engine/legacy entities while preferring snapshot-backed reads when available.
