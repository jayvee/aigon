# Research: AI Development Effectiveness

**Status:** done
**Created:** 2026-03-17

## Context

The Aigon dashboard currently surfaces two core metrics: **feature throughput** (count of completed features) and **cycle time** (duration from start to done). These already nudge users toward smaller, faster features.

The next step is measuring *how efficiently* the AI is being used per feature — not just speed, but cost, interaction overhead, and implementation clarity. This research explores what additional signals are worth capturing, what data Aigon already has access to, what commercial products are doing in this space, and how to frame the results.

Aigon's unique position: this is **individual developer effectiveness**, not team/org metrics. The user is optimising their own AI workflow.

## Data Aigon Has Today

Before designing metrics, research agents should understand what's currently available:

- **Feature lifecycle**: spec creation date, status transitions (inbox → backlog → in-progress → done), completion date
- **Git per feature**: branch name, commits, diffs (lines added/removed, files changed) — all derivable from `git log` on the feature branch
- **Session logs**: feature logs exist in `docs/specs/research-topics/logs/` — but do implementation sessions capture interaction data (message counts, turn counts)?
- **Token usage**: not currently tracked. Investigate what Claude Code / Cursor expose (API responses include token counts; do session logs or hooks have access?)
- **Spec files**: the feature spec itself — could be analysed for completeness or structure

A key question: **what data is missing that would be cheap to start capturing now?**

## Questions to Answer

### 1. Token Efficiency

Tokens are a direct measure of how much AI computation a feature consumed. Reducing tokens per feature over time could indicate the developer is writing better specs, giving clearer instructions, or choosing the right mode (autonomous vs interactive).

- [ ] Is "tokens per feature" meaningful? Is lower always better, or does complexity need to be normalised?
- [ ] How would we capture token usage? What do Claude Code and Cursor expose per session? (API response headers, session summaries, hooks?)
- [ ] Should we distinguish input vs output vs thinking tokens? Or is total sufficient?
- [ ] Is the **trend** (tokens per feature over time) more valuable than any single number?
- [ ] Should cost ($) be surfaced alongside or instead of raw token counts?
- [ ] How does autonomous mode vs interactive mode differ in token consumption?

### 2. Interaction Overhead

The amount of back-and-forth between user and agent is a proxy for how well-defined the feature was and how smoothly the implementation went.

- [ ] What's the best measure: message count? user-turn count? session duration? Some combination?
- [ ] Autonomous features (zero interaction) are the ideal — how do we frame the spectrum from fully autonomous to highly interactive?
- [ ] Is there a way to distinguish productive interaction (clarifying requirements) from unproductive interaction (correcting agent mistakes, thrashing)?
- [ ] Does Aigon currently have the data to compute this, or would session logging need to change?
- [ ] What's the relationship between spec quality and interaction count? Can we validate this with existing feature data?

### 3. Git Signals

Every feature has a branch. The commit history tells a story about the implementation process.

- [ ] What does commit count per feature indicate? Is 1 commit (clean autonomous) better than 10 (iterative)?
- [ ] Is lines changed per feature useful? Or too noisy (a config change vs a refactor)?
- [ ] Can we detect **rework** from commit patterns? (e.g. "fix" commits, reverts, high churn in the same files)
- [ ] What are useful aggregates: average/median commits per feature, average files touched, average lines changed?
- [ ] Are there **anti-patterns** worth flagging? (e.g. very high churn = thrashing, single massive commit = no checkpointing)

### 4. Competitive Landscape

Other products are measuring AI development effectiveness at various levels. Understand what they do, what signals they use, and where Aigon's individual-developer angle differs.

- [ ] **DX** — what do they measure? How do they define AI effectiveness? What's their methodology?
- [ ] **Cadence** — what's their angle? What stage are they at?
- [ ] Other tools: LinearB, Waydev, Pluralsight Flow, Swarmia — do any focus on individual AI-assisted workflow?
- [ ] What metrics have proven **controversial** in dev productivity measurement? (e.g. lines of code as a KPI)
- [ ] Are there academic papers or frameworks (DORA, SPACE, DevEx) that address AI-assisted development specifically?

### 5. Naming & Framing

If we introduce a dashboard section or score for this, how do we frame it?

