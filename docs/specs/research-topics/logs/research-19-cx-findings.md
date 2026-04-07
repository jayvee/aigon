# Research Findings: ai native workflow metrics

**Agent:** Codex (cx)
**Research ID:** 19
**Date:** 2026-03-23

---

## Key Findings

### Executive summary

The strongest conclusion from the research is that Aigon should not try to invent a single "AI productivity score." The best-supported framing is still multi-dimensional. The SPACE framework explicitly argues developer productivity cannot be reduced to one metric, and recent DORA AI research shows AI can improve some outcomes while harming others, especially delivery stability. For Aigon's insights view, the winning shape is a compact scorecard of 5-8 metrics that balance speed, quality, flow, and cost rather than a vanity throughput dashboard.

For first implementation, Aigon should prioritize metrics that match its actual vantage point: CLI orchestration, git history, worktree/session lifecycle, agent status transitions, feature logs, evaluation outcomes, and model token telemetry. That means Aigon is unusually well-positioned for workflow and rework metrics, moderately positioned for cost metrics, and poorly positioned for raw IDE metrics like suggestion acceptance rate unless it imports vendor telemetry from tools such as GitHub Copilot.

### Recommended metric set for Aigon

I would prioritize these 8 metrics, in this order:

1. **Durable Change Rate / Persistence Rate**
   - Definition: percentage of AI-authored or agent-authored changed lines that still exist after a durability window.
   - Recommended windows: `7 days` primary, `30 days` secondary.
   - Why it matters: this is the cleanest antidote to vanity throughput. It rewards code that survives, not code that merely lands.
   - Aigon fit: strong with added attribution and delayed follow-up analysis.

2. **Rework Rate**
   - Definition: percentage of features or AI-authored changes that trigger high churn, fix cascades, or substantial rewrites inside a defined window.
   - Why it matters: GitClear's research is directionally useful here; churn and reduced reuse are plausible leading indicators of maintainability risk.
   - Aigon fit: strong right now. Aigon already computes `rework_thrashing`, `rework_fix_cascade`, and `rework_scope_creep` from git signals.

3. **First-Pass Success Without Rework**
   - Definition: feature completed without entering `waiting` and without rework flags in the implementation window.
   - Why it matters: this compresses quality and flow into one operational metric.
   - Aigon fit: very strong right now. Most building blocks already exist in `collectAnalyticsData()`.

4. **Prompt-to-Submitted Latency**
   - Definition: elapsed time from agent launch / first `implementing` status to `submitted`.
   - Why it matters: more useful than generic cycle time because it anchors on when AI execution actually starts rather than when a spec entered backlog.
   - Aigon fit: very strong right now via manifest status transitions and feature logs.

5. **Flow Interruption Burden**
   - Definition: wait time and interruption burden during a feature, measured through count and duration of `waiting` states.
   - Why it matters: this is one of Aigon's best differentiators because orchestration tooling sees handoffs and stalls better than IDE tools do.
   - Aigon fit: very strong right now. Aigon already derives `autonomyRatio`, `waitCount`, and `totalWaitMs`.

6. **Human Edit Distance to Agent Output**
   - Definition: how much human-authored follow-up modification was required after the agent's first substantial patch.
   - Why it matters: close cousin of Copilot acceptance rate, but better suited to Aigon's workflow level.
   - Aigon fit: medium. Requires stronger authorship attribution and commit-range segmentation than Aigon currently has.

7. **Review Turnaround + Review Depth**
   - Definition: combine review speed with a depth proxy, such as follow-up deltas after review, change-request cycles, or eval disagreement rate.
   - Why it matters: DORA cautions that faster review is not automatically better review.
   - Aigon fit: medium. Strong if Aigon integrates PR metadata; weaker if limited to local git.

8. **Cost per Durable Change**
   - Definition: token spend divided by durable changed lines, durable features, or durable points of business value.
   - Why it matters: pure token-per-line is interesting but incomplete. The more defensible denominator is durable shipped outcome.
   - Aigon fit: medium today because token telemetry is strongest for Claude transcripts; broader agent normalization is needed.

### Metrics Aigon should avoid or defer

