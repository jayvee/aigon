---
aigon_id: F694
complexity: high
agent: cc
set: pro-merge
depends_on: [693, 695]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-25T03:37:36.776Z", actor: "cli/feature-prioritise" }
---

# Feature: merge pro docs into oss docs and purge pro references

## Summary

Aigon's public documentation is currently organised around a two-tier product: the docs
site has a dedicated **"Aigon Pro"** navigation section with 8 guides under it, a `ProBadge`
React component sprinkled across four `_meta` files, a standalone `/pro` marketing page, a
"Pro Commands" reference section, `[Pro]` markers in `aigon help`, and a private-beta
signup pitch in the README. With Pro merged into OSS (F693), none of that is true any more.

This feature makes the documentation describe **one free, open-source product**. Every
Pro-tier guide is promoted into the ordinary guide list, the badge component and its call
sites are deleted, the `/pro` marketing page and its route/rewrite/sitemap entries are
removed with a redirect so existing inbound links don't 404, aigon-pro's own
`docs/pro-installation.md` and `README.md` are absorbed and retired, and every remaining
mention of a Pro tier, a beta key, a separate package, or a "free tier" boundary is
rewritten or removed.

Scope is **documentation only** — no `lib/` behaviour changes. F693 owns the code; F695
owns the wizard. This feature owns every `.md`, `.mdx`, `.html`, `.tsx`, `.txt`, and nav
metadata file that talks about Pro.

## User Stories

- [ ] As someone landing on aigon.build, I see one product with one feature list — no "Pro"
      nav link, no upgrade CTA, no "in development, not yet available for purchase" banner.
- [ ] As someone reading the docs sidebar, Insights, Autonomous Mode, Scheduling, Recurring
      Features, Aigon Sync and Agent Failover appear as ordinary guides alongside Drive Mode
      and Fleet Mode, with no PRO superscript and no separator dividing "open source" from
      anything else.
- [ ] As someone who bookmarked `aigon.build/pro` or was sent the pro-installation guide link,
      I get redirected somewhere useful instead of a 404.
- [ ] As someone running `aigon help`, no command is marked `[Pro]` and there is no footer
      saying Pro features are in development.
- [ ] As a contributor reading `CONTRIBUTING.md` and `AGENTS.md`, there is no OSS/Pro repo
      boundary to respect and no instruction to keep implementation in a second private repo.
- [ ] As a maintainer, `grep -ri "aigon.pro"` over the public docs returns only historical
      CHANGELOG entries and archived spec history — nothing that describes current behaviour.

## Acceptance Criteria

### Docs site — navigation and components

- [ ] `site/components/pro-badge.tsx` is deleted, along with every `withPro(...)` call and
      `import { withPro }` line in:
      `site/content/guides/_meta.tsx`,
      `site/content/reference/commands/infra/_meta.tsx` (wraps `insights`, `workflow`),
      `site/content/reference/commands/feature/_meta.tsx` (wraps `feature-autonomous-start`,
      `feature-autonomous-stop`),
      `site/content/reference/commands/research/_meta.tsx` (wraps `research-autopilot`).
- [ ] `site/content/guides/_meta.tsx` no longer has an `_oss-header` or `_pro-header`
      separator. The 8 guides currently under the Pro separator (`autonomous-mode`,
      `scheduling-features`, `recurring-features`, `aigon-sync`, `feature-sets-autonomous`,
      `brewboard-feature-set`, `insights`, `agent-failover`) are interleaved into the single
      guide list in a **deliberate reading order**, not appended. `pro-installation` is gone
      from the list entirely.
- [ ] `site/content/reference/commands/_meta.js` drops the `pro: "Pro Commands"` entry.
- [ ] `site/content/reference/commands/pro/` is deleted (`activate.mdx`, `status.mdx`,
      `installed-notice.mdx`).
- [ ] `site/content/guides/pro-installation.mdx` is deleted.
- [ ] `npm run build` in `site/` succeeds with no unresolved imports and no broken internal links.

