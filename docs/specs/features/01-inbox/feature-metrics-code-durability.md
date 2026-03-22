# Feature: metrics-code-durability

## Summary

Post-merge code durability analysis — the flagship differentiator for Aigon Pro. Three complementary views of "did agent code stick?": persistence rate (what % of AI lines survive at T+7d/T+30d), edit distance (how much did humans modify agent output before merge), and post-merge rework rate (how much agent code gets churned after merge). No other tool measures AI code survival at the feature level.

## User Stories
- [ ] As a developer, I want to see what percentage of my agent's code survived after 7 and 30 days so I know if the AI is producing durable work
- [ ] As a developer, I want to see how much I had to modify agent output before merging so I can compare agent effectiveness
- [ ] As a developer, I want to know if agent code is causing post-merge churn so I can adjust my workflow

## Acceptance Criteria
- [ ] Persistence rate computed via git blame at T+7d and T+30d for agent-attributed commits, reported per feature
- [ ] Edit distance computed as normalized diff between agent's final commit and merge commit, bucketed as no-change / minor (<10%) / significant (10-50%) / rewrite (>50%)
- [ ] Post-merge rework rate: percentage of agent-authored lines modified within 7d and 14d after merge
- [ ] Results stored in a durable format (JSON in `.aigon/metrics/` or similar) for dashboard consumption
- [ ] CLI command to trigger durability analysis on demand (`aigon metrics durability [feature-id]`)

## Validation
```bash
node --check aigon-cli.js
```

## Technical Approach

- **Persistence**: Periodic git blame on files touched by agent commits. Compare agent-authored lines at merge time vs. current state at T+7d/T+30d.
- **Edit distance**: `git diff <agent_final_commit>..<merge_commit>` normalized by total agent output lines. Line-level diff ratio first; consider compression-based edit distance (CBED, arXiv:2412.17321) later.
- **Post-merge rework**: Re-run git blame at T+7d/T+14d, count agent-authored lines that were deleted or modified.
- **Scheduling**: Can run on-demand via CLI or as a background check during `aigon doctor`.

Published benchmarks for context: GitClear reports code churn rose from 3.1% to 5.7% (2020-2024) with AI adoption. AI PRs have 1.7x more issues (CodeRabbit). 75% of AI agents break previously working code in long-term maintenance (SWE-CI).

## Dependencies
- metrics-git-attribution (needs reliable AI/human commit classification)

## Out of Scope
- AST-level semantic diff (future enhancement)
- Bug/defect attribution (requires SAST integration)
- IDE-level suggestion persistence (Copilot-style acceptance tracking)

## Open Questions
- Should persistence analysis run automatically on a schedule or only on-demand?
- How to handle squash-merged features where individual agent commits are lost?

## Related
- Research: research-19-ai-native-workflow-metrics
- Depends-on: metrics-git-attribution
- Blocks: metrics-insights-scorecard (durability is the flagship dashboard metric)
