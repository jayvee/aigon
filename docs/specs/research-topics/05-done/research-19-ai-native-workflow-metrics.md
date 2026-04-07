# Research: ai-native-workflow-metrics

## Context

Traditional software engineering metrics (DORA, cycle time, velocity) were designed for human-driven workflows. In the AI-native development era, these metrics are either misleading or insufficient:

- **Cycle time is artificially compressed** — AI can generate a PR in minutes, but the bottleneck has shifted to validation and review
- **Lines of code / velocity are meaningless** — AI can produce thousands of lines that may need extensive rework
- **Quality signals are inverted** — high throughput may correlate with higher defect rates when AI-generated code isn't properly validated

Aigon already tracks some workflow data (feature lifecycle, agent status, session timing). The opportunity is to define and instrument the **right** metrics for AI-native workflows, then surface them in the dashboard's insights view.

This research should identify the top 5-10 metrics that Aigon should implement, considering:
- What can Aigon actually measure from its position (CLI, git, agent orchestration)
- What provides genuine signal vs. vanity metrics
- What would be most useful for users tracking AI-native workflow effectiveness

### Inspiration & Starting Points

The user has gathered initial ideas from multiple AI conversations, organized into these categories:

**Inner Loop (AI collaboration effectiveness):**
- Acceptance Rate vs. Persistence Rate (does AI code survive 24h?)
- AI Edit Distance (human modifications to AI output before commit)
- Prompt-to-PR Latency (intent to submitted PR)
- Prompt Efficiency ("cognitive compile time" — iterations to convergence)

**Quality & Debt:**
- AI-Generated Bug Density (bugs in AI vs human components)
- Rework Rate (rewrites, rollbacks, patches — AI PRs may show ~1.7x more issues)
- Review Velocity (are reviews scaling with larger AI-generated PRs?)
- Documentation-to-Code Parity
- Test Coverage Depth (logic coverage, not just line coverage)

**Cognitive & Flow:**
- Mean Time to Context (MTTC) — onboarding/context-switching speed
- AI Friction — flow interruptions from hallucinations, non-deterministic output
- Developer Flow State measurement

**Systemic / Business:**
- Token-to-Value Ratio (LLM spend vs. feature delivery)
- Autonomous Resolution Rate (AI-resolved incidents without human intervention)
- Shadow Code Generation (untracked AI tool usage)

**SPACE Framework adaptations** for AI-era development are also worth investigating.

## Questions to Answer

### Metric Selection & Prioritization
- [ ] Of all proposed metrics, which 5-10 provide the highest signal-to-noise for AI-native workflows?
- [ ] Which metrics can Aigon realistically measure from its vantage point (CLI orchestrator, git history, agent sessions, worktree lifecycle)?
- [ ] Which metrics require data Aigon doesn't currently collect, and what instrumentation would be needed?
- [ ] Are there metrics from academic research or industry reports (e.g., GitClear, LinearB, DX) that we're missing?

### Inner Loop Metrics
- [ ] How should "Persistence Rate" be defined and measured? (AI code survival over time — 24h, 1 week, 1 sprint?)
- [ ] What's the right way to measure AI Edit Distance? (git diff between agent commit and final human-edited commit?)
- [ ] How do we measure Prompt Efficiency / "cognitive compile time" without being invasive? (session length, iteration count, conversation turns?)
- [ ] Is "Prompt-to-PR Latency" meaningfully different from existing cycle time, or does it need a different anchor point?

### Quality Metrics
- [ ] How can Aigon attribute code to AI vs. human authorship for bug density tracking? (agent commits vs. human commits? git blame?)
- [ ] What's the best definition of "Rework Rate" for AI-generated code? (commits that revert/modify AI output within N days?)
- [ ] Can we measure review quality, not just review speed? (comments per PR, approval-to-merge ratio, post-merge issues?)

### Business & Value Metrics
- [ ] How should Token-to-Value Ratio be calculated? What counts as "value"? (features shipped, bugs fixed, time saved?)
- [ ] Is Autonomous Resolution Rate applicable to Aigon's domain, or is it more SRE-focused?
- [ ] What cost data does Aigon have access to or could collect? (token usage from agent sessions, API costs?)

### Competitive Landscape
- [ ] What metrics do existing AI dev tools report? (GitHub Copilot metrics, Cursor analytics, LinearB, Jellyfish, DX)
- [ ] Are there emerging standards or frameworks for AI development metrics? (SPACE evolution, DORA adaptations?)
- [ ] What do engineering leaders actually want to see in dashboards? (practitioner interviews, blog posts, conference talks)

### Implementation in Aigon
- [ ] Which metrics map to Aigon's existing data model? (feature specs, agent manifests, git history, session logs)
- [ ] What new telemetry/instrumentation would each metric require?
- [ ] How should metrics be presented in the dashboard's insights view? (trends, benchmarks, alerts?)

## Scope

