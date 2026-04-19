# Implementation Log: Feature 272 - single-source-3-self-healing-spec-reconciliation
Agent: cx

## Plan
- Add one shared reconciliation helper for workflow-backed feature/research specs.
- Invoke it from the shared workflow read model so board and dashboard reads self-heal through the same path.
- Reuse the same helper from `aigon repair` in dry-run and execution mode without reintroducing folder-to-engine inference.

## Progress
- Extended `lib/feature-spec-resolver.js` from feature-only lookup to shared feature/research visible-spec lookup while preserving the feature-facing API.
- Added `lib/spec-reconciliation.js` to compare workflow snapshot lifecycle vs visible spec location, move drifted specs back to the engine-expected folder, and log the correction.
- Hooked reconciliation into `lib/workflow-read-model.js`, so snapshot-backed reads automatically self-heal visible folder drift for both board and dashboard consumers.
- Simplified `lib/commands/misc.js` repair flow to reuse the shared reconciliation diagnosis and move path, while keeping broader cleanup for done-state sessions/worktrees/branches/state files.
- Updated `AGENTS.md` and `docs/architecture.md` for the new shared module and the read-path responsibility shift.

## Decisions
- Kept reconciliation strictly one-way: if no workflow snapshot exists, the helper reports `missing-workflow-state` and does nothing.
- Limited helper side effects to visible spec relocation only; it never creates workflow state or infers lifecycle from folder position.
- Preserved safety around placeholder specs by allowing replacement of placeholder destinations but refusing to overwrite a non-placeholder destination file.
- Kept the dashboard/board integration centralized in `workflow-read-model` rather than duplicating reconciliation calls in each consumer.
- Validation results:
  - `node --check aigon-cli.js`
  - `node --check lib/spec-reconciliation.js`
  - `node --check lib/feature-spec-resolver.js`
  - `node --check lib/workflow-read-model.js`
  - `node --check lib/commands/misc.js`
  - `npm test` failed in existing `tests/integration/pro-gate.test.js` assertions unrelated to this feature (`isProAvailable()` expected `true` in Pro-gate scenarios but returned `false`)
  - `aigon server restart` exited successfully and reported `✅ Server restarting via system service.`

## Conversation Summary
- The implementation followed the feature spec directly from the prepared worktree for feature `272`.
- No extra user clarification was needed; the work focused on unifying spec-drift reconciliation and preserving `aigon repair` cleanup behavior.
