# Feature: single-source-2-engine-based-read-paths

## Summary
Migrate board and dashboard from folder scanning to engine snapshot queries for feature/research lifecycle display. Remove `listStageSpecFiles()` and `fs.readdirSync()` folder scans from lifecycle display paths. After this, all read paths ask the engine for lifecycle truth, never the filesystem.

## User Stories
- [ ] As a user, the board and dashboard always show the correct lifecycle stage for every feature/research, even if the spec file is in the wrong folder
- [ ] As a user, I never see phantom features in the wrong column due to stale folder state

## Acceptance Criteria
- [ ] `lib/board.js` reads lifecycle state from engine snapshots, not folder scanning
- [ ] `lib/dashboard-status-collector.js` reads lifecycle state from engine snapshots, not `listStageSpecFiles()`
- [ ] Folder scanning is retained ONLY as a fallback for pre-engine entities (legacy migration)
- [ ] Board and dashboard display is consistent with engine state even when folder position is stale

## Validation
```bash
node --check aigon-cli.js
npm test
```

## Technical Approach
- Replace `fs.readdirSync()` folder scanning in `lib/board.js` with engine snapshot queries via `lib/workflow-snapshot-adapter.js`
- Replace `listStageSpecFiles()` in `lib/dashboard-status-collector.js` with engine-based listing
- Keep folder scanning only as a legacy fallback for entities that predate the engine
- Key files: `lib/board.js`, `lib/dashboard-status-collector.js`, `lib/workflow-snapshot-adapter.js`

## Dependencies
- depends_on: single-source-1-engine-only-spec-transitions

## Out of Scope
- Auto-correction of folder position on read — that's feature single-source-3
- Feedback entity changes — that's feature single-source-4

## Open Questions
- None

## Related
- Research: research-33-single-source-of-truth-for-feature-state
