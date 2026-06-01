# Evaluation: Feature 541 - landing-page-redesign-swiss-light

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-541-landing-page-redesign-swiss-light.md`

The spec asks for a full Swiss Light redesign of the OSS landing page, conversion of the Pro page from Next.js/React to static HTML, shared `style.css`, one-font/one-accent/border-only visual language, preservation of existing landing-page JavaScript, and a `/pro` path that serves the new static Pro page without needing the old server-side screenshot checks.

## Implementations to Compare

- **cc** (Claude): `/Users/jviner/.aigon/worktrees/aigon/feature-541-cc-landing-page-redesign-swiss-light`
- **cu** (Cursor): `/Users/jviner/.aigon/worktrees/aigon/feature-541-cu-landing-page-redesign-swiss-light`
- **cx** (Codex): `/Users/jviner/.aigon/worktrees/aigon/feature-541-cx-landing-page-redesign-swiss-light`

## Evaluation Criteria

| Criteria | cc | cu | cx |
|---|---|---|---|
| Code Quality | 7/10 | 9/10 | 7/10 |
| Spec Compliance | 6/10 | 9/10 | 7/10 |
| Performance | 8/10 | 8/10 | 9/10 |
| Maintainability | 6/10 | 8/10 | 7/10 |
| **Total** | **27/40** | **34/40** | **30/40** |

## Summary

| Agent | Lines | Score |
|---|---|---|
| cc | 1418/+, 2071/- | 27/40 |
| cu | 2687/+, 2530/- | 34/40 |
| cx | 981/+, 2977/- | 30/40 |

Validation attempted: `git diff --check main..HEAD` passed for all three implementations, and both `home.html` and `pro.html` parsed with Python's `html.parser` in each worktree. `npm --prefix site run build` could not run in any worktree because dependencies are not installed (`next: command not found`).

Cross-cutting issue: all three implementation diffs delete `docs/specs/features/01-inbox/feature-amp-transcript-telemetry.md`, which is unrelated to this visual redesign and should be restored before merging the chosen implementation.

### Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - Produces a coherent shared Swiss Light stylesheet with the requested DM Sans/DM Mono tokens, muted red accent, white background, and no CSS `box-shadow`/gradient matches in the rewritten stylesheet.
  - Preserves the large existing OSS page surface: YouTube embed, terminal templates, dashboard tab gallery, walkthrough tabs, GIF lightbox, lazy GIF loading, copy affordance, mobile screenshot section, reports, get-started, and Pro CTA.
  - Adds a comprehensive static `site/public/pro.html` with all major Pro content sections and CSS-based missing-image placeholders.
- Weaknesses:
  - Does not actually remove or redirect the Next.js Pro route: `site/app/pro/page.tsx` remains the old React/Tailwind page with `fs.existsSync()`, orange/teal classes, gradient/shadow styling, and server-side screenshot detection. This misses a central acceptance criterion and means `/pro` still resolves to the old page in Next routing.
  - Leaves the old decorative lifecycle SVG in `home.html`, including teal/blue/orange colors and inline `IBM Plex Mono`/`Manrope` font-family attributes, directly violating the one-accent/one-font/no-decorative-elements direction.
  - Implementation log is skeletal, with no meaningful decisions, known issues, or validation notes.
  - Includes the unrelated deletion of `feature-amp-transcript-telemetry.md`.

#### cu (Cursor)
- Strengths:
  - Best spec compliance: deletes the old Next.js Pro route, adds `site/public/pro.html`, and adds a `/pro` rewrite to `/pro.html`, so the Pro page is genuinely static and no longer depends on `fs.existsSync()`.
  - Cleanly removes the decorative lifecycle diagram and replaces the old 4-card execution-mode section with a real accessible tabbed interface (`exec-mode-*`) including role/aria state and dedicated JavaScript.
  - Preserves all required OSS page behavior and content: templates, animated terminal dependency, copy-to-clipboard, dashboard gallery tabs, step walkthrough, hero terminal cycling, GIF lightbox/lazy loading, reveal observers, nav tracking, YouTube embed, fleet GIFs, reports, mobile screenshots, and Pro CTA.
  - Pro page conversion is thorough and readable: all required Pro sections are retained, screenshot placeholders are handled client-side with `onerror`, and the page shares the same Swiss Light stylesheet and navigation system.
  - Strong implementation log documents key choices, deferrals, and manual validation scope.
- Weaknesses:
  - Largest diff and CSS surface area, which raises review cost compared with the more compact CX implementation.
  - Lighthouse/mobile performance was not actually measured, and the retained animated-terminal dependency means the performance acceptance criterion is only partially demonstrated.
  - Includes the unrelated deletion of `feature-amp-transcript-telemetry.md`.

#### cx (Codex)
- Strengths:
  - Most compact implementation and aggressively removes decorative CSS, old gradients, and most of the prior visual system; CSS token set is close to the requested Swiss Light source of truth.
  - Keeps the existing OSS JavaScript functionality, templates, screenshots, YouTube embed, dashboard gallery, step walkthrough, GIF lightbox/lazy loading, and copy affordance.
  - Converts the Pro content to static HTML and leaves a minimal Next.js redirect from `/pro` to `/pro.html`, avoiding the old `fs.existsSync()` screenshot checks while keeping `/pro` working in Next.
  - Passed `git diff --check` and static HTML parser checks with the smallest changed-line count among the three.
- Weaknesses:
  - Execution modes are presented as one static panel with tab-looking buttons rather than a real tabbed interface with per-mode description + command; the tab buttons do not drive distinct panels, so this falls short of the acceptance criterion.
  - Pro page is much more compressed than CU's and trims some explanatory copy/details from Pro sections, despite the spec saying to preserve existing content sections and avoid broad content rewrites.
  - Uses `home.html`/`pro.html` relative links in several places and canonicalizes Pro to `/pro.html`, whereas the product route is still `/pro`; this is less polished than CU's rewrite.
  - Implementation log is empty aside from headings, making review and handoff weaker.
  - Includes the unrelated deletion of `feature-amp-transcript-telemetry.md`.


## Recommendation

**Winner:** cu (Cursor) — strongest implementation of the actual spec, especially the static Pro conversion and `/pro` routing behavior, while preserving the existing interactive landing-page surface.

**Rationale:** CU is the only implementation that both removes the old server-side Pro route and serves the static Pro page at `/pro`, while also replacing the execution-mode cards with a real tabbed interface and preserving the existing page functionality. CX is leaner and could be easier to audit, but it under-delivers on the execution-mode tabs and Pro content preservation; CC has a good-looking static page but leaves the old `/pro` React route in place, which misses a core requirement.

Before merging, consider adopting from `cx`: the minimal `site/app/pro/page.tsx` redirect is a useful fallback if you prefer an explicit Next route instead of relying only on `next.config.mjs` rewrites. Otherwise, CU already has the strongest complete implementation; the main pre-merge cleanup is to restore the unrelated deleted inbox spec file.
