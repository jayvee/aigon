---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-30T00:33:32.231Z", actor: "cli/feature-prioritise" }
---

# Feature: slim landing hero

## Summary
Refactor the public landing page hero so it becomes a concise above-the-fold introduction with clear calls to action, while preserving the strongest current payoff copy in a dedicated section immediately below the hero. This is a static-site refactor of `site/public/home.html` and `site/public/css/style.css`: no new assets, no new design system tokens, and no broad redesign beyond relocating existing content, tightening copy, restoring CTAs, and merging the two documentation sections into one get-started section.

Source brief: `tmp/feature-landing-hero-slim.md`.
Design rationale reference: `Landing Page Review v2.html` at repo root, if present.

## User Stories
- [ ] As a first-time visitor, I can understand Aigon's core value from one focused H1, one subtitle, and one visual block without reading a long hero essay.
- [ ] As a visitor ready to try Aigon, I can copy the install command or star the GitHub repo directly from the hero.
- [ ] As a visitor evaluating whether Aigon is worth using, I see the four "Why Use Aigon" payoff cards as a first-class section directly after the hero.
- [ ] As a docs-oriented visitor, I find install guidance and all documentation entry points in one unified get-started section instead of two separate docs blocks.

## Acceptance Criteria
- [ ] The hero contains exactly these content groups, in this order unless layout requires a minor visual adjustment: eyebrow/kicker, one `<h1>`, one subtitle paragraph, agent chip/fact row, CTA row, and the Fleet three-step visual block.
- [ ] The page still has exactly one `<h1>` element.
- [ ] The hero H1 text is exactly: `A spec-driven harness that orchestrates Claude Code, Codex, and Gemini CLI -- in parallel, on real branches, in real worktrees.`
- [ ] The hero subtitle text is exactly: `Write a spec once. Launch competing implementations. Let one agent judge another. Merge the diff that survives review.`
- [ ] The existing two-line `hero-wedge` headline is removed from the hero and no `.hero-wedge*` markup remains in `site/public/home.html`.
- [ ] The FONUT joke is preserved by appending this sentence to the body of the `Stop hitting quota walls.` payoff card: `Schedule specs to run when you have quota or while you sleep -- no more FONUT (Fear Of Not Using Tokens).`
- [ ] The four current `hero-payoff` cards are moved out of the hero into a new `<section id="why" class="section reveal">` immediately after the closing hero section.
- [ ] The new `#why` section uses eyebrow text `Why a multi-agent harness` and H2 text `Four reasons one agent isn't enough.`
- [ ] The payoff card headings and body copy remain unchanged except for the FONUT sentence added to `Stop hitting quota walls.`
- [ ] The hero visual is only the existing Fleet three-step triptych (`.hero-fleet-showcase` and its three `.fleet-demo-frame` GIF triggers).
- [ ] The Kanban screenshot figure (`.hero-preview`) is removed from the hero and the Kanban screenshot remains available as the lead image in `#dashboard`.
- [ ] The hero includes two CTA buttons below the subtitle and before/near the fact row: primary install CTA and ghost GitHub CTA.
- [ ] The primary CTA displays `$ npx aigon install`, links to `#get-started` as a no-JS fallback, copies `npx aigon install` to the clipboard on click, and exposes a small copied affordance without breaking keyboard use.
- [ ] The GitHub CTA displays `Star on GitHub` with a leading star character if the existing visual language can support it, and links to `https://github.com/jayvee/aigon` using safe external-link attributes.
- [ ] A future CTA marker is left near the hero CTA markup: `<!-- TODO: add aigon init CTA -->`.
- [ ] Sections `#docs` and `#explore-docs` are merged into one `<section id="get-started">` with eyebrow `Get started` and H2 `Install in one command. Read what you need.`
- [ ] The install snippet remains at the top of `#get-started`, followed by all six docs tiles in a single grid.
- [ ] The obsolete `#explore-docs` section is removed.
- [ ] Header navigation updates any `#docs` landing-page anchor to `#get-started`. Do not add `#why` to the primary nav unless the final page feels hard to scan; recommended default is to leave `#why` out because it immediately follows the hero.
- [ ] Active nav highlighting and scroll behavior still work after the section ID changes.
- [ ] Meta description and Open Graph/Twitter descriptions are updated if they still reflect the old wedge-heavy or Kanban-heavy positioning.
- [ ] The Fleet lightbox still opens for each of the three Fleet GIF frames after `.hero-preview` is removed from the trigger selector.
- [ ] Lighthouse accessibility score does not regress from the current page when tested locally, or any regression is explained and fixed before submission.
- [ ] Mobile layout at the existing breakpoints has no empty containers, overlapping CTA buttons, clipped hero copy, or orphaned hero-card styles.
- [ ] No new fonts, colors, images, libraries, or external scripts are introduced. Reuse existing `:root` tokens and existing classes where appropriate.

