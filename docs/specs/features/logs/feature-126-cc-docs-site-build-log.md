---
commit_count: 3
lines_added: 7165
lines_removed: 3217
lines_changed: 10382
files_touched: 62
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
---

# Implementation Log: Feature 126 - docs-site-build
Agent: cc

## Plan

Replace the static HTML site in `site/` with a Fumadocs Next.js app. Port all landing page content to React/Tailwind components, set up docs with Diataxis structure, configure search and theming.

## Progress

- Scaffolded Fumadocs Next.js 15 app with fumadocs-core@15, fumadocs-ui@15, fumadocs-mdx@11
- Rebuilt landing page: hero, problem, CLI demo (terminal animation), value proposition, workflow modes, dashboard gallery, docs quickstart, philosophy, community, footer
- Created terminal animation React component replacing the old `animated-terminal` Web Component CDN dependency
- Set up docs layout at `/docs/` with sidebar navigation and Diataxis structure:
  - Getting Started
  - Guides: Drive Mode, Fleet Mode, Autopilot Mode, Research Workflow
  - Reference: CLI Commands, Configuration, Agents
  - Concepts: Specs and State, Execution Modes, Evaluation
- Configured Orama search via `fumadocs-core/search/server`
- Customised theme: warm editorial palette (#d55f2a orange, #0f7775 teal, #1f4f8a blue), Geist Sans/Mono fonts, dark mode as default
- Configured Vercel deployment (vercel.json: framework nextjs)
- Ported all image assets to public/img/

## Decisions

- **Fumadocs over Geistdocs**: Used Fumadocs directly rather than Geistdocs template because the landing page requires heavy customisation that Geistdocs doesn't accommodate easily.
- **Version compatibility workaround**: fumadocs-mdx@11 returns `Source.files` as a function while fumadocs-core@15 expects an array. Applied a cast workaround in `lib/source.ts` to bridge this.
- **Terminal component as React**: Built a custom `TerminalWindow` component with typing animation rather than importing a third-party library, keeping dependencies minimal.
- **Sora font deferred**: The spec mentions Sora typography. Defined it in the CSS `--font-heading` variable but used Geist as fallback since Sora isn't bundled via `next/font` (would need Google Fonts import). Can be added as a follow-up.
- **Dark mode default**: Set via `RootProvider theme={{ defaultTheme: "dark" }}`.
- **Docs content is placeholder**: Per spec, actual content writing is out of scope (that's docs-content feature). Each section has a placeholder page.
