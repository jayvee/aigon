# Feature: Complete CLI modularization

## Summary

Extract the three most self-contained domains from `lib/utils.js` (8,530 lines) into their existing stub modules: validation/Ralph, board rendering, and feedback. The `lib/commands/shared.js` split is out of scope — its closure-based `createAllCommands()` pattern makes splitting high-risk for low gain, and the thin wrapper modules already route imports correctly.

After this feature, agents and developers working on validation, board, or feedback can load a focused 200–1,200 line module instead of a 8,000+ line file. `utils.js` shrinks by ~1,900 lines.

## User Stories

- [ ] As an AI agent tasked with validation work, I can load `lib/validation.js` (~1,150 lines) instead of all of `lib/utils.js`
- [ ] As a developer debugging board rendering, I open `lib/board.js` and find the actual logic there
- [ ] As a developer modifying feedback triage, I find it in `lib/feedback.js` — not buried in utils at line 4,673
- [ ] As a user, the CLI behaves identically before and after

## Acceptance Criteria

### Extraction targets

- [ ] `lib/validation.js` contains: `parseRalphProgress`, `parseFeatureValidation`, `detectValidationCommand`, `buildRalphPrompt`, `ensureRalphCommit`, `runRalphAgentIteration`, `runRalphValidation`, `appendRalphProgressEntry`, `runRalphCommand`, `parseAcceptanceCriteria`, `classifyCriterion`, `getPackageJsonScripts`, `getProfileValidationCommands`, `evaluateAllSubjectiveCriteria`, `updateSpecCheckboxes`, `runSmartValidation`, `formatCriteriaResults`, `runFeatureValidateCommand` — target ~1,150 lines
- [ ] `lib/board.js` contains: `collectBoardItems`, `getWorktreeInfo`, `getCurrentBranch`, `saveBoardMapping`, `loadBoardMapping`, `getBoardAction`, `displayBoardKanbanView`, `displayKanbanSection`, `displayBoardListView`, `displayListSection`, `ensureBoardMapInGitignore` — target ~490 lines
- [ ] `lib/feedback.js` contains: `normalizeFeedbackStatus`, `getFeedbackFolderFromStatus`, `normalizeFeedbackSeverity`, `serializeFeedbackFrontMatter`, `extractFeedbackSummary`, `normalizeFeedbackMetadata`, `buildFeedbackDocumentContent`, `readFeedbackDocument`, `collectFeedbackItems`, `tokenizeText`, `jaccardSimilarity`, `findDuplicateFeedbackCandidates`, `buildFeedbackTriageRecommendation`, `formatFeedbackFieldValue` — target ~300 lines

### utils.js after extraction

- [ ] The extracted functions are removed from `lib/utils.js` (not re-exported — nothing external uses utils directly for these)
- [ ] `lib/utils.js` is under 6,700 lines after extraction

### Correctness

- [ ] `node -c aigon-cli.js` passes
- [ ] `node -c lib/*.js lib/commands/*.js` passes for all modules
- [ ] `npm test` passes (all 25 tests)
- [ ] `aigon help`, `aigon board`, `aigon doctor`, `aigon feature-validate` all work correctly

## Validation

```bash
node -c aigon-cli.js && for f in lib/*.js lib/commands/*.js; do node -c "$f"; done
npm test
wc -l lib/utils.js  # should be under 6700
```

## Technical Approach

Each extraction is the same 4 steps:

1. Move the target functions from `lib/utils.js` into the stub module, adding any `require()` imports they need
2. Update any `require()` inside the moved functions that reference `utils.*` helpers that stay in utils
3. In `lib/commands/shared.js`, add a `require('../validation')` (or board/feedback) at the top and update any direct calls — there are very few since shared.js barely uses utils directly (6 references)
4. Delete the moved functions from `lib/utils.js`

**No re-export stubs in utils.js.** The existing `lib/commands/*.js` wrapper modules import from `shared.js`, not from utils, so removing functions from utils doesn't break any import paths.

### Extraction order

1. `lib/feedback.js` — smallest (~300 lines), good warm-up, functions are clustered around line 4,673
2. `lib/board.js` — self-contained display logic (~490 lines), clustered around line 6,531
3. `lib/validation.js` — largest but fully standalone (~1,150 lines), clustered around line 7,022

## Out of Scope

- `lib/commands/shared.js` split — `createAllCommands()` is a closure that binds all handlers together; splitting it requires restructuring the entire command handler pattern, not just moving code
- Remaining `lib/utils.js` domains: config, devserver, dashboard, worktree, templates — these are more tangled with each other and offer less clear boundaries
- Adding tests, TypeScript, ES modules, or changing any CLI behaviour

## Dependencies

- Feature 49 (Phase 3 — modularize CLI) — done ✅

## Related

- Phase 3: Feature 49 — created the stub modules this feature populates
- `lib/utils.js` — source of all extractions
- `lib/commands/shared.js` — only needs minor `require()` additions at the top
