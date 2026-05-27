---
complexity: very-high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-27T14:12:15.966Z", actor: "cli/feature-prioritise" }
---

# Feature: landing-page-redesign-swiss-light

## Summary

Complete visual redesign of both the Aigon OSS landing page (`site/public/home.html` + `site/public/css/style.css`) and the Aigon Pro landing page (`site/app/pro/page.tsx`) using the "Swiss Light" design direction. The current pages have classic AI-generated aesthetics — warm cream backgrounds with radial gradients, orange+teal dual accent, three font families (Sora + Manrope + IBM Plex Mono), pill-shaped gradient buttons, numbered value-prop cards — that are immediately recognizable as AI-designed. The redesign adopts a disciplined, handcrafted visual language: one font family, one accent color, strict grid, border-based depth, and zero decorative elements.

## Background & Design Research

### The problem

The current landing page shares the exact same look and colour scheme as other AI-designed landing pages. A side-by-side comparison with fullstackpm.com/courses/claudecode confirmed the pages are visually interchangeable — warm beige gradients, orange/teal accents, rounded cards, pill CTAs. This immediately marks Aigon's site as "made by AI" and undermines the product's credibility as a tool built by a craftsperson.

### Research process

15 real websites were researched across 5 design directions (Editorial/Magazine, Brutalist/Raw, Swiss/Systematic, Dark Craft, Analog/Tactile), with 3 sites per direction. The user reviewed all 15 and selected 7 finalists, then cut to a final 6:

| # | Site | Key lesson |
|---|------|-----------|
| 1 | **Linear** (linear.app) | Product UI embedded directly as marketing — the real app IS the page |
| 2 | **Raycast** (raycast.com) | Dark as theater for bright product; restrained accents |
| 3 | **Oxide Computer** (oxide.computer) | Monospace font as display type AND illustration system |
| 4 | **Offscreen Magazine** (offscreenmag.com) | Editorial restraint, buzzword-free, serif/sans pairing |
| 5 | **Supabase** (supabase.com) | One accent color ruthlessly enforced; border hierarchy for depth |
| 6 | **Warp** (warp.dev) | Dual-altitude product shots (CLI + dashboard together) |

### Rejected directions

- **Brutalist/Raw** (Sourcehut, Suckless, McMaster-Carr) — too stripped down
- **Analog/Tactile** (Field Notes, Daylight Computer, Panic) — didn't resonate
- **Dark-native theme** — user explicitly prefers light backgrounds despite admiring dark-site design quality
- **Zed** (zed.dev) — cut in final round
- **Stripe Press** — too sparse
- **The Pudding** — too playful
- **Vercel** — "not a landing page" (platform homepage)
- **iA Writer** — "not inspiring"

### Chosen direction: "Swiss Light"

Three hero sketches were created (`tmp/sketch-a-swiss-light.html`, `tmp/sketch-b-editorial-mono.html`, `tmp/sketch-c-inverted-theater.html`). The user selected **Sketch A: Swiss Light** — pulling from Linear + Supabase lessons applied to a white/light background.

Reference file: `tmp/landing-page-inspiration.html` — the final 6 inspiration sites with clickable links, visual details, and transferable principles.

### Design principles (from cross-cutting analysis of all 15 sites)

What makes AI pages look AI-generated (the 5 tells to eliminate):

1. **Multi-color accent** — handcrafted sites use 1-2 colors max
2. **Font variety** — distinctive sites invest in ONE family
3. **Radial gradients on body** — an instant AI fingerprint
4. **Hero → cards → features → CTA template** — the default SaaS scaffold
5. **Generically positive copy** — no opinionated voice

## User Stories

- [ ] As a visitor, the landing page looks handcrafted and distinctive — I cannot identify it as AI-designed
- [ ] As a visitor on the OSS page, I understand what Aigon does within 5 seconds of landing (spec-driven multi-agent orchestration)
- [ ] As a visitor, the terminal demo and dashboard screenshots are the visual focal points, not decorative elements
- [ ] As a visitor on the Pro page, I see how Pro extends the OSS tool with metrics, coaching, benchmarks, and workflows — with the same visual language as the OSS page
- [ ] As a developer, the install command (`npm install -g @senlabsai/aigon@next`) is immediately copy-able
- [ ] As a visitor on mobile, the page reads well at 375px+ widths with no horizontal scroll

## Acceptance Criteria

### Design system

