# Feature: aade-pro-tier

## Summary
Gate premium AADE features behind Pro license: AI-generated coaching and interpretation, trend sparklines, rolling averages, cross-feature comparison, full history retention, and the full `aigon insights` command (rule-based + LLM analysis). Merges: aade-pro-ai-coaching, aade-pro-dashboard, aade-pro-insights.

## User Stories
- [ ] As a Pro user, I want AI-powered coaching that explains WHY my rework rate spiked and WHAT to try differently
- [ ] As a Pro user, I want trend sparklines and rolling averages across features so I can see if I'm improving over time
- [ ] As a Pro user, I want cross-feature comparison views so I can identify which types of work cost the most
- [ ] As a Pro user, I want full history retention (not just current month) so I can track long-term patterns

## Acceptance Criteria
- [ ] All Pro features check `requirePro()` before rendering/executing
- [ ] AI coaching: LLM-powered analysis of aggregated AADE data with actionable recommendations
- [ ] AI coaching rate-limited (e.g., 20 insights/month) to control LLM inference costs
- [ ] Dashboard Pro sections: trend sparklines, rolling averages, cross-feature comparisons
- [ ] Full history: Pro users see all historical data; free users see current month / 7-day window only
- [ ] `aigon insights --deep` runs LLM analysis (Pro); `aigon insights` runs rule-based (free)
- [ ] Graceful degradation: if license expires, Pro sections show upgrade prompt instead of crashing

## Validation
```bash
node --check aigon-cli.js
node -c lib/utils.js
```

## Technical Approach
- **AI coaching**: Call LLM (via AADE data context) to generate personalised recommendations; cache results to avoid repeated API calls
- **Dashboard gating**: Pro sections in `templates/dashboard/js/statistics.js` check license tier; render upgrade prompts for free users
- **History gating**: `collectAnalyticsData()` in `lib/utils.js` limits time window for free users
- **Insights gating**: `aigon insights` base command stays free (rule-based); `--deep` flag or full output requires Pro
- **Cost control**: Rate-limit LLM coaching calls per license per month; consider BYOK (bring your own key) as escape hatch

## Dependencies
- aade-free-tier (free instrumentation and rule-based insights must exist first)
- aade-licensing-and-billing (license validation and `requirePro()` must be in place)

## Out of Scope
- Team/org analytics (future scope)
- Custom report generation or export
- Real-time streaming insights

## Open Questions
- Should AI coaching use the user's own API key (BYOK) or Aigon's API key with rate limits?
- What LLM model for coaching? Needs to be cost-effective for the $9-12/mo price point

## Related
- Research: research-15-aade-commercial-gate, research-13-ai-development-effectiveness
- Features: aade-free-tier, aade-licensing-and-billing
