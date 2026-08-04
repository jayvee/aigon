# Implementation Log: Feature 741 - backup-cross-machine-project-preservation

## Status

Implemented. Vault push now refreshes only locally present registered projects,
and restore leaves Git-tracked `.aigon` files under repository authority.

## New API Surface

No new commands or options. Existing `backup push`, `backup pull`, and pull
dry-run behavior is safer across machines with different cloned project sets.

## Key Decisions

- Keep remote project snapshots that have no locally present registered repo.
- Replace the snapshot for each locally present repo exactly, including an empty
  portable scope, while preserving unrelated remote project directories.
- Derive code-owned `.aigon` files from `git ls-files`; omit them from Vault,
  exclude them from restore plans, and overlay current working-tree versions
  onto the restore stage before its atomic swap.

## Gotchas / Known Issues

- Vault no longer treats removing a repo from one machine's registration as a
  request to delete that project's remote snapshot. A future explicit prune
  command would be required for intentional deletion.

## Explicitly Deferred

- Explicit Vault project pruning.
- Automatic cloning or registration of unavailable projects.

## For the Next Feature in This Set

None.

## Test Coverage

- `node tests/unit/backup.test.js` covers preservation of an unavailable remote
  project, replacement of a local project, omission of Git-tracked files, and a
  newer tracked file surviving an older Vault restore.
- `npm run test:iterate` and `node -c lib/backup.js` pass.
