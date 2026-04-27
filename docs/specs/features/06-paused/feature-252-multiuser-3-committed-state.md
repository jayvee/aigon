# Feature: multiuser-3-committed-state

## Summary

Relocate `state.json` from the gitignored `.aigon/workflows/` directory to a committed sibling file alongside each entity's spec. For example, `feature-42-auth.md` gets a sibling `feature-42-auth.state.json`. State is auto-committed on significant lifecycle transitions (start, submit, close) with a `chore(state):` commit prefix. This applies to all entity types (features, research, feedback) and runs in both solo and team mode — state is always committed for backup, history, and future multi-user visibility. VS Code and Cursor `files.exclude` settings hide `*.state.json` from the file explorer. A custom git merge driver registered via `.gitattributes` handles incidental state file conflicts automatically (timestamp-based last-write-wins per field, event array union). The migration framework handles relocating existing consolidated state files to their new location.

## Sequence

This is **feature 3 of 5** in the `multiuser-` series:
1. `multiuser-migration-framework` — versioned migration infrastructure
2. `multiuser-state-consolidation` — single `state.json` per entity
3. `multiuser-auto-assignee` — assignee field on all entities
4. `multiuser-committed-state` ← this feature
5. `multiuser-team-mode-sync` — push/pull sync with assignment locking

## User Stories

- [ ] As a user, I want my feature state backed up in git so I don't lose lifecycle history if `.aigon/` is wiped
- [ ] As a user, I want to see the lifecycle history of a feature via `git log feature-42-auth.state.json`
- [ ] As a user, I don't want state files cluttering my IDE file explorer
- [ ] As a user working with teammates, I want state file merge conflicts resolved automatically so they never block me

## Acceptance Criteria

- [ ] Migration registered with migration framework: for each entity in `.aigon/workflows/`, move `state.json` to sit alongside the spec as `{spec-name}.state.json`
- [ ] Engine path resolution (`lib/workflow-core/paths.js`) updated to find state files alongside specs in `docs/specs/{features,research-topics,feedback}/`
- [ ] State auto-committed on `feature-start`, `feature-submit`, `feature-close`, `research-start`, `research-submit`, `research-close`, `feedback-create`, `feedback-close` with commit message `chore(state): {action} {entity-type} {id}`
- [ ] `.gitignore` updated: remove `.aigon/workflows/` entry (keep `.aigon/state/`, `.aigon/locks/`)
- [ ] VS Code `files.exclude`: `**/*.state.json` added to `.vscode/settings.json`
- [ ] Cursor equivalent setting added
- [ ] `.gitattributes` entry: `*.state.json merge=aigon-state`
- [ ] Custom merge driver `aigon merge-state` command: timestamp-based last-write-wins for `snapshot`, `assignee`, `review`; union + dedup + sort for `events`; last-write-wins for `stats`
- [ ] `aigon install-agent` registers the merge driver in local git config
- [ ] `aigon doctor` detects conflicted `*.state.json` files and can regenerate state from spec position
- [ ] When spec files move between stage folders (e.g., `03-in-progress/` → `05-done/`), the sibling `.state.json` moves with them
- [ ] Ephemeral files remain gitignored: `.aigon/state/` (agent status, heartbeats), `.aigon/locks/`

## Validation

```bash
node --check lib/workflow-core/paths.js
npm test
```

## Technical Approach

- Migration: iterate `.aigon/workflows/{features,research}/*/state.json`, find corresponding spec file, copy state as sibling `{spec-name}.state.json`, delete original
- Path resolution: `getEntityRoot()` changes from `.aigon/workflows/{type}/{id}/` to scanning spec directories for the matching `.state.json` sibling
- Auto-commit: after writing `state.json`, run `git add {path}.state.json && git commit -m "chore(state): ..."` — only on the significant transitions listed above
- Merge driver: a new `aigon merge-state` CLI command. Reads the 3 files (ancestor, ours, theirs) as JSON, merges field-by-field, writes result to "ours" path. Registered via `git config merge.aigon-state.driver "aigon merge-state %O %A %B"`
- `.gitattributes` is committed to the repo — every clone gets the merge strategy. The driver itself is installed by `aigon install-agent` or `aigon init`
- Fallback for uninstalled driver: git falls back to default text merge, which may conflict. `aigon doctor` resolves by regenerating from spec position

## Dependencies

- depends_on: multiuser-2-auto-assignee

## Out of Scope

- Pushing state to remote (that's `multiuser-team-mode-sync`)
- Assignment locking enforcement (that's `multiuser-team-mode-sync`)
- `aigon sync` command (that's `multiuser-team-mode-sync`)

## Open Questions

- None — design settled during R30 evaluation

## Related

- Research: #30 multi-user-workflow-state-sync
