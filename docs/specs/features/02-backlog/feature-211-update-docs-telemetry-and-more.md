# Feature: update-docs-telemetry-and-more

## Summary

The docs site and landing page are missing coverage of several recently shipped features: cross-agent telemetry (CC, GG, CX parsers), the activity breakdown field (implement/evaluate/review), token usage charts by activity/agent/model, the Amplification dashboard (Pro tier analytics), and reliability/merge-gate improvements. This feature audits every gap, writes the missing guides and reference pages, refreshes outdated screenshots, and captures new screenshots (via Playwright where possible, with manual instructions otherwise).

## User Stories

- [ ] As a new user evaluating Aigon, I can see on the landing page that it tracks token usage and cost across agents so I understand the observability story before reading the docs.
- [ ] As a developer running Fleet mode, I can read a "Telemetry & Analytics" guide that explains what data is collected, how to read the Reports tab, and how to interpret the activity breakdown (implement vs. evaluate vs. review).
- [ ] As a Pro subscriber, I can find a dedicated guide to the Amplification dashboard that explains quality metrics, trend charts, and AI coaching insights — without digging through the generic dashboard guide.
- [ ] As a team lead, I can find a concepts page on reliability that covers merge gates, worktree isolation, and audit logs.
- [ ] As a reader of any docs page with a screenshot, the screenshot reflects the current UI (no stale "Radar" references, correct chart layouts, correct tab labels).

## Acceptance Criteria

### New documentation pages
- [ ] `site/content/guides/telemetry.mdx` — "Telemetry & Analytics" guide covering: what is collected, activity field values, per-agent cost attribution, how to read the Reports tab, free-tier vs. Pro boundaries
- [ ] `site/content/guides/amplification.mdx` — "Amplification Dashboard" guide (Pro) covering: quality metrics leaderboard (first-pass rate, commits/feature, rework ratio), trend charts, AI insights & coaching, cost optimization view
- [ ] `site/content/concepts/reliability.mdx` — "Reliability & Safety" concepts page covering: worktree isolation, merge gate scanning (gitleaks + semgrep), severity thresholds, audit logs, recovery from failed evaluations
- [ ] All new pages are linked in the Nextra `_meta` navigation files so they appear in the sidebar

### Updated existing pages
- [ ] `site/content/guides/dashboard.mdx` — Pro section updated to link to the new Amplification guide; token chart screenshots added; activity breakdown explained
- [ ] `site/content/getting-started.mdx` — references Reports tab so users know it exists from day one
- [ ] `site/public/home.html` (landing page) — adds a bullet or card in the dashboard section mentioning "cost & token visibility across all agents" and links to the Telemetry guide

### Screenshots — existing to refresh
- [ ] `aigon-dashboard-reports.png` — retake to show current Reports tab (verify tab label, layout)
- [ ] `aigon-dashboard-reports-summary.png` — retake to show current Summary sub-tab with up-to-date metric cards
- [ ] `aigon-dashboard-reports-charts.png` — retake to show current Charts sub-tab (5 synchronized charts including Tokens Used)

### Screenshots — new captures needed
- [ ] `aigon-dashboard-reports-activity.png` — Charts tab zoomed on the "Token Activity" time-series chart (introduced feature 209), showing activity-type colour coding
- [ ] `aigon-dashboard-reports-agent-breakdown.png` — Charts tab showing the per-agent cost attribution view
- [ ] `aigon-amplification-metrics.png` — Amplification/Pro quality metrics leaderboard (agent rows, first-pass rate column highlighted)
- [ ] `aigon-amplification-charts.png` — Amplification trend charts panel (cycle time, rework, cost-per-feature over time)
- [ ] `aigon-amplification-insights.png` — Amplification AI insights / coaching card

### Playwright automation
- [ ] `site/scripts/take-screenshots.js` (new) — Playwright script that:
  1. Opens `http://localhost:4100` (the running Aigon dashboard)
  2. For each screenshot target: navigates to the correct tab/sub-tab, waits for data to load, takes a full-viewport screenshot to `site/public/img/raw/` (staging area — NOT the final `img/` path)
  3. Prints a checklist of what was captured and what needs manual cropping/polish before moving to `site/public/img/`
