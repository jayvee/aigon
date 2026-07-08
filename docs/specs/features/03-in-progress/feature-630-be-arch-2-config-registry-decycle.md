---
complexity: very-high
set: be-arch
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-07T06:05:28.380Z", actor: "cli/feature-prioritise" }
---

# Feature: be-arch-2-config-registry-decycle

> **Merged scope (2026-07-08):** absorbs former #629 `be-arch-1-module-graph-guard`. Building the require-graph tooling and untangling the config cycle cluster share one context — the implementer who maps the 133 cycles is the right person to break the biggest ones, and the guard gets proven against real refactoring instead of landing as speculative tooling. Phase A below is the old #629 scope; Phase B is the decycle.

## Summary

Two phases, one context. **Phase A — module-graph guard:** turn Aigon's documented module boundaries into a mechanical gate. A require-graph analysis of `lib/` (2026-07-07) found **133 require cycles** — almost all through the `lib/config.js` hub (fan-in 85, tangled with `agent-registry`, `templates`, `utils`, `proxy`, `instance-identity`, `global-config-migration`, `profile-placeholders`, `terminal-adapters`) — plus several prose-only architecture rules that nothing enforces: "agent-sessions domain files import no worktree/workflow-core/dashboard/command modules" (F554), "consumers use workflow-core only via the public barrel" (F517), and the dashboard read-only module ownership list (AGENTS.md § Dashboard read-only rule). Ship `scripts/check-module-graph.js`: a zero-dependency require-graph checker with (a) cycle detection, (b) declarative boundary rules, and (c) a committed baseline of existing violations so it lands green and **ratchets** — new cycles or violations fail `test:core`; the baseline only ever shrinks.

**Phase B — config decycle:** untangle the require-cycle cluster around `lib/config.js`, the most-depended-on module in the codebase, which simultaneously *imports* modules that import it back — producing the vast majority of the cycles Phase A pins. Representative cycles: `config → global-config-migration → instance-identity → config`, `config → profile-placeholders → config`, `agent-registry → config → agent-registry`, `config → templates → utils → state-queries → feature-workflow-rules → agent-exhaustion-detect → config`, and `instance-identity → proxy → instance-identity`. CJS tolerates cycles by handing importers a **partially-initialised** module object — whether a given export is defined depends on load order, which is why this class of bug appears only in specific entrypoints and why hub modules become scary to touch. The fix is layering: a leaf-level config core (pure read/write/merge of config files, importing nothing from the tangle), with migration-running, identity, profile detection, and registry consumption layered *above* it. Phase B ends by deleting every config-cluster cycle from Phase A's freshly-committed baseline — the guard's first ratchet, proven in the same feature.

## User Stories

- [ ] As a maintainer (or implementing agent), if my change introduces a new require cycle or imports `lib/workflow-core/engine.js` directly from a module that should use the barrel, `npm run test:core` fails with the exact edge that broke the rule.
- [ ] As a maintainer, I can run `node scripts/check-module-graph.js --report` and see: total cycles, cycles by hub module, boundary violations by rule, and the baseline delta since last commit.
- [ ] As a maintainer adding a config key, I touch a config-core module that provably imports nothing that imports it back — no risk of a load-order regression in an unrelated entrypoint.
- [ ] As a reviewer, the module-graph baseline shrinks in this feature's diff by every config-cluster cycle, and the guard keeps it that way for the rest of the be-arch set (features 3/4/5 delete their own baseline entries).

## Acceptance Criteria

### Phase A — guard

