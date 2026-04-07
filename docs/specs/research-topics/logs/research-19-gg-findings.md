# Research Findings: AI-Native Workflow Metrics

## Overview

Based on industry research (DX, LinearB, Jellyfish, DORA 2024, and the emerging SPACE/GAINS frameworks), measuring AI developer productivity requires moving beyond traditional output metrics (lines of code, PR count). AI inherently inflates "activity" metrics while often bottlenecking the review phase and increasing initial rework. 

The industry is converging on frameworks like **DX Core 4** (Speed, Effectiveness, Quality, Impact) and focusing on "code survivability" and "rework rates" over pure velocity.

## Answers to Research Questions

### Metric Selection & Prioritization
The top 5-10 metrics that provide the highest signal-to-noise for AI-native workflows, and which Aigon can realistically measure, are:
1. **AI Code Survivability (Persistence Rate)**: % of agent-authored code remaining in the codebase after 1 sprint (14 days).
2. **AI Edit Distance**: The diff size between an agent's commit and the final human commit merged to main.
3. **Agent Rework Rate**: Frequency of human commits (or subsequent agent sessions) modifying agent-authored lines within 48-72 hours.
4. **Prompt Efficiency / Session-to-Success Rate**: Ratio of successful agent sessions (ending in a commit/PR) vs. abandoned sessions, along with turns-to-completion.
5. **AI-Segmented Cycle Time**: Time from spec creation to PR merge for AI-assisted features vs. manual features.
6. **Review Phase Expansion**: Time spent in the PR review phase for AI-generated code vs. human-generated code.
7. **Token-to-Value Ratio (ROAI)**: Token/API cost per merged feature or resolved ticket.

**Instrumentation Needed**: Aigon needs to start explicitly tagging its commits (e.g., via `Co-authored-by: Aigon` or a specific git author) and implement a background telemetry job that periodically runs `git blame` to calculate survivability and rework.

### Inner Loop Metrics
- **Persistence Rate**: Should be measured at 7-day and 14-day intervals. Aigon can run a background script checking the `git blame` of files touched by previous agent commits.
- **AI Edit Distance**: Measured via `git diff <agent_final_commit>...<merge_commit_to_main>`. It shows how much "polishing" the human had to do.
- **Prompt Efficiency**: Can be measured non-invasively by tracking the number of conversational turns or elapsed time in an agent session before the session reaches a "done" state.
- **Prompt-to-PR Latency**: Meaningfully different from traditional cycle time. Cycle time anchors at ticket creation; Prompt-to-PR anchors at the *start of cognitive work* (the first prompt), measuring pure implementation speed.

### Quality Metrics
- **Attribution**: Aigon must enforce a strict git attribution strategy. Every agent commit should use a specific email (`agent@aigon.dev`) or a git trailer (`Aigon-Agent-ID: <id>`).
- **Rework Rate**: Best defined as a human commit modifying lines previously authored by an agent within 7 days. High rework indicates the agent's context or capabilities were insufficient.
- **Review Quality**: Aigon can measure the ratio of review comments to PR size. AI-heavy PRs often have 150% more volume, so measuring review velocity without measuring review depth risks incentivizing the "IKEA effect" (rubber-stamping AI code).

### Business & Value Metrics
- **Token-to-Value Ratio**: Value should be anchored to Aigon's "Feature Specs" or resolved issue tickets. Calculated as: `Total Tokens Used for Feature / 1 Feature Delivered`.
- **Autonomous Resolution Rate**: Highly applicable to Aigon, especially for bug-fixing or test-fixing agents. Defined as incidents/bugs resolved with zero human commits added before merge.
- **Cost Data**: Aigon tracks agent sessions, so it can easily calculate token usage and map it to estimated LLM API costs.

### Competitive Landscape
- **DX**: Focuses heavily on developer sentiment (DevEx) and line-level code authorship.
- **LinearB**: Focuses on workflow automation (PR routing) and tracking AI review coverage.
- **Jellyfish**: Focuses on resource allocation and whether AI shifts time from KTLO (Keep The Lights On) to Innovation.
- **Standards**: The **SPACE** framework is favored over DORA because DORA's "Deployment Frequency" can be artificially inflated by AI, masking underlying tech debt. The **GAINS** framework is an emerging standard specific to GenAI.

### Implementation in Aigon
- **Data Model Mapping**: Aigon's feature specs map perfectly to "Value". Agent session logs map to "Prompt Efficiency". Git history maps to "Survivability" and "Edit Distance".
- **Presentation**: Should be presented as an "AI ROI Dashboard" in the insights view showing time saved, rework bottlenecks, and token costs.
- **Insights view scope**: AI-Segmented Cycle Time, Prompt Efficiency, Code Survivability, Rework Rate, and Token-to-Value (ROI).

## Recommendation
Aigon should adopt a **"Quality & Survivability First"** metrics strategy. Since Aigon acts as an autonomous orchestrator, proving that Aigon's code *survives* without human rework is the ultimate proof of value.

We should immediately implement git attribution for all Aigon commits and build a background telemetry service that calculates **AI Edit Distance** and **Code Survivability**. These two metrics will form the core of Aigon's insights dashboard, differentiating Aigon from tools that only report vanity metrics like "lines generated."

## Suggested Features

| Feature Name | Description | Priority | Depends On |
| :--- | :--- | :--- | :--- |
| `agent-git-attribution` | Ensure all agent commits use a distinct author email or git trailer for precise tracking. | high | none |
| `metric-code-survivability` | Background job that uses git blame to calculate the 14-day persistence rate of agent code. | high | `agent-git-attribution` |
| `metric-ai-edit-distance` | Calculate the diff size between the final agent commit and the PR merge commit. | high | `agent-git-attribution` |
| `dashboard-roi-insights` | Insights view to visualize Token-to-Value, Survivability, and Rework Rate. | medium | `metric-code-survivability` |
| `metric-prompt-efficiency` | Track and visualize agent session length and turns-to-completion per feature. | medium | none |
| `metric-review-expansion` | Measure the time PRs sit in review, segmented by % of AI-authored code. | low | `agent-git-attribution` |

## Sources
- DX AI Measurement Framework & DX Core 4 (getdx.com)
- DORA 2024 Report (Throughput paradox and AI delivery stability)
- SPACE Framework adaptations for AI (Microsoft Research / GitHub)
- LinearB and Jellyfish AI productivity methodologies
- GAINS Framework for AI-native workforce metrics