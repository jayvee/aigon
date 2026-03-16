---
status: submitted
updated: 2026-03-16T10:57:27.372Z
startedAt: 2026-03-16T09:14:40.807Z
events:
  - { ts: "2026-03-16T09:14:40.807Z", status: implementing }
  - { ts: "2026-03-16T09:19:30.732Z", status: implementing }
  - { ts: "2026-03-16T09:28:36.928Z", status: waiting }
  - { ts: "2026-03-16T10:57:27.372Z", status: submitted }
---

# Implementation Log: Feature 68 - complete-cli-modularization
Agent: cc

## Plan

The three extraction targets (feedback, board, validation) each followed the same 4-step pattern from the spec:

1. Read the full function body from `lib/utils.js` to understand its internal dependencies
2. Write the function into the stub module, replacing any internal utils calls with `utils.X` references
3. Update `lib/commands/shared.js` to spread the new module into scope alongside utils
4. Delete the function from `lib/utils.js` (both the implementation and the `module.exports` entry)

The critical architectural insight: `shared.js` uses `const scope = { ...utils, ...overrides }` to expose everything to command handlers. Extending this to `{ ...utils, ...board, ...feedback, ...validation, ...overrides }` meant all extracted functions remained available to every command with zero changes to the command handlers themselves.

Extraction order followed the spec: feedback first (smallest, ~374 lines), board second (~502 lines), validation last (~1,131 lines).

## Progress

**`lib/feedback.js`** — 17 functions extracted:
`normalizeFeedbackStatus`, `getFeedbackFolderFromStatus`, `normalizeFeedbackSeverity`, `normalizeTag`, `parseTagListValue`, `normalizeTagList`, `serializeFeedbackFrontMatter`, `extractFeedbackSummary`, `normalizeFeedbackMetadata`, `buildFeedbackDocumentContent`, `readFeedbackDocument`, `collectFeedbackItems`, `tokenizeText`, `jaccardSimilarity`, `findDuplicateFeedbackCandidates`, `buildFeedbackTriageRecommendation`, `formatFeedbackFieldValue`.

Calls back into `utils` for: `serializeYamlScalar`, `parseFrontMatter`, `extractMarkdownSection`, `parseNumericArray`, `PATHS`, `FEEDBACK_STATUS_TO_FOLDER`, `FEEDBACK_FOLDER_TO_STATUS`.

**`lib/board.js`** — 11 functions extracted:
`collectBoardItems`, `getWorktreeInfo`, `getCurrentBranch`, `saveBoardMapping`, `loadBoardMapping`, `getBoardAction`, `displayBoardKanbanView`, `displayKanbanSection`, `displayBoardListView`, `displayListSection`, `ensureBoardMapInGitignore`.

Calls back into `utils` only for `utils.PATHS` (features and research roots).

**`lib/validation.js`** — 25 functions extracted:
`formatTimestamp`, `parseRalphProgress`, `parseFeatureValidation`, `detectNodePackageManager`, `detectNodeTestCommand`, `detectValidationCommand`, `buildRalphPrompt`, `getCurrentHead`, `getGitStatusPorcelain`, `getChangedFilesInRange`, `getCommitSummariesInRange`, `ensureRalphCommit`, `runRalphAgentIteration`, `runRalphValidation`, `appendRalphProgressEntry`, `runRalphCommand`, `parseAcceptanceCriteria`, `classifyCriterion`, `getPackageJsonScripts`, `getProfileValidationCommands`, `evaluateAllSubjectiveCriteria`, `updateSpecCheckboxes`, `runSmartValidation`, `formatCriteriaResults`, `runFeatureValidateCommand`.

Calls back into `utils` for: `safeWrite`, `readTemplate`, `processTemplate`, `getAgentCliConfig`, `getAgentLaunchFlagTokens`, `getAvailableAgents`, `loadProjectConfig`, `getActiveProfile`, `parseCliOptions`, `getOptionValue`, `findFile`, `PATHS`. Also includes git helper functions (`getCurrentHead`, `getGitStatusPorcelain`, `getChangedFilesInRange`, `getCommitSummariesInRange`) that were co-located with the ralph block and moved along with it.

**`lib/utils.js`** — reduced from 8,530 → 6,542 lines (−1,988 lines).

**`lib/commands/shared.js`** — 4-line change: add 3 `require()` calls and update the scope spread.

**Verified:**
- `node -c aigon-cli.js && for f in lib/*.js lib/commands/*.js; do node -c "$f"; done` — all pass
- `npm test` — 148/151 passing (3 pre-existing failures unrelated to this feature)
- `aigon help`, `aigon board`, `aigon doctor`, `aigon feature-validate 68 --dry-run` — all work correctly

**Also created:** `docs/specs/features/01-inbox/feature-e2e-aigon-test.md` — a spec for a future end-to-end test suite with fixture repo and tmux mock shim, motivated by the gap in test coverage this feature exposed.

## Decisions

**No re-export stubs in utils.js.** The spec was explicit: don't add `X: require('./feedback').X` back into utils exports. This is safe because nothing imports directly from `lib/utils.js` for these functions — all consumers go through `shared.js` scope.

**`getWorktreeStatus` and `safeRemoveWorktree` stayed in utils.js.** These two functions appear between the ralph loop helpers and the `getChangedFilesInRange` block, but they're not in the spec's extraction list and are logically about worktree management (not validation). They remained in utils.

**Git helpers moved with validation.** `getCurrentHead`, `getGitStatusPorcelain`, `getChangedFilesInRange`, `getCommitSummariesInRange` are not in the spec's explicit list but are only called from within the validation block. Moving them alongside avoided awkward `utils.getCurrentHead()` calls inside validation.js for functions that have no business being in utils long-term.

**Removals done with Python script for large blocks.** Three of the removals (feedback block 1, board block, validation block) involved 150–500 contiguous lines. Used a Python one-liner to slice by line number rather than trying to match the full text with Edit — more reliable for large deletions.

**e2e test gap noted.** During implementation, the user asked about e2e coverage. The existing `npm test` suite tests individual functions but not command dispatch end-to-end. The smoke tests (`aigon help`, `aigon board`, etc.) confirmed the spread wiring worked, but feedback-triage and autonomous-loop paths were not exercised. The e2e feature spec captures this debt.