- [ ] `scripts/check-module-graph.js` parses `require()` edges across `lib/**/*.js` and `aigon-cli.js` (static string requires only; dynamic requires reported as an "unanalyzable" count, not errors). Zero new npm dependencies.
- [ ] Cycle detection reports each cycle as a readable path (`a.js -> b.js -> a.js`), deduplicated by cycle set.
- [ ] Boundary rules are data, not code — a rules table at the top of the script (or a small JSON), starting with the rules already documented in AGENTS.md:
  - `lib/agent-sessions/*` (domain files) must not import worktree/workflow-core/dashboard/commands (per F554; `hosts/tmux.js` lazy-borrow exception encoded explicitly).
  - Modules outside `lib/workflow-core/` must import workflow-core only via `lib/workflow-core/index.js` (barrel) or the documented low-level exceptions (`workflow-snapshot-adapter.js`; encode the current exception list from actual usage, then ratchet).
  - `lib/dashboard-server.js` + `lib/dashboard-routes/**` must not import spec/log/state file-format owners other than the documented read-side owner modules (encode the AGENTS.md list).
  - `lib/commands/**` may import `lib/*` but `lib/*` domain modules must not import `lib/commands/**` (verify current reality first; if violations exist they go in the baseline).
- [ ] Baseline file (e.g. `scripts/module-graph-baseline.json`) pins the pre-Phase-B cycles + violations. The check fails on: any cycle/violation not in the baseline, and on baseline entries that no longer exist (forcing baseline shrink to be committed — the ratchet in both directions).
- [ ] Wired into `npm run test:core` (alongside `check-template-leaks.js`) and runs in under ~2s. `--report` mode prints summary tables; default mode prints only failures (quiet on green).
- [ ] Unit test with a small fixture graph: one cycle, one boundary violation, one baseline suppression — proves detection and ratchet semantics (`// REGRESSION:` comment per T2).
- [ ] Phase A lands as its own commit(s) with the full baseline BEFORE Phase B starts deleting from it — the diff history must show the ratchet working.

### Phase B — config decycle

- [ ] A layered split — suggested shape (adjust to the seams found, but the layering property is the criterion):
  - `lib/config-core.js` (or `lib/config/core.js`): file locations, read/parse/merge/write for `~/.aigon/config.json` + `.aigon/config.json`, precedence walking. Imports at most `cli-parse`/fs/path-level helpers. **Zero imports from** agent-registry, templates, proxy, instance-identity, profile-placeholders, migrations.
  - Migration triggering (`global-config-migration`) moves out of config's import path: entrypoints (CLI dispatch, server start) invoke migrations explicitly, then read config — config reading never triggers migration as an import-time side effect.
  - `instance-identity` ↔ `proxy` cycle broken (one direction only; likely identity is lower).
  - `agent-registry`, `profile-placeholders`, `templates`, `terminal-adapters` consume config-core; nothing in config-core consumes them. Whatever config currently needs *from* them (e.g. agent defaults resolution) moves up into a composition module or into the consumer.
