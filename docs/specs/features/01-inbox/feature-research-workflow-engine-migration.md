# Feature: research-workflow-engine-migration

## Summary

Migrate research topics onto the workflow-core engine so research lifecycle writes stop depending on folder probing and `moveFile()` transitions. Features already moved to engine-owned lifecycle state with snapshot-backed reads. Research should follow the same architectural direction: engine-owned state, projected folder moves, and shared read-side helpers.

This should continue the simplification of the codebase only if it is done as subtraction. The target is not "feature workflow, duplicated for research". The target is one workflow engine with entity-specific lifecycle rules, thin research command wiring, and materially less folder-driven lifecycle code in `lib/commands/research.js` and `lib/entity.js`.

## User Stories

- [ ] As an aigon user, research topics show correct state and actions in the dashboard driven by the engine, just like features
- [ ] As an aigon user, `aigon research-start`, `research-close`, and `research-eval` work through the engine with the same reliability as feature commands
- [ ] As an aigon maintainer, I can read one engine codebase that handles both features and research — not two separate state systems
- [ ] As an aigon maintainer, I can delete legacy research folder-transition code rather than preserving it behind compatibility layers

## Acceptance Criteria

- [ ] Research lifecycle managed by workflow-core engine (events.jsonl + snapshot.json in `.aigon/workflows/research/{id}/`)
- [ ] Research lifecycle authority is the engine snapshot/event log. Spec folder location is projection only, not the source of truth for active research state
- [ ] Research commands (`research-start`, `research-close`, `research-eval`, and any supported pause/resume flow) dispatch through workflow-core or a thin research workflow service over workflow-core primitives; they do not perform lifecycle transitions by directly probing `02-backlog`, `03-in-progress`, or `04-in-evaluation`
- [ ] Folder moves (inbox → backlog → in-progress → done) are projections of engine state, not the source of truth
- [ ] Workflow-core supports research by reusing the same engine infrastructure, persistence model, and action-derivation pattern used for features. A research-specific lifecycle definition is acceptable; a second bespoke engine is not
- [ ] `deriveAvailableActions()` and machine construction are generalised through one rule-definition pattern shared by feature and research lifecycles
- [ ] `workflow-snapshot-adapter.js` is generalised into a shared workflow snapshot/read adapter, or replaced with an equivalent shared adapter that works for both features and research
- [ ] Dashboard shows research topics with correct engine-derived actions (start, eval, close, pause)
- [ ] `feature-workflow-rules.js` is renamed/generalised to a shared workflow-rules module, or replaced with a shared rule-definition module that both feature and research lifecycle code consume
- [ ] `lib/commands/research.js` direct folder-scanning and lifecycle-transition code is materially reduced or deleted
- [ ] `lib/entity.js` no longer owns research lifecycle transitions via `findFile()` / `moveFile()` for start, eval, and close
- [ ] Net code deletion: more lines removed than added
- [ ] Research and feature use the same snapshot adapter, action mapper, and spec resolver — no duplication
- [ ] No new long-lived compatibility path is added that lets research workflow semantics drift between engine state and folder state
- [ ] No in-flight research migration/bootstrap path is added for legacy active research topics; pre-engine research can be restarted or re-run instead
- [ ] `docs/architecture.md` updated to document the unified engine covering both features and research
- [ ] `CLAUDE.md` and `AGENTS.md` updated to reflect research uses the engine
- [ ] All existing research tests pass or are updated

## Validation

```bash
npm test
node aigon-cli.js research-list --active --json
```

## Technical Approach

### What's different about research vs features

| Aspect | Features | Research |
|--------|----------|----------|
| Lifecycle | implementing → reviewing → evaluating → closing → done | in-progress → evaluation → done |
| Fleet/solo | Both | Solo only (multiple findings agents, but no competition) |
| Winner selection | Yes (fleet eval picks winner) | No |
| Review step | Optional (solo) | No |
| Eval | Compares implementations (fleet) or skipped (solo) | Synthesises findings, recommends features |
| Agents | Implement independently | Research independently, findings are merged |

