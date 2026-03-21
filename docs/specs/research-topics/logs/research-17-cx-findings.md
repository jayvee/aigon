# Research Findings: new docs site

**Agent:** Codex (cx)
**Research ID:** 17
**Date:** 2026-03-21

---

## Key Findings

### 1. spec-kitty.ai is split across two systems

- `docs.spec-kitty.ai` is using **DocFX**, not Docusaurus/Nextra/Mintlify. I verified this from the live site runtime assets: `docfx.min.js`, `docfx.min.css`, `main.css`, `toc.json`, and `index.json`.
- `spec-kitty.ai` itself appears to be a separate marketing site with a bundled frontend app; based on the hashed asset bundle (`assets/index-*.js`, `assets/index-*.css`), it is likely a Vite-built marketing site. That part is an inference from runtime assets, not a repo inspection.
- The important takeaway is architectural, not brand-level: Spec Kitty has a **marketing site + separate docs stack**. The docs experience is serviceable, but it is not especially modern or differentiated.

### 2. The strongest open-source contenders in 2026 are not equal

- **Nextra**: strongest fit if the goal is "docs and marketing in one Vercel-native Next.js app" with low reinvention. It is Next.js-based, MDX-first, has Pagefind-backed search, dark mode, good built-in docs layout primitives, and static export support. It does not have Docusaurus-style first-party versioning; that is the main gap.
- **Fumadocs**: strongest fit if Aigon expects heavier customization, richer API/reference generation, and more product-grade design control. It is built for Next.js/App Router, supports MDX, has first-class search integrations (built-in Orama, Algolia support), and has an official OpenAPI integration with interactive playground and generated MDX files. It is the most flexible open-source option in this set.
- **Docusaurus**: still the safest "docs platform" choice when versioning matters. It has first-party versioning and strong search support, but it feels more like a docs product than a marketing-plus-docs product. For Aigon, that matters because the site likely needs both docs and positioning.
- **Starlight**: very good static docs framework, especially if you want simplicity and speed. It has built-in Pagefind search and MD/MDX authoring. It is less Vercel-native than the Next.js options and is better for "excellent docs site" than "docs + polished product site in one app."
- **VitePress**: strong for technical docs, especially if the content is mostly Markdown and the team wants low ceremony. It supports local search and Algolia, but it is Vue-flavored and not a natural fit for a Vercel-centric tool unless there is a strong preference for it.
- **Mintlify / GitBook**: both are strong hosted products, especially for fast API docs and content teams, but they trade away control. Mintlify is especially good at OpenAPI-driven references and polished hosted docs. GitBook is strong for collaborative authoring. For Aigon, both introduce unnecessary product coupling if the goal is a brand-defining developer site.

### 3. Framework capability matrix for Aigon's needs

| Framework | MDX | Dark Mode | Search | Versioning | API Reference Auto-gen | Vercel Fit | Notes |
|-----------|-----|-----------|--------|------------|-------------------------|------------|-------|
| Nextra | yes | yes | yes, Pagefind | limited / custom | possible, but not the standout path | excellent | Best "single Next.js site" balance |
| Fumadocs | yes | yes | yes, Orama/Algolia | limited / custom | excellent, official OpenAPI integration | excellent | Best if docs will become a real product surface |
| Docusaurus | yes | yes | yes, official Algolia support | yes, first-party | possible, but usually plugin/ecosystem-driven | good | Best if versioned product docs dominate |
| Starlight | yes | yes | yes, built-in Pagefind | no obvious first-party versioning found in this pass | possible, but not core strength | good | Excellent static docs ergonomics |
| VitePress | markdown + Vue in markdown | yes | yes, local + Algolia | limited / custom | possible, but not core strength | good | Strong technical docs, weaker brand-site fit |
| Mintlify | yes | yes | yes | yes | excellent | hosted, easy | Fastest hosted path, least control |
| GitBook | block editor + synced docs | yes | yes | yes | strong OpenAPI support | hosted, easy | Good collaborative authoring, weaker design ownership |

### 4. Comparable CLI tools mostly do one of two things

