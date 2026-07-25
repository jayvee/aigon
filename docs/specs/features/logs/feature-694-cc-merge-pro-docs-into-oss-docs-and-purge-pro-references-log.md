# Implementation Log: Feature 694 - merge-pro-docs-into-oss-docs-and-purge-pro-references
Agent: cc

## Status

Complete, in the four commits the spec phased plus one gate fix:

1. `docs(site): collapse Pro guide section into the single guide list`
2. `docs(site): retire the /pro marketing page with redirects`
3. `docs(site): rewrite guide and reference prose without tier language`
4. `docs: purge Pro tier from README, CONTRIBUTING, AGENTS, help.txt, docker`
5. `fix: unblock docs:check gate — drop deleted lib/commands/pro from the command inventory`

`npm run test:core` green. `site/` builds clean (106 pages, Pagefind index
regenerates). `npm run docs:check`, `check-template-leaks`,
`check-rendered-template-leaks`, `check-root-instruction-budget` all pass.

## New API Surface

None — documentation only. Two structural moves worth knowing:

- `site/content/reference/commands/setup/installed-notice.mdx` — the page moved
  out of the deleted `commands/pro/` directory. `installed-notice` is a real,
  ungated setup command (`lib/commands/setup/installed-notice.js`); deleting its
  page would have orphaned two links in `applying-aigon-updates.mdx` and broken
  `docs:check`'s command-coverage rule.
- `AGENTS.md` anchor `aigon-root:oss-pro-boundary` → `aigon-root:public-repo`.
  `scripts/check-root-instruction-budget.js` hard-requires each anchor by name,
  so the rename is a two-file change.

## Key Decisions

