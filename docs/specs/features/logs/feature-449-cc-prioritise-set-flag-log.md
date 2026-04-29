# Implementation Log: Feature 449 - prioritise-set-flag
Agent: cc

## Status
Complete. All acceptance criteria met; 64/64 tests green.

## New API Surface
`lib/feature-deps.js` (added, exported): `readSetMembership(content)`, `scanInboxBySet(setSlug, specRoot)`, `getAllKnownSets(specRoot, folders?)`, `topoSort(specs)`.
`feature-prioritise` now accepts `--set <slug>`, `--all-sets`, `--dry-run`, `--yes` — implemented by overriding the entity-commands handler in `lib/commands/feature.js`.

## Key Decisions
Placed `featurePrioritiseSet` as an async closure inside the `featureCommands(ctx)` factory (same pattern as the existing `feature-create` override) so it has full access to `def`, `ctx`, and `entity.entityPrioritise` without extra wiring. Cycle detection uses Kahn's algorithm with DFS path reconstruction for the human-readable cycle string. `process.exitCode` is reset before each `entityPrioritise` call and checked afterward to detect failure.

## Gotchas / Known Issues
None found.

## Explicitly Deferred
Reordering already-prioritised backlog entries (spec explicitly out of scope).

## For the Next Feature in This Set
Both `prioritise-correctness` features are now shipped. `lib/feature-deps.js` is the shared dep-graph module.

## Test Coverage
23 tests added in `tests/integration/prioritise-set-flag.test.js`: unit coverage for `readSetMembership`, `topoSort`, `getAllKnownSets`; integration coverage for `--set` toposort ordering, cycle detection, `--all-sets`, `--dry-run`, unknown set, and single-slug regression.
