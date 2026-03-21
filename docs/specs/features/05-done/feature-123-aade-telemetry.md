# Feature: aade-telemetry

## Summary

Capture token/cost/git-signal/rework telemetry locally and expose raw metrics in the dashboard. Data collection and basic number display are free. All analysis, insights, coaching, and trends are Pro-only. Includes upgrade prompts at Pro boundaries.

## User Stories

- [ ] As a developer, I want to see how many tokens and dollars I spent on AI this month so I can track my costs
- [ ] As a developer, I want git signal data (commits, lines changed, rework flags) captured per feature so I can understand my development patterns
- [ ] As a developer, I want basic dashboard cards showing my raw metrics (totals, counts, flags) so I get value without paying
- [ ] As a developer, I want to see a teaser of what Pro offers (e.g., "Upgrade for AI coaching and trend analysis") so I understand the value before buying

## Acceptance Criteria

- [ ] Token/cost telemetry captured via SessionEnd hook, parsing `~/.claude/projects/<hash>/<session>.jsonl`
- [ ] Git signals computed at feature-close: commits, lines changed, rework detection flags (already done in #115)
- [ ] Data stored in log frontmatter as flat scalar fields (~15 new fields, ~200 bytes/feature)
- [ ] Dashboard shows free cards: token totals, cost this month, feature count, basic rework flags
- [ ] Upgrade prompts shown when user accesses Pro-only views (insights, trends, history, AI coaching)
- [ ] All free-tier features work with no license file, no internet, no account
- [ ] `aigon insights` command shows "Requires Aigon Pro" message (insights are Pro-only)

## Validation

```bash
node --check aigon-cli.js
node -c lib/utils.js
```

## Technical Approach

- **Token capture**: SessionEnd hook adapter parses Claude transcript JSONL (designed in Research-13)
- **Git signals**: Already implemented in feature #115 — computed at feature-close via `lib/git.js`
- **Storage**: Log frontmatter fields in existing feature log files — no new database
- **Dashboard free cards**: Basic statistics cards in `templates/dashboard/js/statistics.js` showing raw numbers (totals, counts, flags) — no charts, no trends, no analysis
- **Pro boundary**: When user clicks an insights/trends/coaching section, show upgrade prompt with link to aigon.build/pro
- **No `aigon insights` in free tier**: Command exists but prints "Requires Aigon Pro — upgrade at aigon.build/pro"

## Dependencies

- Feature #115 aade-git-signals (done — provides git signal computation)
- Feature #122 aade-extract-to-private-package (done — AADE code is in @aigon/pro)

## Out of Scope

- `aigon insights` command output (Pro only)
- Rule-based insights and checks (Pro only — may revisit later)
- AI/LLM-powered coaching (Pro only)
- Trend sparklines, rolling averages, full history (Pro only)
- License validation (that's aade-licensing-and-billing)
- Landing page / payment (that's aade-commercial-site)

## Open Questions

- What specific raw metrics should the free dashboard cards show? (Suggestion: total features, total cost, avg cost/feature, rework flag count — numbers only, no interpretation)

## Related

- Research: research-15-aade-commercial-gate, research-13-ai-development-effectiveness
- Features: #115 aade-git-signals (done), #122 aade-extract-to-private-package (done), #124 aade-pro-tier, #125 aade-licensing-and-billing
