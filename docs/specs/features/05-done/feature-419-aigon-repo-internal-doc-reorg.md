---
complexity: medium
set: aigon-install-contract
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-28T00:20:49.246Z", actor: "cli/feature-prioritise" }
---

# Feature: aigon-repo-internal-doc-reorg

## Summary

Reorganize aigon-the-repo's `docs/` folder for clarity and add a single catalog entry point. Move proposals, reviews, and demos into named subfolders. Patch stale module-map entries in `AGENTS.md` and `docs/architecture.md` left over from F413/414/415. **Zero impact on consumer repos** — this is purely repo-internal cleanup that lands first in the set.

## User Stories
- As an agent making changes to aigon, I want one canonical entry point (`docs/README.md`) that lists every internal doc with a one-line "what's in here / when to read it" hook, so I don't have to grep or guess what exists.
- As an aigon maintainer, I want stale module-map entries patched so the line counts and descriptions in `AGENTS.md` and `docs/architecture.md` match the post-F413/414/415 reality.
- As a future agent reading the reorganized docs, I want forward-looking proposals, point-in-time reviews, and demo content in clearly-named folders so I can ignore them when irrelevant to a code change.

## Acceptance Criteria
- [ ] `docs/README.md` exists with a one-line entry per internal doc grouped into: "Engineering" (architecture, dashboard, workflow-rules, autonomous-mode, testing*, prompt-caching-policy, token-maxing, security*, linux-install), "Proposals" (`docs/proposals/`), "Reviews" (`docs/reviews/`), "Demos" (`docs/demos/`).
- [ ] `docs/proposals/` contains `aigon-next-operator-brief.md` and `aigon-next-prototype-bootstrap.md` (moved from `docs/`).
- [ ] `docs/reviews/` contains `2026-04-06/modularity-review.md` (moved from `docs/modularity-review/2026-04-06/`).
- [ ] `docs/demos/` contains `demo-guide.md` (moved from `docs/`) and the `media/` subfolder (moved from `docs/media/`).
- [ ] `docs/notes/` retains existing files (`codex-config-audit.md`); listed in catalog as "scratch / informal investigations."
- [ ] `AGENTS.md` § "Module Map" updated: `lib/dashboard-routes.js` shown as ~60 lines (thin aggregator), with new sub-entries for `lib/dashboard-routes/{analytics,config,entities,recommendations,sessions,system,util}.js`. `lib/commands/setup.js` shown as ~3,492 lines with new sub-entries for `lib/commands/setup/{seed-reset,worktree-cleanup,gitignore-and-hooks,pid-utils,agent-trust}.js`. `lib/agent-registry.js` updated to ~655 lines and the F414 runtime-dispatch helpers (`getSessionStrategy`, `getTelemetryStrategy`, `getTrustInstallScope`, `getResumeConfig`) listed.
- [ ] `AGENTS.md` § "Reading Order" replaced with a single pointer: "1. AGENTS.md (this file) — orientation. 2. `docs/README.md` — catalog of all other docs."
- [ ] `docs/architecture.md` line 122 updated to reflect the F413 split (`lib/dashboard-routes.js` is now a 60-line aggregator; deep-dive description moved to a new "Dashboard route modules" sub-section enumerating the seven sub-files).
- [ ] `docs/architecture.md` line 369 updated to remove the "old monolith delegation" wording.
- [ ] All cross-references inside the moved files (e.g. relative links between `aigon-next-*` files, internal links in `modularity-review`) are updated to the new paths.
- [ ] No dead links: `grep -rE 'docs/(aigon-next|modularity-review|demo-guide|media)' --include="*.md"` returns zero results outside `docs/specs/`.
- [ ] **Feature Sets doc landed at `templates/docs/feature-sets.md`** (canonical, installs into consumer repos) and dogfooded at `docs/feature-sets.md`. Created in this conversation as part of the design pass — the implementation step is to verify it exists, list it in the catalog, and confirm its cross-references are intact. Covers: what a set is, when to use one, `--set` flag, `depends_on:` frontmatter, `set-prioritise` topological-order ID assignment, `set list` / `set show`, set state derivation, Pro autonomous-set commands, common patterns, frontmatter reference.
- [ ] **`templates/docs/development_workflow.md` and the dogfooded `docs/development_workflow.md` cross-reference `docs/feature-sets.md`** in the file header (one line). Already added in the design pass — implementation verifies it survives.
- [ ] `docs/README.md` catalog lists `feature-sets.md` under the "Engineering" group with hook: "What feature sets are, when to use them, how `set-prioritise` assigns IDs in dependency order."

## Validation
```bash
node --check aigon-cli.js
test -f docs/README.md
test -d docs/proposals && test -d docs/reviews && test -d docs/demos
! test -f docs/aigon-next-operator-brief.md
! test -f docs/demo-guide.md
grep -q "lib/dashboard-routes/" AGENTS.md
grep -q "docs/README.md" AGENTS.md
```

## Pre-authorised
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May `git mv` doc files in bulk without per-file confirmation (the moves are mechanical and the acceptance criteria enumerate the target paths).

## Technical Approach

Pure file moves + targeted edits. No code changes to `lib/`. The `docs/README.md` catalog should be ≤80 lines: one section per group, one line per file in the format `- [Title](path.md) — one-line hook`. Use `git mv` for all moves so history is preserved. Update the references in `AGENTS.md` and `docs/architecture.md` based on actual `wc -l` output and the post-F413/414/415 file structure (already verified in the discussion that produced this set).

Pre-existing test in `tests/integration/getNextId-worktree-aware.test.js` was fixed in the same conversation that produced this set — no test work needed here.

## Dependencies
<!-- First in set; no upstream dependencies. -->
- (none)

## Out of Scope
- Anything that changes consumer-repo install behavior (covered by F2: stop-scaffolding-consumer-agents-md).
- Moving aigon-vendored docs (`docs/development_workflow.md`, `docs/agents/`) into `.aigon/docs/` (covered by F3: vendor-aigon-docs-to-dot-aigon-folder).
- Manifest-tracked install (covered by F4: install-manifest-tracked-files).
- Brewboard seed regeneration (covered by F5: refresh-brewboard-seed-post-install-contract).
- Renaming or restructuring `docs/competitive/` and `docs/marketing/` — left in place, listed in the catalog under "Engineering reference" subgroup or similar; restructuring those is out of scope.

## Open Questions
- Should `docs/competitive/` and `docs/marketing/` move under `docs/proposals/` or stay at `docs/` root? **Default:** stay at `docs/` root (they're reference material, not forward-looking proposals).
- Should `docs/notes/codex-config-audit.md` move under `docs/reviews/`? **Default:** keep `docs/notes/` as a separate "informal scratch" bucket — reviews are dated/structured artifacts.

## Related
- Set: aigon-install-contract
- Prior features in set: (none — first in set)
- Follows: F413, F414, F415 (the simplification features whose stale doc references this feature patches)
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1468" height="132" viewBox="0 0 1468 132" role="img" aria-label="Feature dependency graph for feature 419" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-419" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-419)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-419)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-419)"/><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-419)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#419</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">aigon repo internal doc r…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#420</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">stop scaffolding consumer…</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#421</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">vendor aigon docs to dot …</text><text x="636" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#422</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">install manifest tracked …</text><text x="936" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#423</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">refresh brewboard seed po…</text><text x="1236" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
