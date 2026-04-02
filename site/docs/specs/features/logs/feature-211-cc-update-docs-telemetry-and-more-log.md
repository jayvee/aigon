# Feature 211 — Implementation Log (cc)

## Summary

Implemented Phase 1 of the docs/telemetry/screenshot feature: all content ships immediately, screenshots degrade gracefully with placeholders.

## What was implemented

### New files
- **`site/components/Screenshot.tsx`** — Server component that checks `fs.existsSync` at build time. Shows `<img>` if the file exists, or a styled placeholder with "Screenshot coming soon" if not.
- **`site/content/guides/telemetry.mdx`** — Full guide covering cross-agent telemetry: parsers (CC, GG, CX), activity breakdown (implement/evaluate/review), cost attribution, Reports tab walkthrough, free vs Pro boundaries.
- **`site/content/guides/amplification.mdx`** — Pro guide covering quality metrics leaderboard, trend charts, AI insights/coaching, setup instructions.
- **`site/content/concepts/reliability.mdx`** — Concepts page covering worktree isolation, merge gate scanning, severity thresholds, audit logs, heartbeat monitoring, failure recovery.
- **`site/scripts/take-screenshots.js`** — Playwright capture script targeting all screenshot slots. Exits 1 with setup instructions if dashboard unreachable.

### Updated files
- **`site/content/guides/_meta.js`** — Added `telemetry` (after dashboard) and `amplification` (last entry)
- **`site/content/concepts/_meta.js`** — Added `reliability` (after evaluation)
- **`site/content/guides/dashboard.mdx`** — Added activity breakdown section, linked to telemetry and amplification guides
- **`site/content/getting-started.mdx`** — Mentioned Reports tab in the dashboard step
- **`site/public/home.html`** — Added telemetry feature card in dashboard section
- **`site/mdx-components.tsx`** — Registered Screenshot component for MDX

## Key decisions
- Used inline styles on Screenshot component rather than CSS classes to avoid adding a new CSS file and to work across light/dark themes via CSS custom properties
- Placed telemetry guide between dashboard and security-scanning in sidebar nav (logical reading order)
- Amplification guide placed last in guides (Pro content)
- No `aigon-radar-dashboard.png` references found — stale reference cleanup criterion was already satisfied

## Issues encountered
- Initial build failed because Screenshot was registered in `site/components/mdx.tsx` but Nextra 4 uses `site/mdx-components.tsx` as the real entry point. Fixed by adding the import there.
