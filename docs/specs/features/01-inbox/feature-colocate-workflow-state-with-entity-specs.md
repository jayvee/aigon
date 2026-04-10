# Feature: colocate workflow state with entity specs

## Summary

Move workflow engine state files (events.jsonl, snapshot.json, review-state.json) from `.aigon/workflows/{features,research}/<id>/` to live alongside the entity spec in `docs/specs/features/<phase>/` and `docs/specs/research-topics/<phase>/`. This eliminates the dual-encoding of state (engine vs spec folder), makes entity state portable, and lays the groundwork for git-based state sharing across machines.

## User Stories

- [ ] As a developer, I want all state for a feature to live in one place alongside its spec so I can understand its full lifecycle without looking in two directories
- [ ] As a developer, I want feature state to survive a fresh clone (since `docs/specs/` is committed but `.aigon/workflows/` is gitignored)
- [ ] As a developer, I want `docs/specs/features/05-done/` to contain the complete historical record of a finished feature without needing a separate archive step

## Acceptance Criteria

- [ ] `events.jsonl`, `snapshot.json`, and `review-state.json` are stored next to the entity spec using the naming convention `feature-{id}-{slug}.events.jsonl`, `feature-{id}-{slug}.state.json`, `feature-{id}-{slug}.review-state.json`
- [ ] Same pattern for research: `research-{id}-{slug}.events.jsonl`, `research-{id}-{slug}.state.json`
- [ ] `lib/workflow-core/paths.js` resolves state paths via the spec resolver (find spec location, derive sibling paths) instead of hardcoded `.aigon/workflows/` base
- [ ] All phase transitions (`move_spec` effects) move the state files alongside the spec in a single atomic operation
- [ ] `lib/feature-spec-resolver.js` returns state file paths as part of its resolution result
- [ ] `lib/stats-aggregate.js` scans `docs/specs/` phase folders for `.events.jsonl` files instead of `.aigon/workflows/`
- [ ] `lib/feature-review-state.js` reads/writes review state from the colocated path
- [ ] `.aigon/workflows/features/` and `.aigon/workflows/research/` directories are no longer created or used
- [ ] Lock files remain in `.aigon/` (they are process-local, not entity state)
- [ ] `.vscode/settings.json` is created/updated by `aigon init` or `aigon install-agent` with `files.exclude` rules hiding `*.state.json`, `*.events.jsonl`, and `*.review-state.json`
- [ ] All existing tests pass; workflow engine behavior is unchanged
- [ ] A one-time migration path exists: on first run after upgrade, existing `.aigon/workflows/` state is moved to the colocated location

## Validation

```bash
npm test
node -c aigon-cli.js
node -c lib/utils.js
```

## Technical Approach

### Path resolution change
The core change is in `lib/workflow-core/paths.js`. Instead of:
```
getEntityRoot(repoPath, 'features', id) → .aigon/workflows/features/<id>/
```
It becomes:
```
getEntityRoot(repoPath, 'features', id) → docs/specs/features/<phase>/  (resolved via spec resolver)
```

State file names are derived from the spec filename by replacing the `.md` extension:
- `feature-42-my-feature.md` → `feature-42-my-feature.state.json`
- `feature-42-my-feature.md` → `feature-42-my-feature.events.jsonl`
- `feature-42-my-feature.md` → `feature-42-my-feature.review-state.json`

### Spec resolver enhancement
`resolveFeatureSpec()` already scans phase folders and returns the spec path. Extend the return object to include sibling state paths so callers don't construct them independently.

### Phase transition (move_spec effect)
The existing `move_spec` effect executor renames one file. Extend it to move all colocated files (spec + state + events + review-state) in one pass. Files that don't exist yet (e.g., no review-state for a brand-new feature) are skipped silently.

### Lock files stay in `.aigon/`
File locks are process-local concurrency guards, not entity state. They stay at `.aigon/locks/features/<id>/lock` (or similar), separate from the entity data.

### VS Code settings
`aigon install-agent` already writes `.claude/settings.json`, `.gemini/settings.json`, etc. Add `.vscode/settings.json` to the install scaffold with `files.exclude` for `*.state.json`, `*.events.jsonl`, `*.review-state.json`. Merge with existing settings if the file already exists.

### Migration
On first access, if `.aigon/workflows/features/<id>/` exists but colocated files don't, move them automatically. Log a one-time message. This runs lazily per-entity, not as a bulk migration command.

## Dependencies

- None — this is a standalone refactor of internal state storage

## Out of Scope

- Git commit/push of state files (that's the Aigon Teams feature)
- Multi-user coordination, ownership, or locking
- Any changes to the dashboard UI (it reads snapshots the same way, just from a different path)
- Research workflow changes beyond the same colocation pattern

## Open Questions

- Should `closeout.md` (generated on feature-close) also move to sit alongside the spec? Likely yes for consistency.
- Should the `.gitignore` entry for `.aigon/workflows/` be kept temporarily for backwards compatibility, or removed immediately?

## Related

- Research: none
- Enables: Aigon Teams (Pro) — git-based multi-user state sharing