- [ ] Script exits 0 if the dashboard is reachable, exits 1 with a helpful message if not (so CI doesn't silently swallow it)
- [ ] README block in the script header explains manual steps for BrewBoard scenario (see Technical Approach)

## Validation

```bash
# Docs site builds without errors
cd site && npm run build 2>&1 | tail -20
# All new MDX files pass Next.js build
node -e "console.log('validation placeholder')"
```

## Technical Approach

### Content strategy
Each new guide follows the existing pattern in `site/content/guides/`: intro callout (what the feature does), prerequisites, step-by-step walkthrough with annotated screenshots, reference table, and a "Next steps" link.

### Screenshot workflow
Two-stage process:
1. **Raw capture**: Playwright writes to `site/public/img/raw/` — full viewport, no cropping.
2. **Final polish** (manual): User crops, adjusts contrast, and moves approved files to `site/public/img/`. MDX pages reference `img/` paths only.

**Why BrewBoard for screenshots**: The Aigon dashboard only shows meaningful data when a project with completed features is loaded. BrewBoard (seed project at `~/src/brewboard`) is the canonical test fixture with enough history to make Reports, Charts, and Amplification panels look realistic. The Playwright script should run against `aigon server start` pointed at the BrewBoard worktree, not an empty project.

**BrewBoard setup instructions (embed in script header and in the spec)**:
```
1. cd ~/src/brewboard
2. aigon seed-reset ~/src/brewboard --force   # restores to initial state with completed features
3. aigon server start                          # starts dashboard at http://localhost:4100
4. node site/scripts/take-screenshots.js      # captures all targets to site/public/img/raw/
```
If `aigon seed-reset` cannot generate enough history for Amplification charts (requires Pro), capture a static mock or annotate the screenshot placeholder with a TODO comment in the MDX.

### Navigation wiring
- `site/content/guides/_meta.ts` — add `"telemetry"` and `"amplification"` entries
- `site/content/concepts/_meta.ts` — add `"reliability"` entry
- Order: telemetry after dashboard guide; amplification last (Pro-gated); reliability after evaluation concept

### Stale screenshots
Any screenshot file currently referencing "Radar" in name or content should be identified and either removed or replaced. Specifically audit: `aigon-radar-dashboard.png` — check if any MDX page references it and update the reference to the correct file.

### Landing page change
Minimal: one additional bullet in the existing dashboard capabilities list. Do not redesign the landing page layout (out of scope). Use `Skill(frontend-design)` if any CSS is touched.

## Dependencies

- Aigon dashboard must be running locally (port 4100) to take screenshots
- BrewBoard seed project at `~/src/brewboard` with `aigon seed-reset` applied
- `@playwright/test` already available or installable (`npm install -D @playwright/test` in site/)
- Pro subscription or mock Pro state to capture Amplification screenshots (if not available, document with TODO placeholders)

## Out of Scope

- Redesigning the landing page layout or hero section
- Adding new docs content about features not yet shipped (e.g., feature 210 dependency enforcement)
- Automated screenshot diffing in CI
- Translating docs to other languages
- Updating the comparisons matrix (separate feature)

## Open Questions

- Is a Pro license available in the dev environment to capture real Amplification screenshots, or do we need to use a mock/stub state? If mocking, what's the correct way to force Pro mode for screenshot purposes?
- Should the Amplification guide live under `/docs/guides/` or under `/pro/` (the existing Pro landing page)? Currently `/pro/` is a Next.js page, not an MDX route — linking from the guides sidebar may require a cross-link rather than a sidebar entry.
- Are there any other recently shipped features (beyond telemetry, activity breakdown, Amplification) that need docs coverage in this batch?

## Related

- Research: n/a
- Features: 207 (Gemini & Codex telemetry), 208 (activity breakdown), 209 (token activity time series), 202 (agent-attributed token analytics)
- Pro page: `site/app/pro/page.tsx`
- Dashboard guide: `site/content/guides/dashboard.mdx`
- Existing screenshots: `site/public/img/aigon-dashboard-reports*.png`, `site/public/img/*-pro.png`
