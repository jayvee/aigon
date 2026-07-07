---
complexity: medium
set: be-arch
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-07T06:05:28.198Z", actor: "cli/feature-prioritise" }
---

# Feature: be-arch-1-module-graph-guard

## Summary

Turn Aigon's documented module boundaries into a mechanical gate. A require-graph analysis of `lib/` (2026-07-07) found **133 require cycles** — almost all through the `lib/config.js` hub (fan-in 85, tangled with `agent-registry`, `templates`, `utils`, `proxy`, `instance-identity`, `global-config-migration`, `profile-placeholders`, `terminal-adapters`) — plus several prose-only architecture rules that nothing enforces: "agent-sessions domain files import no worktree/workflow-core/dashboard/command modules" (F554), "consumers use workflow-core only via the public barrel" (F517), and the dashboard read-only module ownership list (AGENTS.md § Dashboard read-only rule). This feature ships `scripts/check-module-graph.js`: a zero-dependency require-graph checker with (a) cycle detection, (b) declarative boundary rules, and (c) a committed baseline of existing violations so it can land green today and **ratchet** — new cycles or new boundary violations fail `test:core`; the baseline only ever shrinks. It is the foundation the rest of the be-arch set burns down against.

## User Stories

- [ ] As a maintainer (or implementing agent), if my change introduces a new require cycle or imports `lib/workflow-core/engine.js` directly from a module that should use the barrel, `npm run test:core` fails with the exact edge that broke the rule.
- [ ] As a maintainer, I can run `node scripts/check-module-graph.js --report` and see: total cycles, cycles by hub module, boundary violations by rule, and the baseline delta since last commit.
- [ ] As the be-arch set progresses (features 2–7), each feature deletes its entries from the baseline file and the guard proves the improvement is permanent.

## Acceptance Criteria

- [ ] `scripts/check-module-graph.js` parses `require()` edges across `lib/**/*.js` and `aigon-cli.js` (static string requires only; dynamic requires reported as "unanalyzable" count, not errors). Zero new npm dependencies.
- [ ] Cycle detection reports each cycle as a readable path (`a.js -> b.js -> a.js`), deduplicated by cycle set.
- [ ] Boundary rules are data, not code — a rules table at the top of the script (or a small JSON), starting with the rules already documented in AGENTS.md:
  - `lib/agent-sessions/*` (domain files) must not import worktree/workflow-core/dashboard/commands (per F554; `hosts/tmux.js` lazy-borrow exception encoded explicitly).
  - Modules outside `lib/workflow-core/` must import workflow-core only via `lib/workflow-core/index.js` (barrel) or the documented low-level exceptions (`workflow-snapshot-adapter.js`; encode the current exception list from actual usage, then ratchet).
  - `lib/dashboard-server.js` + `lib/dashboard-routes/**` must not import spec/log/state file-format owners other than the documented read-side owner modules (encode the AGENTS.md list).
  - `lib/commands/**` may import `lib/*` but `lib/*` domain modules must not import `lib/commands/**` (verify current reality first; if violations exist they go in the baseline).
- [ ] Baseline file (e.g. `scripts/module-graph-baseline.json`) pins today's cycles + violations. The check fails on: any cycle/violation not in the baseline, and on baseline entries that no longer exist (forcing baseline shrink to be committed — the ratchet in both directions).
- [ ] Wired into `npm run test:core` (alongside `check-template-leaks.js`) and runs in under ~2s.
- [ ] `--report` mode prints the summary tables; default mode prints only failures (quiet on green).
- [ ] AGENTS.md: § Rules Before Editing gains one line pointing at the guard; the boundary rules in prose now cite the script as their enforcement.
- [ ] Unit test with a small fixture graph: one cycle, one boundary violation, one baseline suppression — proves detection and ratchet semantics (`// REGRESSION:` comment per T2).

## Validation

```bash
node scripts/check-module-graph.js
npm run test:iterate
```

## Technical Approach

- Reuse the resolution rules of Node CJS (`./x` → `x.js` or `x/index.js`); ignore `node_modules` and non-relative requires. ~150 lines.
- Baseline format: sorted arrays of canonical cycle strings and `rule:from->to` violation strings — diff-friendly, so each be-arch feature's baseline shrink is visible in review.
- Follow the precedent of `scripts/check-template-leaks.js` (mechanical guard, runs in test:core and is documented as "a backstop, not the rule").
- This is the "fix the class, not the instance" move for the incident pattern in AGENTS.md § Write-Path Contract: boundary rules that only exist as prose get violated by the next agent that didn't read that paragraph.
- Restart server not required (script-only change), but `lib/` untouched here anyway.

## Dependencies

- None — lands first; the rest of the set depends on it.

## Out of Scope

- Fixing any of the 133 cycles (be-arch-2 and friends) — this feature only pins them.
- ESLint-plugin-based enforcement (import rules) — the custom script covers CJS `require` cleanly without new deps.
- Frontend dashboard JS module graph (covered by the dash-arch set's ES-module conversion + ESLint).

## Open Questions

- Whether `lib/utils.js` (cross-cutting re-export module) should be declared a sanctioned facade in the rules or treated as a hub to shrink — recommend: sanctioned for now, revisit in be-arch-2.
- Exact list of current workflow-core barrel bypasses — discover during implementation and encode as the initial exception/baseline set.

## Related

- Prior work: `scripts/check-template-leaks.js` (mechanical-guard precedent), F554 (agent-sessions import rules), F517 (barrel-only consumption rule), AGENTS.md § Dashboard read-only rule.
- Set: be-arch — sequencing: 1 (guard) → 2 (config decycle) → 3/4/5 (big-module decompositions, parallelisable) → 6/7/8 (independent).
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="568" height="348" viewBox="0 0 568 348" role="img" aria-label="Feature dependency graph for feature 629" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-629" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-629)"/><path d="M 244 66 C 284 66, 284 174, 324 174" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-629)"/><path d="M 244 66 C 284 66, 284 282, 324 282" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-629)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#629</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">be arch 1 module graph gu…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#630</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">be arch 2 config registry…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="132" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="156" font-size="14" font-weight="700" fill="#0f172a">#631</text><text x="336" y="178" font-size="13" font-weight="500" fill="#1f2937">be arch 3 finish setup mi…</text><text x="336" y="198" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="240" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="264" font-size="14" font-weight="700" fill="#0f172a">#632</text><text x="336" y="286" font-size="13" font-weight="500" fill="#1f2937">be arch 4 worktree tmux b…</text><text x="336" y="306" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
