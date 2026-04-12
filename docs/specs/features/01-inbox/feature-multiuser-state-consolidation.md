# Feature: multiuser-state-consolidation

## Summary

First migration using the migration framework: consolidate the 4 separate state files per entity (`events.jsonl`, `snapshot.json`, `review-state.json`, `stats.json`) into a single `state.json` file. This reduces complexity in the engine (one read/write path instead of four), simplifies future relocation, and eliminates the need for separate readers in stats aggregation, board, dashboard, and doctor. The migration runs as a mass migration on upgrade — all entities are converted at once, with automatic backup via the migration framework. Applies to all entity types (features, research, feedback).

## Sequence

This is **feature 1 of 5** in the `multiuser-` series:
1. `multiuser-migration-framework` — the framework this migration uses
2. `multiuser-state-consolidation` ← this feature
3. `multiuser-auto-assignee` — adds assignee field to state
4. `multiuser-committed-state` — relocates state to git-tracked sibling files
5. `multiuser-team-mode-sync` — push/pull sync with assignment locking

## User Stories

- [ ] As a user upgrading Aigon, I want my 4 separate state files automatically consolidated into one so the engine is simpler
- [ ] As a developer, I want one file to read/write per entity instead of four so there are fewer code paths and fewer opportunities for partial state reads

## Acceptance Criteria

- [ ] Migration registered with the migration framework for the release version
- [ ] For each entity (feature, research, feedback) in `.aigon/workflows/`: reads `events.jsonl`, `snapshot.json`, `review-state.json`, `stats.json` (whichever exist) and writes a single `state.json`
- [ ] `state.json` shape: `{ snapshot, events, review, stats }` — keys omitted if source file didn't exist
- [ ] Old files (`events.jsonl`, `snapshot.json`, `review-state.json`, `stats.json`) deleted after successful migration
- [ ] Engine read path (`lib/workflow-core/`) reads from `state.json` only — no fallback to old files (mass migration ensures they're gone)
- [ ] Engine write path writes consolidated `state.json` on every state transition
- [ ] `lib/stats-aggregate.js` reads stats from `state.json` instead of standalone `stats.json`
- [ ] `lib/feature-review-state.js` reads/writes review data from `state.json` instead of standalone `review-state.json`
- [ ] `lib/workflow-snapshot-adapter.js` reads snapshot from `state.json`
- [ ] Entities with no existing state files are skipped (no empty `state.json` created)
- [ ] `npm test` passes after migration

## Validation

```bash
node --check lib/workflow-core/engine.js
node --check lib/stats-aggregate.js
npm test
```

## Technical Approach

- Migration function: iterate `.aigon/workflows/{features,research,feedback}/*/`, for each directory read the 4 files if they exist, merge into `state.json`, delete originals
- Engine changes centre on `lib/workflow-core/paths.js` — the single point where file paths are resolved. All consumers already go through this module
- `review-state.json` functionality folds into the engine rather than being a separate sidecar — this eliminates the "different writers" problem discussed in R30
- No concurrent write risk: the engine lock serializes all writes, and the "distinct features" constraint means only one user writes to a given entity's state
- The migration is idempotent: if `state.json` already exists and old files don't, skip that entity

## Dependencies

- depends_on: multiuser-migration-framework

## Out of Scope

- Relocating state files to sit alongside specs (that's `multiuser-committed-state`)
- Adding the assignee field (that's `multiuser-auto-assignee`)
- Any team mode or sync behaviour
- Changing where `.aigon/workflows/` lives on disk — state stays in the same gitignored location for now

## Open Questions

- None — design settled during R30 evaluation

## Related

- Research: #30 multi-user-workflow-state-sync