## Validation
Run the normal project checks plus the feature-specific static assertions below.

```bash
node -c aigon-cli.js
npm test
node - <<'NODE'
const fs = require('fs');
const assert = require('assert');
const html = fs.readFileSync('site/public/home.html', 'utf8');
const css = fs.readFileSync('site/public/css/style.css', 'utf8');

const h1Count = (html.match(/<h1\b/g) || []).length;
assert.strictEqual(h1Count, 1, 'landing page must have exactly one h1');
assert(html.includes('A spec-driven harness that orchestrates Claude Code, Codex, and Gemini CLI'), 'new hero h1 missing');
assert(html.includes('Write a spec once. Launch competing implementations.'), 'new hero subtitle missing');
assert(!html.includes('class="hero-wedge"'), 'old hero wedge markup remains');
assert(html.includes('id="why"'), '#why section missing');
assert(html.includes('Why a multi-agent harness'), '#why eyebrow missing');
assert(html.includes("Four reasons one agent isn't enough."), '#why h2 missing');
assert(html.includes('FONUT (Fear Of Not Using Tokens)'), 'FONUT sentence missing');
assert(html.includes('id="get-started"'), '#get-started section missing');
assert(!html.includes('id="explore-docs"'), '#explore-docs should be removed');
assert(!html.includes('href="#docs"'), 'old #docs landing anchor remains');
assert(html.includes('npx aigon install'), 'install CTA/snippet missing');
assert(html.includes('TODO: add aigon init CTA'), 'future init CTA marker missing');
assert(html.includes('querySelectorAll(".fleet-demo-frame")') || html.includes("querySelectorAll('.fleet-demo-frame')"), 'lightbox trigger selector should no longer include .hero-preview');
assert(!/querySelectorAll\([^)]*hero-preview/.test(html), 'lightbox selector still targets removed hero preview');
assert(css.includes('.hero-actions'), 'hero CTA styles missing');
NODE
```

Manual browser smoke test:
- [ ] Load the landing page locally.
- [ ] Click the `$ npx aigon install` CTA and verify the command is copied and a visible copied state appears.
- [ ] Click the GitHub CTA and verify it opens the GitHub repo.
- [ ] Open each of the three Fleet GIF frames and close the lightbox.
- [ ] Tab through the hero from the skip link through both CTAs and Fleet frames.
- [ ] Scroll top to bottom and verify section spacing, nav highlighting, and mobile layout.

## Pre-authorised
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May edit only `site/public/home.html` and `site/public/css/style.css` unless a validation command reveals a directly related static-site issue.
- May add a small vanilla-JS clipboard handler inside `site/public/home.html`; do not add dependencies.
- May adjust existing landing-page CSS selectors and responsive rules to support the content move, but must not introduce new global design tokens, fonts, images, or external scripts.