### Docs site — marketing surface

- [ ] `site/public/pro.html` (444 lines) is deleted.
- [ ] `site/app/pro/page.tsx` is deleted.
- [ ] The `/pro → /pro.html` rewrite in `site/next.config.mjs` is removed.
- [ ] The `https://www.aigon.build/pro` entry in `site/app/sitemap.ts` is removed.
- [ ] **Redirects exist** for `/pro` and `/docs/guides/pro-installation` so inbound links
      (including the one currently in `README.md`) land on a live page — `/` and
      `/docs/getting-started` respectively. Add them to `site/vercel.json` or
      `next.config.mjs` `redirects()`, whichever the site already uses for redirects.
- [ ] `site/public/home.html`: the `/pro` nav link is removed; the "Aigon Pro" CTA block
      (eyebrow, lead copy, `Explore Aigon Pro` button, screenshot) is either deleted or
      rewritten as an ordinary feature block for Insights — no upgrade framing either way.
- [ ] `site/public/img/{insights-pro,charts-pro,summary-pro}.png` are either re-referenced
      from the Insights guide (preferred — they are good screenshots) or deleted. No orphaned
      image files.

### Docs site — prose

Each of these files currently contains tier language and must be rewritten so the described
capability reads as standard, always-available behaviour. No file may retain "requires Pro",
"Pro only", "(Pro)", "free tier", "upgrade", "beta key", or a separate-install step:

- [ ] `site/content/getting-started.mdx` — remove the Pro install step from the setup flow.
- [ ] `site/content/compare.mdx`
- [ ] `site/content/guides/index.mdx`
- [ ] `site/content/guides/agent-failover.mdx`
- [ ] `site/content/guides/aigon-sync.mdx`
- [ ] `site/content/guides/dashboard.mdx` — drop references to Pro-populated view divs / stubs.
- [ ] `site/content/guides/insights.mdx`
- [ ] `site/content/guides/recurring-features.mdx`
- [ ] `site/content/guides/scheduling-features.mdx`
- [ ] `site/content/guides/telemetry.mdx`
- [ ] `site/content/guides/autonomous-mode.mdx`
- [ ] `site/content/guides/feature-sets-autonomous.mdx`
- [ ] `site/content/guides/brewboard-feature-set.mdx`
- [ ] `site/content/guides/security-scanning.mdx`
- [ ] `site/content/guides/applying-aigon-updates.mdx`
- [ ] `site/content/guides/setup-wizard.mdx` — **coordinate with F695**; the step list and
      step numbering change there.
- [ ] `site/content/reference/commands/index.mdx`
- [ ] `site/content/reference/commands/infra/insights.mdx`
- [ ] `site/content/reference/commands/infra/schedule.mdx`
- [ ] `site/content/reference/commands/infra/workflow.mdx`
- [ ] `site/content/reference/commands/feature/feature-autonomous-start.mdx`
- [ ] `site/content/reference/commands/feature/feature-autonomous-stop.mdx`
- [ ] `site/content/reference/commands/research/research-autopilot.mdx`
- [ ] `site/content/reference/agents.mdx`
- [ ] `site/content/reference/configuration.mdx` — remove `proKey` if documented.
- [ ] `site/app/llms.txt` and `site/app/llms-full.txt` routes emit no Pro-tier content
      (they derive from the MDX, so verify rather than edit).

### Repo-root documentation

- [ ] `README.md` — the "Aigon Pro" section (currently ~lines 149–160: commercial-tier pitch,
      `john@aigon.build` private-beta request, links to `/docs/guides/pro-installation` and
      `/pro`, and the "the free tier … stays free and open source" sentence) is removed. If
      the capabilities it advertised aren't described elsewhere in the README, fold them into
      the main feature list instead of deleting the information.
