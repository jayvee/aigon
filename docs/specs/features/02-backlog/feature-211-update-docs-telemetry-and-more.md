# Feature: update-docs-telemetry-and-more

## Summary

The docs site and landing page are missing coverage of several recently shipped features: cross-agent telemetry (CC, GG, CX parsers), the activity breakdown field (implement/evaluate/review), token usage charts by activity/agent/model, the Amplification dashboard (Pro tier analytics), and reliability/merge-gate improvements. This feature audits every gap and writes all missing guides and reference pages. It also establishes a graceful screenshot pattern so the docs go live immediately and screenshots can be dropped in later without any code changes.

**Two-phase delivery:** Phase 1 (content + scaffold) ships to production; Phase 2 (screenshots) is filled in over time by running the Playwright script and copying crops into `site/public/img/`.

## User Stories

- [ ] As a new user evaluating Aigon, I can see on the landing page that it tracks token usage and cost across agents so I understand the observability story before reading the docs.
- [ ] As a developer running Fleet mode, I can read a "Telemetry & Analytics" guide that explains what data is collected, how to read the Reports tab, and how to interpret the activity breakdown (implement vs. evaluate vs. review).
- [ ] As a Pro subscriber, I can find a dedicated guide to the Amplification dashboard that explains quality metrics, trend charts, and AI coaching insights — without digging through the generic dashboard guide.
- [ ] As a team lead, I can find a concepts page on reliability that covers merge gates, worktree isolation, and audit logs.
- [ ] As a reader of a docs page where a screenshot hasn't been taken yet, I see a clearly-labelled placeholder (not a broken image) that tells me what the screenshot will show.
- [ ] As the author, once I've cropped a screenshot and placed it in `site/public/img/`, the placeholder automatically disappears with no code change required.

## Acceptance Criteria

### Phase 1: Content (ships immediately, no images needed)

**New documentation pages**
- [ ] `site/content/guides/telemetry.mdx` — "Telemetry & Analytics" guide: what is collected, activity field values (implement/evaluate/review), per-agent cost attribution, how to read the Reports tab, free-tier vs. Pro boundaries
- [ ] `site/content/guides/amplification.mdx` — "Amplification Dashboard" guide (Pro): quality metrics leaderboard (first-pass rate, commits/feature, rework ratio), trend charts, AI insights & coaching, cost optimization view
- [ ] `site/content/concepts/reliability.mdx` — "Reliability & Safety" concepts page: worktree isolation, merge gate scanning (gitleaks + semgrep), severity thresholds, audit logs, recovery from failed evaluations
- [ ] All new pages wired into Nextra `_meta` navigation so they appear in the sidebar

**Updated existing pages**
- [ ] `site/content/guides/dashboard.mdx` — Pro section links to Amplification guide; activity breakdown explained
- [ ] `site/content/getting-started.mdx` — mentions Reports tab so users know it exists from day one
- [ ] `site/public/home.html` (landing page) — one additional bullet in the dashboard capabilities list: "cost & token visibility across all agents" with a link to the Telemetry guide

**Screenshot component**
- [ ] `site/components/Screenshot.tsx` — server component that:
  - Accepts `src`, `alt`, and optional `caption` props
  - At build time, checks whether `public/${src}` exists using `fs.existsSync`
  - If the file **exists**: renders a standard `<figure>` with `<img>` and optional `<figcaption>`
  - If the file **does not exist**: renders a styled placeholder `<div>` (dashed border, neutral background) containing the `alt` text and a small label "Screenshot coming soon" — no broken image icon, no build error
- [ ] All screenshot slots in new and updated MDX pages use `<Screenshot>` instead of bare `<img>` or `next/image`
- [ ] Site builds cleanly (`npm run build`) with zero images present in `site/public/img/` for the new slots

**Stale reference cleanup**
- [ ] Audit all MDX pages for references to `aigon-radar-dashboard.png` — update or remove any found

### Phase 2: Screenshots (filled in over time, no code changes needed)

Each item below is a screenshot target. Once the image is cropped and placed at the listed path, the `<Screenshot>` component automatically shows it. No MDX edit required.

**Existing screenshots to retake**
- [ ] `site/public/img/aigon-dashboard-reports.png` — current Reports tab (verify tab label and layout)
- [ ] `site/public/img/aigon-dashboard-reports-summary.png` — current Summary sub-tab with up-to-date metric cards
- [ ] `site/public/img/aigon-dashboard-reports-charts.png` — current Charts sub-tab (5 synchronized charts including Tokens Used)

**New screenshots**
- [ ] `site/public/img/aigon-dashboard-reports-activity.png` — Charts tab, Token Activity time-series chart (feature 209), activity-type colour coding visible
- [ ] `site/public/img/aigon-dashboard-reports-agent-breakdown.png` — Charts tab, per-agent cost attribution view
- [ ] `site/public/img/aigon-amplification-metrics.png` — Amplification quality metrics leaderboard
- [ ] `site/public/img/aigon-amplification-charts.png` — Amplification trend charts (cycle time, rework, cost-per-feature)
- [ ] `site/public/img/aigon-amplification-insights.png` — Amplification AI insights / coaching card

