# Feature: single-source-2-engine-based-read-paths

## Summary
Migrate board and dashboard lifecycle display to engine snapshot queries for feature/research entities. Snapshot state becomes the default read path for numeric entities with workflow state. Filesystem scanning remains only as a read-only compatibility fallback for no-ID inbox items and legacy numeric entities that are missing workflow state. Read paths must never create snapshots from folder position.

## User Stories
- [ ] As a user, the board and dashboard always show the correct lifecycle stage for every feature/research, even if the spec file is in the wrong folder
- [ ] As a user, I never see phantom features in the wrong column due to stale folder state
- [ ] As a user, legacy numeric entities with missing workflow state are still visible, but are clearly treated as legacy items rather than silently upgraded

## Acceptance Criteria
- [ ] `lib/board.js` and `lib/dashboard-status-collector.js` use workflow snapshots as the authoritative lifecycle read path for numeric feature/research entities with workflow state
- [ ] Folder scanning is retained only for no-ID inbox items that do not yet participate in workflow-core
- [ ] Folder scanning is retained only for legacy numeric entities that are missing workflow state and need explicit migration/backfill
- [ ] Board and dashboard display snapshot lifecycle state even when visible folder position is stale
- [ ] Legacy numeric entities with no snapshot are surfaced as read-only compatibility items and are clearly marked as missing workflow state / legacy
- [ ] No board/dashboard read path creates workflow snapshots or mutates workflow state from folder position
- [ ] State-changing commands still refuse to act on missing-snapshot numeric entities until they are explicitly migrated/backfilled

## Validation
```bash
node --check aigon-cli.js
npm test
```

Manual scenarios:
- [ ] Snapshot present + stale folder -> item renders in snapshot-derived stage
- [ ] Numeric legacy item with no snapshot -> item remains visible and marked legacy/missing-workflow
- [ ] No-ID inbox item -> still visible through compatibility path
- [ ] Refreshing board/dashboard does not create new snapshot files

## Technical Approach
- Introduce a clear read-side source matrix: snapshot exists -> workflow read model; no-ID inbox item -> filesystem compatibility path; numeric item with no snapshot -> filesystem compatibility path marked legacy/missing-workflow
- Replace folder-derived lifecycle stage calculation in board/dashboard with workflow-driven stage resolution
- Keep compatibility fallback read-only; it must never bootstrap snapshots or rewrite lifecycle state
- Prefer shared read abstractions (`lib/workflow-read-model.js`, `lib/workflow-snapshot-adapter.js`) and keep board/dashboard as consumers
- Key files: `lib/board.js`, `lib/dashboard-status-collector.js`, `lib/workflow-read-model.js`, `lib/workflow-snapshot-adapter.js`, `lib/feature-spec-resolver.js`

## Dependencies
- depends_on: single-source-1-engine-only-spec-transitions

## Out of Scope
- Auto-correction of folder position on read — that's feature single-source-3
- Feedback entity changes — that's feature single-source-4

## Open Questions
- None

## Related
- Research: research-33-single-source-of-truth-for-feature-state
