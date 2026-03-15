# Feature: aigon-icon

## Summary
Design an icon/logo for Aigon to use on the public website and dashboard. The icon should visually allude to the project's name origin: **AI + agon** (Greek: "contest", "competition", "arena") — reflecting the core concept of AI agents competing and collaborating in an arena setting (research arenas, feature bakeoffs, competitive implementations).

## User Stories
- [ ] As a visitor to the Aigon website, I can immediately identify the brand through a distinctive icon
- [ ] As a dashboard user, I see the Aigon icon in the header, giving the tool a polished, professional feel
- [ ] As a developer browsing GitHub, I recognise the Aigon icon in the README and repo social preview

## Acceptance Criteria
- [ ] Icon works at multiple sizes: favicon (16x16, 32x32), dashboard header (~24px), website hero (~64-128px), social preview (1280x640)
- [ ] Icon is legible and recognisable at small sizes (favicon)
- [ ] Works on both dark and light backgrounds (or has variants)
- [ ] Available as SVG (scalable) and PNG (raster fallbacks)
- [ ] Visually alludes to the "agon" (arena/contest) concept — not just generic "AI" imagery
- [ ] Fits the existing dashboard aesthetic (dark theme, `--accent: #3b82f6` blue, clean/modern)
- [ ] Icon integrated into dashboard header (`<h1>` in `templates/dashboard/index.html`)
- [ ] Favicon added to dashboard HTML

## Validation
```bash
# Verify icon files exist
test -f assets/icon/aigon-icon.svg
test -f assets/icon/aigon-icon-32.png
test -f assets/icon/favicon.ico
```

## Technical Approach

### Design Direction
The icon should blend two concepts:

1. **Arena / Contest (agon)**: Visual metaphors could include:
   - A colosseum/amphitheatre shape (simplified, geometric)
   - Converging arrows or agents facing off
   - A circular arena with multiple entry points (representing multiple agents)
   - Laurel wreath (victory in competition)
   - Shield or crest shape (competition emblem)

2. **AI / Technology**: Subtle nods like:
   - Circuit-like lines or nodes
   - Geometric precision
   - Neural network dot pattern

### Suggested Approaches
- **Option A**: Stylised "A" lettermark formed by converging arrows (agents entering the arena)
- **Option B**: Circular arena shape with nodes at cardinal points (representing competing agents), connected by lines
- **Option C**: Minimalist colosseum arch silhouette with a circuit/node motif inside

### Format & Integration
- Design as SVG for scalability
- Export PNGs at required sizes
- Add to `assets/icon/` directory
- Update dashboard HTML to include icon in header and as favicon
- Consider adding to `package.json` as repository icon

## Dependencies
- Feature: aigon-website (paused) — icon will be used there when website is built
- Dashboard template: `templates/dashboard/index.html`

## Out of Scope
- Full brand guidelines / style guide
- Animated logo variants
- Marketing materials beyond icon placement
- Website redesign

## Open Questions
- Should we commission a professional designer or create an SVG programmatically?
- Do we want a wordmark (icon + "Aigon" text) in addition to the standalone icon?
- Should the icon include colour or be monochrome with colour variants?
- Preferred design direction from the options above (A/B/C or something else)?

## Related
- Research: Name origin — "Aigon" = AI + agon (Greek: contest/competition/arena)
- Feature: [aigon-website](../05-paused/feature-aigon-website.md) (paused)
- Dashboard: `templates/dashboard/index.html`
