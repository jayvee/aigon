---
complexity: high
set: be-arch
depends_on: [629]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-07T06:05:28.380Z", actor: "cli/feature-prioritise" }
---

# Feature: be-arch-2-config-registry-decycle

## Summary

Untangle the require-cycle cluster around `lib/config.js`. Config is the most-depended-on module in the codebase (fan-in 85 of 125 lib files) and simultaneously *imports* modules that import it back — producing the vast majority of the 133 cycles pinned by be-arch-1's baseline. Representative cycles from the 2026-07-07 analysis: `config → global-config-migration → instance-identity → config`, `config → profile-placeholders → config`, `agent-registry → config → agent-registry`, `config → templates → utils → state-queries → feature-workflow-rules → agent-exhaustion-detect → config`, and `instance-identity → proxy → instance-identity`. CJS tolerates cycles by handing importers a **partially-initialised** module object — whether a given export is defined depends on load order, which is why this class of bug appears only in specific entrypoints and why hub modules become scary to touch. The fix is layering: a leaf-level config core (pure read/write/merge of config files, importing nothing from the tangle), with migration-running, identity, profile detection, and registry consumption layered *above* it.

## User Stories

- [ ] As a maintainer adding a config key, I touch a config-core module that provably imports nothing that imports it back — no risk of a load-order regression in an unrelated entrypoint.
- [ ] As an implementing agent, when I accidentally re-introduce a cycle through config, `test:core` fails (be-arch-1 guard) instead of shipping a latent partial-export bug.
- [ ] As a reviewer, the module-graph baseline shrinks in this feature's diff by every config-cluster cycle, and the guard keeps it that way.

## Acceptance Criteria

- [ ] A layered split — suggested shape (adjust to the seams found, but the layering property is the criterion):
  - `lib/config-core.js` (or `lib/config/core.js`): file locations, read/parse/merge/write for `~/.aigon/config.json` + `.aigon/config.json`, precedence walking. Imports at most `cli-parse`/fs/path-level helpers. **Zero imports from** agent-registry, templates, proxy, instance-identity, profile-placeholders, migrations.
  - Migration triggering (`global-config-migration`) moves out of config's import path: entrypoints (CLI dispatch, server start) invoke migrations explicitly, then read config — config reading never triggers migration as an import-time side effect.
  - `instance-identity` ↔ `proxy` cycle broken (one direction only; likely identity is lower).
  - `agent-registry`, `profile-placeholders`, `templates`, `terminal-adapters` consume config-core; nothing in config-core consumes them. Whatever config currently needs *from* them (e.g. agent defaults resolution) moves up into a composition module or into the consumer.
- [ ] `lib/config.js` remains as a compatibility facade re-exporting the same public surface (85 importers — do NOT mass-edit call sites in this feature; the facade must be cycle-free itself).
- [ ] be-arch-1 baseline: every cycle whose path includes `lib/config.js`, `lib/instance-identity.js`, or `lib/global-config-migration.js` is removed from the baseline in this feature's diff. Target: baseline cycle count drops by well over half; document the exact numbers in the feature log.
- [ ] No behaviour change: `aigon config show`, config precedence (project > user > default), migration idempotency, and first-run bootstrapping all covered by existing tests, which must pass unmodified (except import-path updates inside the config cluster's own tests).
- [ ] Load-order safety demonstrated: `node -e "require('./lib/<each-refactored-module>')"` succeeds for each module in isolation (add as a tiny test loop — catches partial-export regressions at their root).
- [ ] `AGENTS.md` module map updated for the new shape (rule #6: docs in the same change).

## Validation

```bash
node scripts/check-module-graph.js
npm run test:iterate
```

## Technical Approach

- Work cycle-by-cycle from the be-arch-1 `--report` output, innermost first (`instance-identity ↔ proxy`, `config ↔ global-config-migration ↔ instance-identity`), because outer cycles often dissolve when inner ones break.
- The standard moves, in preference order: (1) move the shared knowledge down into a leaf module both parties import; (2) invert the dependency — the higher layer passes data/callbacks down; (3) move the offending function to the module that owns the concern. Do NOT use lazy `require()` inside functions as the fix — that hides the cycle from the graph without removing the coupling (the guard should count lazy requires it can see; note them in the log).
- `lib/utils.js` (fan-in 26, re-export hub) participates in tangles via `templates → utils → state-queries → feature-workflow-rules`: audit whether utils needs to re-export the offending members at all; shrink its surface where importers can take the direct dependency.
- Restart the dashboard server after `lib/*.js` edits (hot rule #3). This is a wide-blast-radius refactor: run the full `npm run test:core` before handing off, not just the scoped gate.

## Dependencies

- depends_on: be-arch-1-module-graph-guard

## Out of Scope

- Migrating the 85 importers off the `lib/config.js` facade (mechanical follow-up; the facade is fine indefinitely).
- Changing any config schema, key, or precedence semantics.
- The setup/install command tangle (be-arch-3) and worktree tangle (be-arch-4) — even where their cycles touch config, this feature only fixes the config side of the edge.

## Open Questions

- Does anything genuinely need config→agent-registry at import time (e.g. validating agent ids in config)? If so, that validation belongs in the consumer or a composition layer — confirm during implementation.
- `getActiveProfile` merges user overrides (per memory/docs) — decide whether profile resolution is config-core or a layer above (recommendation: above; detection reads the filesystem of the target repo, which is not config's concern).

## Related

- Prior work: F414 (registry runtime-dispatch helpers — the pattern for keeping agent knowledge in agent-registry), incident history in AGENTS.md § Write-Path Contract (the cost of implicit coupling).
- Set: be-arch — the highest-leverage single refactor in the set; unblocks confident work on every module that imports config (i.e. nearly all of them).
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="568" height="132" viewBox="0 0 568 132" role="img" aria-label="Feature dependency graph for feature 630" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-630" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-630)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#629</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">be arch 1 module graph gu…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#630</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">be arch 2 config registry…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
