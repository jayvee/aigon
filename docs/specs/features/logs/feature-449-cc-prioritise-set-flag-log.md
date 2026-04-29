---
commit_count: 5
lines_added: 675
lines_removed: 1
lines_changed: 676
files_touched: 4
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 121
output_tokens: 81215
cache_creation_input_tokens: 178381
cache_read_input_tokens: 6681614
thinking_tokens: 0
total_tokens: 6941331
billable_tokens: 81336
cost_usd: 3.892
sessions: 1
model: "claude-sonnet-4-6"
tokens_per_line_changed: null
---
# Implementation Log: Feature 449 - prioritise-set-flag
Agent: cc

## Status
Implementation complete; full test suite green at last run. Code review recorded below (2026-04-29).

## New API Surface
`lib/feature-deps.js` (added, exported): `readSetMembership(content)`, `scanInboxBySet(setSlug, specRoot)`, `getAllKnownSets(specRoot, folders?)`, `topoSort(specs)`.
`feature-prioritise` now accepts `--set <slug>`, `--all-sets`, `--dry-run`, `--yes` — implemented by overriding the entity-commands handler in `lib/commands/feature.js`.

## Key Decisions
Placed `featurePrioritiseSet` as an async closure inside the `featureCommands(ctx)` factory (same pattern as the existing `feature-create` override) so it has full access to `def`, `ctx`, and `entity.entityPrioritise` without extra wiring. Cycle detection uses Kahn's algorithm with DFS path reconstruction for the human-readable cycle string. `process.exitCode` is reset before each `entityPrioritise` call and checked afterward to detect failure.

## Gotchas / Known Issues
See **Code Review → Residual issues** for items not fixed in this branch.

## Explicitly Deferred
Reordering already-prioritised backlog entries (spec explicitly out of scope).

## For the Next Feature in This Set
Both `prioritise-correctness` features are now shipped. `lib/feature-deps.js` is the shared dep-graph module.

## Test Coverage
23 tests added in `tests/integration/prioritise-set-flag.test.js`: unit coverage for `readSetMembership`, `topoSort`, `getAllKnownSets`; integration coverage for `--set` toposort ordering, cycle detection, `--all-sets`, `--dry-run`, unknown set, and single-slug regression.

## Code Review

**Reviewed by**: composer (Cursor code-review pass)

**Date**: 2026-04-29

**Verdict**: **Approve with follow-ups** — core behaviour is sound, tests pass, and `entityPrioritise` dependency validation still guards cross-set parents at execution time. Address the items below before treating the spec as fully satisfied or as release-hardened UX.

### Strengths

- Inbox scan, Kahn toposort with `set_lead` then alphabetical tie-break, cycle path reporting, plan + confirm / `--yes` / `--dry-run`, and stop-on-failure without rollback match the spec intent.
- Shared helpers in `lib/feature-deps.js` are well tested (units + integrations).
- `feature-prioritise` override correctly composes after `createEntityCommands` so only the feature command gains `--set` / `--all-sets`.
- Cross-set `depends_on` edges are omitted from the **in-set** graph but **`entityPrioritise` still runs `checkDepsPrioritised`** on body-level parents, so children are refused if an out-of-set parent is still in inbox — consistent with single-slug prioritise.

### Residual issues (recommended follow-ups)

1. **Integration test gap (spec AC)**: The spec calls for an integration test where a child in one set depends on a parent in another set that is still in inbox; `--set` on the child’s set should exit non-zero and move nothing, with messaging aligned with `formatDepViolationError`. Only a unit test exists today (`topoSort` ignores external deps). **Add** that integration test.
2. **`--set` argument parsing**: `setSlug` is `args[indexOf('--set') + 1]`. If flags are ordered as `--set --dry-run` or the slug is missing, the code treats another flag as the slug or hits unclear errors. Prefer skipping known flags or reusing shared CLI parsing.
3. **Bulk mode and `--skip-dep-check`**: `featurePrioritiseSet` calls `entityPrioritise(def, slug, ctx, [])`, so **`--skip-dep-check` cannot be passed through** from a bulk invocation. Document or forward compatible flags.
4. **Dead code**: `prevCode` / `void prevCode` around `entityPrioritise` does not restore `process.exitCode`; remove or fix the comment.
5. **Operator docs**: Spec mentioned a one-line note in set-related documentation for `--set`; not present in the branch — add if still in scope.
6. **Plan labels**: Spec example used a “foundation” style label in the printed plan; implementation prints `set_lead` / `deps:` only — minor UX polish.

### Notes

- `scanInboxBySet` uses `parseDependsOn` on the **full file**; validation uses **body** after frontmatter strip. Tests place `depends_on` in the body; specs that put dependencies only in YAML frontmatter could theoretically diverge — same class of issue as elsewhere in `entity.js`.
- `getAllKnownSets(..., def.paths.folders)` may scan more stage folders than “inbox + backlog” for hints; acceptable for “known sets” lists.