- **Raw lines of code / velocity**: too easy for AI to inflate.
- **Token-to-Value Ratio as a headline KPI**: useful internally, but "value" is too subjective to be the top dashboard number unless tied to a concrete denominator.
- **Autonomous Resolution Rate**: more relevant to SRE/support automation than Aigon's present feature workflow.
- **Developer flow state measurement**: attractive, but Aigon cannot observe it directly without invasive instrumentation or self-report.
- **IDE suggestion acceptance rate**: good metric in GitHub Copilot because GitHub has IDE telemetry; weak fit for Aigon unless imported from vendors.

### Answers to the research questions

#### Metric selection and prioritization

The highest signal-to-noise metrics are:

1. Durable Change Rate
2. Rework Rate
3. First-Pass Success Without Rework
4. Prompt-to-Submitted Latency
5. Flow Interruption Burden
6. Human Edit Distance
7. Review Turnaround + Review Depth
8. Cost per Durable Change

These are stronger than traditional throughput metrics because they separate "AI made something quickly" from "the team accepted, retained, and trusted the result."

#### What Aigon can realistically measure now

Aigon already has enough local data to support:

- Feature start/completion timing from spec/log/manifest timestamps
- Agent state transitions such as `implementing`, `waiting`, and `submitted`
- Wait counts and wait duration
- Winner agent and evaluation outcomes
- Git-diff metrics: commit count, lines changed, files touched
- Rework heuristics: thrashing, fix cascades, scope creep
- Claude transcript token/cost telemetry

Concretely, the current codebase already computes or stores:

- `autonomyRatio`, `waitCount`, `firstPassSuccess`, `costUsd`, `tokensPerLineChanged`, and rework flags in `lib/utils.js`
- git-derived rework signals in `lib/git.js`
- per-agent lifecycle state in `.aigon/state/` through `lib/manifest.js`

That means the first dashboard release can be real, not speculative.

#### What Aigon cannot measure yet without new instrumentation

Aigon currently lacks:

- reliable authorship attribution for "AI-authored" vs "human-authored" changes across all agents
- prompt/iteration counts across Codex, Gemini, Cursor, Claude, and future tools in a normalized schema
- PR review metadata such as comments, requested changes, approvals, and merge timestamps
- post-merge defect linkage from issues/incidents
- IDE telemetry such as acceptance rate for inline suggestions

To close those gaps, Aigon needs:

1. A normalized session telemetry record per agent run
   - fields: `agent`, `model`, `startAt`, `endAt`, `turnCount`, `toolCalls`, `tokenUsage`, `costUsd`, `featureId`, `repoPath`

2. Authorship checkpoints
   - record the first meaningful agent-produced commit SHA
   - record subsequent human commits before submit/merge
   - derive edit-distance and persistence metrics from those ranges

3. Optional PR/provider integrations
   - GitHub/GitLab review timestamps, review comment counts, approvals, merge delay

4. Delayed durability jobs
   - re-check merged changes after `7d` and `30d`

#### How to define Persistence Rate

Recommended definition:

- **Line-level durable change rate**: percentage of changed lines introduced by the agent's accepted implementation that still exist after `7d` and `30d`
- **Feature-level persistence rate**: percentage of completed features that do not trigger high churn or substantial rollback during the durability window

Why both:

- Line-level is more precise for code durability
- Feature-level is easier to explain in a dashboard

If Aigon implements only one first, use feature-level persistence first because it is easier to operationalize and less brittle than exact line lineage.

#### How to define AI Edit Distance

Best practical definition for Aigon:

- anchor on the first substantial agent-authored commit or submission snapshot
- compare it to the final merged state
- compute:
  - lines modified after agent output
  - files modified after agent output
  - proportion of agent-authored lines later edited or deleted

This is the workflow-level analogue to Copilot acceptance rate. It is more meaningful for Aigon than keystroke-based metrics because Aigon observes whole-agent outputs rather than inline suggestions.

#### How to measure Prompt Efficiency / cognitive compile time

Do not attempt to infer cognition directly. Use operational proxies:

- iteration count per feature
- number of `waiting -> implementing` loops
- time spent blocked vs active
- total turns/tool calls in the session
- number of validation failures before submit

Recommended headline metric:

- **Iterations to accepted submission**

This is legible, actionable, and less invasive than message-level surveillance.

#### Is Prompt-to-PR Latency different from cycle time?

Yes. Traditional cycle time starts too early and collapses planning, queueing, and implementation into one number. For AI-native workflows, the most informative anchor is when the agent begins active work. Aigon should preserve traditional cycle time as a background metric, but treat prompt-to-submitted latency as the primary inner-loop speed metric.

