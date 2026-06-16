---
complexity: low
set: architecture-simplify-2026-05
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-12T00:34:40.210Z", actor: "cli/feature-prioritise" }
---

# Feature: simplify-centralise-paths-and-json-io

## Summary

Stage-folder names (`'01-inbox'`, `'02-backlog'`, `'03-in-progress'`, `'04-in-evaluation'`, `'05-done'`) appear as **258 inline string literals across 10+ files in `lib/`** even though `LIFECYCLE_TO_FEATURE_DIR` / `LIFECYCLE_TO_RESEARCH_DIR` already exist in `lib/workflow-core/paths.js`. The same fragmentation exists for JSON IO: **129 inline `JSON.parse(fs.readFileSync(...))` patterns**, **66 inline `fs.writeFileSync(..., JSON.stringify(...))` patterns**, **121 `fs.mkdirSync(..., {recursive:true})` calls**, and two separate `safeWrite` implementations (`lib/utils.js:112` and `lib/templates.js:47`). This is the lowest-effort, highest-leverage cleanup of the architecture-simplify set — it is also a natural prerequisite for `simplify-unified-entity-view` because that work touches every read path that today inlines a stage folder string.

## User Stories

- [ ] As an agent investigating "where do specs live?", I get pointed at exactly one file (`lib/workflow-core/paths.js`) instead of grepping 10.
- [ ] As a maintainer changing a stage folder shape (e.g. a future analog of F294), I touch one constant, not 258 grep hits.
- [ ] As an agent reading the codebase, I never see two helpers with the same name (`safeWrite`) that behave subtly differently.

## Acceptance Criteria

- [ ] All literal occurrences of `'01-inbox'`, `'02-backlog'`, `'03-in-progress'`, `'04-in-evaluation'`, `'05-done'` in `lib/**/*.js` are replaced by named references from `lib/workflow-core/paths.js`. Exceptions: test fixtures, migration code (frozen historical paths), and `paths.js` itself.
- [ ] A new `lib/io/json.js` exposes `readJsonSafe(filePath, default)`, `writeJsonAtomic(filePath, value)`, and `ensureDir(dir)`. Migrate the ≥75% highest-traffic call sites (manifest reads on poll paths, sidecar writes, snapshot reads) to use it. The remaining sites can be opportunistically migrated.
- [ ] `lib/io/json.js` is infrastructure-only: no imports from workflow-core, dashboard, commands, config, or agent modules. Domain modules depend on it; it depends only on Node stdlib.
- [ ] The duplicate `safeWrite` in `lib/templates.js` is removed; callers import from `lib/utils.js`.
- [ ] A grep-style lint check (e.g. a simple `npm run lint:paths` script) fails CI if a new `'01-inbox'` literal lands in `lib/`. Implementation: shell or eslint rule, whichever is cheaper.
- [ ] `npm run test:core` passes. `npm run test:browser:smoke` passes if dashboard-touching files change.

## Validation

```bash
# Must show 0 (or only paths.js / migration code) after the work
rg "'0[1-5]-(inbox|backlog|in-progress|in-evaluation|done)'" lib/ --type js | grep -v "workflow-core/paths.js\|migration"
# Duplicate safeWrite should be gone
rg "^function safeWrite\(" lib/ | wc -l   # expect: 1
```

## Technical Approach

- Audit `paths.js` first; add any missing named exports (e.g. `STAGE_FOLDERS.INBOX`) so consumers have a clean target.
- Mechanical sweep with codemod or grep+sed for the folder string replacements. Hand-verify each diff.
- Introduce `lib/io/json.js` as a new file (small, ~50 lines). Don't try to migrate every call site — pick the hot paths first (`dashboard-status-collector`, `workflow-snapshot-adapter`, `feature-dependencies`).
- Resist scope creep into caching (`readJsonCached`) — that belongs in `simplify-unified-entity-view` where it can be measured.

## Dependencies

- None. This feature unblocks `simplify-unified-entity-view` but does not depend on anything else.

## Out of Scope

- Adding read-side caching (deferred to `simplify-unified-entity-view`).
- Refactoring `paths.js` itself or changing folder names on disk.
- Migrating test fixtures (their literal strings are intentional snapshots).

## Open Questions

- Resolved direction: `lib/io/json.js` should live under `lib/io/`, not under `lib/workflow-core/`, because the helper is shared infrastructure for snapshots, sidecars, manifests, config, and dashboard caches.

## Related

- Set: architecture-simplify-2026-05
