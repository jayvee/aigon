---
complexity: high
---

# Feature: module-graph-baseline-burndown

## Summary
The be-arch set landed its structure but left the module-graph baseline **worse in places than it promised**. Post-set review (2026-07-08) found: (1) **F630 Phase B was shipped materially incomplete** — its own log says "net −1 cycle" and its reviewer filed `ESCALATE:architectural`; **39 config-cluster cycles** (paths including `lib/config.js`, `lib/instance-identity.js`, or `lib/global-config-migration.js`) remain in the baseline, against an acceptance criterion of zero. (2) **F633 re-pinned the ratchet upward** — the collector decomposition added **17 new cycles** (baseline 81→87), almost all through one hub edge: `lib/utils.js → lib/dashboard-server.js` (utils re-exports the dashboard server, so every `x → utils` edge reaches back into the dashboard and its new `dashboard-collect/` package, then back out to domain modules). (3) The "baseline only ever shrinks" ratchet turned out to be advisory: agents regenerated the baseline to absorb their own regressions, twice, with no ceremony. This feature burns the baseline down (config cluster to zero, F633's 17 regressions to zero) and hardens the ratchet so silent growth can't recur. Baseline at spec time: **86 cycles, 23 violations** (`scripts/module-graph-baseline.json`).

## User Stories
- [ ] As a maintainer, the config cluster is genuinely layered: no cycle in the baseline passes through `lib/config.js`, `lib/instance-identity.js`, or `lib/global-config-migration.js` — the original F630 promise, delivered.
- [ ] As a maintainer, `lib/utils.js` no longer imports `lib/dashboard-server.js`, so a leaf module importing utils cannot transitively load the entire HTTP server.
- [ ] As a reviewer, an agent cannot absorb a new cycle into the baseline by regenerating it — growth fails loudly unless explicitly flagged, and the flag shows up in the diff.

## Acceptance Criteria
- [ ] **Config cluster to zero:** every baseline cycle whose path includes `lib/config.js`, `lib/instance-identity.js`, or `lib/global-config-migration.js` is removed by real layering fixes (continue F630's `config-core.js` / `config-agent-layer.js` direction; no lazy-`require` hiding). Exact before/after counts in the implementation log.
- [ ] **Break `utils.js → dashboard-server.js`:** `lib/utils.js` stops requiring `lib/dashboard-server.js`. Whatever it re-exports from there (audit first — the re-export list at `lib/utils.js` ~line 155) moves to its owner or is imported directly by the (few) real consumers. This alone should dissolve most of F633's 17 regression cycles — verify each is gone, not merely re-routed.
- [ ] **F633 regressions to zero:** the 17 cycles added between commits `bf5b19d06` and HEAD (all involving `lib/dashboard-collect/*` or the utils hub — list them from `git show bf5b19d06:scripts/module-graph-baseline.json` diffed against current) are out of the baseline.
- [ ] **Ratchet hardening:** `scripts/check-module-graph.js --write-baseline` refuses to write a baseline with more cycles or violations than the committed one unless `--allow-growth <reason>` is passed; the reason is stored in the baseline file (`growthLog` array with date + reason) so growth is visible in the diff and grep-able later. Unit test covers refuse + allow paths (`// REGRESSION:` per T2).
- [ ] Remaining baseline violations (23 at spec time) triaged: each either fixed, or given a one-line justification comment in the rules/baseline (no unexplained residue). New total documented in the log.
- [ ] Full `npm run test:core` green; dashboard verified live after `aigon server restart` (this touches utils/dashboard-server — wide blast radius); `/api/status` payload unchanged (reuse F633's parity approach: capture before/after and diff).
- [ ] AGENTS.md module map + `docs/architecture.md` updated for any module that moves (rule: docs in the same change).

## Validation
```bash
node scripts/check-module-graph.js
npm run test:iterate
```

## Technical Approach
Work the hub edge first (`utils → dashboard-server`) — it multiplies both the config-cluster and dashboard-collect cycle families, so breaking it collapses the worklist before the harder config layering resumes. Then continue F630 Phase B cycle-by-cycle from `node scripts/check-module-graph.js --report`, innermost first, using the same three moves the F630 spec prescribed (push shared knowledge down to a leaf; invert with callbacks/data; relocate to the owner). Do NOT fix by lazy `require()` — count and log any encountered. Restart the dashboard server after `lib/*.js` edits (hot rule #3).

## Dependencies
-

## Out of Scope
- New behaviour anywhere — this is pure decoupling; every command/endpoint output byte-identical.
- Migrating the 85 `lib/config.js` facade importers (facade stays).
- The dashboard-collect package's internal shape (F633's structure stands; only its coupling back into the server/hub goes).
- `feature.js` further diet (F636 got it 2,228 → 1,363; remainder is genuine dispatch — revisit only if it regresses).

## Open Questions
- `utils.js` fan-in is ~26 — decide whether utils remains a sanctioned re-export facade (minus the dashboard-server edge) or gets shrunk opportunistically while touching it. Recommendation: sanction and shrink only what the hub-edge fix forces.

## Related
- Prior work: be-arch F630 (guard + partial decycle — its reviewer's `ESCALATE:architectural` is this feature's mandate), F633 (collector decomposition — source of the 17 regression cycles), F631/F632 (clean examples: both shrank their baseline entries as specced).
- Evidence trail: baseline history — 81 cycles post-F630 Phase A (`93fb03a9f`), 87 after F633 (`63b26ed92`), 86 now; violations 62→23 on 2026-07-08 when `workflow-core/paths.js` was sanctioned as a constants leaf during the post-set review.
