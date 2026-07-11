---
complexity: very-high
set: stable-spec-layout
depends_on: [669]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-11T08:31:59.999Z", actor: "cli/feature-prioritise" }
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
- [ ] `feature-transfer` reads canonical `00-specs` content from the source repo and writes into the target repo through its normal create path (allocating an ID under the feature-2 contract when the target uses stable layout); it never constructs lifecycle-folder paths as durable content in either repo.
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
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1468" height="132" viewBox="0 0 1468 132" role="img" aria-label="Feature dependency graph for feature 670" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-670" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-670)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-670)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-670)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-670)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#666</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">stable spec layout 1 read…</text><text x="36" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#667</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">stable spec layout 2 crea…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#668</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">stable spec layout 3 cano…</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#669</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">stable spec layout 4 gene…</text><text x="936" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#670</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">stable spec layout 5 life…</text><text x="1236" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
