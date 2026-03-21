# Feature: docs-site-build

## Summary

Replace the static HTML site in `site/` with a Fumadocs Next.js app. Rebuild the aigon.build landing page in React/Tailwind, set up the docs layout with Diataxis structure (Getting Started / Guides / Reference / Concepts), configure Orama search, and customize the theme to match Aigon's warm editorial palette. The result is a deployable site with a landing page and empty docs shell.

## Acceptance Criteria

- [ ] Fumadocs Next.js app scaffolded in `site/` with its own `package.json`
- [ ] `cd site && npm run dev` serves the site on port 3000
- [ ] Landing page rebuilt: hero, workflow overview, modes (Drive/Fleet/Autopilot/Swarm), dashboard screenshots
- [ ] Terminal animation component (MDX) replaces the old Web Component
- [ ] Docs layout at `/docs/` with sidebar navigation and Diataxis structure
- [ ] Dark mode enabled (default)
- [ ] Orama search configured and working
- [ ] Theme customized: warm editorial palette, Geist/Sora typography
- [ ] Deploys to Vercel from `site/` subdirectory
- [ ] `aigon dashboard` on port 4100 and docs dev on port 3000 don't conflict

## Validation

```bash
cd site && npm run build && echo "Build OK"
```

## Technical Approach

1. `npx create-fumadocs-app` in `site/` (or use Geistdocs template)
2. Port landing page content from old `index.html` into React components
3. Set up `content/docs/` directory with placeholder pages for each section
4. Configure `fumadocs.config.ts` with navigation, theme, search
5. Build MDX terminal-window component for CLI demos
6. Design tokens: map existing CSS palette to Tailwind config / CSS variables

## Dependencies

- Feature: docs-merge-repos (site/ directory must exist)

## Out of Scope

- Writing actual docs content (that's docs-content)
- DNS switchover (that's docs-go-live)
- Command auto-generation (that's part of docs-content)

## Related

- Research: #17 new-docs-site (Fumadocs recommendation)
- Feature: docs-merge-repos (prerequisite)