- [ ] `CONTRIBUTING.md` — the "commercial Pro tier lives in a separate private repo" paragraph
      is removed; contribution guidance no longer tells people to open an issue before touching
      anything Pro-adjacent.
- [ ] `AGENTS.md` — the `<!-- aigon-root:oss-pro-boundary -->` section ("OSS / Pro Boundary",
      4 rules) is deleted, marker included. `node scripts/check-root-instruction-budget.js` passes.
- [ ] `CLAUDE.md` — no Pro-boundary pointer remains.
- [ ] `docs/architecture.md` § "Aigon Pro (`@aigon/pro`)" is replaced by a section describing
      the merged engines and their modules (see F693); the "Specs for Pro features" subsection
      and the `MOVED-TO-AIGON-PRO.md` pointer are updated to point at `MERGED-FROM-AIGON-PRO.md`.
- [ ] `docs/security-scanner.md:127` — "Automated schedule execution is handled by Aigon Pro's
      recurring engine; in OSS, run `aigon security-scan` on demand" becomes a plain statement
      that the recurring engine runs it on schedule.
- [ ] `templates/help.txt` — the six `[Pro]` markers (lines ~45, 47, 49, 87, 107, 112) and the
      footer at line 217 ("Pro features are currently in development…") are removed.
- [ ] `hero-snapshot.md:61` — the "Aigon Pro — AI-powered insights and coaching dashboard"
      alt text is updated (this file is a captured a11y snapshot; regenerate it rather than
      hand-editing if there is a generator).
- [ ] `docker/clean-room/README.md:86` — "Step 8 (Aigon Pro vault) — decline" is corrected.
      **Coordinate with F695** — the step number changes when the Pro step is removed.
- [ ] `docker/clean-room/smoke-test.sh` — the Pro install path (lines ~114–126, ~367),
      `AIGON_PRO_KEY`, and `AIGON_PRO_TGZ` handling are removed.

### Absorbing aigon-pro's own documentation

- [ ] `aigon-pro/docs/pro-installation.md` (92 lines) contributes nothing that survives the
      merge — the package, the registry `.npmrc` step, the PAT, and the beta key are all gone.
      Confirm nothing in it is uniquely useful (check the troubleshooting section), then mark
      it superseded in the private archive rather than importing it.
- [ ] `aigon-pro/README.md` (20 lines) is rewritten in the archive repo to state plainly that
      the package is retired and the product is now fully open source at `~/src/aigon`, with a
      pointer to `MERGED-FROM-AIGON-PRO.md`.
- [ ] The `MERGED-FROM-AIGON-PRO.md` file F693 creates is linked from `docs/architecture.md`
      so the ID mapping is discoverable from the docs, not just the specs tree.

### CHANGELOG — do not rewrite history

- [ ] `CHANGELOG.md`'s 8 existing Pro references (lines ~213–215, 220, 302, 479, 523, 734, 745)
      are **left untouched**. They accurately describe what shipped in past releases; editing
      them would falsify the record.
- [ ] A new `Unreleased` entry is added covering the merge: Pro is now part of the free
      open-source product, `@senlabsai/aigon-pro` is deprecated, `aigon pro activate|status`
      are removed, and the docs site `/pro` page is retired with a redirect.

### Verification

- [ ] `grep -rniE "aigon.pro|@aigon/pro|@senlabsai/aigon-pro|Pro tier|Pro feature|pro-gated|beta key|proKey|\[Pro\]"` over
      `README.md CONTRIBUTING.md AGENTS.md CLAUDE.md docs/*.md templates/ site/content site/public site/app site/components docker/`
      returns zero hits.
- [ ] `site/` builds and `npx next build` reports no broken links; Pagefind index regenerates
      without indexing a deleted page.
- [ ] `node scripts/check-template-leaks.js` and `node scripts/check-rendered-template-leaks.js` pass
      (`templates/help.txt` installs into user repos — hot rule 10 applies).
- [ ] `npm run test:core` is green.

## Validation

