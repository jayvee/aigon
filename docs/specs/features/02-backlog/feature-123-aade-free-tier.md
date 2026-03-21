# Feature: aade-free-tier

## Summary
Capture token/cost/git-signal/rework telemetry locally, expose raw metrics and rule-based insights in CLI and dashboard — all free forever. Includes upgrade prompts at Pro boundaries to create natural upgrade desire. Merges: aade-free-instrumentation, aade-free-rule-insights, aade-freemium-teaser.

## User Stories
- [ ] As a developer, I want to see how many tokens and dollars I spent on AI this month so I can track my costs
- [ ] As a developer, I want git signal data (commits, lines changed, rework flags) captured per feature so I can understand my development patterns
- [ ] As a developer, I want rule-based insights (e.g., "Your rework rate is above average") in CLI and dashboard so I get value without paying
- [ ] As a developer, I want to see a teaser of what Pro offers (e.g., "Upgrade to see 90-day trends") so I understand the value before buying

## Acceptance Criteria
- [ ] Token/cost telemetry captured via SessionEnd hook, parsing `~/.claude/projects/<hash>/<session>.jsonl`
- [ ] Git signals computed at feature-close: commits, lines changed, rework detection flags
- [ ] Data stored in log frontmatter as flat scalar fields (~15 new fields, ~200 bytes/feature)
- [ ] Dashboard shows free cards: token totals, cost this month, feature count, basic rework flags
- [ ] `aigon insights` command outputs 5-10 rule-based checks (outliers, trends, comparisons) without requiring a license
- [ ] Upgrade prompts shown when user accesses Pro-only views (trends, history, AI coaching)
- [ ] All free-tier features work with no license file, no internet, no account

## Validation
```bash
node --check aigon-cli.js
node -c lib/utils.js
```

## Technical Approach
- Token capture: SessionEnd hook adapter parses Claude transcript JSONL (designed in Research-13)
- Git signals: Computed at feature-close via `lib/git.js` helpers
- Storage: Log frontmatter fields in existing feature log files — no new database
- Dashboard: New statistics cards in `templates/dashboard/js/statistics.js`
- Insights: New `aigon insights` command with rule-based checks (no LLM calls)
- Teaser: When user hits a Pro boundary, show metric summary + "Upgrade to Aigon Pro" prompt with `aigon.dev/pro` link

## Dependencies
- Research-13 AADE feature specs (telemetry adapters, git signals, amplification dashboard, insights)

## Out of Scope
- AI/LLM-powered coaching (that's aade-pro-tier)
- Trend sparklines, rolling averages, full history (that's aade-pro-tier)
- License validation (that's aade-licensing-and-billing)
- Landing page / payment (that's aade-commercial-site / aade-licensing-and-billing)

## Open Questions
- Should rule-based insights be free forever (cx recommendation) or eventually gated (cc recommendation)? Current decision: free forever to maximise adoption funnel.

## Related
- Research: research-15-aade-commercial-gate, research-13-ai-development-effectiveness
- Features: feature-aade-telemetry-adapters, feature-aade-git-signals, feature-aade-amplification-dashboard, feature-aade-insights
