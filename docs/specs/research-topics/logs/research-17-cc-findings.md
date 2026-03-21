# Research Findings: New Docs Site for Aigon

**Agent:** Claude (cc)
**Research ID:** 17
**Date:** 2026-03-21

---

## Key Findings

### 1. What documentation system does spec-kitty.ai use?

**DocFX** (Microsoft's open-source documentation generator), hosted on **GitHub Pages**.

- Uses DocFX `modern` template (Bootstrap 5) with a custom `templates/spec-kitty/` theme
- Markdown engine: Markdig
- Built-in search enabled, dark mode via localStorage toggle
- Follows the **Diataxis** documentation pattern: Tutorials / How-To Guides / Reference / Explanations
- Docs live on a subdomain: `docs.spec-kitty.ai` (separate from the marketing site at `spec-kitty.ai`)
- Deployed via GitHub Actions (`dotnet tool install -g docfx`)

**Assessment:** DocFX is an unusual choice for a non-.NET project. It works but has a small ecosystem outside the .NET world. The Diataxis structure is the real takeaway — it's a proven pattern for developer docs that Aigon should adopt regardless of framework.

### 2. Current aigon-site (`~/src/aigon-site`) analysis

**Stack:** Plain static HTML — single 1,048-line `index.html` + custom CSS (1,833 lines). No framework, no build tool, no package dependencies.

- Hosted on **Cloudflare Pages** (deployed via `scripts/watch-deploy.sh`)
- Typography: Google Fonts (Sora, Manrope, IBM Plex Mono)
- Custom `<terminal-window>` Web Component for CLI demos
- Vanilla JS for animations, tabs, lightbox

**Content sections:** Hero, problem statement, CLI demo, value proposition, workflow lifecycle, mode selection (Drive/Fleet/Autopilot/Swarm), step walkthrough, dashboard screenshots, philosophy, community.

**Verdict: Full rebuild.** The monolithic HTML file has no routing, no search, no dark mode, no MDX support. Adding docs pages would require building a parallel system. A docs framework would provide all of this out of the box while consuming existing markdown content directly.

**What to preserve:** Design language (warm editorial palette, whitespace-heavy aesthetic), terminal animation concept, dashboard GIFs/SVGs, and the landing page content structure.

### 3. Existing content inventory (reuse potential: HIGH)

| Source | Lines | Maps To |
|--------|-------|---------|
| `README.md` | 579 | Getting Started + Concepts overview |
| `GUIDE.md` | 1,320 | Full Reference section |
| `templates/generic/commands/*.md` (32 files) | ~2,000+ | Command reference (per-command pages) |
| CLI `--help` output | ~80 | Quick reference / cheatsheet |
| `docs/architecture.md` | ~400 | Architecture deep-dive |
| `COMPARISONS.md` | ~200 | Comparison / "Why Aigon" page |

The `{{CMD_PREFIX}}` placeholders in command templates are trivially processable. Content restructuring (splitting into pages, adding frontmatter) is straightforward — minimal rewriting needed.

### 4. Documentation framework comparison

| Framework | Stack | MDX | Search | Versioning | API Auto-gen | Vercel Deploy | Landing + Docs | AI Features |
|-----------|-------|-----|--------|------------|-------------|---------------|----------------|-------------|
| **Fumadocs** | Next.js/Vite, React | Native | Orama/Algolia/Flex | Limited | OpenAPI (Scalar) | Zero-config | Yes | LLM built-in |
| **Docusaurus 3.9** | React, Webpack/SWC | Native | Built-in + Algolia | First-class | Via plugins | Zero-config | Yes | None |
| **Starlight** | Astro | MDX + Markdoc | Pagefind (local) | Manual only | None | Needs adapter | Yes (splash) | None |
| **Nextra 4.0** | Next.js App Router | Native | Built-in + Ask AI | Exists, less mature | TSDoc built-in | Zero-config | Yes | Ask AI search |
| **VitePress 1.6** | Vite, Vue 3 | No (Vue components) | Built-in local | Manual only | None | Needs config | Yes | None |
| **Mintlify** | Hosted SaaS | MDX | AI search | Available | Best-in-class | N/A (hosted) | Yes | AI Assistant |
| **GitBook** | Hosted SaaS | No (block editor) | AI search | Built-in | OpenAPI | N/A (hosted) | Limited | GitBook Agent |

### 5. How comparable CLI tools document themselves

| Tool | Framework | Domain Strategy | CLI Docs Pattern | Notable Feature |
|------|-----------|----------------|-----------------|-----------------|
| **Turborepo** | Next.js + MDX | Same domain (turborepo.dev) | Individual pages per command | Multi-entry getting started |
| **pnpm** | Docusaurus | Same domain (pnpm.io) | Hub page + individual command pages | npm comparison tables, versioning, 11 languages |
| **Wrangler** | Astro + MDX | Separate (developers.cloudflare.com) | Category hubs → command subpages | Type annotations per config key, dual-format examples |
| **Railway** | Next.js (static) | Separate (docs.railway.com) | 30+ individual command pages | Cmd+K search, competitor comparison pages |
| **Cursor** | Next.js 13+ RSC | Same domain (cursor.com/docs) | Progressive disclosure | Two-track: `/docs/` (reference) + `/learn/` (concepts) |

**Universal patterns:**
- All use **individual pages per command** with a hub/index page
- All separate "Getting Started" (navigational) from "Reference" (exhaustive)
- Smaller tools keep docs on the same domain; enterprise separates them
- Best config docs include type annotations, defaults, and constraints per key

**Opportunity for Aigon:** Railway (closest analog as CLI+dashboard tool) keeps CLI and dashboard docs in separate sections. Aigon could differentiate by showing CLI and dashboard as two views of the same workflow — side-by-side documentation.

### 6. Auto-generate vs manual command reference?

**Recommendation: Hybrid approach.**

- **Auto-generate** the command index and synopsis/flags from CLI source (`--help` output or a structured command registry)
- **Manually write** descriptions, examples, and workflow context for each command
- The 32 command templates in `templates/generic/commands/` are already structured content — they can serve as the manual layer
- A build-time script can extract command metadata from `aigon-cli.js` to keep the reference in sync

This is the pattern used by pnpm (auto-generated flag tables + manual descriptions) and Wrangler (structured config reference + narrative guides).

### 7. Should docs live at aigon.build/docs or replace the entire site?

**Replace the entire site.** Reasons:
- Current site is a static HTML monolith with no reusable architecture
- Modern docs frameworks (Fumadocs, Docusaurus, Nextra) support both landing pages AND docs
- Single deployment is simpler to maintain
- Turborepo, pnpm, and Cursor all use unified sites (same domain, one framework)
- The landing page content (hero, workflow, modes, dashboard) becomes the index/marketing section
- Docs live at `/docs/` as a subsection

### 8. Minimum viable docs structure

Based on the Diataxis pattern and CLI tool patterns observed:

```
aigon.build/
├── (landing page — hero, workflow overview, modes, why aigon)
├── /docs/
│   ├── getting-started/          ← From README
│   │   ├── installation
│   │   ├── quick-start
│   │   └── your-first-feature
│   ├── guides/                   ← From GUIDE + workflow docs
│   │   ├── feature-lifecycle
│   │   ├── research-lifecycle
│   │   ├── drive-mode
│   │   ├── fleet-mode
│   │   ├── autopilot-mode
│   │   └── dashboard
│   ├── reference/                ← From templates + CLI help
│   │   ├── commands/             ← Individual page per command
│   │   │   ├── feature-create
│   │   │   ├── feature-setup
│   │   │   └── ...
│   │   ├── configuration
│   │   ├── profiles
│   │   └── hooks
│   ├── concepts/                 ← From architecture docs
│   │   ├── specs-driven-development
│   │   ├── state-machine
│   │   ├── worktrees
│   │   └── agent-architecture
│   └── comparisons               ← From COMPARISONS.md
```

## Sources

- [spec-kitty.ai](https://spec-kitty.ai/) — DocFX + GitHub Pages, Diataxis structure
- [spec-kitty GitHub repo](https://github.com/Priivacy-ai/spec-kitty) — DocFX config, custom theme
- [Turborepo docs](https://turborepo.dev/docs) — Next.js + MDX, per-command pages
- [pnpm docs](https://pnpm.io/) — Docusaurus, versioning, i18n, npm comparison tables
- [Wrangler docs](https://developers.cloudflare.com/workers/wrangler/) — Astro + MDX, typed config reference
- [Railway docs](https://docs.railway.com/) — Next.js static export, 30+ CLI command pages
- [Cursor docs](https://cursor.com/docs) — Next.js RSC, two-track docs+learn structure
- [Fumadocs](https://fumadocs.vercel.app/) — Next.js/Vite docs framework, 11.2k stars, LLM integration
- [Docusaurus](https://docusaurus.io/) — Meta's docs framework, ~60k stars, mature versioning
- [Starlight](https://starlight.astro.build/) — Astro docs framework, Pagefind search, minimal JS
- [Nextra 4.0](https://nextra.site/) — Next.js App Router docs, Ask AI search
- [Mintlify](https://mintlify.com/) — Hosted SaaS, best API playground, $250/mo Pro
- [VitePress](https://vitepress.dev/) — Vue-based, fastest dev experience
- [Diataxis framework](https://diataxis.fr/) — Tutorials/How-To/Reference/Explanation pattern

## Recommendation

### Primary: Fumadocs (via Geistdocs template)

**Fumadocs** is the strongest choice for Aigon, deployed via Vercel:

1. **Vercel-native** — zero-config deploy, aligns with Aigon's existing ecosystem
2. **Next.js-based** — React components, MDX authoring, SSR/SSG flexibility
3. **Built-in AI/LLM features** — AI chat in docs, `llms.txt` for LLM consumption (relevant as Aigon is an AI dev tool)
4. **Geistdocs template** — Vercel's own docs template built on Fumadocs gives a polished starting point with dark mode, search (Orama), and professional design out of the box
5. **OpenAPI support** — via Scalar integration, useful if Aigon exposes dashboard APIs
6. **Active development** — 11.2k stars, 160 contributors, rapid feature growth
7. **Landing page support** — custom React components for the marketing/landing section

**Risk:** Younger than Docusaurus, versioning is less mature. Mitigated by Aigon being early enough that versioning isn't critical yet.

**Fallback: Docusaurus** if versioning becomes critical before Fumadocs matures, or if the Fumadocs ecosystem proves too thin.

### Key architectural decisions:
- **Replace entire aigon-site**, not just add `/docs`
- **Move hosting from Cloudflare Pages to Vercel** (natural ecosystem alignment)
- **Diataxis structure**: Getting Started / Guides / Reference / Concepts
- **Hybrid content strategy**: auto-generate command index from CLI source, manually write guides and examples
- **Unified domain**: `aigon.build` serves both landing page and docs
- **Reuse existing content**: README → Getting Started, GUIDE → Reference, templates → Command pages

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| docs-site-scaffold | Scaffold new aigon.build site using Fumadocs/Geistdocs with landing page + docs sections | high | none |
| docs-content-migration | Migrate README, GUIDE, and COMPARISONS.md content into docs page structure | high | docs-site-scaffold |
| docs-command-reference | Create individual docs pages for each CLI command from templates/generic/commands/ | high | docs-site-scaffold |
| docs-command-autogen | Build script to auto-generate command index and flags from CLI source code | medium | docs-command-reference |
| docs-landing-page | Recreate aigon.build landing page (hero, workflow, modes, dashboard) in the new framework | high | docs-site-scaffold |
| docs-terminal-component | MDX component for animated terminal demos (replace current Web Component) | medium | docs-site-scaffold |
| docs-vercel-deploy | Configure Vercel project for aigon.build with custom domain and deploy pipeline | high | docs-site-scaffold |
| docs-search-setup | Configure Orama search indexing across all docs content | medium | docs-content-migration |
| docs-dark-mode-theme | Customize Fumadocs theme to match Aigon's warm editorial palette and typography | medium | docs-site-scaffold |
| docs-ai-chat | Enable built-in AI chat for docs using Fumadocs LLM integration | low | docs-content-migration |
| docs-dashboard-guide | Write guide showing CLI and dashboard as two views of the same workflow (differentiator) | medium | docs-content-migration |
| docs-workflow-diagrams | Create Mermaid/SVG diagrams for feature and research lifecycle flows | low | docs-content-migration |
