# Research Findings: AI-Native Workflow Metrics (Inner Loop)

**Agent:** Claude (cc)
**Research ID:** 19
**Date:** 2026-03-23

---

## Metric 1: Persistence Rate / Code Survival

### Definition

The percentage of AI-generated code lines that remain unchanged in the codebase after a defined time window. Measures whether AI output "sticks" or gets churned away through reverts, rewrites, or gradual replacement.

**Formula:** `Persistence Rate = (AI lines surviving at T) / (AI lines originally committed) * 100`

### Measurement Methodology

**Technical approach — git-based tracking:**
1. **Attribution**: Tag commits as AI-authored vs human-authored. Tools like [Git AI](https://usegitai.com/) store AI attribution in git notes, surviving rebases, squashes, and cherry-picks. Alternative: convention-based (commits from agent worktrees, `Co-Authored-By` trailer parsing, or branch naming like `feature-NNN-agent-*`).
2. **Survival tracking**: At each time window (T+24h, T+7d, T+sprint), run `git blame` on files touched by AI commits and count how many original AI-authored lines remain.
3. **Churn detection**: Compare the diff between the AI commit and the state of those same files at T+N. Lines that were deleted, modified, or moved count as "churned."

**Time windows (recommended hierarchy):**
- **T+24h**: Immediate rejection signal — code that doesn't survive a day was likely wrong
- **T+7d (1 week)**: Post-review survival — captures human review and integration edits
- **T+sprint (2 weeks)**: Operational survival — captures bugs found during testing/QA
- **T+30d**: Long-term durability — the "real" persistence rate

### Data Sources Needed
- Git history with AI attribution (commit metadata, git notes, or branch conventions)
- Periodic `git blame` snapshots or diff analysis
- Feature/PR lifecycle timestamps from Aigon manifests

### Published Benchmarks

**GitClear (2025 report, 211M lines analyzed):**
- Code churn (new code revised within 2 weeks) rose from 3.1% in 2020 to 5.7% in 2024
- Total churn including all revisions: 5.5% (2020) to 7.9% (2024)
- Correlation between AI tool adoption and churn: Pearson r = 0.98
- Refactoring dropped from 25% to under 10% of changed lines (2021-2024), suggesting AI code gets replaced wholesale rather than improved

**SWE-CI Benchmark (March 2026, Alibaba):**
- 75% of AI coding agents break previously working code during long-term maintenance
- Only Claude Opus models exceeded a 50% zero-regression rate
- Each task spans ~233 days and 71 consecutive commits — testing true persistence

### Pros
- Directly answers "is AI helping or creating rework?"
- Uses existing git infrastructure — no new tooling required for basic version
- Correlates well with code quality (low persistence = low quality)
- Actionable: low persistence on specific tasks/agents drives improvement

### Cons
- Attribution is imperfect — mixed commits (human edits on AI code) blur the line
- Legitimate refactoring looks like churn (false negative for quality)
- Time-delayed signal — you don't know persistence rate until the window closes
- Doesn't distinguish "code was wrong" from "requirements changed"

### Sources
- [GitClear AI Code Quality 2025 Report](https://www.gitclear.com/ai_assistant_code_quality_2025_research)
- [GitClear 2025 PDF (full report)](https://gitclear-public.s3.us-west-2.amazonaws.com/GitClear-AI-Copilot-Code-Quality-2025.pdf)
- [GitClear 2026 Research Resources](https://www.gitclear.com/developer_ai_productivity_analysis_tools_research_2026)
- [SWE-CI Benchmark Paper](https://arxiv.org/html/2603.03823v3)
- [Git AI — AI code attribution tool](https://usegitai.com/)
- [AgentBlame — AI code attribution for git](https://github.com/mesa-dot-dev/agentblame)
- [Jonas.rs GitClear Report Summary](https://www.jonas.rs/2025/02/09/report-summary-gitclear-ai-code-quality-research-2025.html)

---

## Metric 2: AI Edit Distance

### Definition

The magnitude of human modifications applied to AI-generated code before it reaches its final committed/merged state. Measures the "gap" between what the AI produced and what actually shipped.

**Formula:** `Edit Distance = normalized_diff(AI_original_output, human_final_version)`

### Measurement Methodology

**Technical approaches (from simplest to most sophisticated):**

1. **Line-level diff ratio**: `% lines changed = (added + deleted + modified lines) / total AI output lines`. Simple, uses standard `git diff`. Aigon can compute this between the agent's commit and the merge commit.

2. **Levenshtein / character-level edit distance**: Character-by-character comparison. More precise but noisy for code (renaming a variable = large distance, small semantic change).

3. **Compression-based edit distance (CBED)**: A novel metric from [arXiv:2412.17321](https://arxiv.org/abs/2412.17321) based on the Lempel-Ziv-77 algorithm. Designed specifically to measure post-editing effort on LLM-generated text. Key advantage: highly correlated with actual edit time and effort, and handles block operations (moving/copying code blocks) that fool traditional edit distance. Linear computational complexity.

4. **Semantic diff**: AST-based comparison that ignores whitespace, formatting, variable names. Harder to implement but captures meaningful changes only. Tools like `tree-sitter` can parse most languages.

**What to compare:**
- Agent's final commit on the feature branch vs. the merge commit on main (captures review edits)
- Agent's raw output vs. agent's committed output (captures agent self-correction)
- First agent commit vs. final pre-merge state (captures full iteration)

**Normalization:**
- As percentage of total lines (0% = shipped as-is, 100% = fully rewritten)
- Bucketed: "no change", "minor edits (<10%)", "significant rework (10-50%)", "rewrite (>50%)"

### Data Sources Needed
- Agent commit SHAs (from Aigon manifests)
- Merge/squash commit SHAs
- Git diff between the two
- Optionally: AST parser for semantic diff

### Published Benchmarks

**CodeRabbit (December 2025, 470 PRs analyzed):**
- AI-generated PRs contain 1.7x more issues than human PRs (10.83 vs 6.45 issues per PR)
- AI PRs have 1.4x more critical issues and 1.7x more major issues
- Logic/correctness errors: 1.75x more in AI code
- Security findings: 1.57x more (XSS vulnerabilities 2.74x more common)

**Human-AI Synergy in Agentic Code Review (arXiv:2603.15911, 278,790 conversations):**
- Human reviewer suggestions adopted 56.5% of the time vs AI agent suggestions at 16.6%
- Over half of unadopted AI suggestions are incorrect or addressed through alternative fixes
- When AI suggestions are adopted, they produce larger code complexity increases

**Compression-Based Edit Distance paper (arXiv:2412.17321):**
- Traditional metrics (Levenshtein, BLEU, TER) correlate poorly with actual editing effort
- CBED achieves high correlation with human edit time across real-world datasets
- Especially effective for block-level operations common in code editing

### Pros
- Direct measure of AI output quality from the developer's perspective
- Can identify which types of tasks AI handles well vs. poorly
- Useful for comparing agents/models (lower edit distance = better fit)
- Computable from existing git history — no new instrumentation for basic version

### Cons
- Formatting/style changes inflate the metric (semantic diff mitigates this)
- Doesn't distinguish "human improved it" from "human fixed it"
- Merge strategies (squash, rebase) can obscure the original AI output
- Requires careful baseline — some human editing is expected and healthy

### Sources
- [Assessing Human Editing Effort via Compression-Based Edit Distance](https://arxiv.org/abs/2412.17321)
- [Human-AI Synergy in Agentic Code Review](https://arxiv.org/html/2603.15911)
- [CodeRabbit: AI vs Human Code Generation Report](https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report)
- [HAI-Eval: Measuring Human-AI Synergy in Collaborative Coding](https://arxiv.org/abs/2512.04111)

---

## Metric 3: Prompt Efficiency / Cognitive Compile Time

### Definition

The number of iterations (conversation turns, tool calls, agent sessions) required to converge on a working solution. Measures how efficiently the human-AI collaboration produces correct output — the "cognitive compile time" before the code "runs clean."

**Formula:** `Prompt Efficiency = successful_outcome / total_iterations` (higher = better)
**Alternative:** `Cognitive Compile Time = total turns or sessions until passing tests/review`

### Measurement Methodology

**Proxy metrics (from least to most invasive):**

1. **Session count per feature**: Number of distinct agent sessions (Aigon already tracks this in manifests). A feature requiring 1 session is more efficient than one requiring 5. No new instrumentation needed.

2. **Turn count per session**: Number of human prompts within a single agent session. Requires agent transcript access or session-level metadata. Claude Code exposes this in session data.

3. **Tool call count**: Total tool invocations (file reads, edits, test runs, web searches) per feature. Higher counts may indicate exploration/confusion. Available from agent transcripts.

4. **Retry/error count**: Number of failed test runs, linting errors, or build failures the agent encounters before success. Direct signal of iteration quality.

5. **Token consumption**: Total tokens (input + output) per feature. Rough proxy for "effort" — a feature consuming 500K tokens vs 50K tokens suggests very different efficiency levels.

**Measurement without being invasive:**
- Aigon already tracks session start/end times and agent status transitions
- Token counts can be extracted from agent billing/usage data
- Turn counts require either agent API access or post-hoc transcript analysis
- The key is to measure at the session/feature level, not individual keystrokes

**Benchmarking interaction patterns:**
- Anthropic's eval framework recommends `pass@k` (at least 1 success in k attempts) and `pass^k` (all k attempts succeed) as complementary metrics
- For agent evals, starting with 20-50 real-world task traces provides statistically meaningful signal
- Track transcript/trace separately from outcome to understand process vs result

### Data Sources Needed
- Agent session metadata (start time, end time, status) — already in Aigon manifests
- Session turn/message counts — requires agent transcript access
- Tool call logs — from agent session data
- Test execution results with timestamps — from CI or agent logs
- Token usage data — from agent API billing

### Published Benchmarks

**Anthropic "Demystifying Evals for AI Agents":**
- `pass@k`: Probability of at least 1 correct solution in k attempts (rises with k)
- `pass^k`: Probability that ALL k trials succeed (falls with k — measures consistency)
- Recommended starting point: 20-50 tasks drawn from real failures
- Each change early in development has large, noticeable effect — small samples suffice

**HAI-Eval Benchmark (arXiv:2512.04111, 45 participants):**
- Standalone LLMs achieve 0.67% pass rate on collaboration-necessary tasks
- Unaided humans achieve 18.89%
- Human-AI collaboration achieves 31.11%
- Strategic breakthroughs can originate from either humans or AI

**Industry signals:**
- Portkey.ai reports teams using structured prompt testing cut iteration cycles by up to 75%
- No published benchmarks yet for "turns per feature" in AI-native development — this is a gap Aigon could fill

### Pros
- Directly measures collaboration efficiency — the core value proposition of AI-assisted development
- Multiple proxy metrics available at different instrumentation costs
- Trend over time shows whether the team is getting better at working with AI
- Comparable across agents/models (which agent converges faster?)

### Cons
- "Fewer turns" isn't always better — complex tasks legitimately need more iteration
- Hard to normalize across task complexity (a bug fix vs. a new feature)
- Turn count doesn't capture thinking time between turns (the human's cognitive load)
- Token count penalizes verbose but correct responses
- No established industry benchmarks for comparison yet

### Sources
- [Anthropic: Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [HAI-Eval: Measuring Human-AI Synergy](https://arxiv.org/abs/2512.04111)
- [Portkey: Evaluating Prompt Effectiveness](https://portkey.ai/blog/evaluating-prompt-effectiveness-key-metrics-and-tools/)
- [IBM: Prompt Optimization](https://www.ibm.com/think/topics/prompt-optimization)

---

## Metric 4: Prompt-to-PR Latency

### Definition

Elapsed wall-clock time from initial intent (feature creation / first prompt) to a submitted, review-ready pull request. The AI-native equivalent of "cycle time" but with different phase boundaries.

**Formula:** `Prompt-to-PR Latency = timestamp(PR submitted) - timestamp(intent expressed)`

### How It Differs from Traditional Cycle Time

Traditional cycle time measures "first commit to deploy" or "ticket started to ticket done." Prompt-to-PR Latency differs in three key ways:

1. **Clock start is earlier**: Includes the ideation/prompting phase where humans describe intent to AI, which is a new phase that didn't exist in traditional workflows
2. **The "implementation" phase is compressed**: AI can generate code in minutes, but validation takes longer
3. **New bottlenecks emerge**: Context-building, prompt iteration, and AI output validation replace typing as the primary time sinks

### Where the Clock Starts (Options)

| Anchor Point | When to Use | Pros | Cons |
|---|---|---|---|
| Feature spec creation | Aigon feature lifecycle | Captures full lifecycle | Includes idle time before work starts |
| First agent session start | First active work | Clean signal, measurable | Misses planning/spec time |
| First human prompt in session | Most precise intent | True "intent to output" | Requires transcript access |

**Recommendation**: Use "first agent session start" as the primary anchor (Aigon already tracks this), with "feature creation" as a secondary total-lifecycle metric.

### Meaningful Sub-Phases

1. **Spec-to-Session** (ideation): Feature creation to first agent session start. Measures planning/prioritization latency.
2. **Session-to-Commit** (implementation): First agent session to first meaningful commit. Measures AI generation speed.
3. **Commit-to-Tests-Pass** (validation): First commit to all tests passing. Measures first-pass quality.
4. **Tests-to-PR** (packaging): Tests passing to PR submitted. Measures review-readiness overhead.
5. **PR-to-Merge** (review): PR submitted to merged. Measures review bottleneck.

### Data Sources Needed
- Feature creation timestamps — already in Aigon spec metadata
- Agent session start/end — already in Aigon manifests
- Commit timestamps — from git
- CI/test pass timestamps — from CI system or agent logs
- PR creation and merge timestamps — from GitHub API

### Published Benchmarks

**Greptile State of AI Coding 2025:**
- Median PR size grew 33% (57 to 76 lines) from March to November 2025
- Per-developer code output grew from 4,450 to 7,839 lines
- But no published "time from prompt to PR" benchmarks exist yet

**DORA Report 2025 (AI-Assisted Software Development):**
- AI compresses the front end of the process (code generation) but lead time includes the full path to production
- Reviews, tests, and sign-offs still take time — sometimes longer with AI output
- AI increases PR size by 154% (Faros AI telemetry), which may slow reviews
- 75% of engineers use AI tools but most organizations see no measurable delivery performance gains
- Working in small batches amplifies AI's positive effects on product performance

**Key insight**: The bottleneck has shifted from "writing code" to "validating code." Prompt-to-PR Latency captures this shift; traditional cycle time does not.

### Pros
- Captures the full AI-native workflow, including new phases (prompting, validation)
- Sub-phases reveal specific bottlenecks (is validation the problem? review?)
- Aigon already has most required timestamps — low instrumentation cost
- Directly comparable across features, agents, and developers
- Compelling dashboard metric

### Cons
- Wall-clock time includes idle periods (nights, weekends, context switches)
- Doesn't account for task complexity — a 5-minute bug fix vs. a 3-day feature
- PR size and scope vary widely, making cross-feature comparison noisy
- "Clock start" definition is debatable and affects the metric significantly

### Sources
- [Greptile: State of AI Coding 2025](https://www.greptile.com/state-of-ai-coding-2025)
- [DORA: State of AI-Assisted Software Development 2025](https://dora.dev/research/2025/dora-report/)
- [Faros AI: DORA Report 2025 Key Takeaways](https://www.faros.ai/blog/key-takeaways-from-the-dora-report-2025)
- [Plandek: DORA Metrics in the Age of AI 2026](https://plandek.com/blog/how-to-measure-dora-metrics-in-the-age-of-ai-2026/)
- [CodeRabbit: 2026 Will Be the Year of AI Quality](https://www.coderabbit.ai/blog/2025-was-the-year-of-ai-speed-2026-will-be-the-year-of-ai-quality)

---

## Metric 5: First-Pass Success Rate

### Definition

The percentage of AI-generated code submissions that pass all tests, linting, and CI checks on the first attempt without human intervention. Measures the reliability and correctness of AI output.

**Formula:** `First-Pass Success Rate = (PRs/commits passing CI on first run) / (total AI PRs/commits) * 100`

### Measurement Methodology

**What counts as "first pass":**
- Agent generates code and submits/commits
- CI pipeline runs (tests, lint, type check, build)
- If ALL checks pass on the first run = success
- Any failure requiring re-prompting, human edits, or agent retry = failure

**Granularity levels:**
1. **Commit-level**: Does each individual AI commit pass CI? (Strictest)
2. **PR-level**: Does the PR pass CI when first opened? (Most practical)
3. **Feature-level**: Does the feature pass end-to-end validation on first attempt? (Broadest)

**What to track:**
- CI status on first run per AI-authored PR/commit
- Type of failure (test, lint, build, type error)
- Number of iterations to achieve green CI
- Time from first failure to green CI

### Data Sources Needed
- CI/CD pipeline results with timestamps — GitHub Actions, etc.
- Commit/PR attribution (AI vs human) — from Aigon manifests or commit metadata
- Test execution logs — for failure categorization
- Agent retry/iteration counts — from session data

### Published Benchmarks

**SWE-bench (industry standard for AI coding evaluation):**
- Devin (Cognition, 2024): 13.86% resolution rate on SWE-bench (vs 1.96% previous best)
- Claude 3.7 Sonnet (Feb 2025): 62.3% on SWE-bench Verified
- Top models on SWE-bench Pro (Scale Labs, 2025-2026): scores range from ~30% to ~65%
- Note: SWE-bench measures "can the AI solve the issue at all," not strictly "first-pass CI success"

**SWE-CI Benchmark (March 2026, 100 tasks from real Python repos):**
- Tests long-term maintenance, not just one-shot fixes
- 75% of AI agents break previously working code — even when initial patches pass tests
- Zero-regression rates: most models below 0.25, Claude Opus 4.5 at 0.51, Claude Opus 4.6 at 0.76
- This is the most relevant benchmark for "first-pass success in context" — passing tests today but breaking code tomorrow

**CodeRabbit Report (December 2025):**
- AI-generated code produces 1.7x more issues than human code
- AI PRs: 10.83 issues on average vs. 6.45 for human PRs
- Excessive I/O operations 8x more common in AI code

**Failed AI PRs on GitHub (arXiv:2601.15195, 33K agent-authored PRs):**
- CI/test failure observed in 17% of failed PRs
- Documentation, CI, and build-update tasks have highest merge success
- Performance and bug-fix tasks perform worst
- Larger code changes and more files touched correlate with lower success

### Pros
- Binary, objective metric — no subjectivity in "did CI pass?"
- Fast feedback loop — know within minutes of submission
- Directly actionable — failure categories guide agent improvement
- Comparable across agents, models, and task types
- Aligns with SWE-bench methodology — familiar to the industry

### Cons
- Depends heavily on test coverage — no tests = 100% "success" (misleading)
- Doesn't measure code quality, only correctness against existing tests
- CI configuration varies across projects — not easily comparable across repos
- First-pass success on trivial tasks inflates the metric
- SWE-CI shows first-pass success can be misleading — code may pass now but cause regressions later

### Sources
- [SWE-CI: Evaluating Agent Capabilities via Continuous Integration](https://arxiv.org/html/2603.03823v3)
- [Cognition: SWE-bench Technical Report (Devin)](https://cognition.ai/blog/swe-bench-technical-report)
- [SWE-bench Verified Leaderboard (Epoch AI)](https://epoch.ai/benchmarks/swe-bench-verified)
- [Scale Labs: SWE-Bench Pro Leaderboard](https://labs.scale.com/leaderboard/swe_bench_pro_public)
- [Where Do AI Coding Agents Fail? (arXiv:2601.15195)](https://arxiv.org/abs/2601.15195)
- [CodeRabbit: AI vs Human Code Generation Report](https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report)
- [Why Are AI Agent PRs Unmerged? (arXiv:2602.00164)](https://arxiv.org/abs/2602.00164)

---

## Cross-Cutting Observations

### The Metrics Reinforce Each Other

These five metrics form a coherent picture when used together:

| Scenario | Persistence | Edit Distance | Prompt Efficiency | PR Latency | First-Pass |
|---|---|---|---|---|---|
| AI is working well | High (>90%) | Low (<10%) | High (1-2 sessions) | Low | High (>80%) |
| AI generates plausible but wrong code | Medium | High (>30%) | Low (many retries) | High | Low |
| AI is misaligned with codebase | Low (<70%) | High | Low | High | Low |
| Good AI + slow review process | High | Low | High | High (review phase) | High |

### What's Missing from Industry

1. **No standard "turns per feature" benchmark** — Aigon could be first to publish this
2. **No tool tracks full prompt-to-merge lifecycle** — most tools measure code gen OR review, not the full arc
3. **Persistence rate is under-studied** — GitClear measures churn generally, but nobody measures AI-specific persistence at the feature level
4. **Edit distance for code has no standard** — the compression-based metric from arXiv is promising but not adopted

### Implementation Priority for Aigon

| Metric | Data Available Today | New Instrumentation | Insights Value |
|---|---|---|---|
| Prompt-to-PR Latency | Mostly (timestamps in manifests) | PR creation timestamp | High — compelling dashboard |
| First-Pass Success Rate | Partial (agent session outcomes) | CI integration | High — actionable |
| Persistence Rate | Git history exists | Attribution + periodic analysis | High — unique differentiator |
| Prompt Efficiency | Session counts exist | Turn/token counts from agents | Medium — needs agent API |
| AI Edit Distance | Git diffs available | Semantic diff tooling | Medium — complex to normalize |

## Recommendation

**Start with Prompt-to-PR Latency and First-Pass Success Rate** — they require the least new instrumentation, produce the most actionable insights, and map directly to Aigon's existing data model (feature specs, manifests, git history).

**Add Persistence Rate as the flagship "unique" metric** — no other tool measures AI code survival at the feature level. This is the strongest differentiator for Aigon's insights dashboard.

**Defer AI Edit Distance and Prompt Efficiency** until agent transcript/API access is standardized — these provide valuable signal but require deeper instrumentation.

## Competitive Landscape Analysis

### Tool-Level Metrics Offerings

#### GitHub Copilot (GA February 2026)

GitHub's metrics system provides a centralized dashboard and REST API.

**Metrics tracked:**
- Acceptance rate (ratio of accepted lines/suggestions to total suggested; GitHub reports 88% of accepted code retained in final submissions)
- Total suggestions and total acceptances (raw counts)
- Lines suggested vs lines accepted
- Daily/weekly active users across IDE modes including agent mode
- Adoption rate (active users / licensed users)
- Code generation dashboard (lines suggested, added, deleted across completions, chat, agent)
- Language and model breakdown

**How measured:** Server-side telemetry from Copilot extension. API at `/copilot/copilot-metrics`. Even if accepted code is later deleted, it is still logged as accepted.

**Notable gap:** No persistence/retention metric. Community has requested this but it is not available. This is the single biggest metric Aigon can offer that Copilot cannot.

**Scale:** 15M+ users by early 2025, 4.7M paid subscribers by January 2026 (75% YoY growth).

Sources:
- [GitHub Copilot Usage Metrics Docs](https://docs.github.com/en/copilot/concepts/copilot-usage-metrics/copilot-metrics)
- [Copilot Metrics GA Changelog](https://github.blog/changelog/2026-02-27-copilot-metrics-is-now-generally-available/)
- [Lines of Code Metrics](https://docs.github.com/en/copilot/reference/copilot-usage-metrics/lines-of-code-metrics)
- [Copilot Metrics API](https://docs.github.com/en/rest/copilot/copilot-metrics)
- [Microsoft Copilot Metrics Dashboard (OSS)](https://github.com/microsoft/copilot-metrics-dashboard)

#### Cursor (Team Analytics)

Full IDE control gives Cursor deeper editor-level data than extension-based tools.

**Metrics tracked:**
- AI suggestions shown vs accepted (acceptance rate)
- Lines added, lines deleted, accepted lines added, accepted lines deleted (real-time editor tracking)
- AI tabs opened vs accepted
- Chat total accepts
- Active users (WAU/MAU)
- Model usage breakdown
- User spending / cost tracking

**How measured:** Editor instrumentation, Admin API (`/api/dashboard/analytics`), near real-time. 90-day max date range per request.

**Scale:** ~1M DAU (2025), $2B ARR by February 2026. Billions of completions daily.

Sources:
- [Cursor Analytics Docs](https://cursor.com/docs/account/teams/analytics)
- [Cursor Analytics API](https://cursor.com/docs/account/teams/analytics-api)
- [Cursor AI Code Tracking API](https://cursor.com/docs/account/teams/ai-code-tracking-api)

### Engineering Intelligence Platforms

#### LinearB — 2026 Software Engineering Benchmarks Report

Based on 8.1M+ PRs across 4,800 teams in 42 countries. Includes 3 new AI-specific metrics.

**Key AI findings:**
- AI PRs wait 4.6x longer before review, but are reviewed 2x faster once picked up
- AI-generated PRs show 1.7x more issues than manual PRs
- AI PR acceptance rates: 32.7% vs 84.4% for manual PRs
- 92% of developers use AI assistants, claiming 25% productivity boosts

**Metrics:** Cycle Time, Deploy Frequency, PR Size, Change Failure Rate, Rework Rate, Planning Accuracy, plus new AI-specific segments for delivery velocity, code quality, and team health impact.

Sources:
- [LinearB 2026 Benchmarks Report](https://linearb.io/resources/software-engineering-benchmarks-report)
- [LinearB Gen AI Code Report](https://linearb.io/resources/measuring-impact-the-genai-code-report)

#### Jellyfish — AI Impact Dashboard

Vendor-agnostic platform supporting Copilot, Cursor, Claude Code, Amazon Q, Gemini Code Assist, Windsurf, CodeRabbit, plus agentic tools (Devin, Copilot Agent, Google Jules).

**Key data:**
- PRs per engineer increased 113% (1.36 to 2.9) as AI adoption goes from 0% to 100%
- 90% of teams use AI coding tools (up from 61% one year prior)
- Only 20% of teams use engineering metrics to measure AI impact
- Connects AI usage/spend to throughput, cycle time, code quality, cost efficiency

Sources:
- [Jellyfish AI Impact Dashboard](https://jellyfish.co/platform/jellyfish-ai-impact/)
- [2025 AI Metrics in Review](https://jellyfish.co/blog/2025-ai-metrics-in-review/)
- [2025 State of Engineering Management Report](https://jellyfish.co/resources/2025-state-of-engineering-management-report/)

#### DX — AI Measurement Framework

Created by the researchers behind DORA and SPACE. Three-dimension framework:

1. **Utilization:** DAU/WAU, % PRs AI-assisted, % committed code AI-generated, tasks assigned to agents
2. **Impact:** AI-driven time savings, developer satisfaction (CSAT), correlations to DX Core 4, human-equivalent hours from agents
3. **Cost:** ROI of AI spend, cost efficiency per feature

**Published benchmarks (Q4 2025, 135K+ developers, 266 companies):**
- 91% AI adoption
- 3.6 hours saved weekly per developer
- 22% of committed code is AI-authored
- DXI: every 1-point increase saves ~13 min/dev/week (~10 hours annually)

Sources:
- [DX AI Measurement Framework](https://getdx.com/whitepaper/ai-measurement-framework/)
- [5 Metrics for AI Impact](https://getdx.com/blog/5-metrics-in-dx-to-measure-ai-impact/)
- [Q4 2025 AI Impact Report](https://getdx.com/blog/ai-assisted-engineering-q4-impact-report-2025/)

#### Other Platforms

- **Swarmia:** Targets Copilot/Cursor adoption analytics. Raised $11M Series A (June 2025). SPACE + DORA + AI tool integrations.
- **Hivel:** AI-native engineering intelligence. Expanded metrics guides for Copilot and Cursor. Prescriptive insights and predictive forecasting.
- **Pluralsight Flow:** Acquired by Appfire (February 2025). DORA metrics, cycle time, deployment frequency. No significant AI-specific metrics — falling behind.

### DORA 2025 — AI-Specific Adaptations

The 2025 DORA report pivoted entirely to AI-assisted software development.

**Metric changes:**
- **Rework Rate added** as new metric: proportion of unplanned deployments to fix user-visible issues
- **MTTR renamed** to "Failed Deployment Recovery Time," moved from stability to throughput
- **Reorganized** into 3 throughput metrics (deployment frequency, lead time, rework rate) and 2 instability metrics (change failure rate, failed deployment recovery time)

**AI findings:**
- AI adoption positively correlates with throughput (teams ship faster)
- But acceleration correlates with higher instability (more change failures, increased rework, longer recovery)
- AI acts as an "amplifier" — magnifies strengths of high performers AND dysfunctions of struggling teams

**DORA AI Capabilities Model — 7 practices:**
1. Clear and communicated AI stance
2. Healthy data ecosystems
3. AI-accessible internal data
4. Strong version control practices
5. Working in small batches
6. User-centric focus
7. Quality internal platforms

Sources:
- [DORA 2025 Report](https://dora.dev/research/2025/dora-report/)
- [DORA AI Capabilities Model](https://cloud.google.com/resources/content/2025-dora-ai-capabilities-model-report)
- [Faros AI Analysis](https://www.faros.ai/blog/key-takeaways-from-the-dora-report-2025)
- [IT Revolution Analysis](https://itrevolution.com/articles/ais-mirror-effect-how-the-2025-dora-report-reveals-your-organizations-true-capabilities/)

### SPACE Framework Status

No formal "SPACE 2.0 for AI" publication exists. However:
- DX (the platform) was built by the SPACE researchers and the DX AI Measurement Framework is effectively its spiritual successor
- Engineering leaders increasingly pair SPACE + DORA + DevEx Framework for complete coverage
- SPACE remains the human-factors complement to DORA's delivery metrics

### Academic Research

#### METR Randomized Controlled Trial (July 2025)

The most rigorous study to date. 16 experienced OSS developers (avg 5 years on their repos, repos avg 22k+ stars), 246 tasks randomly assigned AI-allowed or AI-disallowed.

**Key finding: AI made experienced developers 19% SLOWER** (CI: +2% to +39%).

**Critical insight:** Developers estimated they were 20% faster with AI — wrong about the direction by ~40 percentage points.

Follow-up study (late 2025) encountered selection bias: developers refused to work without AI, biasing results.

Sources:
- [METR Study](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/)
- [METR Late-2025 Update](https://metr.org/blog/2026-02-24-uplift-update/)
- [arxiv Paper](https://arxiv.org/abs/2507.09089)

#### Code Survival Analysis (2025-2026)

Survival analysis of 200,000+ code units from 201 open-source projects.

**Finding:** AI-authored code persists 16% longer than human code (15.8 pp lower modification rate). Challenges the assumption that AI code is quickly discarded. However, may reflect that AI code is less likely to be refactored (consistent with GitClear's refactoring decline).

Source: [Will It Survive? arxiv paper](https://arxiv.org/pdf/2601.16809)

#### GitClear (211M lines analyzed, 2020-2024)

- Refactoring rate: 25% (2021) to under 10% (2024)
- Code cloning: 8.3% to 12.3%; duplicated blocks rose 8x in 2024
- Code churn (revised within 2 weeks): 5.5% (2020) to 7.9% (2024)
- Legacy refactoring: code revised after 1+ month dropped from 30% to 20%

### What Engineering Leaders Want

Consensus across DX, Jellyfish, Swarmia, and industry analysis:

1. **ROI of AI tools** — connect spend to delivery outcomes (the #1 ask)
2. **Quality impact** — is AI causing more bugs, rework, incidents?
3. **Adoption depth** — not "who has it installed" but "who uses it effectively"
4. **Time savings** — where is time recovered, and is it reinvested?
5. **Review bottleneck visibility** — AI generates faster than humans review

**Anti-patterns to avoid:** Lines of code, commit count, hours worked (vanity metrics). AI vendor self-reported metrics (conflict of interest). Velocity without quality context.

**Key DX insight:** "Once engineers get good with AI, they ask more and better questions about requirements, which can make cycle times look longer." Naive metric interpretation misleads.

Sources:
- [DX: How to Measure AI Impact](https://getdx.com/blog/ai-measurement-hub/)
- [DX: Measuring AI Code Assistants and Agents](https://getdx.com/research/measuring-ai-code-assistants-and-agents/)
- [Swarmia: Measuring AI Productivity Impact](https://www.swarmia.com/blog/productivity-impact-of-ai-coding-tools/)

### Competitive Landscape Summary

| Platform | AI-Specific Metrics | Data Source | Unique Angle |
|----------|-------------------|-------------|--------------|
| **GitHub Copilot** | Acceptance rate, lines suggested/accepted, DAU, adoption | IDE extension telemetry | Largest dataset; self-reported by vendor |
| **Cursor** | Suggestions/accepted, lines added/deleted, chat accepts, spend | Full IDE instrumentation | Deepest editor-level data |
| **DX** | Utilization/impact/cost framework, time savings, AI-authored % | Surveys + system metrics | Most rigorous research-backed framework |
| **Jellyfish** | AI usage vs throughput/cycle time/quality, ROI | Multi-vendor aggregation | Vendor-agnostic, business outcome focus |
| **LinearB** | AI PR review delays, AI PR issue rate, AI vs manual acceptance | Git/PR analysis at scale | Largest PR dataset (8.1M), benchmarking |
| **Swarmia** | Copilot/Cursor adoption, DORA+SPACE | Git + AI tool APIs | Lightweight, developer-friendly |
| **Hivel** | Expanded Copilot/Cursor metrics, prescriptive | Multi-source aggregation | AI-native from inception |
| **GitClear** | Churn, clone growth, refactoring decline, code age | Git diff analysis | Quality focus, long-term trends |
| **DORA** | Rework rate (new), amplifier effect, 7 capabilities | Survey + system metrics | Industry standard, Google-backed |
| **Aigon (proposed)** | Persistence, edit distance, session efficiency, prompt-to-PR | CLI orchestrator + git + agent sessions | Workflow-native; sees what no other tool sees |

### The Gap Aigon Fills

No existing tool measures from the **workflow orchestrator** vantage point. They measure from:
- The IDE (Copilot, Cursor) — suggestion-level
- Git/PR analysis (LinearB, GitClear) — commit-level
- Surveys (DX, DORA) — self-reported
- Multi-vendor aggregation (Jellyfish) — correlation-level

Aigon uniquely sees: feature lifecycle (spec to completion), agent session timing and iterations, worktree creation/destruction, state transitions and triggers, multi-agent coordination, and the full prompt-to-merge arc. This is the orchestration layer that sits between developer intent and AI execution — a blind spot for every other tool.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| metric-prompt-to-pr-latency | Track and display elapsed time from feature creation through PR submission with sub-phase breakdown | high | none |
| metric-first-pass-success | Track CI pass/fail on first submission for AI-authored PRs and display success rate trends | high | none |
| metric-persistence-rate | Periodic git blame analysis measuring AI code survival at T+24h, T+7d, T+sprint windows | high | metric-ai-attribution |
| metric-ai-attribution | Tag commits as AI-authored vs human-authored using git notes, commit metadata, or branch conventions | high | none |
| metric-edit-distance | Compute normalized diff between agent output and final merged code per feature | medium | metric-ai-attribution |
| metric-prompt-efficiency | Track session count, turn count, and token usage per feature as proxy for iteration efficiency | medium | none |
| insights-dashboard-metrics | Insights dashboard panel displaying metric trends, comparisons, and anomaly alerts | high | metric-prompt-to-pr-latency, metric-first-pass-success |

---

# Part 2: Quality Metrics & Business/Value Metrics (Deep Research)

*Added 2026-03-23 — deep-dive findings on the 7 metrics requested: AI bug density, rework rate, review quality, test coverage depth, token-to-value ratio, autonomous resolution rate, and developer time saved.*

---

## Metric 6: AI-Generated Bug Density

### Definition

The rate of defects (bugs, security vulnerabilities, logic errors) in AI-authored code compared to human-authored code, normalized per PR or per KLOC.

### Attribution — How to Tell AI Code from Human Code

**Tools and approaches:**
- **Co-authored-by trailers:** Aigon already uses these on agent commits — the simplest attribution signal available today.
- **[Git AI](https://usegitai.com/):** Open-source git extension. On commit, processes checkpoints into an Authorship Log linking line ranges to agent sessions, attached via Git Notes. Survives rebases, squashes, cherry-picks.
- **[AgentBlame](https://github.com/mesa-dot-dev/agentblame):** CLI + GitHub browser extension. Automatic tracking with Cursor, Claude Code, OpenCode. Shows which lines were written by AI in any file.
- **[BlamePrompt](https://github.com/Ekaanth/blameprompt):** Tracks AI code provenance without API keys.
- **Convention-based:** Agent worktree branch names, commit author email (`agent@aigon.dev`), git trailers (`Aigon-Agent-ID: <id>`).

**Key insight from Git AI's approach:** Rather than trying to detect AI code after the fact, the best strategy is for coding agents to explicitly mark inserted hunks as AI-generated at commit time, giving accurate attribution.

### Published Benchmarks

**CodeRabbit "State of AI vs Human Code Generation" (December 2025):**
- **Methodology:** 470 open-source GitHub PRs (320 AI-coauthored, 150 human-only). Statistical method: Poisson rate ratios with 95% confidence intervals.
- AI-authored PRs: **10.83 issues/PR** vs. 6.45 for human PRs (**~1.7x overall**)
- Critical/major defects: **1.4-1.7x higher**
- **By category:**
  - Logic/correctness errors: **+75%** (business logic errors, misconfigurations, unsafe control flow)
  - Security vulnerabilities: **1.5-2x** (XSS 2.74x more common, improper password handling, insecure object references)
  - Performance inefficiencies: **~8x** (excessive I/O operations)
  - Readability problems: **>3x** (naming/formatting inconsistencies)
- **Defect composition:** ~90-93% code smells, 5-8% bugs, ~2% security vulnerabilities (consistent across AI models)

**GitClear (Feb 2025, 211M changed lines, 2020-2024):**
- Copy/paste duplication: 8.3% (2020) → 12.3% (2024) — **48% relative increase**
- Duplicated code blocks: **8x increase** in 2024
- Refactoring dropped from 25% to <10% of changed lines — AI code gets replaced wholesale rather than improved

**DORA 2024 Report:**
- **7.2% decrease in delivery stability** for every 25% increase in AI adoption

**Faros AI (June 2025, 10,000+ devs, 1,255 teams):**
- AI adoption associated with **9% increase in bugs per developer**
- **154% increase** in average PR size

**University of Naples (August 2025):**
- AI-generated Python/Java code is "simpler and more repetitive, yet more prone to unused constructs and hardcoded debugging"

### Measurement Methodology for Aigon

1. Tag all agent commits with attribution metadata (already done via Co-authored-by)
2. Run SAST/lint tools (ESLint, Semgrep, SonarQube, CodeRabbit) on all PRs
3. Segment results by AI-attributed vs. human-attributed
4. Normalize by PR size (issues per KLOC changed)
5. Track trends over time and by agent/model

### Pros & Cons

| Pros | Cons |
|------|------|
| Strong published baselines (1.7x) for benchmarking | Attribution imperfect — human-edited AI code is a gray area |
| Git attribution is tractable with existing tools | PR-level analysis misses mixed authorship within files |
| Directly answers "is AI code worse?" | Severity classification depends on review tool |
| Segmentation by model/agent enables comparison | AI code may be reviewed less thoroughly (rubber-stamp problem) |

### Sources
- [CodeRabbit: State of AI vs Human Code Generation](https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report)
- [CodeRabbit Full Whitepaper](https://www.coderabbit.ai/whitepapers/state-of-AI-vs-human-code-generation-report)
- [GitClear: AI Copilot Code Quality 2025](https://www.gitclear.com/ai_assistant_code_quality_2025_research)
- [Git AI](https://usegitai.com/) | [AgentBlame](https://github.com/mesa-dot-dev/agentblame) | [BlamePrompt](https://github.com/Ekaanth/blameprompt)
- [AI-Generated Code Statistics 2026](https://www.netcorpsoftwaredevelopment.com/blog/ai-generated-code-statistics)

---

## Metric 7: Rework Rate

### Definition

The proportion of AI-generated code that is reverted, substantially modified, or overwritten within a defined time window (typically 7-14 days). Measures code durability and first-time correctness.

### Measurement Methodology

**GitClear approach (industry standard):**
- Track "code churn" — lines added then reverted or significantly modified within 14 days
- Compare churn rates for AI-attributed lines vs. human-attributed lines
- Classification: "moved", "deleted", "updated", "reverted" — each signals different quality issues

**DORA 2024 approach:**
- Narrower, production-focused: proportion of unplanned deployments to fix user-visible issues

**Recommended Aigon approach:**
1. At T+7d and T+14d, run git blame on files touched by agent commits
2. Calculate what percentage of agent-authored lines have been replaced
3. Classify rework by type using heuristics:

| Signal | Likely Intentional Refinement | Likely Quality Issue |
|--------|-------------------------------|---------------------|
| Diff size | <20% of original | >50% of original |
| Commit message | "refactor", "style", "rename" | "fix", "revert", "hotfix", bug tracker ref |
| Timing | Same session/day | Days later, after review or production |
| Scope | Formatting, naming, comments | Logic, control flow, security |
| Test changes | No test changes needed | Tests added or modified |

### Published Benchmarks

**GitClear (211M lines, 2020-2024):**
- Code churn (new code revised within 2 weeks): **5.5% (2020) → 7.9% (2024)**
- Projected to **double** vs. 2021 pre-AI baseline
- Code revised within one month: dropped from 30% (2020) to 20% (2024) — more time spent fixing recent (AI) code, less on improving legacy
- Refactoring: 25% (2021) → <10% (2024) — AI code gets replaced wholesale

**Faros AI (2025):**
- Teams with high AI adoption merged **98% more PRs** but review times increased **91%**
- **154% increase** in average PR size — larger PRs have higher rework risk

**CircleCI (2026):**
- Nearly **3 in 10 merges to main now fail** — highest failure rate recorded
- Feature branch activity jumped **59%** year-over-year

### Pros & Cons

| Pros | Cons |
|------|------|
| Directly measurable from git history | Intentional-vs-quality distinction requires heuristics |
| Strong signal for code quality | Mixed-authorship files complicate line-level attribution |
| Time-windowed avoids counting long-term refactoring | Legitimate requirement changes look like rework |
| GitClear provides published baselines | Doesn't capture rework severity |

### Sources
- [GitClear: AI Copilot Code Quality 2025](https://www.gitclear.com/ai_assistant_code_quality_2025_research)
- [Jonas.rs: GitClear Report Summary](https://www.jonas.rs/2025/02/09/report-summary-gitclear-ai-code-quality-research-2025.html)
- [Faros AI: The AI Productivity Paradox](https://www.faros.ai/blog/ai-software-engineering)
- [DORA 2024 Report](https://cloud.google.com/blog/products/devops-sre/announcing-the-2024-dora-report)

---

## Metric 8: Review Quality for AI PRs

### Definition

The thoroughness and effectiveness of human code review applied to AI-generated PRs. Addresses: are reviewers keeping up with AI output, or rubber-stamping?

### The Core Problem

AI has shifted the development bottleneck from code generation to code review:
1. AI generates more PRs, faster, and larger
2. Review queues grow beyond human capacity
3. Reviewers rush or rubber-stamp
4. More bugs reach production
5. More hotfixes → more PRs → bigger queue (vicious cycle)

### Measurement Methodology

**Review engagement metrics (from GitHub/GitLab API):**
- Comments per PR (total and per changed line)
- Time-to-first-review (PR opened → first reviewer comment)
- Time-to-approval (PR opened → approval)
- Number of review rounds (request-review cycles)
- Reviewer count per PR

**Rubber-stamp detection heuristics:**
- Approval in <5 minutes on a 500+ line PR
- Zero comments on a PR with >100 changed lines
- Single reviewer for large/complex PRs
- Approval without any "changes requested" on initial review

**Post-merge quality signals:**
- Bugs filed within 7/14/30 days traced to specific PRs
- Hotfix deployments referencing recently merged AI PRs

### Published Benchmarks

**Faros AI (June 2025, 10,000+ developers):**
- PR review times increased **91%** for high AI adoption teams
- PRs are **154% larger** on average
- **98% more PRs** merged — volume outpacing review capacity
- No org-level improvement despite team-level output gains

**LinearB (2026, 8.1M PRs):**
- AI PRs wait **4.6x longer** before review
- Once picked up, reviewed **2x faster** (possibly rubber-stamping)
- AI PR acceptance rates: **32.7%** vs. **84.4%** for manual PRs

**Human-AI Review Synergy (arXiv:2603.15911, 278,790 conversations):**
- Human reviewer suggestions adopted **56.5%** of the time
- AI agent review suggestions adopted only **16.6%**
- Over half of unadopted AI suggestions are incorrect

**CircleCI (2026):**
- Nearly **3 in 10 merges to main now fail**

### Pros & Cons

| Pros | Cons |
|------|------|
| Review metrics available from GitHub/GitLab APIs | "Good" metrics are context-dependent |
| Rubber-stamp detection is straightforward | Requires code hosting API integration |
| Directly actionable (adjust review process) | More comments does not always = better review |
| Correlates with downstream quality | Cultural/seniority factors affect patterns |

### Sources
- [Faros AI: The AI Productivity Paradox](https://www.faros.ai/blog/ai-software-engineering)
- [LinearB 2026 Benchmarks Report](https://linearb.io/resources/software-engineering-benchmarks-report)
- [The AI Code Review Bottleneck (Mar 2026)](https://levelup.gitconnected.com/the-ai-code-review-bottleneck-is-already-here-most-teams-havent-noticed-1b75e96e6781)
- [Code Review is a Bottleneck in the AI Era](https://asyncsquadlabs.com/blog/code-review-bottleneck-ai-era/)
- [Human-AI Synergy in Agentic Code Review](https://arxiv.org/html/2603.15911)

---

## Metric 9: Test Coverage Depth (Beyond Line Coverage)

### Definition

Test suite effectiveness at catching defects, measured beyond line coverage using mutation testing, branch coverage, and assertion density. Critical because AI-generated tests inflate line coverage to 90%+ while providing minimal defect detection.

### The Gap: Line Coverage vs. Mutation Score

**The critical finding:** AI-generated tests routinely achieve **90%+ line coverage** but only **30-40% on mutation testing**. These are tests that execute code paths without asserting on behavior — "tests that pass but prove nothing."

### Measurement with Mutation Testing

**How it works:**
1. Introduce artificial bugs (mutations): change `>` to `>=`, flip booleans, remove return statements
2. Run test suite against each mutation
3. If tests catch it (fail) → mutation "killed"; if tests pass despite mutation → "survived"
4. **Mutation Score = killed / total * 100**

**Tools by language:**

| Language | Tool | Maturity |
|----------|------|----------|
| JavaScript/TypeScript | Stryker | Most mature JS mutation testing |
| Python | mutmut, cosmic-ray | mutmut simpler; cosmic-ray more configurable |
| Java | PIT (Pitest) | Industry standard for JVM |
| Go | go-mutesting | Less mature but functional |

**Complementary metrics:**

| Metric | What It Measures | AI-Specific Value |
|--------|-----------------|-------------------|
| **Mutation Score** | % injected bugs caught by tests | Exposes AI test shallowness |
| **Branch Coverage** | % conditional branches exercised | AI often misses edge cases |
| **Assertion Density** | Assertions per test method | AI tests often have fewer assertions |
| **Defect Detection Rate** | Bugs caught by tests vs. found in production | Ultimate quality signal |
| **MC/DC Coverage** | Modified Condition/Decision Coverage | Reveals untested logical conditions |

### Published Benchmarks

- AI-generated tests: **90%+ line coverage, 30-40% mutation score**
- Devin (2025): Companies see test coverage rise from **50-60% to 80-90%** — but this is line coverage, not mutation score
- Module expectations: algorithmic code scores lower; utility functions should score high; business logic (where AI defects concentrate) should score high

### Pros & Cons

| Pros | Cons |
|------|------|
| Gold standard for test quality (academically validated) | Computationally expensive (10-100x test runtime) |
| Exposes gap between coverage numbers and defect detection | Requires language-specific tooling |
| Forces thinking about test intent | Equivalent mutations create noise |
| Directly relevant to AI test generation quality | Impractical for every PR; better as periodic audit |

### Sources
- [GenQE: Mutation Testing Guide (2025)](https://genqe.ai/ai-blogs/2025/02/25/mutation-testing-elevating-software-quality-beyond-traditional-methods/)
- [Codecov: Beyond Code Coverage Metrics](https://about.codecov.io/blog/measuring-the-effectiveness-of-test-suites-beyond-code-coverage-metrics/)
- [Master Software Testing: Mutation Testing 2025](https://mastersoftwaretesting.com/testing-fundamentals/types-of-testing/mutation-testing)

---

## Metric 10: Token-to-Value Ratio

### Definition

The cost in LLM tokens (and equivalent dollars) to deliver one unit of value (feature shipped, bug fixed, task completed). The core economic efficiency metric for AI-assisted development.

**Formula:** `Token-to-Value = Total Token Cost ($) / Value Units Delivered`

### Measurement Methodology

**Numerator — Cost:**
- Total tokens consumed across all agent sessions for a feature (input + output separately)
- Output tokens cost **3-10x more** than input tokens
- For a typical agent generating 2x more output than input, actual cost is roughly **9x** the advertised input-token price
- Include all sessions: initial implementation, iteration, test fixes, review responses

**Denominator — Value (in order of preference for Aigon):**
1. **Features merged to main** — maps directly to Aigon spec lifecycle (best proxy)
2. **Bugs fixed and verified** — clear, countable outcomes
3. **Developer-hours saved** — estimated via historical comparison (most speculative)

**Normalization:** Compare across features of similar complexity; track trend over time; segment by task type.

### Cost Data Available

| Data Point | Source | Aigon Access |
|-----------|--------|-------------|
| API token counts (input/output) | LLM API responses | Agent sessions (needs instrumentation) |
| Model pricing | Published by providers | Static lookup tables |
| Session duration | Agent start/end times | Already in Aigon manifests |
| Agent Compute Units | Devin, similar tools | N/A for Aigon (own metric needed) |

### Published Benchmarks

**Token price trends (2022-2026):**
- ~$12/M tokens (2022) → <$2/M for comparable performance (2025)
- GPT-4o: **$2.50/M input** (down from $60 in 2024)
- GPT-5.2 (Feb 2026): **$1.75/M input**
- GPT-5 nano: **$0.05/M input**
- Key: **prices dropping ~10x every 18 months**

**Cost optimization (real examples):**
- One company cut per-task cost from **$0.15 to $0.054** by routing 40% of queries to cheaper models
- Routing 70% routine / 30% frontier yields better ROI than all-in on frontier

**ROI measurement challenges:**
- Only **51%** of companies can clearly track AI ROI (Deloitte 2025)
- Only **28%** of finance leaders report clear, measurable AI value
- Nearly half expect **up to 3 years** for ROI from basic AI automation

### Pros & Cons

| Pros | Cons |
|------|------|
| Directly answers "is AI cost-effective?" | "Value" is subjective and hard to standardize |
| Token costs precisely trackable (API returns exact counts) | Features vary enormously in complexity |
| Compelling for an ROI dashboard | Counterfactual is speculative |
| Natural trend improvement (prices fall + models improve) | Hidden costs (developer review/fix time) not captured |

### Sources
- [Deloitte: AI Tokens — Navigating Spend Dynamics](https://www.deloitte.com/us/en/insights/topics/emerging-technologies/ai-tokens-how-to-navigate-spend-dynamics.html)
- [pricepertoken.com](https://pricepertoken.com/)
- [Langfuse: Token & Cost Tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking)
- [Silicon Data: LLM Cost Per Token (2026)](https://www.silicondata.com/blog/llm-cost-per-token)

---

## Metric 11: Autonomous Resolution Rate

### Definition

The percentage of tasks completed by AI agents end-to-end without requiring human code modifications before merge. Measures true AI autonomy in production workflows.

### Measurement Methodology

**For Aigon:**
1. Agent completes feature/task and creates a PR
2. Compare agent's final commit SHA with the merge commit SHA
3. If diff is empty → fully autonomous resolution
4. If diff is <10% of total changes → effectively autonomous (minor polish)
5. Track as percentage across all features over time

**Variants:**
- **Strict:** Zero human commits between agent PR and merge
- **Relaxed:** <10% human modifications
- **Benchmark (SWE-bench):** Agent resolves real GitHub issue, verified by test suite

### Published Benchmarks

**SWE-bench Verified (as of early 2026):**

| Agent/Model | Resolution Rate | Date |
|------------|----------------|------|
| Refact.ai Agent | **70.4%** (352/500) | 2025 |
| Claude 3.7 Sonnet | **62.3%** | Feb 2025 |
| Devin (original) | **13.86%** | Mar 2024 |
| Previous best (pre-Devin) | **1.96%** | Early 2024 |

**Devin Real-World (2025 Performance Review):**
- PR merge rate: **34% → 67%** over 2025
- Devin 2.0: **83% more tasks** per Agent Compute Unit vs. 1.x
- Best for tasks a junior engineer would take **4-8 hours**
- "Senior-level at codebase understanding but junior at execution"

**SWE-CI (March 2026 — long-term maintenance):**
- **75% of AI agents break previously working code** during maintenance
- Zero-regression rates: most models <0.25; Claude Opus 4.5: 0.51; Claude Opus 4.6: 0.76
- Critical: one-shot resolution rates overstate real-world autonomy

**Relevance to Aigon:** Highly relevant. Aigon orchestrates agent sessions for features, bugs, and tests. This metric directly measures whether Aigon's orchestration produces shippable code. Higher autonomous resolution = less human intervention = more developer time saved = stronger ROI signal in the insights dashboard.

### Pros & Cons

| Pros | Cons |
|------|------|
| Clear, near-binary metric | Ignores partial value (agent does 90% of work) |
| Benchmarkable against SWE-bench and competitors | SWE-bench tasks narrower than real features |
| Compelling commercial metric | Task complexity distribution affects rate |
| Shows agent/model improvement over time | SWE-CI shows one-shot success can mislead |

### Sources
- [SWE-bench Verified (Epoch AI)](https://epoch.ai/benchmarks/swe-bench-verified)
- [Cognition: Devin's 2025 Performance Review](https://cognition.ai/blog/devin-annual-performance-review-2025)
- [SWE-CI Benchmark](https://arxiv.org/html/2603.03823v3)
- [AI Agent Benchmark Comparison (80+ agents)](https://github.com/murataslan1/ai-agent-benchmark)

---

## Metric 12: Developer Time Saved / Amplification Factor

### Definition

The ratio of estimated completion time without AI to actual time with AI. An amplification factor of 2x means AI doubles effective output.

**Formula:** `Amplification Factor = (Estimated time without AI) / (Actual time with AI)`

### The Conflicting Evidence

| Study | Finding | Method | N | Year |
|-------|---------|--------|---|------|
| **McKinsey** | Up to **2x faster** | Survey + controlled tasks | Undisclosed | 2023 |
| **GitHub Copilot RCT** | **55.8% faster** (simple tasks) | Randomized controlled trial | 95 devs | 2023 |
| **Multi-company (MS, Accenture, F100)** | **26% avg**; 35-39% juniors, 8-16% seniors | Telemetry | ~5,000 devs | 2024 |
| **METR RCT** | **19% SLOWER** (experienced OSS devs) | Randomized controlled trial | 16 devs, 246 issues | Jul 2025 |
| **Faros AI** | 21% more tasks, 98% more PRs, **91% longer reviews**, no org improvement | Telemetry | 10,000+ devs | Jun 2025 |
| **DX** | **3.6 hours saved weekly** per developer | Surveys + system metrics | 135K+ devs | Q4 2025 |

### The METR Study (July 2025) — Most Rigorous

- 16 experienced developers on their own large OSS repos (avg 22K+ stars, 1M+ lines)
- 246 real issues randomly assigned to AI-allowed vs. AI-disallowed
- Tools: Cursor Pro with Claude 3.5/3.7 Sonnet (frontier at time of study)
- **Result: 19% SLOWER with AI** (statistically significant)
- **Perception gap:** Developers expected 24% speedup. After the study, they still believed 20% speedup. Reality: 19% slowdown. **Wrong by ~40 percentage points.**
- **Why:** Experienced developers on familiar codebases have strong mental models. AI context-building, output review, and correction overhead exceeds generation benefit.
- **Update (Feb 2026):** METR redesigning study; acknowledges "developers are likely more sped up from AI tools in early 2026"

### The Amplification Insight (DORA 2025)

AI is an **amplifier, not a universal accelerator.** It magnifies strengths of high-performing orgs AND dysfunctions of struggling ones.

**Key moderating factors:**

| Factor | Higher Amplification | Lower/Negative |
|--------|---------------------|----------------|
| Task complexity | Simple, well-defined | Complex, ambiguous |
| Developer experience | Juniors (35-39% gain) | Seniors on familiar code (may slow) |
| Codebase familiarity | Unfamiliar codebases | Deeply familiar codebases |
| Org maturity | Strong CI/CD, testing, review | Weak processes |
| Task type | Boilerplate, migrations, tests | Architecture, design, novel algorithms |

### Measuring the Counterfactual

The counterfactual is inherently speculative. Best approaches for Aigon:
1. **Historical baselines** — compare similar features before/after AI adoption (most practical)
2. **Complexity-normalized comparison** — use spec size or story points as normalizer
3. **Self-report with correction** — collect estimates, apply ~40% overestimation bias (METR gap)
4. **DX benchmark comparison** — compare Aigon users' self-reported savings against DX's 3.6 hrs/week baseline

### Pros & Cons

| Pros | Cons |
|------|------|
| The metric leaders most want to see | Counterfactual makes precise measurement impossible |
| Multiple published baselines exist | Self-reports biased by ~40% (METR) |
| Translates directly to budget/headcount decisions | Results vary enormously by context |
| Trend tracking shows model improvement | METR shows experts can be slowed — uncomfortable finding |

### Sources
- [METR: Developer Productivity Study (Jul 2025)](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/)
- [METR: Study Design Update (Feb 2026)](https://metr.org/blog/2026-02-24-uplift-update/)
- [GitHub Copilot RCT (arXiv, 2023)](https://arxiv.org/abs/2302.06590)
- [Faros AI: AI Productivity Paradox](https://www.faros.ai/blog/ai-software-engineering)
- [DORA 2025 Report](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report)
- [DX: Q4 2025 AI Impact Report](https://getdx.com/blog/ai-assisted-engineering-q4-impact-report-2025/)
- [McKinsey: Developer Productivity with GenAI](https://www.mckinsey.com/capabilities/tech-and-ai/our-insights/unleashing-developer-productivity-with-genai)

---

# Combined Recommendation: All 12 Metrics

## The AI Productivity Paradox — The Central Finding

The single most important finding across all research: **AI increases individual output but organizational delivery metrics stay flat** (Faros AI, 2025). Bottlenecks shift downstream — review queues grow 91%, bugs increase 9%, PR size grows 154%. The value created by AI is absorbed by downstream bottlenecks.

**Implication for Aigon:** Metrics that measure only generation speed ("lines produced", "PRs opened") are vanity metrics. The metrics that matter measure **end-to-end value delivery**: did the code ship, did it survive, did it cause rework?

## Implementation Priority

### Tier 1 — Implement First (high signal, feasible now)
1. **Persistence Rate** — Flagship differentiator. No other tool measures AI code survival at feature level.
2. **AI Edit Distance** — Directly quantifies agent effectiveness from git history.
3. **Token-to-Value Ratio** — Essential ROI metric. Aigon tracks sessions; add token counting.
4. **First-Pass Success Rate** — Binary CI signal. Fast feedback, directly actionable.
5. **Prompt-to-PR Latency** — Full lifecycle timing. Most timestamps already in manifests.

### Tier 2 — Implement Next (high signal, moderate effort)
6. **Autonomous Resolution Rate** — "Did agent code ship as-is?" Compelling commercial metric.
7. **Rework Rate** — Time-windowed code churn. Complements persistence.
8. **AI Bug Density** — Requires SAST/lint integration. Strong published baselines (1.7x).
9. **Prompt Efficiency** — Session/turn/token counts per feature.

### Tier 3 — Aspirational (high value, high instrumentation cost)
10. **Review Quality** — Requires GitHub API for comments, rounds, timing.
11. **Mutation Score** — Gold standard for test quality. Computationally expensive.
12. **Amplification Factor** — Important for marketing but methodologically challenging. Requires caveats about METR findings.

## Updated Feature Table (All 12 Metrics)

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| `metric-ai-attribution` | Standardize agent commit attribution via Co-authored-by trailers and agent-specific emails | high | none |
| `metric-persistence-rate` | Background git blame analysis measuring AI code survival at T+7d, T+14d | high | `metric-ai-attribution` |
| `metric-edit-distance` | Normalized diff between agent output and final merged code per feature | high | `metric-ai-attribution` |
| `metric-token-cost-tracking` | Capture token counts (input/output) from agent sessions, map to features with dollar cost | high | none |
| `metric-first-pass-success` | Track CI pass/fail on first submission for AI-authored PRs | high | none |
| `metric-prompt-to-pr-latency` | Elapsed time from feature creation through PR merge with sub-phase breakdown | high | none |
| `metric-autonomous-resolution` | Percentage of agent PRs merging with zero/<10% human code modifications | medium | `metric-ai-attribution` |
| `metric-rework-rate` | Time-windowed (7d/14d) measurement of agent lines reverted or substantially modified | medium | `metric-ai-attribution` |
| `metric-bug-density-segmented` | Defect rate comparison (AI vs human) using SAST/lint tools | medium | `metric-ai-attribution` |
| `metric-review-engagement` | PR review duration, comment density, rubber-stamp detection via GitHub API | medium | none |
| `metric-prompt-efficiency` | Session count, turn count, and token usage per feature | medium | none |
| `metric-mutation-score` | Stryker/mutmut integration for mutation testing on AI-generated tests | low | none |
| `metric-amplification-factor` | Historical comparison of feature cycle times before/after Aigon, complexity-normalized | low | `metric-token-cost-tracking` |
| `dashboard-metrics-insights` | Insights dashboard visualizing all metrics with trends, benchmarks, anomaly detection | high | `metric-persistence-rate`, `metric-token-cost-tracking` |