- [ ] `lib/config.js` remains as a compatibility facade re-exporting the same public surface (85 importers — do NOT mass-edit call sites in this feature; the facade must be cycle-free itself).
- [ ] Baseline ratchet: every cycle whose path includes `lib/config.js`, `lib/instance-identity.js`, or `lib/global-config-migration.js` is removed from the Phase A baseline in this feature's diff. Target: baseline cycle count drops by well over half; document the exact numbers in the feature log.
- [ ] No behaviour change: `aigon config show`, config precedence (project > user > default), migration idempotency, and first-run bootstrapping all covered by existing tests, which must pass unmodified (except import-path updates inside the config cluster's own tests).
- [ ] Load-order safety demonstrated: `node -e "require('./lib/<each-refactored-module>')"` succeeds for each module in isolation (add as a tiny test loop — catches partial-export regressions at their root).
- [ ] AGENTS.md: module map updated for the new shape; § Rules Before Editing gains one line pointing at the guard; the boundary rules in prose now cite the script as their enforcement (rule #6: docs in the same change).

## Validation

```bash
node scripts/check-module-graph.js
npm run test:iterate
```

## Technical Approach

- **Sequence strictly A then B.** Build the graph tooling first, commit it with the full baseline, then use its `--report` output as the worklist for Phase B — the tool pays for itself inside its own feature.
- Guard: reuse Node CJS resolution rules (`./x` → `x.js` or `x/index.js`); ignore `node_modules` and non-relative requires. ~150 lines. Baseline format: sorted arrays of canonical cycle strings and `rule:from->to` violation strings — diff-friendly, so this feature's own baseline shrink (and each later be-arch feature's) is visible in review. Follow the `scripts/check-template-leaks.js` precedent (mechanical guard, runs in test:core, "a backstop, not the rule").
- Decycle: work cycle-by-cycle from the `--report` output, innermost first (`instance-identity ↔ proxy`, `config ↔ global-config-migration ↔ instance-identity`), because outer cycles often dissolve when inner ones break.
- The standard moves, in preference order: (1) move the shared knowledge down into a leaf module both parties import; (2) invert the dependency — the higher layer passes data/callbacks down; (3) move the offending function to the module that owns the concern. Do NOT use lazy `require()` inside functions as the fix — that hides the cycle from the graph without removing the coupling (the guard should count lazy requires it can see; note them in the log).
- `lib/utils.js` (fan-in 26, re-export hub) participates in tangles via `templates → utils → state-queries → feature-workflow-rules`: audit whether utils needs to re-export the offending members at all; shrink its surface where importers can take the direct dependency.
- Restart the dashboard server after `lib/*.js` edits (hot rule #3). This is a wide-blast-radius refactor: run the full `npm run test:core` before handing off, not just the scoped gate.

## Dependencies

- None — lands first; be-arch 3/4/5 depend on this feature (for the guard).

## Out of Scope

- Fixing non-config cycles beyond what Phase B's cluster naturally dissolves (be-arch 3/4/5 delete their own baseline entries).
- Migrating the 85 importers off the `lib/config.js` facade (mechanical follow-up; the facade is fine indefinitely).
- Changing any config schema, key, or precedence semantics.
- ESLint-plugin-based enforcement (import rules) — the custom script covers CJS `require` cleanly without new deps.
- Frontend dashboard JS module graph (dash-arch/dash-finish territory; note: dash-finish-3's cycle check should reuse this scanner if practical).
- The setup/install command tangle (be-arch-3) and worktree tangle (be-arch-4) — even where their cycles touch config, this feature only fixes the config side of the edge.

## Open Questions

- Whether `lib/utils.js` should be declared a sanctioned facade in the guard rules or treated as a hub to shrink — recommend: sanctioned for now, shrink opportunistically in Phase B.
- Exact list of current workflow-core barrel bypasses — discover during implementation and encode as the initial exception/baseline set.
- Does anything genuinely need config→agent-registry at import time (e.g. validating agent ids in config)? If so, that validation belongs in the consumer or a composition layer — confirm during implementation.
- `getActiveProfile` merges user overrides (per memory/docs) — decide whether profile resolution is config-core or a layer above (recommendation: above; detection reads the filesystem of the target repo, which is not config's concern).

## Related

- Prior work: `scripts/check-template-leaks.js` (mechanical-guard precedent), F554 (agent-sessions import rules), F517 (barrel-only consumption rule), AGENTS.md § Dashboard read-only rule, F414 (registry runtime-dispatch pattern), incident history in AGENTS.md § Write-Path Contract (the cost of implicit coupling).
- Set: be-arch — the foundation feature: guard + highest-leverage refactor. Sequencing: this → 3/4/5 (big-module decompositions, parallelisable) → 6 → merged cleanup feature last.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="568" height="348" viewBox="0 0 568 348" role="img" aria-label="Feature dependency graph for feature 630" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-630" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-630)"/><path d="M 244 66 C 284 66, 284 174, 324 174" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-630)"/><path d="M 244 66 C 284 66, 284 282, 324 282" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-630)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#630</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">be arch 2 config registry…</text><text x="36" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#631</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">be arch 3 finish setup mi…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="132" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="156" font-size="14" font-weight="700" fill="#0f172a">#632</text><text x="336" y="178" font-size="13" font-weight="500" fill="#1f2937">be arch 4 worktree tmux b…</text><text x="336" y="198" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="240" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="264" font-size="14" font-weight="700" fill="#0f172a">#633</text><text x="336" y="286" font-size="13" font-weight="500" fill="#1f2937">be arch 5 collector decom…</text><text x="336" y="306" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
