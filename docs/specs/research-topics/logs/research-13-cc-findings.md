---
status: submitted
updated: 2026-03-17T02:29:27.779Z
---

# Research Findings: Aigon AI Development Effectiveness (AADE)

**Agent:** Claude (cc)
**Research ID:** 13
**Date:** 2026-03-17

---

## Key Findings

### 1. Token Efficiency

**Tokens per feature is meaningful — but only with normalisation.** Lower is not always better. A complex multi-file refactor legitimately consumes more tokens than a config tweak. Raw "tokens per feature" would penalise ambitious work.

**Best normalisation: tokens per line changed** (from git diff). Cheap, already derivable from Aigon's git data. Alternatives: tokens per file touched, or manual spec complexity tags (S/M/L).

**The trend matters more than any single number.** A rolling average over the last 10-20 features reveals whether the developer is writing better specs, giving clearer instructions, or choosing the right mode. A sparkline on the dashboard is the right visualisation.

**Claude Code transcript data is already available.** Session JSONL files at `~/.claude/projects/<project-hash>/<session-id>.jsonl` contain per-turn `usage` objects with `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, and `output_tokens`. Verified on this project: one session had 157 turns, 243K cache creation tokens, 7.5K output tokens, 11.3M cache read tokens.

**Capture mechanism:** A `SessionEnd` hook can parse the transcript JSONL (path available via `transcript_path` in hook input) and write token totals to the feature's log metadata. The `gitBranch` field in transcripts links sessions to features. ~50 lines of JS to implement.

**Surface cost ($) as the primary metric, tokens as drill-down.** Cost normalises across models (Haiku is 25x cheaper than Opus per token), accounts for input/output/cache pricing tiers, and is what developers actually pay. Claude Code already computes cost internally (`/cost` command, `--max-budget-usd` flag).

**Distinguish token types.** Output tokens cost 5x more than input. Thinking tokens (billed as output) indicate planning-heavy sessions that may produce better code with fewer iterations. Cache read tokens are 90% cheaper — high cache-read ratios indicate efficient context reuse. The breakdown is already in the data.

**Cursor does NOT expose per-session token data.** Cursor uses subscription billing with no per-session cost breakdown. For Cursor features, use indirect proxies: message count or session duration from log events.

**Autonomous vs interactive:** No published benchmarks, but the architecture is clear. Autonomous mode uses more tokens per session (broader exploration) but potentially fewer tokens per feature (no correction loops). The ratio of autonomous-to-interactive turns is itself a metric worth tracking.

### 2. Interaction Overhead

**Best measure: wait event count (already tracked).** Aigon's log frontmatter `events` array with `implementing → waiting → implementing` transitions is a better metric than raw message count. It captures moments the agent had to stop and ask the human, not just conversation volume.

**Why not message count?** It conflates productive elaboration with thrashing. A 20-message session with 0 clarifying questions is better than a 5-message session with 3 corrections.

**Why not session duration?** Duration is confounded by feature complexity. A 2-hour autonomous session on a complex feature is better than a 30-minute session requiring 5 interventions on a trivial one.

**The autonomy spectrum:**

| Level | Label | Signal | Aigon Data |
|-------|-------|--------|------------|
| 0 | Full Autonomy | Zero waits, single pass | `firstPassSuccess=true`, `autonomyRatio=1.0` |
| 1 | Light Touch | 1 wait (testing confirmation) | `waitCount=1`, `autonomyRatio>0.8` |
| 2 | Guided | 2-3 waits (clarification + testing) | `waitCount=2-3` |
| 3 | Collaborative | Multiple waits, productive corrections | `waitCount>3`, no rework pattern |
| 4 | Thrashing | Multiple waits with rework | `waitCount>3` + git churn signal |

**Anthropic's own research** (analysing millions of Claude Code interactions) found that experienced users shift from approving individual actions to monitoring-and-intervening, with auto-approve usage rising from ~20% (new users) to 40%+ (750+ sessions). Turn duration (99.9th percentile) doubled from 25 to 45 minutes between Oct 2025 and Jan 2026 as users trusted agents with longer autonomous runs.

**Key insight:** Autonomy is co-constructed by the model, the user, and the product — not purely a model capability metric. Frame it as a *workflow quality* indicator, not an agent quality indicator.

**Productive vs unproductive interaction:** Cheap proxy already available — count of `implementing → waiting` transitions. One transition is normal (testing gate). Two or more suggests course corrections. Content-level classification (analysing what was said) would require LLM analysis of session transcripts — expensive and invasive.

**METR study warning:** Developers estimated AI saved 20-24% of time, but the measured result was 19% *slower*. Subjective measures of interaction quality are unreliable — objective counts are essential.

### 3. Git Signals

**Commit count alone is ambiguous.** 1 commit could mean perfect autonomous execution OR no checkpointing (risky). Multiple commits mean iterative development (normal). The signal is in the commit *pattern*, not the count.

**Rework detection from git:**

| Anti-pattern | Detection | Signal |
|---|---|---|
| Thrashing | 5+ commits touching the same file | Agent repeatedly failing/retrying |
| No checkpoints | 1 commit with 500+ lines changed | No rollback points if something breaks |
| Fix cascade | 3+ "fix:" commits after initial feat | Spec was unclear or agent made mistakes |
| Scope creep | Files touched >> spec AC count | Agent went beyond spec |
| Empty submission | 0 net lines changed | Agent did nothing useful |

**Useful aggregates:** Median commits per feature, median files touched, churn ratio (lines added then deleted / total lines), fix-commit ratio (fix/revert commits / total). All derivable from `git log` on feature branches with no new instrumentation.

**Industry benchmark:** Typical code churn (code rewritten by same person within 3 weeks) is 13-30%, meaning 70-87% efficiency. Source: Pluralsight Flow research.

### 4. Competitive Landscape

**Every player targets teams/orgs/enterprises. None focus on the individual solo developer.** This is genuine whitespace.

| Product | Focus | AI-Specific? | Individual? |
|---------|-------|-------------|-------------|
| **DX** | Developer Experience Index (DXI), survey-based. AI Measurement Framework: utilization, impact, cost. DX Core 4 unifies DORA/SPACE/DevEx. | Yes — dedicated AI framework | No (team/org) |
| **Cadence** | AI coding session quality. Analyses session logs, not code. Privacy-first. Closest competitor in spirit. | Yes — core focus | No (team tool) |
| **LinearB** | Team engineering productivity. 3 new AI metrics in 2026 benchmarks. Key finding: AI PRs wait 4.6x longer for review, 32.7% acceptance vs 84.4% manual. | Partially | No (management) |
| **Swarmia** | Engineering effectiveness. Tracks Copilot/Cursor/Claude adoption. EUR 10M raised June 2025. | Adoption tracking | No (team) |
| **Jellyfish** | Enterprise engineering management. McKinsey partnership. Only 20% of teams use metrics to measure AI impact. | Enterprise insights | No (enterprise) |
| **Milestone** | GenAI data lake. $10M seed Nov 2025. Correlates codebases, PM tools, team structure. Explicitly turned away small customers. | Yes — core focus | No (enterprise only) |
| **Pluralsight Flow** | Activity-based analytics. Acquired by Appfire Feb 2025. Criticized as outdated. | No | No |
| **Waydev** | Engineering intelligence, DORA/DX/SPACE. | No | No |

**DX's key stat:** 91% AI coding assistant adoption; 22% of code is AI-authored (Q4 2025, 266 companies). Their DXI: each 1-point improvement = 13 min saved/dev/week.

### 5. Frameworks & AI

**DORA 2025 pivoted entirely to AI.** Report titled "State of AI-Assisted Software Development." Added **rework rate** as a 5th metric. Core finding: **AI is an amplifier, not a creator of excellence.** Accelerates good orgs, magnifies chaos in bad ones. 90% of developers now use AI tools.

**SPACE (2021):** Not AI-specific but being adapted. Teams using all 5 dimensions improve 20-30% more than those tracking only activity.

**DevEx:** A 2025 SSRN paper examines "Developer Experience Measurement in the Age of AI." Nicole Forsgren (DORA/SPACE/DevEx creator): "AI accelerates coding, but developers aren't getting that much more done."

**The AI Productivity Paradox (DORA 2025):** AI boosts individual output (21% more tasks, 98% more PRs) but organisational delivery metrics stay flat. AI adoption correlates with higher instability — more change failures, increased rework, longer cycle times.

### 6. Naming & Framing

**Candidate evaluation:**

| Name | Verdict | Reasoning |
|------|---------|-----------|
| **AI Development Effectiveness (ADE)** | Crowded | "ADE" already means Application Development Environment, Agentic Development Environment, and API Development Environment (Postman). Would cause confusion. |
| **Aigon AI Development Effectiveness (AADE)** | **Selected** | Branded, ownable, unambiguous. No existing use in tech/dev tools. Accurate, professional. Clean acronym. |
| **Flow Index** | Avoid | "Flow" is crowded — Pluralsight Flow, Flow Framework, flow metrics. Confusable. |
| **Amplification Score** | Best for dashboard UX | Captures DORA's "AI is an amplifier" insight. Implies you're already good, AI multiplies capability. Motivating. Ownable — not used by competitors. Drop "Score" → just "Amplification." |
| **Leverage Score** | Decent | Strong metaphor but finance connotations (debt leverage). "Score" feels judgmental. |
| **Efficiency Score** | Avoid | Nicole Forsgren explicitly warns against efficiency-focused metrics. Associated with Taylorism/surveillance. Vanilla. |

**Decision: AADE (Aigon AI Development Effectiveness).** Use "AADE" as the official name across specs, docs, CLI commands, and API. Use "Amplification" as the user-facing dashboard section label. AADE describes the system; Amplification describes how it feels.

**Framing principles for a solo developer tool:**
- Language should suggest **growth and mastery**, not judgment and scoring
- "Productivity" → feels like surveillance, even self-applied. Avoid.
- "Amplification" → implies you're already doing well, the tool multiplies your capability
- Individual indicators ("your AI acceptance rate improved 12% this week") are more actionable than a composite score ("your score is 73")
- A composite can exist as a secondary rollup for trend-tracking

### 7. Data Aigon Has Today vs What's Missing

**Already available (no code changes needed):**

| Metric | Status | Source |
|--------|--------|--------|
| Feature throughput (count, trend, velocity) | ✅ Full | `05-done/` file count + timestamps |
| Cycle time (median, max, trend) | ✅ Full | `startedAt` + `completedAt` |
| Autonomy ratio (wait time / total time) | ✅ Full | Events array in log frontmatter |
| First-pass success rate | ✅ Full | Presence of `waiting` events |
| Autonomous mode adoption | ✅ Full | `--autonomous` flag in logs |
| Agent performance (win rates, autonomy, cycle time) | ✅ Full | Evaluation files + log metadata |
| Wait event count & duration | ✅ Full | Events array |
| Claude Code transcript token data | ✅ Available | `~/.claude/projects/` JSONL files |

**Missing — needs new work:**

| Metric | Effort | Value |
|--------|--------|-------|
| Token aggregation per feature | Low (~50 lines JS, SessionEnd hook) | High |
| Cost ($) per feature | Low (pricing table + token data) | High |
| Git commit count per branch | Low (one git command) | Medium |
| Lines changed per feature | Low (`git diff --stat`) | Medium |
| File churn / rework detection | Medium (commit pattern analysis) | Medium |
| Message/turn count per session | Medium (transcript parsing) | Medium |
| Spec quality score | High (needs rubric + analysis) | Low |
| Productive vs unproductive interactions | High (LLM classification) | Speculative |

### 8. AI-Powered Insights Layer

Beyond raw metrics, an LLM can analyse AADE data to generate actionable coaching — similar to Claude Code's `/insights` command, which reads 30 days of local session history and generates friction analysis, workflow recommendations, and CLAUDE.md suggestions.

**Insight categories for AADE:**

- **Pattern detection** (cross-feature): "Your last 5 features had increasing wait counts (2, 3, 4, 5, 7) — specs may be getting less detailed"
- **Outlier analysis**: "Feature #73 took 12.3 hours vs your median of 3.1 — it had 8 wait events compared to your average of 2.4"
- **Actionable recommendations**: "Consider autonomous mode for config-change features — your first-pass rate on those is 92%"
- **Comparative analysis**: "Agent CC completes features 1.8x faster than CU but with 15% lower first-pass success"
- **Weekly/monthly summaries**: Volume, best/worst feature, autonomy trend direction, cost trajectory

**Implementation approach (phased):**

| Phase | Approach | Cost | Notes |
|-------|----------|------|-------|
| **1. Rule-based CLI** | `aigon insights` — 5-10 hardcoded checks (trend detection, outliers, thresholds) against analytics JSON | $0 | Works offline, instant, no LLM needed |
| **2. LLM-narrated** | Send analytics JSON to Claude API with a "developer workflow coach" system prompt | ~$0.01-0.05/call (Haiku/Sonnet with prompt caching) | 3-5 actionable paragraphs, on-demand |
| **3. Dashboard tab** | "Insights" tab with cached results, "Refresh" button, visual trend indicators | API cost per refresh | Full integration with existing dashboard |

**Key design principle from Claude `/insights`:** No external tracking, purely local data, runs on-demand (not real-time), generates a static report. This validates the batch-on-demand approach over real-time analysis.

**Cadence (teamcadence.ai)** takes a similar approach — analyses AI session logs after each session, compares against best practices, gives coaching feedback. Privacy-first. Closest comparable product, but team-oriented.

The analytics JSON from `/api/analytics` is ~2-5KB for 30 features — easily fits in a single prompt. With prompt caching, the system prompt + analysis framework (~2K tokens) is cached at 90% discount, making repeated calls very cheap.

### 9. Commercial Potential

**AADE is a strong candidate for Aigon's commercial product offering.** The combination of AADE metrics + AI-powered insights creates a natural value tier:

- **Free tier (Aigon OSS):** Core workflow — feature lifecycle, Kanban board, agent orchestration, basic dashboard with throughput and cycle time
- **Commercial tier (AADE):** Token/cost tracking, git signal analysis, rework detection, amplification dashboard, AI-powered insights and coaching

**Why AADE works as a commercial gate:**
- It's a clear value-add on top of the core workflow, not a paywall on existing features
- The AI insights layer has per-call API costs that justify a subscription
- Every competitor in this space (DX, Cadence, LinearB, Swarmia, Jellyfish) charges for analytics/insights
- Individual developer positioning is differentiated — no competitor serves this niche
- The data collection (token capture, git signals) is open, but the analysis and coaching layer is the premium

**Note:** A separate research topic has been created (research-14) to investigate commercialisation strategy — when, how, and at what point to introduce the commercial gate.

## Sources

### AI Insights
- [How Claude Code's /insights Command Works](https://www.zolkos.com/2026/02/04/deep-dive-how-claude-codes-insights-command-works.html)
- [Claude Code /insights Review](https://www.natemeyvis.com/claude-codes-insights/)
- [Cadence — AI Session Quality](https://teamcadence.ai/)
- [AI-Driven Developer Productivity — DevActivity](https://devactivity.com/posts/productivity-tips/the-future-of-developer-productivity-ai-powered-efficiency-in-2026/)

### Token Efficiency & Data Availability
- [Claude Code Costs](https://code.claude.com/docs/en/costs) — `/cost`, `/stats`, `--max-budget-usd`, ~$6/dev/day average
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks) — 27 lifecycle events, `transcript_path` available in hook input
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference) — `--output-format json`, `--max-budget-usd`
- [Cursor Analytics](https://cursor.com/docs/account/teams/analytics) — no per-session token data

### Interaction Overhead & Git Signals
- [Anthropic: Measuring AI Agent Autonomy in Practice](https://www.anthropic.com/research/measuring-agent-autonomy) — millions of Claude Code interactions; autonomy spectrum
- [METR: Measuring Impact of Early-2025 AI on Developer Productivity](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/) — AI slowed experienced developers by 19%
- [METR 2026 Update](https://metr.org/blog/2026-02-24-uplift-update/) — updated methodology, still -18%
- [Pluralsight: Code Churn](https://www.pluralsight.com/resources/blog/software-development/code-churn) — churn = code rewritten within 3 weeks, 13-30% typical
- [Swimm: How to Measure Code Churn](https://swimm.io/learn/developer-experience/how-to-measure-code-churn-why-it-matters-and-4-ways-to-reduce-it)
- [MDPI: Assessing Interaction Quality in Human-AI Dialogue](https://www.mdpi.com/2504-4990/8/2/28)

### Competitive Landscape
- [DX AI Measurement Hub](https://getdx.com/blog/ai-measurement-hub/)
- [DX: 5 Metrics for AI Impact](https://getdx.com/blog/5-metrics-in-dx-to-measure-ai-impact/)
- [DX: Measuring AI Code Assistants and Agents](https://getdx.com/research/measuring-ai-code-assistants-and-agents/)
- [DX: Guide to DXI](https://getdx.com/blog/guide-to-developer-experience-index/)
- [DX: Q4 2025 AI Impact Report](https://getdx.com/blog/ai-assisted-engineering-q4-impact-report-2025/)
- [Cadence](https://teamcadence.ai/) — AI session quality analysis startup
- [LinearB 2026 Benchmarks](https://linearb.io/resources/software-engineering-benchmarks-report)
- [Swarmia: AI Adoption Metrics](https://help.swarmia.com/use-cases/measure-the-productivity-impact-of-ai-tools/ai-adoption-metrics)
- [Jellyfish 2025 AI Metrics Review](https://jellyfish.co/blog/2025-ai-metrics-in-review/)
- [Milestone TechCrunch](https://techcrunch.com/2025/11/13/milestone-raises-10m-to-make-sure-ai-rhymes-with-roi/)

### Frameworks
- [DORA 2025 Report](https://dora.dev/research/2025/dora-report/) — pivoted to AI; added rework rate as 5th metric
- [SPACE Framework](https://queue.acm.org/detail.cfm?id=3454124) — Satisfaction, Performance, Activity, Communication, Efficiency
- [DevEx Paper](https://queue.acm.org/detail.cfm?id=3595878) — feedback loops, cognitive load, flow state
- [DevEx in Age of AI — SSRN](https://papers.ssrn.com/sol3/Delivery.cfm/5316738.pdf?abstractid=5316738) — updated indicators for AI era
- [Nicole Forsgren on Lenny's Podcast](https://www.lennysnewsletter.com/p/how-to-measure-ai-developer-productivity) — "AI accelerates coding, but developers aren't getting that much more done"
- [AI Coding Productivity Statistics 2026](https://www.getpanto.ai/blog/ai-coding-productivity-statistics)
- [AI Coding Assistants ROI](https://www.index.dev/blog/ai-coding-assistants-roi-productivity)

## Recommendation

**Start with what's cheap and high-value.** Aigon already has the strongest interaction/autonomy metrics in the space. The highest-ROI next steps are:

1. **Add token/cost tracking via Claude Code SessionEnd hook.** The data is already in transcript JSONL files — just needs aggregation. This fills the biggest gap (cost per feature) with ~50 lines of JS.

2. **Add git signal aggregation at feature-close.** Commit count, lines changed, files touched, and fix-commit detection per feature branch. All one-liners against `git log`. Store in log frontmatter alongside existing metrics.

3. **Frame the dashboard section as "Amplification"** — individual indicators (cost trend, autonomy trend, first-pass rate, rework rate) under a motivating umbrella. No composite score initially; let the user see which indicators improve over time.

4. **Don't chase message-level interaction tracking.** The wait-event model is already a better signal. Transcript-level message counting adds complexity for marginal gain.

5. **Normalise token metrics by lines changed.** "Tokens per line changed" is the most practical efficiency ratio. Trend it over time with a rolling average.

The unique positioning: **Aigon is the only tool measuring individual AI development effectiveness as a personal optimisation tool.** Every competitor targets teams/orgs. Lean into this — and consider AADE as the foundation of a commercial offering (see Section 9).

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| session-token-capture | SessionEnd hook that parses Claude Code transcript JSONL and writes token totals (input, output, cache, cost) to feature log frontmatter | high | none |
| git-signal-aggregation | At feature-close, compute and store commit count, lines changed, files touched, and fix-commit ratio per feature branch | high | none |
| cost-per-feature-display | Dashboard cards showing cost ($) per feature with rolling average trend sparkline | high | session-token-capture |
| amplification-dashboard-section | New dashboard section grouping AADE metrics (cost trend, autonomy trend, first-pass rate, rework indicators) under "Amplification" framing | medium | cost-per-feature-display, git-signal-aggregation |
| token-normalisation | Compute and display tokens-per-line-changed ratio with trend over last N features | medium | session-token-capture, git-signal-aggregation |
| rework-detection | Analyse commit patterns per feature to flag thrashing (5+ commits same file), fix cascades (3+ fix commits), and scope creep | medium | git-signal-aggregation |
| aade-insights-rules | CLI command `aigon insights` with 5-10 rule-based checks (trend detection, outliers, thresholds) against analytics JSON — zero LLM cost | medium | amplification-dashboard-section |
| aade-insights-ai | LLM-narrated insights — send analytics JSON to Claude API with coaching system prompt, generate 3-5 actionable paragraphs on demand | medium | aade-insights-rules |
| aade-insights-dashboard | Dashboard "Insights" tab with cached results, refresh button, and visual trend indicators | medium | aade-insights-ai |
| autonomy-spectrum-labels | Replace raw autonomy ratio with human-readable labels (Full Autonomy / Light Touch / Guided / Collaborative / Thrashing) on dashboard | low | none |
| cursor-session-proxy | For Cursor-implemented features, estimate interaction overhead from log wait events since per-session token data is unavailable | low | none |
