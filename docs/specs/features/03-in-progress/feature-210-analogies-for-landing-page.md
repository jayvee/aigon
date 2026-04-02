# Feature: analogies-for-landing-page

## Summary
Add a rotating analogy carousel to the landing page hero section that cycles through three "Aigon is like X + Y" comparisons (Trello + GitHub Copilot, Trello + Cursor, Trello + Claude Code). Each analogy has a headline and byline. The carousel auto-advances and tracks which analogy is visible via analytics events, enabling the user to measure which framing resonates most with visitors.

## User Stories
- [ ] As a visitor, I see a clear analogy comparing Aigon to tools I already know, so I immediately grasp the value proposition
- [ ] As a visitor, I can manually navigate between analogies (dots/arrows) if I want to read at my own pace
- [ ] As the site owner, I can see analytics data showing which analogy visitors engage with most, so I can prioritise the best-performing framing

## Acceptance Criteria
- [ ] Three analogy slides render in the hero area of `/site/public/home.html`, each with headline + byline as specified below
- [ ] Carousel auto-advances every 6–8 seconds with a smooth crossfade or slide transition
- [ ] Manual navigation via indicator dots (and optionally prev/next arrows); clicking a dot pauses auto-advance temporarily
- [ ] Each slide impression fires a GA4 event (`analogy_impression`, with parameter `analogy_name`: `copilot` / `cursor` / `claude_code`) when the slide becomes visible
- [ ] Manual dot/arrow clicks fire a `analogy_click` event with `analogy_name` + `direction` (next/prev/dot)
- [ ] GA4 integration uses a `gtag.js` snippet in the `<head>` of `home.html` (Vercel Analytics covers React pages but not the static HTML landing page)
- [ ] Carousel is responsive and looks correct on mobile (stacked, swipeable)
- [ ] No external carousel library — matches existing vanilla JS patterns in `home.html`
- [ ] Playwright screenshot confirms visual correctness on desktop and mobile viewports

## Validation
```bash
# Syntax check the landing page HTML (no broken tags)
node -e "const fs=require('fs'); const h=fs.readFileSync('site/public/home.html','utf8'); if(!h.includes('analogy-carousel')) { process.exit(1); }"
```

## Technical Approach

### Placement
Insert the carousel **inside the existing hero section** (`#top`), between the `<p class="eyebrow">` and the current `<h1>`. The current static h1 and `hero-summary` paragraph get replaced by the carousel content. The existing hero bullet points (`hero-points`) remain below.

### HTML structure
```html
<div class="analogy-carousel" role="region" aria-label="Aigon explained" aria-roledescription="carousel">
  <div class="analogy-slides">
    <div class="analogy-slide is-active" data-analogy="copilot">
      <h1>Aigon—where Trello meets GitHub Copilot... but you choose your agents.</h1>
      <p class="hero-summary">You bring your own API keys and models, run multiple agents in parallel, and use LLMs to judge and refine each task—on your terms.</p>
    </div>
    <div class="analogy-slide" data-analogy="cursor">
      <h1>Aigon—where Trello meets Cursor... but you're in full control.</h1>
      <p class="hero-summary">You bring your own model subscriptions and run tasks through multiple agents in parallel, comparing and refining outcomes.</p>
    </div>
    <div class="analogy-slide" data-analogy="claude_code">
      <h1>Aigon—if Trello and Claude Code had a baby, but that baby comes with a whole family of agents:</h1>
      <p class="hero-summary">You can stick with Claude Code as the star sibling, or bring in more brothers, sisters, and cousins—Aigon coordinates them all, making your workflow a true family effort.</p>
    </div>
  </div>
  <div class="analogy-nav">
    <button class="analogy-dot is-active" data-index="0" aria-label="Analogy 1"></button>
    <button class="analogy-dot" data-index="1" aria-label="Analogy 2"></button>
    <button class="analogy-dot" data-index="2" aria-label="Analogy 3"></button>
  </div>
</div>
```

### CSS
Add to `/site/public/css/style.css`:
- `.analogy-carousel` — relative container
- `.analogy-slide` — absolute positioned, opacity transition (crossfade), `is-active` = visible
- `.analogy-nav` — centered dot row below the carousel, matching the existing `--accent` orange for active dot
- Mobile: slides stack naturally, touch swipe via `touchstart`/`touchend` listeners

### JavaScript
Add to the existing `<script>` block at the bottom of `home.html`:
- Auto-advance timer (7s interval), pauses on hover/interaction, resumes after 10s idle
- Dot click handler — switches slide, fires analytics event
- Touch swipe detection for mobile
- Impression tracking: fire `gtag('event', 'analogy_impression', { analogy_name })` on each transition

### Analytics (GA4)
- Add a `gtag.js` snippet to the `<head>` of `home.html` with a GA4 measurement ID (user to provide, or use a placeholder `G-XXXXXXXXXX`)
- Events:
  - `analogy_impression` — fired when a slide becomes visible (auto or manual), params: `{ analogy_name, trigger: 'auto'|'manual' }`
  - `analogy_click` — fired on dot/arrow interaction, params: `{ analogy_name, direction }`
- This is separate from Vercel Analytics (which covers the React docs pages but doesn't inject into the static `home.html`)

## Dependencies
- GA4 measurement ID — user needs to create a GA4 property and provide the `G-XXXXXXXXXX` ID (can use placeholder during implementation)

## Out of Scope
- A/B testing framework (randomising which analogy shows first) — simple sequential rotation for now; order analysis via GA events
- Changing the hero fleet showcase GIFs below the carousel
- Modifying any React/Nextra pages

## Open Questions
- ~~Should the carousel randomise the starting slide per visitor?~~ **Yes** — randomise the starting slide on each page load to eliminate position bias. Store the starting index in the `analogy_impression` event as `start_position` so we can control for it in analysis.
- ~~GA4 measurement ID?~~ **Not yet** — implement with placeholder `G-XXXXXXXXXX`. Add a comment in the gtag snippet so it's easy to find and replace once the property is created.

## Related
- Landing page: `site/public/home.html`
- Styles: `site/public/css/style.css`
- Existing carousel patterns: hero terminal demo (auto-cycling agents), dashboard tab gallery
