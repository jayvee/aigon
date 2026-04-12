# Feature: multiuser-migration-framework

## Summary

Introduce a versioned migration framework for Aigon state files. When `check-version` detects a version jump, it runs any pending migrations. Each migration creates a backup under `.aigon/migrations/{version}/` containing a tarball of the affected state, a `manifest.json` with machine-readable metadata, and a `migration.log` with human-readable details. Migrations are idempotent (if the version folder exists with a successful manifest, skip), and automatically restore from backup on failure. This is the foundation for all future breaking state changes — the framework knows how to back up, run, validate, and restore, but knows nothing about what is being migrated. Applies to all entity types (features, research, feedback).

## Sequence

This is **feature 0 of 5** in the `multiuser-` series:
1. `multiuser-migration-framework` ← this feature
2. `multiuser-state-consolidation` — first consumer of the framework
3. `multiuser-auto-assignee` — adds assignee field to state
4. `multiuser-committed-state` — relocates state to git-tracked sibling files
5. `multiuser-team-mode-sync` — push/pull sync with assignment locking

## User Stories

- [ ] As a user upgrading Aigon, I want state file migrations to run automatically so I don't need to do anything manually
- [ ] As a user, if a migration fails I want my state automatically restored from backup so I don't lose data
- [ ] As a developer adding a future migration, I want a simple `runMigration(version, migrateFn)` harness I can hook into

## Acceptance Criteria

- [ ] `.aigon/migrations/{version}/` directory created per migration run
- [ ] `backup.tar.gz` contains a snapshot of `.aigon/workflows/` before migration
- [ ] `manifest.json` contains: `fromVersion`, `toVersion`, `migratedAt`, `status` (success/failed/restored), entity lists (features, research, feedback migrated/skipped)
- [ ] `migration.log` contains timestamped entries for each action taken
- [ ] If migration function throws, backup is automatically restored and `manifest.status` is set to `"restored"`
- [ ] If `.aigon/migrations/{version}/manifest.json` exists with `status: "success"`, migration is skipped (idempotent)
- [ ] `check-version` calls `runPendingMigrations()` after updating Aigon
- [ ] Framework applies to all entity types: features, research, feedback

## Validation

```bash
node --check lib/migration.js
npm test
```

## Technical Approach

- New module: `lib/migration.js` exporting `runMigration(version, migrateFn)` and `runPendingMigrations()`
- Migration registry: a simple map of version → migration function, imported from consuming features
- Backup uses `tar` via child_process (available on macOS and Linux)
- `check-version` in `lib/commands/setup.js` calls `runPendingMigrations()` after a successful update
- Validation step after migration: iterate all entity directories, confirm expected files parse as valid JSON
- On failure: extract `backup.tar.gz`, overwrite `.aigon/workflows/`, log the failure, continue (don't block the session)

## Dependencies

- none

## Out of Scope

- The actual state file consolidation migration (that's `multiuser-state-consolidation`)
- Any multi-user or team mode behaviour
- Migrations for non-state files (templates, config)

## Open Questions

- None — design settled during R30 evaluation

## Related

- Research: #30 multi-user-workflow-state-sync
