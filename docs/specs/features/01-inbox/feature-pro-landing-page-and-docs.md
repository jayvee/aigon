# Feature: pro-landing-page-and-docs

## Summary

Create the Aigon Pro landing page at `aigon.build/pro` and add Pro references throughout the public docs site and GitHub README. The Pro page showcases all Pro-gated features with real dashboard screenshots, describes what's included, and ends with a prominent "Coming Soon" banner since Pro isn't purchasable yet. The docs and README should reference Pro where relevant so users discover it organically.

## User Stories
- [ ] As a visitor to aigon.build/pro, I see a clear, compelling page showing exactly what Pro includes — with real screenshots of charts, insights, and quality metrics
- [ ] As a free-tier user who clicks "Get Aigon Pro →" from a dashboard gate, I land on a page that explains what I'll get and tells me it's coming soon
- [ ] As a visitor reading the docs, I encounter natural references to Pro features (e.g. in the dashboard guide, reports reference) so I know it exists
- [ ] As a visitor reading the GitHub README, I see a brief mention of Pro with a link

## Acceptance Criteria
- [ ] `site/content/pro.mdx` (or equivalent route) exists and renders at `aigon.build/pro`
- [ ] Pro page has sections for each Pro feature: Agent Quality metrics (first-pass rate, CPF, rework ratio), Trend Charts (cycle time, CPF, rework ratio charts), Insights (AI observations + coaching), with screenshots from `site/public/img/`
- [ ] Pro page ends with a full-width "Coming Soon" banner — prominent, not a footnote
- [ ] Pro page has no purchase/pricing — purely informational + "coming soon"
- [ ] `site/content/guides/dashboard.mdx` references Pro features where the Reports tab is discussed
- [ ] `README.md` has a brief "Aigon Pro" section or mention with link to `aigon.build/pro`
- [ ] All existing `aigon.build/pro` links from dashboard gates resolve (no 404)
- [ ] Pro page is listed in the site navigation/meta (sidebar or top-level)
- [ ] Screenshots used are the existing ones from `site/public/img/` (e.g. `aigon-dashboard-reports-charts.png`, `aigon-dashboard-reports-summary.png`, `aigon-dashboard-statistics.png`)

## Validation
```bash
# Verify the pro page file exists
test -f site/content/pro.mdx || test -f site/app/pro/page.tsx
# Verify README mentions Pro
grep -q "Aigon Pro" README.md
```

## Technical Approach

### Pro Landing Page (`site/content/pro.mdx`)
- New MDX page at site root (not under /docs) so it's `aigon.build/pro`
- Sections with screenshots:
  1. **Hero**: "Aigon Pro — deeper insights into your AI development workflow"
  2. **Agent Quality Metrics**: first-pass rate, commits/feature, rework ratio — screenshot of summary cards
  3. **Trend Charts**: cycle time, CPF, rework trends — screenshot of charts tab
  4. **AI Insights**: observations, coaching, amplification — screenshot of insights tab
  5. **Coming Soon**: full-width banner with "Pro is coming soon — join the waitlist" or similar
- Use existing screenshots from `site/public/img/` — no new screenshots needed
- Keep the page simple and static — no interactive components

### Docs References
- `site/content/guides/dashboard.mdx`: add a "Pro Features" subsection mentioning what's available with Pro in the Reports tab
- Any command reference that touches metrics (e.g. `insights.mdx`) should note Pro requirement

### README
- Add a short "Aigon Pro" section after the features list, 2-3 lines + link

## Dependencies
- depends_on: pro-gated-reports (feature 152 — must be merged so the dashboard gates exist)

## Out of Scope
- Pricing or payment integration
- Waitlist signup backend
- New screenshots (use existing ones)
- Changes to the dashboard Pro gates (already done in feature 152)

## Open Questions
- Should the Pro page be under `aigon.build/pro` (site root) or `aigon.build/docs/pro` (docs section)?
- Do we want a waitlist email input or just "coming soon" text?

## Related
- Feature 152: pro-gated-reports (dashboard Pro gates)
- `site/public/img/aigon-dashboard-reports-charts.png` — charts screenshot
- `site/public/img/aigon-dashboard-reports-summary.png` — summary screenshot
- `site/content/guides/dashboard.mdx` — dashboard guide
- `README.md` — GitHub repo README
