# Research: AI Development Effectiveness

**Status:** inbox
**Created:** 2026-03-17

## Context

The Aigon dashboard currently surfaces two core metrics: feature throughput (how many features completed) and cycle time (how long each feature takes). These are a strong start, and are already nudging users toward smaller, faster features.

The next frontier is measuring *how well* the AI is being used — not just speed, but quality of interaction. This research explores what additional effectiveness signals are worth capturing, how to derive them from data Aigon already has access to (git, session logs, spec quality), and how to frame and brand those metrics in a way that resonates with AI-native developers.

Commercial products like **DX** and **Cadence** are entering this space from the team/org-level angle. Aigon's opportunity is the individual developer level — personal AI workflow effectiveness as a first-class metric.

## Questions to Answer

### Token Usage
- [ ] Is "tokens per feature" a meaningful effectiveness metric? Does lower = better, or is it more nuanced?
- [ ] How do we capture token usage per feature? Does Aigon have access to this data, or does it need to be added to session logging?
- [ ] Is the trend over time more interesting than the absolute number? (e.g. tokens per feature declining = user getting better at prompting)
- [ ] How does token usage relate to spec quality — do better-defined features consume fewer tokens to implement?
- [ ] Are there different token "profiles" worth distinguishing? (input tokens vs output tokens, thinking tokens if using extended thinking models)
- [ ] What's the cost dimension — should token usage also be surfaced as estimated cost per feature?
- [ ] How does autonomous vs interactive mode affect token consumption, and is that worth calling out separately?

### Interaction Quality
- [ ] How do we measure the amount of back-and-forth between user and agent during a feature session? (e.g. message count, turn count, session duration)
- [ ] Is there a proxy for "spec quality" derived from interaction volume? (Better specs → fewer turns → faster resolution)
- [ ] What's a reasonable baseline for "good" vs "noisy" interaction? Is it relative (personal trend) or absolute?
- [ ] For autonomous features (zero interaction), how do we surface this as a positive signal vs just a data-absent edge case?
- [ ] Are there existing tools or research papers on measuring human-AI collaboration quality at the individual level?

### Git Signal Analysis
- [ ] What is the relationship between commit count per feature and implementation quality or clarity of spec?
- [ ] Is a single large commit (squashed) better or worse than many small commits? What does each pattern imply about workflow?
- [ ] Is lines of code changed per feature a useful signal? What does high vs low delta suggest?
- [ ] What are the average/median commits and file changes per feature in typical AI-assisted development? Any benchmarks available?
- [ ] Are there negative patterns to flag? (e.g. very high churn = thrashing, many tiny commits = uncertainty)
- [ ] Can we detect rework from commit messages or diffs? (e.g. "fix", "revert", "undo")

### Competitive Landscape
- [ ] What does **DX** measure? How do they define and display AI development effectiveness? What's their methodology?
- [ ] What does **Cadence** (startup) measure? What's their unique angle or hypothesis?
- [ ] What other tools exist in this space (LinearB, Waydev, Pluralsight Flow, Swarmia, etc.)? What signals do they use?
- [ ] Are any of these individual-developer focused, or all team/org focused?
- [ ] What metrics have proven controversial in this space (e.g. lines of code as a KPI)?

### Branding & Framing
- [ ] What name captures the concept of AI-assisted development effectiveness for a solo developer? Options to evaluate:
  - "AI Development Effectiveness" (ADE)
  - "Workflow Effectiveness Score"
  - "Flow Index"
  - "Amplification Score" (how much the AI is amplifying the developer)
  - "Leverage Score"
  - Something else?
- [ ] Is a single composite score desirable, or should it stay as a set of individual indicators?
- [ ] How do products like Dora metrics, SPACE framework, or DevEx score frame developer productivity in ways we could borrow from or differentiate against?
- [ ] What framing feels motivating vs judgemental to an individual developer?

## Scope

**In scope:**
- Metrics derivable from data Aigon already has: git history, feature lifecycle timestamps, session logs (if captured), spec files
- Individual developer effectiveness (not team metrics)
- Dashboard visualisation ideas
- Branding and naming options
- Competitive product analysis (DX, Cadence, and others)

**Out of scope:**
- Team-level or org-level analytics
- Integration with external tools (Jira, Linear, etc.) — that's a separate feature
- Implementing any metrics (this is research only)

## Inspiration

- **DX** — team AI effectiveness measurement, likely survey + tooling signals
- **Cadence** — startup in this space, specific angle TBD
- DORA metrics — classic 4-metric framework (deployment frequency, lead time, change failure rate, MTTR)
- SPACE framework (Microsoft Research) — Satisfaction, Performance, Activity, Communication, Efficiency
- DevEx — Developer Experience metrics, published by DX + GitHub