- [ ] **One font family only**: DM Sans (400, 500, 700) + DM Mono (400, 500) — remove Sora, Manrope, IBM Plex Mono
- [ ] **One accent color**: a muted red (#c23a22 or similar — NOT orange, teal, purple, or blue). Used for CTAs and interactive highlights only
- [ ] **White background** (#fff) — no radial gradients, no diagonal line pattern overlay, no warm cream
- [ ] **Border hierarchy for depth** (Supabase-style: 3 tiers of border opacity) — no box-shadows, no gradients on cards
- [ ] **No decorative elements**: no SVG lifecycle diagram, no animated terminal web component (unless it adds genuine value), no analogy carousel
- [ ] CSS custom properties in `:root` reduced to: `--bg`, `--bg-subtle`, `--text`, `--text-muted`, `--accent`, `--border-1`, `--border-2`, `--border-3`, `--mono`, `--sans`

### OSS landing page (`site/public/home.html` + `style.css`)

- [ ] **Header**: sticky, white bg with blur, logo in mono uppercase, text-only nav links (Docs, Workflow, Dashboard), single ghost-style GitHub link
- [ ] **Hero section**: large headline (clamp 2.2rem–3.6rem), muted subtitle, monospace install command in a bordered box with copy affordance, "Open source · MIT · Bring your own subscriptions" meta line
- [ ] **Terminal demo**: real CLI commands (create, start fleet, eval, close) in a dark terminal block — clean, no decorated frame with fake window chrome beyond a simple border-radius. Content matches the existing demo flow
- [ ] **Execution modes**: tabbed interface (Drive / Fleet / Autopilot / Swarm) with description + command on each tab — replaces the current 4-card grid
- [ ] **Dashboard section**: keep the existing tab-switching screenshot gallery (Pipeline, Monitor, Reports, Logs, All Items) but restyle to match Swiss Light — no shadows, border-based panels
- [ ] **Fleet showcase GIFs**: keep the 3-step GIF walkthrough but restyle frames to match (remove any gradient-based frames)
- [ ] **Reports/charts section**: keep the charts screenshot and 3 feature descriptions, restyle
- [ ] **Why section**: 3 value props in a bordered grid (not rounded shadow cards) — "Different models catch different bugs", "Your subscriptions, zero markup", "Local data, simple tools"
- [ ] **Get started section**: install command + doc links grid, restyed
- [ ] **Pro CTA section**: restyed to match Swiss Light, keep existing content pointing to /pro
- [ ] **Mobile phone screenshots**: keep the remote-access/mobile section with phone screenshots
- [ ] **Footer**: minimal, mono-styled
- [ ] All existing JavaScript functionality preserved: copy-to-clipboard on install CTA, dashboard tab switching, step walkthrough tabs/mode switching, hero terminal cycling, fleet GIF lightbox, lazy GIF loading, scroll reveal, nav active state tracking
- [ ] YouTube video embed preserved in hero section
- [ ] All `<template>` blocks for terminal demos preserved (content unchanged, just restyled presentation)

### Pro landing page (`site/app/pro/page.tsx`)

- [ ] Adopt the same Swiss Light design tokens — must look like the same site as the OSS page
- [ ] Replace Tailwind classes referencing `aigon-orange`, `aigon-teal`, gradient backgrounds, and Sora font with Swiss Light equivalents
- [ ] Preview banner: restyle with the new accent color
- [ ] Section eyebrows: use mono-styled labels (currently uses `aigon-teal` and `aigon-orange` alternating — switch to single muted color)
- [ ] FeatureCard component: bordered grid cells (matching OSS why-grid pattern) instead of rounded shadow cards
- [ ] ScreenshotFrame component: simple border, no shadow, no dark-mode gradient
- [ ] Badge component: border-based, not gradient-based
- [ ] "Coming Soon" CTA section: bordered panel, no decorative gradient glow
- [ ] Keep all existing Pro content sections: Agent Quality Metrics, Trend Charts, Cost Visibility, AI Insights, Reusable Workflows, Scheduled Features, Agent Benchmarks, Aigon Sync, Integrations
- [ ] Keep all existing screenshot references (they may or may not exist as files — the ScreenshotFrame component already handles missing images with a placeholder)

### Performance & compatibility

- [ ] Page weight: fewer web fonts loaded (2 families instead of 3), no external terminal animation library if not needed
- [ ] Lighthouse performance score >= 90 on mobile
- [ ] No horizontal scroll at 375px viewport width
- [ ] All existing accessibility features preserved: skip-link, ARIA labels, keyboard navigation, tabindex, role attributes

## Validation

```bash
# Visual check — open in browser and compare against sketch-a-swiss-light.html
# Check mobile responsiveness at 375px
# Verify all interactive elements work (tabs, copy, lightbox, etc.)
```

## Technical Approach

### Files to modify

1. **`site/public/css/style.css`** — complete rewrite of the design system. Strip all current CSS variables and replace with Swiss Light tokens. Remove all gradient backgrounds, radial gradients, decorative patterns, pill-button styles. Rebuild every component with border-based depth.

2. **`site/public/home.html`** — restructure sections to match Swiss Light layout. The HTML content (terminal demos, screenshots, template blocks, JavaScript) is largely preserved; the structural changes are:
   - Hero: simplify markup, remove analogy carousel if present
   - Why section: bordered grid instead of card layout
   - Modes: tabs instead of 4-card grid (existing step-walkthrough tabs can be repurposed)
   - Remove decorative SVG lifecycle diagram (replace with simpler text or keep if it can be restyled cleanly)
   - Keep all `<template>` elements, all `<script>` blocks, all image references

3. **`site/app/pro/page.tsx`** — update component styles to use Swiss Light tokens. The page uses Tailwind classes, so this means replacing color classes (`text-aigon-orange`, `bg-aigon-orange/10`, `border-aigon-orange/30`, `text-aigon-teal`, etc.) and font classes (`font-[family-name:var(--font-sora)]`) with Swiss Light equivalents. The FeatureCard, ScreenshotFrame, and Badge components are defined inline in this file and should be restyled.

4. **`site/tailwind.config.ts` or equivalent** — update/add Swiss Light color tokens so the Pro page Tailwind classes resolve correctly. Ensure `aigon-orange` references are replaced or remapped.

5. **Font loading** — update the Google Fonts `<link>` in `home.html` to load DM Sans + DM Mono only. Update any font declarations in the Next.js app layout for the Pro page.

### Design reference

The approved sketch is at `tmp/sketch-a-swiss-light.html` — a self-contained HTML file showing the hero, terminal demo, tabbed modes, and value-prop grid. Use this as the visual reference, not a template to copy verbatim. The real page has significantly more content (dashboard screenshots, fleet GIFs, mobile screenshots, Pro CTA, etc.) that must be adapted to this design language.

### Key design decisions

- **Accent color**: #c23a22 (muted red) — not warm orange (#d55f2a), not teal (#0f7775). This was specifically chosen to avoid the AI-page cliché palette.
- **Light background, NOT warm**: #ffffff, not #f7f2e8. Cool, not cozy.
- **Border depth, not shadows**: Three-tier border system (--border-1: #e8e8e8, --border-2: #d0d0d0, --border-3: #999) replaces all box-shadow usage.
- **Monospace for system elements**: DM Mono for code, commands, labels, eyebrows. DM Sans for everything else.
- **Copy tone**: direct, confident, not generically positive. "One spec, many agents, the best diff wins" rather than "More models lead to better quality."

### What to preserve (do not remove)

- All terminal demo content and `<template>` blocks
- All JavaScript: clipboard, tab switching, terminal cycling, lightbox, lazy loading, scroll observers
- YouTube embed
- Dashboard screenshot gallery with tab switching
- Fleet showcase GIF walkthrough (3 steps)
- Mobile phone screenshots section
- All image references (`img/aigon-dashboard-*.png`, `img/aigon-dashboard-*.gif`, etc.)
- `animated-terminal.min.js` script if terminal demos depend on it
- Vercel analytics snippet
- All meta tags, OG tags, canonical URL

## Dependencies

- None — this is a visual redesign with no backend or CLI changes

## Out of Scope

- Content rewrites beyond copy tone adjustments (the sections, features listed, and product descriptions stay the same)
- New screenshots or images (use existing assets)
- New pages or routes
- Dark mode / theme toggle
- Changes to the docs site (Nextra/MDX pages under `/docs`)
- Changes to the dashboard itself (`templates/dashboard/index.html`)
- SEO changes beyond preserving existing meta tags
- New JavaScript functionality

## Open Questions

- Should the `animated-terminal` web component library be kept, or should terminal demos be static code blocks? The current animated terminals add visual interest but also add a JS dependency. Decision: keep for now, restyle the frame.
- The SVG lifecycle diagram (Research → Features → Build → Evaluate → Ship → Feedback loop) — keep and restyle, or remove and replace with text? Decision: implementer's call based on whether it can be made to fit the Swiss Light aesthetic without looking decorative.

## Related

- Reference: `tmp/landing-page-inspiration.html` — final 6 inspiration sites with analysis
- Reference: `tmp/sketch-a-swiss-light.html` — approved hero sketch
- Reference: `tmp/sketch-b-editorial-mono.html` — rejected alternative (Editorial Mono)
- Reference: `tmp/sketch-c-inverted-theater.html` — rejected alternative (Inverted Theater)
