# Feature: AADE Amplification Dashboard

## Summary

New "Amplification" section in the Aigon dashboard displaying AI development effectiveness metrics. Shows cost-per-feature cards, rolling trend sparklines, autonomy spectrum labels (Full Autonomy / Light Touch / Guided / Collaborative / Thrashing), first-pass rate (features completed without rework flags), and rework indicators. This is the user-facing presentation layer for AADE data captured by the telemetry adapters and git signals features.

## User Stories

- [ ] As a developer, I want to see my cost per feature at a glance so I can understand what each feature costs in AI compute
- [ ] As a developer, I want to see trend sparklines so I can tell if my AI efficiency is improving over time
- [ ] As a developer, I want autonomy labels on each feature so I can see the spectrum from fully autonomous to highly interactive
- [ ] As a developer, I want rework indicators highlighted visually so I can spot problematic features quickly
- [ ] As a developer, I want a first-pass rate metric so I can track how often features complete cleanly on the first attempt

## Acceptance Criteria

- [ ] New "Amplification" section visible in the dashboard (collapsible, below existing sections)
- [ ] Cost cards: each recent feature shows estimated cost in USD (from telemetry adapter data)
- [ ] Rolling sparklines: 7-day and 30-day trends for cost-per-feature and tokens-per-line-changed
- [ ] Autonomy labels displayed per feature: Full Autonomy, Light Touch, Guided, Collaborative, Thrashing — derived from telemetry data
- [ ] First-pass rate: percentage of features completed without any rework flags (thrashing, fix cascade, scope creep)
- [ ] Rework indicators: visual markers (icon or colour) on features that triggered rework pattern flags
- [ ] Dashboard section gracefully handles missing data (features without AADE telemetry show "—" or "No data")
- [ ] Section renders correctly in both the HTTP dashboard and falls back cleanly if data is incomplete

## Validation

```bash
node --check aigon-cli.js
node --check lib/utils.js
npm test
```

## Technical Approach

- Add new section to `templates/dashboard/index.html` with Amplification Stats heading
- Backend: new API endpoint or extend existing dashboard data endpoint to include AADE metrics aggregated from feature log frontmatter
- Sparklines: lightweight inline SVG or CSS-only sparklines (no charting library dependency)
- Autonomy label mapping: read `autonomy_label` field from log frontmatter, display with colour coding (green=autonomous, yellow=guided, red=thrashing)
- First-pass rate: count features where all rework flags are false / total features with AADE data
- Cost cards: read `cost_usd` from frontmatter, format as currency
- Use existing `parseLogFrontmatterFull()` to read AADE fields from all feature logs

## Dependencies

- aade-telemetry-adapters (provides cost, tokens, autonomy labels in frontmatter)
- aade-git-signals (provides rework flags in frontmatter)
- Existing dashboard infrastructure (`aigon-cli.js dashboard`, `templates/dashboard/index.html`)

## Out of Scope

- Composite "Leverage Score" or single-number summary (individual indicators are more actionable)
- Historical data backfill for features completed before AADE was enabled
- Export or sharing of amplification data
- Comparison across projects or repositories

## Open Questions

- Should sparklines use a fixed window (last N features) or a time window (last 30 days)?
- What's the minimum number of features needed before sparklines are meaningful? (Show placeholder before threshold?)
- Should the section be visible by default or opt-in? (Commercial gating consideration)
- Dark mode / light mode styling for the new section?

## Related

- Research: research-13-ai-development-effectiveness (Synthesis — Naming & Framing, Commercial Gating)
- Feature: aade-telemetry-adapters (data source — tokens, cost, autonomy)
- Feature: aade-git-signals (data source — rework flags, git metrics)
- Feature: aade-insights (analyses the same data with rules and LLM coaching)
