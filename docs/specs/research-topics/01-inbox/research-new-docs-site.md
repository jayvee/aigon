# Research: Online Documentation Site for Aigon

## Context

Aigon has an existing website at [aigon.build](https://aigon.build) (source: `~/src/aigon-site`), but it lacks proper documentation. All docs live as markdown files in the main aigon repo (`docs/`, `CLAUDE.md`, `AGENTS.md`, `docs/development_workflow.md`). This research is about rebuilding aigon.build with a new docs-focused framework — replacing or extending the current site with a proper documentation system. As aigon grows toward a commercial product (AADE), it needs:

- Makes aigon accessible to new users who aren't reading the source
- Presents the workflow (create → prioritise → start → evaluate → close) clearly
- Documents all CLI commands, slash commands, dashboard features, and configuration
- Looks professional enough for a commercial developer tool

The user was impressed by [spec-kitty.ai](https://spec-kitty.ai/) docs and wants to understand what documentation system they use and find the best approach for aigon.

## Questions to Answer

- [ ] What documentation system does spec-kitty.ai use? (Inspect the site: framework, hosting, theme, structure)
- [ ] What are the leading documentation frameworks for developer tools in 2026? (Docusaurus, Nextra, Mintlify, GitBook, Fumadocs/Geistdocs, Starlight, VitePress, etc.)
- [ ] Which frameworks support: MDX authoring, dark mode, search, versioning, API reference auto-generation, and CLI command documentation?
- [ ] Which frameworks deploy easily to Vercel? (Aigon is already a Vercel ecosystem tool)
- [ ] What is the best framework for a CLI-first developer tool? (Not a SaaS dashboard — a terminal tool with a web dashboard)
- [ ] How do comparable CLI tools document themselves? (Look at: Turborepo docs, pnpm docs, Wrangler docs, Railway CLI docs, Cursor docs)
- [ ] Should aigon auto-generate command reference from the CLI source code, or maintain docs manually?
- [ ] What's the minimum viable docs structure? (Getting started, commands reference, workflow guide, configuration, FAQ)
- [ ] Can existing repo markdown (`docs/development_workflow.md`, help text, slash command templates) be reused as docs source?
- [ ] What is the current aigon-site (`~/src/aigon-site`) built with? Should we rebuild from scratch or migrate?
- [ ] Should docs live at aigon.build/docs or replace the entire site? (Landing page + docs in one framework vs separate)

## Scope

### In Scope
- Documentation framework comparison and selection
- Site structure and information architecture
- Content strategy (what to write, what to auto-generate)
- Hosting and deployment approach
- Visual style and branding considerations
- Comparison with spec-kitty.ai's approach

### Out of Scope
- Actually building the docs site (that's a feature)
- Writing all the documentation content
- Domain registration or DNS setup
- Pricing page or commercial content (may come later with AADE)

## Inspiration

- [spec-kitty.ai](https://spec-kitty.ai/) — user liked the structure and presentation
- [Turborepo docs](https://turbo.build/repo/docs) — CLI tool with excellent docs
- [Geistdocs](https://preview.geistdocs.com/docs) — Vercel's own documentation template
- Aigon's existing docs in `docs/` directory as content source
- Current aigon-site (`~/src/aigon-site`) at [aigon.build](https://aigon.build) as the deployment target