- [ ] What do existing products call their metrics? What language resonates?
- [ ] Is a **single composite score** desirable (like a "Flow Index"), or should it remain individual indicators?
- [ ] What framing feels **motivating** to a solo developer vs judgemental? (This is a personal tool, not a manager's surveillance dashboard)
- [ ] Candidate names to evaluate against what competitors use:
  - "AI Development Effectiveness" (ADE)
  - "Flow Index"
  - "Amplification Score"
  - "Leverage Score"
  - "Efficiency Score"

## Scope

**In scope:**
- Metrics derivable from data Aigon has or could cheaply add: git history, feature lifecycle, session logs, token usage, spec files
- Individual developer effectiveness (personal optimisation)
- Data availability audit — what exists today vs what needs to be added
- Competitive product analysis
- Naming and dashboard framing options

**Out of scope:**
- Team-level or org-level analytics
- Integration with external project management tools (Jira, Linear, etc.)
- Implementing any metrics — this is research only
- Code quality metrics (test coverage, bug rates) — that's a different dimension

## Inspiration

- **DX** — team AI effectiveness measurement, survey + tooling signals
- **Cadence** — startup focused on AI workflow effectiveness
- **DORA metrics** — deployment frequency, lead time, change failure rate, MTTR
- **SPACE framework** (Microsoft Research) — Satisfaction, Performance, Activity, Communication, Efficiency
- **DevEx** — Developer Experience metrics, published by DX + GitHub

## Synthesis

### Naming Decision

**AADE (Aigon AI Development Effectiveness)** confirmed as the official name. "AIDE" was considered but rejected — three conflicts: Aide by CodeStory (YC-backed AI IDE at aide.dev), AIDE (Advanced Intrusion Detection Environment, well-known Linux tool), and name proximity to Aider (aider.chat). AADE has zero conflicts. User-facing dashboard label: **"Amplification"**.

### Consensus (Both Agents Agreed)

1. Tokens per feature is meaningful but needs normalisation — trend over time matters more than any single number
2. Git signals (commit churn, fix cascades, reverts) reliably detect rework and thrashing
3. Competitive landscape is entirely team/org-focused — no tool serves the individual solo developer (genuine whitespace)
4. Token/cost capture is the highest-priority missing data
5. "Amplification" framing resonates — motivating, non-judgmental

### Divergent Views

- **Token capture mechanism:** Claude recommended SessionEnd hook parsing transcript JSONL (verified working); Gemini recommended OpenTelemetry integration — both are valid adapter approaches
- **Interaction overhead:** Claude favoured wait-event count (already tracked); Gemini favoured turn/message count (new tracking needed)
- **Composite score:** Gemini wanted a "Leverage Score" composite; Claude recommended against it initially. Decision: no composite score — individual indicators are more actionable for a solo developer
- **Cursor data:** Claude says no per-session tokens available; Gemini claims a private Dashboard API exists. Resolved by the adapter model — each agent adapter captures what it can

### Key Architectural Decision: Agent Adapter Model

Aigon is multi-agent. Each agent (cc, gg, cu, etc.) exposes different telemetry. Rather than a single capture mechanism, AADE uses an **adapter model**: when you add an agent to Aigon, part of the agent definition includes how to gather telemetry for that agent. The adapter normalises data into a common schema stored in log frontmatter.

### Storage Decision: Frontmatter

All AADE telemetry stored as flat scalar fields in existing feature log frontmatter. Adds ~15 fields per feature (~200 bytes). Scales well to hundreds of features — already parsed by `parseLogFrontmatterFull()`, git-friendly diffs, no new files or databases needed. Per-turn granularity is explicitly not stored — only aggregated totals.

### Commercial Gating

AADE is the foundation of Aigon's commercial product offering:
- **Free tier (Aigon OSS):** Core workflow — feature lifecycle, Kanban board, agent orchestration, basic dashboard with throughput and cycle time
- **Commercial tier (AADE/Amplification):** Token/cost tracking, git signal analysis, rework detection, amplification dashboard, AI-powered insights and coaching

The AI insights layer has per-call API costs that justify a subscription. Every competitor charges for analytics. The individual-developer positioning is differentiated.

## Recommendation

Start with what's cheap and high-value. Aigon already has the strongest interaction/autonomy metrics in the space. The four features below fill the gaps with minimal code, leverage existing data, and build toward the commercial Amplification tier.

## Output

### Selected Features

| Feature Name | Description | Priority | Create Command |
|--------------|-------------|----------|----------------|
| aade-telemetry-adapters | Agent adapter model for telemetry capture — each agent gets an adapter that extracts tokens, cost, turns, and autonomy labels into a common schema. Claude Code adapter parses transcript JSONL via SessionEnd hook. Includes token normalisation (tokens-per-line-changed). Adapter interface so future agents plug in cleanly. | high | `aigon feature-create "aade-telemetry-adapters"` |
| aade-git-signals | At feature-close, compute git metrics per branch: commit count, lines changed, files touched, fix-commit ratio. Flag rework patterns (thrashing: 5+ commits same file, fix cascades: 3+ fix commits, scope creep: files >> spec). Store in log frontmatter. | high | `aigon feature-create "aade-git-signals"` |
| aade-amplification-dashboard | New "Amplification" dashboard section with cost-per-feature cards, rolling trend sparklines, autonomy spectrum labels (Full Autonomy / Light Touch / Guided / Collaborative / Thrashing), first-pass rate, and rework indicators. | medium | `aigon feature-create "aade-amplification-dashboard"` |
| aade-insights | Three-phase insights engine: (1) rule-based CLI `aigon insights` with 5-10 trend/outlier checks, zero LLM cost; (2) LLM-narrated coaching via Claude API with developer workflow coach prompt; (3) dashboard "Insights" tab with cached results and refresh. Commercial gate candidate — free tier gets rule-based, paid tier gets AI coaching. | medium | `aigon feature-create "aade-insights"` |

### Feature Dependencies

- aade-amplification-dashboard depends on aade-telemetry-adapters and aade-git-signals
- aade-insights depends on aade-amplification-dashboard (needs data to analyse)

### Not Selected

- **Composite "Leverage Score":** Individual indicators are more actionable for a solo developer than a single number. Can revisit once indicators are established and users want a rollup.
- **Per-turn message tracking:** Wait-event model already captures interaction overhead better than raw message counts. Marginal gain for significant complexity.