- **pnpm** uses **Docusaurus** directly. That is the classic "serious CLI docs" pattern.
- **Wrangler / Cloudflare Workers docs** use **Astro** (`meta generator: Astro v6.0.5` on the live docs page), showing that static-first frameworks can scale well for developer docs.
- **Turborepo docs**, **Railway docs**, and **Cursor docs** all appear to be **custom Next.js sites** based on live `_next` assets. That is an inference from runtime inspection, but the pattern is clear: higher-end developer tools often converge on custom Next.js-based docs experiences instead of off-the-shelf docs-only systems.
- For Aigon, that implies: if the docs site is part of the product narrative, **Next.js-native docs tooling is strategically aligned**.

### 5. Aigon's current site is not a migration problem, it is a replacement problem

- The current `~/src/aigon-site` repo is a **plain HTML + CSS static site** with no framework, no npm, and Cloudflare Pages "Framework preset: None".
- That means there is no framework migration tax to preserve. Rebuilding is cleaner than trying to incrementally retrofit docs into the existing static site.
- Existing content is reusable:
  - `README.md`
  - `docs/development_workflow.md`
  - `templates/help.txt`
  - `docs/agents/*.md`
  - selected spec docs and screenshots
- Existing design/content from `aigon-site` can still be reused as copy, screenshots, and landing-page structure, but not as a technical base.

### 6. Command reference should be partially auto-generated, not fully hand-written

- Aigon already has a usable metadata layer for commands:
  - `lib/templates.js` defines `COMMAND_REGISTRY` with command names, aliases, and argument hints.
  - prompt templates store per-command descriptions in the `<!-- description: ... -->` frontmatter-like comment.
- That is enough to auto-generate:
  - command index
  - command synopsis / args
  - aliases
  - prompt descriptions
- It is **not** enough for full high-quality reference docs on its own, because nuanced behavior still lives in command modules and prompt templates.
- Best approach:
  - auto-generate the command skeleton/reference tables from `COMMAND_REGISTRY` + template descriptions
  - hand-write the explanatory sections, examples, mode semantics, and workflow guidance

### 7. Best recommendation for Aigon

- **Choose Fumadocs if the priority is a premium docs product on Vercel with room to grow into richer reference pages, generated API-like docs, and a stronger custom visual identity.**
- **Choose Nextra if the priority is fastest execution with the lowest complexity while still getting a polished Next.js/MDX docs experience.**
- My recommendation is **Fumadocs**.

Why Fumadocs wins for Aigon:

- Aigon is not just an API or library. It has workflow concepts, command surfaces, agent-specific docs, dashboard screenshots, and likely future AADE/commercial positioning.
- That means the docs site needs to behave like a **product documentation app**, not just a static manual.
- Fumadocs gives the strongest balance of:
  - Vercel-native deployment
  - MDX authoring
  - flexible custom design
  - strong search options
  - official generated API/reference capabilities
  - room to keep landing + docs in one cohesive Next.js app

### 8. Minimum viable information architecture

Recommended v1 structure:

- `/` landing page
- `/docs`
- `/docs/getting-started`
- `/docs/workflow`
- `/docs/commands`
- `/docs/commands/feature-*`, `/research-*`, `/feedback-*`, etc.
- `/docs/dashboard`
- `/docs/agents`
- `/docs/configuration`
- `/docs/faq`
- `/docs/changelog` or `/docs/what-s-new`

### 9. URL structure recommendation

- Use **one framework for both landing page and docs**.
- Put docs at **`aigon.build/docs`**.
- Do not keep a separate marketing repo long-term unless the marketing experience becomes radically different from the docs shell.

Reasoning:

- one deployment pipeline
- one design system
- one search surface
- one analytics setup
- easier internal linking between marketing and docs
- less content drift

I would only split them if the landing site becomes a high-change marketing property owned by a different workflow/team.

## Sources