#### How to attribute bugs to AI vs human authorship

Short answer: carefully, and never with false precision.

Recommended approach:

- attribute a bug to the most recent accepted change-set affecting the defective lines
- classify that change-set as `agent-authored`, `human-authored`, or `mixed`
- report bug density on the unit of accepted change-sets, not on whole files

This requires issue linkage or revert/fix classification. Aigon does not have enough data yet to make this a phase-one metric.

#### Best definition of Rework Rate

Use a layered definition:

- **Implementation-window rework**: rework flags within the feature branch or worktree before submit
- **Short-term rework**: significant modification/revert within `7d` after merge
- **Longer-term rework**: same within `30d`

For launch, ship implementation-window rework first because the data is local and already partially available.

#### Can Aigon measure review quality, not just review speed?

Partially.

Without PR integrations, Aigon can estimate review depth through:

- evaluation disagreement rate between agents
- amount of change after review/eval
- number of wait cycles before final submit

With GitHub/GitLab data, Aigon can add:

- review comment count normalized by PR size
- requested-changes rate
- approval-to-merge delay
- post-merge defect rate

Review quality should be presented as a composite, never a single raw count.

#### How should Token-to-Value Ratio be calculated?

If Aigon ships this, use:

- `cost per durable feature`
- `cost per durable 100 lines changed`
- `cost per accepted feature with no rework`

Avoid broad business-value denominators until Aigon integrates product outcomes. Right now, "value" is better treated as delivery quality and durability, not revenue.

#### Is Autonomous Resolution Rate relevant?

Not for Aigon's first metrics release. It may become relevant if Aigon expands into incident response, support triage, or autonomous operational loops. For current feature and research workflows, it is secondary at best.

### Competitive landscape

#### What existing tools report

- **GitHub Copilot** publicly documents adoption, engagement, acceptance rate, pull request lifecycle metrics, and code generation metrics including agent contribution and AI-driven lines changed.
- **DX** positions its AI reporting around utilization, impact, and cost, and explicitly ties AI usage to PR throughput, maintainability, change failure, and developer experience.
- **DORA** publishes evidence that AI adoption correlates with better documentation quality, code quality, code review speed, and approval speed, while also warning that delivery stability can decline.
- **GitClear** emphasizes churn, clone growth, and reduced code reuse as maintainability warnings in the AI era.

The gap Aigon can exploit is workflow-native orchestration metrics. GitHub sees IDE and PR telemetry. GitClear sees code movement. DX sees enterprise systems and surveys. Aigon uniquely sees multi-agent work orchestration, wait states, worktree lifecycle, evaluation/winner flow, and local git history in one place.

#### Are there emerging standards?

The closest thing to a standard is still "use a balanced framework":

- **SPACE** for multi-dimensional measurement
- **DORA** for delivery outcomes and operational quality
- **DevEx / DX Core 4** for combining system metrics with human friction and business framing

Inference: there is no settled AI-native metrics standard yet. That creates room for Aigon to define a practical operator-oriented scorecard, as long as it avoids claiming a universal single-number truth.

#### What leaders actually want in dashboards

The consistent pattern across GitHub, DORA, Google Research, and DX is:

- not just adoption, but whether AI improves meaningful outcomes
- confidence that speed is not hiding quality regressions
- some cost/ROI visibility
- evidence that developers are spending less time blocked

So the dashboard should answer four questions:

1. Are we going faster?
2. Is the output sticking?
3. Are reviews and fixes getting easier or harder?
4. Are we getting enough value for the AI spend?

### Recommended implementation plan for the insights dashboard

#### Phase 1: ship now from current data

Build these first:

- Prompt-to-Submitted Latency
- Flow Interruption Burden
- First-Pass Success
- Rework Rate
- Cost per Feature
- Tokens per Line Changed
- Winner agent / agent comparison cards

These can mostly be derived from existing logs, manifests, git signals, and Claude telemetry.

#### Phase 2: add attribution

Build:

- Human Edit Distance
- Agent-authored share of final diff
- Cost per Durable Change

Requires normalized commit/snapshot attribution for every agent.

#### Phase 3: add delayed quality outcomes

Build:

- 7d/30d Persistence Rate
- post-merge rework
- defect-linked quality metrics

Requires scheduled durability analysis and issue/PR integration.

### Insights packaging

