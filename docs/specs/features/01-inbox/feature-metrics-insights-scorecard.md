# Feature: metrics-insights-scorecard

## Summary

Aigon Pro dashboard combining existing metrics (first-pass success, autonomy ratio, wait burden, cost, rework signals) with new durability metrics into a balanced scorecard answering four questions: Are we going faster? Is the output sticking? Are reviews and fixes getting easier or harder? Are we getting enough value for the AI spend? Includes trends over time, agent comparisons, and sub-phase latency breakdown.

## User Stories
- [ ] As a developer, I want a single dashboard showing whether my AI workflow is improving over time
- [ ] As a developer, I want to compare agent effectiveness (which agent produces the most durable code at the lowest cost?)
- [ ] As a developer, I want to see where my feature lifecycle bottlenecks are (implementation vs review vs rework)

## Acceptance Criteria
- [ ] Dashboard displays existing metrics: first-pass success rate, autonomy ratio, average wait count, cost per feature, tokens per line changed, rework signals
- [ ] Dashboard displays durability metrics (when available): persistence rate, edit distance, post-merge rework
- [ ] 7-day and 30-day trend lines for key metrics
- [ ] Agent comparison view: side-by-side metrics per agent (cc, gg, cx, cu)
- [ ] Feature lifecycle sub-phase breakdown: spec→session→commit→submitted→done with average durations
- [ ] Free tier shows: latency, wait burden, first-pass success
- [ ] Pro tier adds: durability metrics, agent comparisons, trend analysis, cost views

## Validation
```bash
node --check aigon-cli.js
```

## Technical Approach

Build on existing `collectAnalyticsData()` in `lib/utils.js` which already aggregates most metrics. Add new panels to the Aigon dashboard (`lib/dashboard-server.js` / `templates/dashboard/`). Use the same polling/WebSocket architecture as existing dashboard panels.

## Dependencies
- metrics-code-durability (for durability metrics — v1 can ship without, using existing metrics only)

## Out of Scope
- External integrations (GitHub PR review data, CI pipeline data)
- Real-time streaming metrics
- Multi-project aggregation

## Open Questions
- Should the scorecard be a new tab in the existing dashboard or a separate view?
- What visual format best communicates trends? (sparklines, bar charts, numbers with arrows?)

## Related
- Research: research-19-ai-native-workflow-metrics
- Depends-on: metrics-code-durability (soft — v1 can ship with existing metrics)
- Enhanced-by: metrics-session-telemetry (richer cross-agent cost data)
