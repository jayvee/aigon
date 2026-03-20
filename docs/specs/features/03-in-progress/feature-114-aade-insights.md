# Feature: AADE Insights

## Summary

Three-phase insights engine for AADE data. Phase 1: rule-based CLI command `aigon insights` that runs 5-10 trend and outlier checks with zero LLM cost. Phase 2: LLM-narrated coaching via Claude API using a developer workflow coach prompt. Phase 3: dashboard "Insights" tab with cached results and manual refresh. The AI coaching phases are commercial gate candidates — free tier gets rule-based insights, paid tier gets AI-powered coaching and the dashboard tab.

## User Stories

- [ ] As a developer, I want to run `aigon insights` and get actionable observations about my AI development patterns without any API cost
- [ ] As a developer, I want AI-powered coaching that analyses my trends and suggests specific improvements to my workflow
- [ ] As a developer, I want to see insights in the dashboard so I don't have to remember to run CLI commands
- [ ] As a developer on the free tier, I want useful rule-based insights even without paying for AI coaching

## Acceptance Criteria

### Phase 1 — Rule-Based CLI
- [ ] `aigon insights` command exists and outputs trend/outlier observations to stdout
- [ ] At least 5 rules implemented: (1) cost trend (rising/falling over last 5 features), (2) token efficiency trend (tokens_per_line_changed), (3) rework frequency (% of features with rework flags), (4) autonomy distribution (how often Full Autonomy vs Thrashing), (5) outlier detection (feature with 3x+ average cost or tokens)
- [ ] Output is human-readable, concise, and actionable (not raw data dumps)
- [ ] Zero LLM cost — all logic is deterministic
- [ ] Gracefully handles insufficient data (< 3 features: "Not enough data for insights yet")

### Phase 2 — LLM Coaching
- [ ] `aigon insights --coach` flag triggers LLM analysis
- [ ] Sends aggregated AADE data (not raw logs) to Claude API with a developer workflow coach system prompt
- [ ] Returns 3-5 specific, actionable recommendations
- [ ] Warns user about API cost before calling (or uses a cost cap)
- [ ] Commercial gate: behind a flag or config check for paid tier

### Phase 3 — Dashboard Tab
- [ ] "Insights" tab in the Amplification dashboard section
- [ ] Shows cached insight results (from last CLI run or scheduled refresh)
- [ ] Manual refresh button triggers re-computation
- [ ] Rule-based insights always visible; AI coaching results shown only if available and gated

## Validation

```bash
node --check aigon-cli.js
npm test
```

## Technical Approach

- Phase 1: New `insightsCommand()` function in `aigon-cli.js`, registered as `aigon insights` subcommand
- Rules implemented as an array of `{ name, check(features) => Observation | null }` where each rule receives the list of features with AADE frontmatter data
- Phase 2: Use Claude API (or AI Gateway) to send a structured prompt with aggregated metrics. System prompt positions Claude as a developer workflow coach focused on AI-assisted development efficiency
- Phase 3: Cache insights as JSON in `.aigon/insights-cache.json` with timestamp. Dashboard reads cache and renders. Refresh button triggers re-computation via API call
- Commercial gating: check `.aigon/config.json` for a `license` or `tier` field; Phase 1 always available, Phases 2-3 require `tier: "pro"` or similar

## Dependencies

- aade-telemetry-adapters (provides token/cost data in frontmatter)
- aade-git-signals (provides rework flags in frontmatter)
- aade-amplification-dashboard (Phase 3 integrates into the dashboard)
- Claude API access (Phase 2 only — requires API key or AI Gateway)

## Out of Scope

- Automated scheduled insights (cron-style — user runs manually or refreshes)
- Team-level insights or cross-project comparisons
- Predictive analytics (estimating cost of future features)
- Integration with external analytics tools

## Open Questions

- What's the right LLM cost cap for a single coaching call? ($0.05? $0.10?)
- Should Phase 2 use the same Claude model as the user's agent, or a smaller/cheaper model?
- How should commercial gating be implemented? License key? Config flag? Server-side check?
- Should insights be versioned so users can see how recommendations changed over time?

## Related

- Research: research-13-ai-development-effectiveness (Synthesis — Commercial Gating, Three-Phase Insights)
- Feature: aade-telemetry-adapters (data source)
- Feature: aade-git-signals (data source)
- Feature: aade-amplification-dashboard (Phase 3 integration target)