**Playwright capture script**
- [ ] `site/scripts/take-screenshots.js` — headless Playwright script that:
  1. Navigates to each target URL/tab at `http://localhost:4100`
  2. Waits for the relevant chart/panel to be visible
  3. Saves full-viewport screenshots to `site/public/img/raw/` (staging area — not the final path)
  4. Prints a checklist: captured files + manual steps (crop, polish, move to `site/public/img/`)
  5. Exits 0 if dashboard is reachable; exits 1 with a clear message if not
- [ ] Script header contains the full BrewBoard setup sequence (see Technical Approach)

## Validation

```bash
# Site builds with zero new image files present (proves graceful degradation)
cd site && npm run build 2>&1 | tail -30
```

## Technical Approach

### Screenshot component (`site/components/Screenshot.tsx`)

This is a Next.js App Router **server component** — `fs` is safe to use here because the check happens at SSG/build time, not in the browser.

```tsx
// Rough shape — agent fills in styling details
import fs from 'fs'
import path from 'path'

interface Props {
  src: string   // e.g. "/img/aigon-dashboard-reports.png"
  alt: string
  caption?: string
}

export function Screenshot({ src, alt, caption }: Props) {
  const filePath = path.join(process.cwd(), 'public', src)
  const exists = fs.existsSync(filePath)

  if (!exists) {
    return (
      <div className="screenshot-placeholder">
        <span className="label">Screenshot coming soon</span>
        <span className="desc">{alt}</span>
      </div>
    )
  }

  return (
    <figure>
      <img src={src} alt={alt} />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  )
}
```

Styling for `.screenshot-placeholder`: dashed border, muted background (matches Nextra's neutral palette), readable at both light and dark mode. Keep it unobtrusive — informative, not alarming.

### BrewBoard screenshot setup

The Aigon dashboard only shows meaningful data when a project with completed features is loaded. BrewBoard (`~/src/brewboard`) is the canonical test fixture.

```
# Run before taking screenshots:
cd ~/src/brewboard
aigon seed-reset ~/src/brewboard --force   # restores seed state with completed features
aigon server start                          # dashboard at http://localhost:4100
node /path/to/aigon/site/scripts/take-screenshots.js
```

Raw captures land in `site/public/img/raw/`. Crop in Preview/Figma/your tool of choice, then move finished files to `site/public/img/` with the exact filename the `<Screenshot>` component expects.

**Amplification screenshots**: require Pro to be active. If Pro isn't available in the dev environment, leave those slots as placeholders (the component handles this gracefully) and add a `<!-- TODO: requires Pro license -->` comment in the MDX.

### Navigation wiring

- `site/content/guides/_meta.ts`: add `"telemetry"` after `"dashboard"`, add `"amplification"` as last entry (Pro-gated)
- `site/content/concepts/_meta.ts`: add `"reliability"` after `"evaluation"`

### Landing page change

One bullet added to the existing dashboard capabilities list. No layout or CSS changes. If any CSS is touched, invoke `Skill(frontend-design)` first.

### Content strategy

Each new guide follows the existing pattern in `site/content/guides/`: brief intro callout, prerequisites (if any), section-by-section walkthrough with `<Screenshot>` components, reference table, and a "Next steps" link. Write full prose — do not use placeholder text; the content ships immediately.

## Dependencies

- `fs` (Node built-in) — no new npm deps for the Screenshot component
- `@playwright/test` for the screenshot script — install with `npm install -D @playwright/test` inside `site/` if not already present (dev dependency only)
- BrewBoard seed project at `~/src/brewboard` for Phase 2 screenshot capture
- Pro subscription (or mock state) for Amplification screenshots; placeholders are acceptable if unavailable

## Out of Scope

- Redesigning the landing page layout or hero section
- Adding docs for features not yet shipped (e.g., feature 210 dependency enforcement)
- Automated screenshot diffing in CI
- Translating docs to other languages
- Updating the comparisons matrix (separate feature)

## Open Questions

- Should the Amplification guide live in `/docs/guides/` or link from the existing `/pro` page? Currently `/pro/` is a standalone Next.js page, not an MDX route — linking from the guides sidebar may use a cross-link rather than a sidebar entry.
- Is there a way to force Pro mode locally for screenshot capture without a live subscription?

## Related

- Features: 207 (Gemini & Codex telemetry), 208 (activity breakdown), 209 (token activity time series), 202 (agent-attributed token analytics)
- Pro page: `site/app/pro/page.tsx`
- Dashboard guide: `site/content/guides/dashboard.mdx`
- Existing screenshots: `site/public/img/aigon-dashboard-reports*.png`, `site/public/img/*-pro.png`