```bash
# No live Pro-tier language in user-facing docs
! grep -rniE "aigon[- ]pro|@aigon/pro|@senlabsai/aigon-pro|Pro tier|Pro feature|pro-gated|beta key|proKey|\[Pro\]|Explore Aigon Pro" \
    README.md CONTRIBUTING.md AGENTS.md CLAUDE.md templates/help.txt docs/architecture.md docs/security-scanner.md \
    site/content site/public site/app site/components docker/clean-room

# Deleted surfaces really are gone
! test -e site/public/pro.html
! test -e site/app/pro
! test -e site/components/pro-badge.tsx
! test -e site/content/guides/pro-installation.mdx
! test -d site/content/reference/commands/pro

# Redirects are declared for the retired public URLs
grep -qE '/pro' site/next.config.mjs site/vercel.json

# Template + budget guards
node scripts/check-template-leaks.js
node scripts/check-rendered-template-leaks.js
node scripts/check-root-instruction-budget.js
```

## Pre-authorised

- May delete site/public/pro.html, site/app/pro/, site/components/pro-badge.tsx, site/content/guides/pro-installation.mdx, and site/content/reference/commands/pro/ without a separate deletion confirmation
- May edit files in the aigon-pro archive repo for the README and pro-installation supersede notes
- May skip npm run test:browser mid-iteration; the deploy gate still runs it before close

## Technical Approach

### Do the nav before the prose

`site/content/guides/_meta.tsx` is the file that decides whether the docs *read* as one
product. Fix it first — collapsing the two separators into a single ordered list forces the
question "where does Insights belong in a reader's journey?", and the answer drives how each
guide's opening paragraph gets rewritten. Doing prose first means rewriting twice.

Suggested single ordering (adjust with judgment, but do not simply append the Pro block):

```
brewboard-tutorial · setup-wizard · dashboard · drive-mode · fleet-mode ·
research-workflow · feedback-workflow · autonomous-mode · feature-sets-autonomous ·
brewboard-feature-set · scheduling-features · recurring-features ·
telemetry · insights · agent-matrix · agent-quota-awareness · pipeline-quota ·
agent-failover · local-models · aigon-sync · github-integration · security-scanning ·
applying-aigon-updates · nudge · troubleshooting
```

### The `/pro` URL is public — redirect, don't 404

`README.md` links to `https://www.aigon.build/pro` and
`https://www.aigon.build/docs/guides/pro-installation`, both are in `sitemap.ts`, and
`pro.html` carries a canonical URL and OG tags, so they are indexed. Deleting them cold
produces 404s from search results and from any README copy already in the wild
(npm, GitHub forks, the published package). Add redirects in the same commit as the deletion.

Check whether `site/vercel.json` already has a `redirects` array; if not, use
`next.config.mjs`'s `redirects()` alongside the existing `rewrites()`.

### Three files are historical records — treat them differently

1. **`CHANGELOG.md`** — never rewrite. Add an Unreleased entry.
2. **`docs/specs/**`** — F693 owns spec-history sanitisation. This feature must not touch
   `docs/specs/`, or the two features will conflict on the same files.
3. **`legacy-fixtures/brewboard/docs/aigon-project.md`** — a frozen fixture reproducing an
   old install state. Leave it; changing it may break `scripts/test-brewboard-migration.sh`.
   Verify that assumption before deciding.

### Discrepancy found during research — resolve it here

`CHANGELOG.md:213` claims a pre-commit hook "blocks staged additions matching the
(now-rotated) Pro beta-key sentinel, non-placeholder `AIGON_PRO_KEY=` values, and Pro-internal
filename patterns", and `AGENTS.md:21` instructs agents not to bypass "the pre-commit
sensitive-content guard". **The actual `.githooks/pre-commit` is 14 lines and only blocks
`.env` / `*.local` files** — no key sentinel, no filename patterns. Either the guard was
reverted or it never landed as described.