### In Scope
- Metrics measurable from an AI development workflow orchestrator's perspective
- Metrics relevant to individual developers and small teams (Aigon's target audience)
- Implementation feasibility within Aigon's architecture
- Academic and industry research on AI-native development measurement

### Out of Scope
- Enterprise-scale organizational metrics (hundreds of engineers)
- Metrics requiring IDE-level instrumentation (keystroke tracking, suggestion acceptance in editor)
- General software quality metrics that don't change with AI (uptime, SLA compliance)
- Building the actual metrics implementation (that's a separate feature)

## Recommendation

### The Central Finding

AI increases individual output but organizational delivery metrics stay flat (Faros AI, 2025). Bottlenecks shift downstream — review queues grow 91%, bugs increase 9%, PR size grows 154%. Metrics that measure only generation speed are vanity metrics. The metrics that matter measure **end-to-end value delivery**: did the code ship, did it survive, did it cause rework?

### Aigon's Unique Vantage Point

No existing tool measures from the workflow orchestrator layer. GitHub/Cursor see IDE telemetry. GitClear sees code movement. DX sees surveys. Aigon uniquely sees: feature lifecycle (spec to completion), agent session timing and iterations, worktree lifecycle, state transitions, multi-agent coordination, and the full prompt-to-merge arc.

### What Aigon Already Tracks

Aigon already computes significant metrics from existing data:
- `firstPassSuccess` — feature completed without entering `waiting` state
- `autonomyRatio` / `waitCount` — flow interruption and agent independence
- `costUsd` / `tokensPerLineChanged` — basic cost telemetry from Claude transcripts
- `rework_thrashing` / `rework_fix_cascade` / `rework_scope_creep` — git-derived rework signals during implementation
- Feature lifecycle timestamps (spec creation → implementing → submitted → done)

### Strategic Direction

Aigon should measure **whether AI output survives, not just whether it appears quickly**. The product thesis:
1. Aigon measures whether AI output survives, not just whether it appears quickly
2. Aigon measures orchestration friction, not just code generation
3. Aigon connects agent cost, review burden, and rework into a single workflow view

All three research agents (CC, GG, CX) converged on this framing. The key gap to fill is **post-merge durability** — persistence rate, edit distance, and post-merge rework — which no existing tool measures at the feature level.

### Consensus Across Agents

- Traditional metrics (DORA, velocity, LOC) are misleading for AI-native workflows
- Persistence Rate / Code Survivability is the flagship differentiator
- Agent commit attribution is the foundational prerequisite
- A balanced scorecard beats a single productivity score

### Deferred Metrics

The following were researched but deferred from implementation:
- **Amplification Factor / Developer Time Saved** — methodologically fraught; METR RCT found AI makes experienced devs 19% slower, while self-reports claim 20% faster (40pp perception gap)
- **Mutation Score** — gold standard for test quality but computationally expensive; better as periodic audit
- **AI Bug Density** — requires SAST/lint integration; strong published baselines (1.7x) but complex attribution
- **Autonomous Resolution Rate** — more relevant to SRE/support than current feature workflows
- **Review Quality / Engagement** — requires GitHub/GitLab API integration; deferred to later phase

## Output

### Selected Features

| Feature Name | Description | Priority | Create Command |
|--------------|-------------|----------|----------------|
| metrics-git-attribution | Formalize agent commit attribution (Co-authored-by, agent email, git notes) as the foundation for all quality metrics | high | `aigon feature-create "metrics-git-attribution"` |
| metrics-code-durability | Post-merge code analysis: persistence rate (T+7d, T+30d via git blame), edit distance (agent output vs merged code), and post-merge rework rate | high | `aigon feature-create "metrics-code-durability"` |
| metrics-insights-scorecard | Insights dashboard view combining existing metrics (first-pass success, autonomy ratio, wait burden, cost, rework) with new durability metrics into a balanced scorecard with trends and agent comparisons | high | `aigon feature-create "metrics-insights-scorecard"` |
| metrics-session-telemetry | Normalize per-session telemetry across all agents into a common schema (turns, tool calls, tokens input/output, cost) for cross-agent comparison and accurate cost-per-durable-change | medium | `aigon feature-create "metrics-session-telemetry"` |

### Feature Dependencies

- `metrics-code-durability` depends on `metrics-git-attribution` (needs reliable AI/human attribution to measure persistence)
- `metrics-insights-scorecard` depends on `metrics-code-durability` (durability is the flagship metric in the dashboard)
- `metrics-insights-scorecard` can ship a v1 with existing metrics before durability lands
- `metrics-session-telemetry` is independent but enriches `metrics-insights-scorecard` with cross-agent cost data

### Not Selected

- **metric-prompt-to-pr-latency**: Timestamps already exist in manifests; sub-phase decomposition is a view within the scorecard dashboard, not a standalone feature
- **metric-first-pass-success**: Already implemented (`firstPassSuccess` in `lib/utils.js`)
- **metric-flow-interruption**: Already implemented (`waitCount`, `autonomyRatio` in `lib/utils.js`)
- **metric-rework-rate (implementation window)**: Already implemented (`rework_thrashing`, `rework_fix_cascade`, `rework_scope_creep` in `lib/git.js`)
- **metric-review-engagement**: Requires external API integration; deferred
- **metric-amplification-factor**: Methodologically fraught (METR study)
- **metric-mutation-score**: Computationally expensive; periodic audit only
- **metric-bug-density-segmented**: Requires SAST/lint integration
- **metric-autonomous-resolution**: More SRE-focused than current workflows