Research is simpler than features. That means the migration should share infrastructure, not force research to inherit feature-only concepts like winner selection or review state.

### Step 1: Generalise workflow-core around entity lifecycle definitions

The engine is currently feature-shaped (`featureMachine`, feature action kinds, feature rules). Generalise the engine around lifecycle definitions:

- Move `feature-workflow-rules.js` toward a shared workflow-rules module or equivalent shared definition layer
- Add research lifecycle rules, event names, and manual actions without duplicating engine persistence, locks, projector, or effect orchestration
- Generalise machine/action construction so feature and research lifecycles are generated from the same pattern
- Keep research lifecycle smaller than feature lifecycle. Do not add feature-only states to research just for symmetry

### Step 2: Migrate research write paths first

Replace folder-based lifecycle transitions in research command flows:

| Current | Engine replacement |
|---------|-------------------|
| `moveSpec('01-inbox', '02-backlog')` | `engine.prioritiseResearch(id)` or equivalent workflow-core write path |
| `moveSpec('02-backlog', '03-in-progress')` | `engine.startResearch(id, { agents })` |
| `findFile(PATHS.research, id, ['03-in-progress', '04-in-evaluation'])` | `readResearchSnapshot(repoPath, id)` |
| `moveSpec('03-in-progress'/'04-in-evaluation', '05-done')` | `engine.closeResearch(id)` |

The first deletion target is write-side lifecycle ownership. `lib/entity.js` should stop being the research lifecycle state machine.

### Step 3: Unify the read path with the engine

- Extend the snapshot/read adapter so research snapshots produce dashboard and board actions through the same presenter path as features
- Make `workflow-read-model.js` prefer research snapshots once they exist, instead of relying on research-only stage heuristics in `state-queries.js`
- Keep presentation code thin: shared adapter + shared action mapper, not research-specific dashboard logic

### Step 4: Delete legacy research lifecycle code

- Remove research lifecycle transitions from `lib/entity.js` where they are implemented through `findFile()` / `moveFile()`
- Delete direct active-state folder probing from `lib/commands/research.js`
- Reduce or eliminate any duplicate research action tables that exist only because research is not yet snapshot-backed
- Do not add compatibility code for pre-engine in-progress research items. If a research item is mid-flight on the old path, the supported resolution is to restart or re-run it on the new engine path

### Step 5: Update docs and prove subtraction

- `docs/architecture.md` — document unified engine for features and research
- `CLAUDE.md` — update module map and state architecture section
- `AGENTS.md` — update module descriptions
- Capture before/after deletion in the implementation log or PR notes:
  - lines added
  - lines deleted
  - modules simplified or removed
  - legacy folder-read paths deleted

## Dependencies

- depends_on: feature-174-workflow-read-path-simplification (must land first — establishes the single read path for features)

## Out of Scope

- Feedback entity migration (even simpler lifecycle, separate follow-up)
- Changing how research findings are written or structured
- Changing the research evaluation process
- Dashboard UI redesign for research
- Preserving legacy in-flight research workflow behavior during migration
- Bootstrapping old research items into workflow-core from folder state

## Open Questions

- Should research keep a separate `evaluating` lifecycle state, or should synthesis be modelled as an effect inside `in-progress` with a direct close to `done`?
- Should research support pause/resume in the engine from day one, or should the first migration scope focus on backlog → in-progress → evaluating → done only?
- After research writes move to workflow-core, can parts of `lib/entity.js` be deleted entirely rather than made more generic?

## Related

- Feature 171 (full cutover) — established engine-only features
- Feature 174 (read path simplification) — established single read path for features
- `lib/workflow-core/` — the engine to extend
- `lib/commands/research.js` — the 622-line file to simplify
