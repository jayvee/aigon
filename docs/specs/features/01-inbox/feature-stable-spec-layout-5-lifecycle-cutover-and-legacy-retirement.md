---
complexity: very-high
set: stable-spec-layout
depends_on: [stable-spec-layout-4-generated-lifecycle-symlink-view]
---

# Feature: cut lifecycle commands over to stable specs and retire stage-folder authority

## Summary
Complete the stable-layout rollout across features and research: remove canonical spec file moves from lifecycle effects and commands, route all lifecycle visibility through the generated symlink projector, make read models engine-first and canonical-path-aware, update installed templates/docs, and retire the legacy stage-folder write model after comprehensive local and two-clone regression coverage.

## User Stories
- [ ] As an operator, every lifecycle command behaves the same on local and git-branch storage while the canonical spec path never changes.
- [ ] As an operator, switching storage backends does not change how specs are stored or navigated.
- [ ] As an operator, dashboard state, CLI state, and generated lifecycle folders agree without Git commits for lifecycle-only transitions.
- [ ] As a maintainer, no normal feature/research lifecycle path writes around SpecStore or derives authority from a real file's stage folder.

## Acceptance Criteria
- [ ] Prioritise, start, pause, resume, evaluation, code review/revision, close, reset, unprioritise, autonomous flows, set flows, and research equivalents no longer move canonical spec files.
- [ ] Workflow-core no longer emits or executes `move_spec` effects for stable-layout feature/research lifecycle transitions; compatibility materialisation of historical events cannot mutate canonical tracked content.
- [ ] Every successful lifecycle transition refreshes the generated view after canonical state persistence and reports repairable view failures without corrupting workflow state.
- [ ] All lifecycle mutations use asynchronous SpecStore persistence and required post-write publication; synchronous direct writers such as prioritise-time workflow directory migration are removed from normal paths.
- [ ] Git-branch lifecycle commands fail loudly when required canonical state publication fails; success is not reported while lifecycle state is local-only unless an explicitly documented offline-safe operation exists.
- [ ] Dashboard/CLI entity views derive lifecycle from workflow state, resolve content from `00-specs`, and treat lifecycle folders solely as disposable navigation views.
- [ ] Folder scanners, set derivation, dependencies, agent launch, implementation logs, close integrity, stats, doctor, repair, and feedback-to-research paths do not double-count symlink views or infer workflow state from them.
- [ ] Local storage and git-branch storage pass the same behavioural contract suite for feature and research lifecycle transitions.
- [ ] Two-clone tests prove that Machine B can transition an entity, Machine A can sync `aigon-state` without pulling main, and Machine A updates only `.aigon` projections plus ignored symlink views while its canonical spec path/content and Git state remain unchanged.
- [ ] Content-dependent commands detect missing/stale canonical content and refuse with an actionable `update main` message rather than operating on a broken view link.
- [ ] `aigon doctor` reports legacy real files in lifecycle directories, missing canonical files, duplicate identities, unsafe links, and mixed layouts; `--fix` repairs only provably safe generated-view issues.
- [ ] Templates under `templates/` describe canonical `00-specs` paths and generated lifecycle views without assumptions about the target repo's language, package manager, tests, or editor.
- [ ] `docs/specstore-architecture.md`, `docs/architecture.md`, installed development workflow docs, command help, and migration guidance describe the final authority and consistency model.
- [ ] Legacy `specLayout: stage-folders` remains available only for a documented compatibility window with clear migration messaging and no new feature development against it.

## Validation
```bash
npm test
node tests/integration/two-clone-git-branch-storage.test.js
node scripts/check-template-leaks.js
node scripts/check-module-graph.js --report
```

## Pre-authorised

## Technical Approach
Audit every `move_spec`, `moveFile`, stage-folder scan, and direct workflow persistence call across feature/research commands and workflow-core. Replace path-changing effects with post-transition status-view refresh, and replace path-derived reads with the canonical entity view/spec resolver. Historical events remain replayable, but their old absolute/portable move payloads are compatibility metadata and cannot trigger tracked-file mutation under stable layout.

Run contract tests against both storage backends. Add an end-to-end migration fixture representing an established repository, then exercise create through close and cross-clone sync. Update template source-of-truth files rather than installed `.claude`, `.cursor`, or other generated copies.

## Dependencies
- `stable-spec-layout-4-generated-lifecycle-symlink-view`.

## Out of Scope
- VS Code/Cursor integration of any kind.
- Synchronizing spec Markdown without normal Git fetch/pull.
- A hosted state service.
- General-purpose virtual filesystems.

## Open Questions
- The compatibility removal version should be chosen during implementation and documented; the stable layout itself is the default for new repositories once this feature ships.

## Related
- Prior architecture: `docs/specstore-architecture.md`.
- Legacy move paths: `lib/workflow-core/effects.js`, `lib/spec-reconciliation.js`, and lifecycle command handlers.