F693 has an acceptance criterion that depends on this guard. Resolve it in this feature:
either restore a real secret-scanning guard (worth doing regardless — the repo is public), or
correct `AGENTS.md` so it stops referring to a guard that does not exist. Do not leave the
instruction pointing at nothing.

### `templates/help.txt` installs into user repos

Hot rule 10: templates under `templates/` install into the user's repo and must carry zero
opinion about it. The `[Pro]` markers and the "Pro features are currently in development"
footer are exactly the kind of vendor-tier framing that should never have shipped into a
user's help output. Removing them is a template change — run
`node scripts/check-template-leaks.js` and `check-rendered-template-leaks.js`.

### Commit shape

Four commits, so a site regression is bisectable:

1. `docs(site): collapse Pro guide section into the single guide list` — `_meta` files +
   `pro-badge.tsx` deletion + `pro-installation.mdx` + `commands/pro/` deletion.
2. `docs(site): retire the /pro marketing page with redirects` — `pro.html`, `app/pro/`,
   `sitemap.ts`, `next.config.mjs`, `home.html`, redirects.
3. `docs(site): rewrite guide and reference prose without tier language` — the ~24 MDX files.
4. `docs: purge Pro tier from README, CONTRIBUTING, AGENTS, help.txt, docker` — repo root +
   `templates/help.txt` + `docker/` + CHANGELOG Unreleased entry.

## Dependencies

- **F693** (merge aigon-pro into aigon oss) — this feature describes the world F693 creates.
  It can be written and reviewed in parallel but should **land after** F693, or the docs will
  describe capabilities the code does not yet ship for free.
- **F695** (remove Pro step from setup wizard) — shares two files:
  `site/content/guides/setup-wizard.mdx` and `docker/clean-room/README.md` (step numbering).
  This feature lands **last** in the set and is the single reconciling pass for those files.
- Declared in frontmatter: `depends_on: [693, 695]`.

## Out of Scope

- Any `lib/` or `templates/dashboard/js/` behaviour change — F693 owns the code, including
  the dashboard `PRO` badges in `templates/dashboard/js/settings.js`.
- The setup wizard's own step logic — F695.
- `docs/specs/**` sanitisation and the `MERGED-FROM-AIGON-PRO.md` file itself — F693 creates it;
  this feature only links to it.
- Rewriting `CHANGELOG.md` history.
- Importing aigon-pro's marketing, competitive, sdd-eval, or proposals documentation. Those
  stay in the private archive.
- A landing-page redesign. Removing the Pro CTA from `home.html` is in scope; restyling the
  page is not (see paused F541).

## Open Questions

- **`home.html` Pro CTA block** — delete outright, or rewrite as an Insights feature block?
  The screenshots (`insights-pro.png`, `charts-pro.png`, `summary-pro.png`) are good and the
  capability is now free, which argues for rewriting. Confirm with the user before deleting
  the images.
- **`hero-snapshot.md`** — is this generated by a script, or hand-committed? If generated,
  regenerate; if not, hand-edit line 61.
- **The pre-commit guard** — restore a real secret scanner, or correct the docs that claim
  one exists? Restoring is the better answer for a public repo but is arguably its own feature.

## Related

- Prior work: F693 (the code merge this documents), F695 (wizard), F232 (purge AADE from
  public docs — the last time this repo did a docs-wide terminology purge; read its log for
  the file list it used), F153 (pro-landing-page-and-docs — the feature that *created*
  `pro.html` and the Pro guide section, now in aigon-pro).
- `site/components/pro-badge.tsx` — the component being deleted.
- `docs/architecture.md` § "Aigon Pro (`@aigon/pro`)" — the section being replaced.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="132" viewBox="0 0 868 132" role="img" aria-label="Feature dependency graph for feature 694" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-694" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 377 66, 491 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-694)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-694)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-694)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#693</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">merge aigon pro into aigo…</text><text x="36" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#694</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">merge pro docs into oss d…</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#695</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">remove aigon pro step fro…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
