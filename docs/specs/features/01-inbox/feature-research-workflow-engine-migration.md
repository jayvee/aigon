# Feature: research-workflow-engine-migration

## Summary

Migrate research topics to the same workflow engine that features use. Research currently manages state through folder placement (01-inbox, 02-backlog, 03-in-progress, 05-done) with 15+ folder-scanning code paths in `lib/commands/research.js`. Features have already moved to workflow-core with event-sourced state and snapshot reads. Research should reuse the same engine, machine, and read paths — not duplicate them.

The goal is zero duplication: one engine, one machine definition system, one read path, one snapshot adapter. Research is a simpler lifecycle than features (no eval, no fleet, no winner selection), so this is subtraction from the feature model, not addition.

## User Stories

- [ ] As an aigon user, research topics show correct state and actions in the dashboard driven by the engine, just like features
- [ ] As an aigon user, `aigon research-start`, `research-close`, and `research-eval` work through the engine with the same reliability as feature commands
- [ ] As an aigon maintainer, I can read one engine codebase that handles both features and research — not two separate state systems

## Acceptance Criteria

- [ ] Research lifecycle managed by workflow-core engine (events.jsonl + snapshot.json in `.aigon/workflows/research/{id}/`)
- [ ] Research commands (`research-start`, `research-close`, `research-eval`, `research-pause`, `research-resume`) call engine methods directly — no folder-based state transitions
- [ ] Folder moves (inbox → backlog → in-progress → done) are projections of engine state, not the source of truth
- [ ] The XState machine is parameterised or extended to handle both feature and research lifecycles — NOT a separate machine
- [ ] `deriveAvailableActions()` works for both entity types with the same code path
- [ ] `snapshotToDashboardActions()` works for both entity types — no separate research adapter
- [ ] Dashboard shows research topics with correct engine-derived actions (start, eval, close, pause)
- [ ] `feature-workflow-rules.js` is renamed/generalised to `workflow-rules.js` covering both entity types, or research rules are added alongside feature rules in the same module
- [ ] `lib/commands/research.js` folder-scanning code is deleted (target: remove 200+ lines of folder probing)
- [ ] Net code deletion: more lines removed than added
- [ ] Research and feature use the same snapshot adapter, action mapper, and spec resolver — no duplication
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

### Step 1: Generalise the engine

The workflow-core engine is currently feature-specific (`featureMachine`, `feature.started`, etc.). Generalise:

- Rename `feature-workflow-rules.js` → `workflow-rules.js` (or add research rules alongside)
- Add research lifecycle states to the rules: `backlog`, `in-progress`, `evaluating`, `done`, `paused`
- Research machine events: `research.started`, `research.eval_requested`, `research.closed`, `research.paused`, `research.resumed`
- Research has no `reviewing`, `ready_for_review`, or `closing` states — simpler subset
- The XState machine should be parameterised by entity type, not duplicated

### Step 2: Wire research commands to engine

Replace folder-based transitions in `lib/commands/research.js`:

| Current | Engine replacement |
|---------|-------------------|
| `moveSpec('01-inbox', '02-backlog')` | `engine.prioritiseResearch(id)` (or reuse feature pattern) |
| `moveSpec('02-backlog', '03-in-progress')` | `engine.startResearch(id, { agents })` |
| `findFile(PATHS.research, id, ['03-in-progress'])` | `readResearchSnapshot(repoPath, id)` |
| `moveSpec('03-in-progress', '05-done')` | `engine.closeResearch(id)` |

### Step 3: Extend snapshot adapter

`snapshotToDashboardActions()` already takes `entityType` as first parameter. Add research action mappings to the same function — no separate adapter.

### Step 4: Delete folder-scanning code

Remove the 15+ folder-scanning references in `research.js`. Replace `findFile()` calls with snapshot/spec-resolver reads.

### Step 5: Update docs

- `docs/architecture.md` — document unified engine for features and research
- `CLAUDE.md` — update module map and state architecture section
- `AGENTS.md` — update module descriptions

## Dependencies

- depends_on: feature-174-workflow-read-path-simplification (must land first — establishes the single read path for features)

## Out of Scope

- Feedback entity migration (even simpler lifecycle, separate follow-up)
- Changing how research findings are written or structured
- Changing the research evaluation process
- Dashboard UI redesign for research

## Open Questions

- Should `research-eval` transition to a separate `evaluating` state, or go straight to `done`? (Currently it moves to in-evaluation then close moves to done — keep this two-step for consistency with features)
- Should research support pause/resume? (Features do — research should too for consistency)

## Related

- Feature 171 (full cutover) — established engine-only features
- Feature 174 (read path simplification) — established single read path for features
- `lib/workflow-core/` — the engine to extend
- `lib/commands/research.js` — the 622-line file to simplify
