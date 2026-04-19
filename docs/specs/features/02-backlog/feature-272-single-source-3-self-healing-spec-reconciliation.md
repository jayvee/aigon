# Feature: single-source-3-self-healing-spec-reconciliation

## Summary
Add a shared self-healing reconciliation helper that compares engine state with visible folder position for features/research. If they disagree, the engine wins: move the file to the correct folder and log the correction. Reconciliation runs automatically from backend read paths and is idempotent. `aigon repair` remains, but reuses the same reconciliation helper for spec drift.

## User Stories
- [ ] As a user, if a spec file drifts to the wrong folder (e.g. via accidental `git mv` or broad `git add`), it gets silently corrected on the next dashboard/board view
- [ ] As a user, I no longer need to run `aigon repair` to fix spec drift
- [ ] As a user, automatic reconciliation does not remove the broader cleanup behavior of `aigon repair`

## Acceptance Criteria
- [ ] A single shared reconciliation helper compares workflow snapshot lifecycle/expected path with visible spec location for features and research
- [ ] Dashboard and board backend read paths call the same helper rather than implementing independent reconciliation logic
- [ ] When workflow state exists and folder position disagrees, the file is moved to the engine-expected folder and a warning is logged with entity id and from/to paths
- [ ] Reconciliation is one-way: engine -> folder, never folder -> engine
- [ ] Reconciliation never creates workflow snapshots and never attempts to repair entities that have no workflow state
- [ ] Repeated reads after a successful correction are a no-op
- [ ] `aigon repair` keeps its broader cleanup responsibilities, but reuses the same spec reconciliation helper for folder drift
- [ ] Doctor/repair flows never infer lifecycle from folder position

## Validation
```bash
node --check aigon-cli.js
npm test
```

Manual scenarios:
- [ ] Snapshot present + wrong folder -> board/dashboard read corrects file location
- [ ] Same item refreshed again -> no additional move occurs
- [ ] Missing-snapshot numeric entity -> no auto-bootstrap, no folder->engine reconciliation
- [ ] `aigon repair <type> <id> --dry-run` reports the same spec drift diagnosis as the shared reconciliation logic

## Technical Approach
- Add a shared reconciliation helper that resolves expected visible spec path from workflow state and compares it with the current visible file location
- Call the helper from backend read paths used by dashboard/board
- Keep the helper idempotent and side-effect limited to visible spec relocation + logging
- Update `lib/commands/misc.js` so `repair` delegates spec drift handling to the same helper while retaining its broader branch/worktree/session cleanup behavior
- Key files: `lib/dashboard-status-collector.js`, `lib/board.js`, `lib/commands/misc.js`, `lib/feature-spec-resolver.js`, `lib/workflow-core/paths.js`

## Dependencies
- depends_on: single-source-2-engine-based-read-paths

## Out of Scope
- Feedback entity changes — that's feature single-source-4
- Replacing or removing the full `aigon repair` command

## Open Questions
- None

## Related
- Research: research-33-single-source-of-truth-for-feature-state