- Spec Kitty docs runtime inspection via Playwright: `https://docs.spec-kitty.ai/`
- Spec Kitty marketing site runtime inspection via Playwright: `https://spec-kitty.ai/`
- Docusaurus versioning docs: https://docusaurus.io/docs/versioning
- Docusaurus search docs: https://docusaurus.io/docs/search
- Docusaurus markdown / MDX docs: https://docusaurus.io/docs/markdown-features
- Nextra docs intro: https://nextra.site/docs
- Nextra docs theme: https://nextra.site/docs/docs-theme/start
- Nextra search engine docs: https://nextra.site/docs/guide/search
- Nextra site overview: https://nextra.site/
- Nextra static export docs: https://nextra.site/docs/guide/static-exports
- Fumadocs overview: https://v14.fumadocs.dev/
- Fumadocs search docs: https://v14.fumadocs.dev/docs/ui/search
- Fumadocs built-in search: https://v14.fumadocs.dev/docs/headless/search/orama
- Fumadocs OpenAPI docs: https://v14.fumadocs.dev/docs/ui/openapi
- Starlight pages docs: https://starlight.astro.build/guides/pages/
- Starlight site search docs: https://starlight.astro.build/guides/site-search/
- VitePress search docs: https://vitepress.dev/reference/default-theme-search
- Mintlify quickstart: https://www.mintlify.com/docs/quickstart
- Mintlify API playground: https://mintlify.com/docs/api-playground
- Mintlify OpenAPI setup: https://mintlify.com/docs/api-playground/openapi/setup
- GitBook docs home: https://gitbook.com/docs
- GitBook OpenAPI docs: https://gitbook.com/docs/api-references/openapi
- GitBook API reference example: https://gitbook.com/docs/developers/gitbook-api/api-reference
- Turborepo docs runtime inspection: https://turbo.build/repo/docs
- pnpm live site runtime inspection: https://pnpm.io/
- Cloudflare Wrangler docs runtime inspection: https://developers.cloudflare.com/workers/wrangler/
- Railway docs runtime inspection: https://docs.railway.com/cli
- Cursor docs runtime inspection: https://cursor.com/docs
- Local Aigon site README: `~/src/aigon-site/README.md`
- Local Aigon site deployment docs: `~/src/aigon-site/docs/deployment.md`
- Aigon command registry: `lib/templates.js`
- Aigon research-do prompt contract: `templates/generic/commands/research-do.md`

## Recommendation

Build a new **Fumadocs-based Next.js site on Vercel** and use it for both the landing page and docs at `aigon.build/docs`.

Implementation approach:

1. Start a fresh site rather than migrating the current static HTML codebase.
2. Port the current landing page selectively into the new app shell.
3. Reuse existing markdown from `README.md`, `docs/development_workflow.md`, `docs/agents/*.md`, and `templates/help.txt`.
4. Add a generator that reads `lib/templates.js` plus command template descriptions to produce command reference stubs.
5. Hand-curate the workflow docs, dashboard docs, and conceptual docs.
6. Keep versioning out of v1 unless Aigon starts maintaining multiple public release lines.

Fallback recommendation:

- If speed of execution matters more than flexibility, choose **Nextra** instead of Fumadocs.
- If explicit docs versioning becomes a hard requirement immediately, choose **Docusaurus** instead.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| docs-site-framework-selection | Choose and lock the docs framework, hosting approach, and single-site architecture for aigon.build. | high | none |
| docs-site-bootstrap | Create the new docs app with landing page shell, docs layout, navigation, dark mode, and search. | high | docs-site-framework-selection |
| docs-information-architecture | Define the docs structure for getting started, workflow, commands, dashboard, agents, configuration, and FAQ. | high | docs-site-framework-selection |
| command-reference-generator | Generate command reference pages from `COMMAND_REGISTRY` and command template descriptions. | high | docs-site-bootstrap |
| docs-content-migration | Port reusable content from README, workflow docs, help text, and agent docs into the new docs site. | high | docs-site-bootstrap |
| landing-page-migration | Rebuild or adapt the current aigon-site marketing content inside the new docs framework. | medium | docs-site-bootstrap |
| dashboard-docs-and-media | Add dashboard documentation, screenshots, and workflow visuals for the web experience. | medium | docs-content-migration |
| docs-search-tuning | Tune search indexing, synonyms, section weighting, and result quality for CLI command discovery. | medium | docs-site-bootstrap |
| docs-release-notes | Add a changelog or what’s-new section for public-facing product changes. | medium | docs-content-migration |
| docs-versioning-strategy | Decide whether to add docs versioning later and document the trigger for introducing it. | low | docs-site-bootstrap |