**The home-page CTA was rewritten, not deleted.** The spec left this open and
asked for confirmation before deleting the screenshots. Rewriting made the
question moot: `insights-pro.png`, `charts-pro.png` and `summary-pro.png` are all
already referenced from `guides/insights.mdx`, so there were never any orphans to
delete. The block is now an ordinary Insights feature section (`#insights`, with
the nav's `Pro` link becoming `Insights`) and the `.pro-cta-*` CSS was renamed to
`.insights-cta-*`. I also deleted the ~340 lines of `pro.html`-only CSS
(`.pro-hero`, `.pro-card`, `.pro-section`, `.pro-preview-banner`,
`.pro-screenshot`, `.pro-callout`, `.pro-cta-banner`, `.pro-guide-link` and their
media queries) that went dead with the page. Image filenames were left alone —
renaming them would churn four files for no reader-visible gain.

**The guide order is a reading journey, not a merge.** `_meta.tsx` is now
commented groups: orient (tutorial, wizard, dashboard) → core workflows (drive,
fleet, research, feedback) → running work unattended (autonomous, sets, brewboard
set, scheduling, recurring) → measurement (telemetry, insights) → agents (matrix,
quota, pipeline, failover, local) → integrations (sync, github, security,
updates) → day-to-day (nudge, troubleshooting). This differs from the spec's
suggested ordering in one place: telemetry/insights sit *before* the agent block
rather than in the middle of it, because Insights is what you read after running
work, and the agent-selection guides form one continuous topic. `guides/index.mdx`
was rewritten to one grid in the same order, and `agent-failover` was added to it
(it was missing from both grids before).

**The pre-commit-guard discrepancy is resolved by correcting the docs.** The spec
offered "restore a real secret scanner, or correct the instruction". The whole
OSS/Pro boundary section is deleted, which takes the dangling
"pre-commit sensitive-content guard" reference with it. Its replacement,
`## Public Repository`, states what `.githooks/pre-commit` actually does (blocks
staged `.env` and `*.local`) and says plainly that it is *not* a secret scanner,
so the check is the author's. Restoring a real scanner is a code change with its
own test surface — it does not belong in a docs feature. **Worth filing.**

**`docs/architecture.md` deliberately fails the spec's own validation grep.**
The Acceptance Criteria require architecture.md to describe the merge and link
`MERGED-FROM-AIGON-PRO.md`, and F693's "Migrating an old install" subsection must
name `@senlabsai/aigon-pro` and `proKey` — that is the whole point of the
migration path. Both requirements collide with the `aigon[- ]pro|proKey` pattern
in the spec's `## Validation` block. I kept the six matches in §§ "Spec history"
and "Migrating an old install"; every other Pro reference in that file is gone
(the `lib/commands/pro.js` table row, the "OSS stubs that delegate to `@aigon/pro`"
row, and the "Moved to Pro" sync note). The heading is now "Merged engines".

**The spec's validation pattern also over-matches `aigon pro…` generally.** Run
verbatim it flags `aigon proxy`, `aigon profile`, `aigon project-context`,
`Aigon prompts`, and `Aigon project state` — 21 hits, all false. Adding `\b`
(`aigon[- ]pro\b`) makes it clean across every listed path. Use the `\b` form.

## Gotchas / Known Issues

- **`npm run docs:check` was broken before this feature and is now fixed.**
  F693 deleted `lib/commands/pro.js` but left `scripts/docs-check.js` requiring
  it, so the gate crashed with `MODULE_NOT_FOUND` on any invocation. Commit 5
  drops the factory, deletes the now-empty `pro` classification set (every
  command in it is ungated), and swaps `pro` for `installed-notice` in the
  grouped-reference list. This is a spec-sanctioned infrastructure unblock, not
  scope creep — 8 lines, and the docs AC cannot be verified without it.
- **`site/node_modules` had to be installed** to run `next build`; it is
  gitignored and nothing was committed from it.
- **`hero-snapshot.md` has no generator.** I searched `scripts/`, `package.json`
  and `tests/` — nothing references it. It is a hand-committed Playwright a11y
  dump at the repo root, and it is stale in ways beyond this feature (it still
  says "MIT License"; the repo is Apache-2.0). I hand-edited line 61 per the AC
  and left the rest alone. It is debris that probably wants deleting, but that is
  not this feature's call.
- **`legacy-fixtures/brewboard/docs/aigon-project.md` was verified, not assumed.**
  It contains no Pro content at all (the only `pro` hit is `Profile: generic`),
  and `scripts/test-brewboard-migration.sh` only asserts its existence then its
  absence after migration 2.59.1. Untouched, correctly.
- **`docker/clean-room/smoke-test.sh` scenario 3 is gone entirely**, as F695's log
  asked: `install_aigon_pro`, `preflight_pro_tarball`, `scenario_3`, the `--all`
  dispatch, the case arm, and the `--help` text. `bash -n` passes. The
  `aigon-pro` bind mounts in `run.sh` and `run-e2e.sh` also went — they mounted a
  repo that is now a private archive.

## Explicitly Deferred

- **A real pre-commit secret scanner.** See Key Decisions. The public repo would
  benefit; it is a code feature with tests, not a docs edit.
- **Deleting or regenerating `hero-snapshot.md`.** Stale beyond this feature.
- **`npm deprecate @senlabsai/aigon-pro`.** Still a manual registry step, as
  F693 noted. The CHANGELOG Unreleased entry announces it; the command has not
  been run.
- **Committing the `~/src/aigon-pro` archive changes.** I rewrote its `README.md`
  (retired notice, pointer to `~/src/aigon` and `MERGED-FROM-AIGON-PRO.md`) and
  prepended a SUPERSEDED banner to `docs/pro-installation.md`, but did **not**
  commit — F693 hit the same wall: that repo carries ~190 files of unrelated
  install drift and a commit there would sweep it up. **Commit those two files
  yourself.** I confirmed nothing in `pro-installation.md` survives the merge:
  its troubleshooting table has four rows and all four are about the package, the
  registry, the key, or uninstalling — the banner says so explicitly.

## For the Next Feature in This Set

This is the last feature in `pro-merge`. The set's remaining manual tail:
`npm deprecate` on the published package, committing the two archive-repo files,
and (per F693) running `node scripts/import-aigon-pro-specs.js` from
`~/src/aigon` followed by `aigon doctor` once this branch merges, because the
imported engine state is gitignored.

## Test Coverage

No new tests — this feature changes no behaviour. Verification is the gate set:

- `npm run test:core` — green (lint, path literals, template leaks, module graph,
  alpine bindings, diagrams, budget, 53 integration, 2 workflow-core).
- `cd site && npm run build` — compiles clean, 106 static pages, no unresolved
  imports after deleting `pro-badge.tsx`, Pagefind reindexes 106 pages with no
  reference to the removed ones.
- `npm run docs:check` — 106 MDX pages, 140 executable commands, no broken
  internal links, no missing images, full command coverage.
- `node scripts/check-template-leaks.js` (68 files) and
  `check-rendered-template-leaks.js` (7 agents) — clean after the `help.txt` edit.
- `node scripts/check-root-instruction-budget.js` — 112 lines, 7467 bytes,
  8 anchors.
- `bash -n` on all three edited `docker/clean-room` scripts.
- The spec's `## Validation` block, run with `aigon[- ]pro\b`: zero hits across
  `README.md CONTRIBUTING.md AGENTS.md CLAUDE.md templates/help.txt
  docs/security-scanner.md site/{content,public,app,components} docker/clean-room`.
  All five deletion assertions and the redirect assertion pass.

`npm run test:browser` was not run — pre-authorised to skip mid-iteration; it
belongs to the deploy gate before close.
