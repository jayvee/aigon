# Research: Online Documentation Site for Aigon

## Context

Aigon has an existing website at [aigon.build](https://aigon.build) (source: `~/src/aigon-site`), but it lacks proper documentation. User-facing docs currently live in the README and GUIDE files in the aigon repo (not CLAUDE.md/AGENTS.md — those are agent instructions, not user docs). This research is about rebuilding aigon.build with a new docs-focused framework — replacing or extending the current site with proper documentation.

## Questions to Answer

- [x] What documentation system does spec-kitty.ai use? → **DocFX** (confirmed by cc, cx). Diataxis structure is the real takeaway.
- [x] Leading documentation frameworks? → **Fumadocs** (all 3 agents agree), with Nextra as fallback for speed
- [x] MDX, dark mode, search, versioning, auto-gen? → Fumadocs supports all except mature versioning
- [x] Vercel deployment? → Fumadocs is Vercel-native (Next.js), zero-config deploy
- [x] Best for CLI-first tool? → Fumadocs — not just a docs platform, a product documentation app
- [x] Comparable CLI tools? → Turborepo/Railway (Next.js custom), pnpm (Docusaurus), Wrangler (Astro)
- [x] Auto-generate or manual? → Hybrid: auto-gen command index from COMMAND_REGISTRY, hand-write guides
- [x] Minimum viable structure? → Getting Started / Guides / Reference / Concepts (Diataxis)
- [x] Reuse existing markdown? → Yes, high reuse: README → Getting Started, GUIDE → Reference/Guides
- [x] Current site stack? → Static HTML monolith, Cloudflare Pages. Full rebuild, not migrate.
- [x] Same domain or separate? → Replace entire site. Landing page + docs at aigon.build in one app.

## Key Decision: Merge Repos

After synthesis, decided to **merge aigon-site into aigon** under `site/`. Reasons:
- Eliminates repo handoff (agent can update CLI + docs in one commit)
- Command reference auto-gen is trivial (same repo, direct imports)
- One feature board, one git history
- Pattern used by Turborepo, pnpm, Docusaurus

## Recommendation

**Fumadocs Next.js app in `aigon/site/`**, deployed to Vercel, serving both landing page and docs at `aigon.build`. All three agents (cc, cx, gg) independently recommended Fumadocs.

## Output

### Selected Features

| Feature Name | Description | Priority | Create Command |
|---|---|---|---|
| docs-merge-repos | Merge aigon-site into aigon/site/, configure Vercel subdirectory deploy | high | `aigon feature-create docs-merge-repos` |
| docs-site-build | Scaffold Fumadocs app, rebuild landing page, search, theme | high | `aigon feature-create docs-site-build` |
| docs-content | Migrate README/GUIDE to MDX, auto-gen command reference, write guides | high | `aigon feature-create docs-content` |
| docs-go-live | DNS switchover from Cloudflare to Vercel, redirects, AI chat, decommission | high | `aigon feature-create docs-go-live` |

### Feature Dependencies

- docs-site-build → docs-merge-repos
- docs-content → docs-site-build
- docs-go-live → docs-content

### Implementation Order

1. docs-merge-repos (Drive — mechanical git surgery)
2. docs-site-build (Fleet — creative/technical build)
3. docs-content (Fleet — content authoring)
4. docs-go-live (Drive — DNS/deployment ops)