The dashboard should expose:

- latency
- wait burden
- first-pass success
- simple cost per feature
- durable change / persistence views
- rework and maintainability diagnostics
- edit-distance attribution
- team/agent comparisons
- trend analysis and coaching

That split is commercially sensible because the free tier can demonstrate immediate utility, while the durable-outcome analytics are differentiated and harder to replicate.

## Sources

- SPACE framework: Microsoft Research, "The SPACE of Developer Productivity: There's more to it than you think"  
  https://www.microsoft.com/en-us/research/publication/the-space-of-developer-productivity-theres-more-to-it-than-you-think/
- Google Research, "What Improves Developer Productivity at Google? Code Quality."  
  https://research.google/pubs/what-improves-developer-productivity-at-google-code-quality/
- GitHub Docs, "GitHub Copilot usage metrics"  
  https://docs.github.com/en/copilot/concepts/copilot-usage-metrics/copilot-metrics
- GitHub Docs, "Data available in Copilot usage metrics"  
  https://docs.github.com/en/copilot/reference/copilot-usage-metrics/copilot-usage-metrics
- DORA, "Impact of Generative AI in Software Development"  
  https://dora.dev/ai/gen-ai-report/dora-impact-of-generative-ai-in-software-development.pdf
- DORA, "How gen AI affects the value of development work"  
  https://dora.dev/insights/value-of-development-work/
- GitClear, "Coding on Copilot: 2023 Data Suggests Downward Pressure on Code Quality"  
  https://www.gitclear.com/coding_on_copilot_data_shows_ais_downward_pressure_on_code_quality
- DX, "Introducing the GenAI Impact Report"  
  https://getdx.com/news/introducing-genai-impact-report/
- DX, "AI-assisted engineering: How AI is transforming software development"  
  https://getdx.com/blog/ai-assisted-engineering-hub/
- Local codebase references:
  - `lib/utils.js`
  - `lib/git.js`
  - `lib/manifest.js`
  - `docs/architecture.md`

## Recommendation

Implement an **AI-native scorecard**, not a monolithic productivity score.

My recommendation is to launch Aigon's insights view with a first wave centered on:

1. Prompt-to-Submitted Latency
2. Flow Interruption Burden
3. First-Pass Success Without Rework
4. Rework Rate
5. Cost per Feature
6. Tokens per Line Changed

Then add a second wave built around:

1. Human Edit Distance
2. 7d/30d Persistence Rate
3. Cost per Durable Change
4. Review Turnaround + Review Depth

The product thesis should be:

- **Aigon measures whether AI output survives, not just whether it appears quickly.**
- **Aigon measures orchestration friction, not just code generation.**
- **Aigon connects agent cost, review burden, and rework into a single workflow view.**

That is both commercially differentiated and technically credible from Aigon's current architecture.

## Suggested Features

<!--
Use the table format below. Guidelines:
- feature-name: Use kebab-case, be specific (e.g., "user-auth-jwt" not "authentication")
- description: One sentence explaining the capability
- priority: high (must-have), medium (should-have), low (nice-to-have)
- depends-on: Other feature names this depends on, or "none"
-->

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| ai-scorecard-foundation | Add an insights scorecard for latency, wait burden, first-pass success, rework, cost, and tokens using existing logs/manifests/git telemetry. | high | none |
| session-telemetry-normalization | Capture normalized per-session telemetry across agents/models including turns, tool calls, start/end times, and token/cost usage. | high | ai-scorecard-foundation |
| agent-authorship-attribution | Record agent and human commit/snapshot boundaries so Aigon can compute edit distance and durable-change attribution. | high | session-telemetry-normalization |
| durable-change-analysis | Compute 7-day and 30-day persistence for merged changes and surface durable-change rate trends. | high | agent-authorship-attribution |
| review-signal-integration | Import PR review timestamps, approvals, comments, and requested-changes events from GitHub/GitLab. | medium | ai-scorecard-foundation |
| cost-per-durable-change | Combine token telemetry with durability and attribution to show AI spend per durable shipped outcome. | medium | durable-change-analysis |
| agent-comparison-insights | Compare agents on latency, first-pass success, rework, durability, and cost in the insights dashboard. | medium | ai-scorecard-foundation |
| insights-dashboard-foundation | Initial insights view with basic latency, wait burden, and first-pass metrics. | low | ai-scorecard-foundation |
