# Feature: single-source-3-self-healing-spec-reconciliation

## Summary
On dashboard/board refresh, compare engine state with folder position. If they disagree, the engine wins: move the file to the correct folder and log the correction. This replaces the manual `aigon repair` command for spec drift and makes the system self-healing.

## User Stories
- [ ] As a user, if a spec file drifts to the wrong folder (e.g. via accidental `git mv` or broad `git add`), it gets silently corrected on the next dashboard/board view
- [ ] As a user, I no longer need to run `aigon repair` to fix spec drift

## Acceptance Criteria
- [ ] On every dashboard/board refresh, engine state is compared with folder position for all features and research
- [ ] When they disagree, the file is moved to the engine-expected folder and a correction is logged
- [ ] Reconciliation is one-way: engine -> folder, never folder -> engine
- [ ] `aigon repair` uses the same engine -> folder reconciliation logic (or is removed in favor of automatic reconciliation)
- [ ] Doctor/repair flows never infer lifecycle from folder position

## Validation
```bash
node --check aigon-cli.js
npm test
```

## Technical Approach
- Add a reconciliation pass to dashboard/board read paths that compares engine snapshot lifecycle with actual folder position
- If they disagree, move the spec file to match the engine and log a warning
- Update `lib/commands/misc.js` `repair` to use engine -> folder reconciliation only
- Key files: `lib/dashboard-status-collector.js`, `lib/board.js`, `lib/commands/misc.js`, `lib/workflow-core/paths.js`

## Dependencies
- depends_on: single-source-2-engine-based-read-paths

## Out of Scope
- Feedback entity changes — that's feature single-source-4

## Open Questions
- Should reconciliation happen on every read, or be rate-limited to avoid excessive file moves during rapid refreshes?

## Related
- Research: research-33-single-source-of-truth-for-feature-state