## Technical Approach
1. Inspect the current landing page structure in `site/public/home.html` before editing. The current relevant elements are `#top`, `.hero-kicker`, `.hero-subtitle`, `.hero-wedge`, `.hero-facts`, `.hero-why`, `.hero-payoff`, `.hero-preview`, `.hero-fleet-showcase`, `#docs`, and `#explore-docs`.
2. Replace the current hero copy with the brief's focused H1 and subtitle. Prefer keeping the existing `hero-kicker`, `hero-subtitle`, `hero-facts`, and `hero-actions` style concepts rather than inventing a new visual system.
3. Move the four payoff cards from `.hero-why` into a new top-level `#why` section immediately after the hero. Rename wrapper classes only if useful for clarity; if classes stay `hero-payoff`, ensure the CSS is no longer scoped in a way that only works inside `.hero`.
4. Remove the hero Kanban figure (`.hero-preview`) from the hero, but do not remove the dashboard Kanban image in `#dashboard` or the dashboard image switcher data.
5. Add the hero CTA row as normal anchors for accessibility. The install CTA should remain a real `href="#get-started"` link so no-JS users have a useful fallback. With JS enabled, prevent default only after the click is intentionally handled and copy succeeds or fails gracefully.
6. Implement the copied affordance with an accessible state update. Acceptable patterns include changing a short nested status label, toggling a `data-copied` attribute plus visible text, or using an `aria-live="polite"` status near the CTA. Do not rely only on color.
7. Merge `#docs` and `#explore-docs` into `#get-started`. Keep the install command/snippet first, then render six docs tiles in one grid. Remove duplicate links if the two sections currently contain duplicates with the same destination and copy; otherwise preserve all six intended entry points from the brief.
8. Update header nav and any scrollspy/active-link logic that assumes the old `#docs` section. The external `/docs` link can remain if it intentionally points to the docs site, but any landing-page anchor to the install/docs section must target `#get-started`.
9. Update the Fleet lightbox selector at the bottom of `home.html` so it binds only to `.fleet-demo-frame` after `.hero-preview` is deleted.
10. Clean up CSS after the markup move. Remove or neutralize dead `.hero-wedge*` and `figure.hero-preview` rules if no longer used. Preserve existing breakpoints and visual tokens.

## Dependencies
None.

## Implementation Notes
- The source brief recommends not adding `#why` to the primary nav. Follow that unless the final page creates a discoverability problem.
- The existing `#why-aigon` section is a different section about where work lives. Do not accidentally overwrite it. The new payoff-card section should use `id="why"`, and the existing `#why-aigon` section can remain unless renamed only to avoid reader confusion.
- The page currently has a `/docs` nav link rather than a `#docs` nav link in the visible header. Still search for all `#docs` references because the old section ID may be used elsewhere.
- Keep the copy change ASCII-safe in source where possible: use `--` in text source if the surrounding file does not already use the relevant entity; HTML can render typographic punctuation through existing conventions if preferred.

## Out of Scope
- Adding `npx aigon init` as a second primary CTA. Only leave the requested TODO marker.
- Replacing mode emojis or doing broader visual polish.
- Redesigning `#workflow`, `#dashboard`, `#community`, or the Pro strip beyond required nav-anchor and section-flow updates.
- Adding mobile-specific redesigns beyond preserving the existing breakpoints and fixing regressions caused by this refactor.
- Adding new fonts, colors, images, build tooling, or dependencies.
- Changing Aigon workflow, dashboard server, CLI, or docs-generation logic.

## Open Questions
- Should the visible header keep `/docs` as the Docs destination, or should it become `#get-started` to prioritize the landing-page install section? Default to preserving `/docs` unless there is already a same-page `#docs` link or product direction says the landing nav should scroll to install.
- Should the new `#why` section reuse `hero-payoff` class names or get neutral names like `payoff-card`? Default to the smallest clean diff: keep existing card classes if the CSS can be safely moved out of hero-only scope.

## Related
- Design brief: `tmp/feature-landing-hero-slim.md`
- Reference mock/rationale: `Landing Page Review v2.html`
