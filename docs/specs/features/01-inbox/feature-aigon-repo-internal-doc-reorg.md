---
complexity: medium
set: aigon-install-contract
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
