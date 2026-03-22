# Research: ai-native-workflow-metrics

## Context

Traditional software engineering metrics (DORA, cycle time, velocity) were designed for human-driven workflows. In the AI-native development era, these metrics are either misleading or insufficient:

- **Cycle time is artificially compressed** — AI can generate a PR in minutes, but the bottleneck has shifted to validation and review
- **Lines of code / velocity are meaningless** — AI can produce thousands of lines that may need extensive rework
- **Quality signals are inverted** — high throughput may correlate with higher defect rates when AI-generated code isn't properly validated

Aigon already tracks some workflow data (feature lifecycle, agent status, session timing). The opportunity is to define and instrument the **right** metrics for AI-native workflows, then surface them in the Aigon Pro insights/amplification dashboard as a core differentiator.

This research should identify the top 5-10 metrics that Aigon should implement, considering:
- What can Aigon actually measure from its position (CLI, git, agent orchestration)
- What provides genuine signal vs. vanity metrics
- What would be compelling for Aigon Pro's commercial insights offering

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
- [ ] How should metrics be presented in the Aigon Pro insights dashboard? (trends, benchmarks, alerts?)
- [ ] Should any metrics be available in the free tier as a growth lever?

## Scope

### In Scope
- Metrics measurable from an AI development workflow orchestrator's perspective
- Metrics relevant to individual developers and small teams (Aigon's target audience)
- Implementation feasibility within Aigon's architecture
- Commercial positioning for Aigon Pro's insights offering
- Academic and industry research on AI-native development measurement

### Out of Scope
- Enterprise-scale organizational metrics (hundreds of engineers)
- Metrics requiring IDE-level instrumentation (keystroke tracking, suggestion acceptance in editor)
- General software quality metrics that don't change with AI (uptime, SLA compliance)
- Building the actual metrics implementation (that's a separate feature)
