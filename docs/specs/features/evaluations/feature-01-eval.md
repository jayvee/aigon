# Evaluation: Feature 01 - aigon-website

**Mode:** Arena (Multi-agent comparison)
**Evaluator:** Claude Opus 4.6
**Date:** 2026-02-22

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-01-aigon-website.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-site-worktrees/feature-01-cc-aigon-website`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-site-worktrees/feature-01-cx-aigon-website`
- [x] **gg** (Gemini): `/Users/jviner/src/aigon-site-worktrees/feature-01-gg-aigon-website`

## Evaluation Criteria

| Criteria | cc | cx | gg |
|----------|---|---|---|
| Spec Compliance | 4.0 | 4.0 | 3.5 |
| Code Quality | 3.5 | 4.5 | 3.5 |
| Visual Design | 3.5 | 4.0 | 4.0 |
| Performance | 5.0 | 4.5 | 4.5 |
| Maintainability | 3.5 | 4.0 | 3.5 |
| **Overall** | **3.9** | **4.2** | **3.8** |

## Summary

### Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - All 9 spec sections fully covered with authentic CLI command examples
  - Lightest payload (~23KB, zero JS) -- best raw performance
  - Excellent reuse of existing design system (CSS classes, custom properties, theme support)
  - Theme-aware code blocks via `color-mix()` that work across all 5 color themes
  - Rotating hero SVG loop diagram adds motion without JS
- Weaknesses:
  - 7 inline `style` attributes scattered through HTML (maintainability concern)
  - SVG diagrams lack accessibility attributes (no `aria-label`, `role="img"`, `<title>`)
  - No `prefers-reduced-motion` media query for the rotating animation
  - Code blocks use `<div><code>` instead of `<pre><code>` with `<br>` workarounds
  - Flow diagram SVG text becomes unreadable on mobile (fixed coordinates)
  - Visual design is spartan compared to spec's reference site ambitions

#### cx (Codex)
- Strengths:
  - Best accessibility: skip-link, `nav aria-label`, SVG `role="img"` with `<title>`/`<desc>`, `prefers-reduced-motion` query
  - Strongest HTML semantics: proper `<article>`, `<aside>`, `<pre><code>`, `<ol>` usage
  - Fresh, cohesive visual design with Sora/Manrope/IBM Plex Mono font stack
  - Well-tokenized CSS custom property system with logical top-down organization
  - Progressive enhancement pattern (`.js` class, IntersectionObserver with fallback)
  - Thorough implementation log documenting decisions
- Weaknesses:
  - Dead CSS selectors from baseline (`.header-content`, `.principle`, `.hero-name`)
  - Some hardcoded colors bypass the token system (#cf6b40, #e8f0ff, #0a4f4d)
  - Documentation and Community sections thinner than spec envisions
  - Contributing guide link points to raw `README.md` (broken UX)
  - Loads 9 font weights across 3 families (heavier font payload)
  - No favicon

#### gg (Gemini)
- Strengths:
  - Strongest visual elements: polished CLI terminal demos with macOS-style chrome and staggered fade-in animations
  - Clean SVG flow diagram with animated dashed lines and hover glow effects
  - Excellent typography with clamp() fluid sizing throughout
  - Restrained color usage matching "sparse accent" directive
  - Good CSS organization with clear component comment headers
- Weaknesses:
  - Arena Mode (4th core feature) entirely missing from Solution section
  - How It Works truncated from 5 to 3 steps
  - Zero ARIA attributes anywhere in the HTML -- worst accessibility
  - Broken heading hierarchy (multiple `<h2>` inside single features `<section>`)
  - Meta description still says "Aigon - coming soon" (stale from baseline)
  - Duplicate `@media (min-width: 1440px)` blocks creating dead CSS
  - Community section is decorative only (no functional links)

## Recommendation

**Winner:** cx (Codex)

**Rationale:**

Codex delivers the strongest overall implementation across the evaluation criteria:

1. **Accessibility leadership** -- The only implementation with a skip-link, ARIA landmarks, SVG accessibility attributes, and `prefers-reduced-motion`. This alone is a significant differentiator since accessibility is a core quality concern.

2. **Code craftsmanship** -- Best HTML semantics (proper `<article>`, `<aside>`, `<pre><code>`, ordered lists for steps), progressive enhancement with JS feature detection, and the cleanest separation of concerns.

3. **Visual design** -- Fresh, cohesive design system with a purposeful font stack (Sora for authority, Manrope for readability, IBM Plex Mono for code). The warm cream palette with burnt orange/teal accents is distinctive and professional.

4. **Maintainability** -- Fully tokenized CSS custom properties, logical top-down stylesheet organization, and a thorough implementation log. The dead CSS selectors are a minor cleanup task.

5. **Spec compliance** -- Covers all 9 sections with all 4 core features (including Arena Mode, which Gemini missed entirely). Documentation and Community are thinner than spec, but this is a shared gap across all implementations.

The main tradeoff vs. Claude's implementation: Codex creates a fresh design system rather than building on the existing one, and introduces 3 new Google Font families. However, the resulting design quality and code quality justify this approach. The dead CSS from the baseline should be cleaned up before merge.
