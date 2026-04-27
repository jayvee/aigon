# Research Findings: competitive positioning and landscape

**Agent:** OpenCode (op)
**Research ID:** 44
**Date:** 2026-04-27

---

## Key Findings

### 1. Category & Positioning Terminology

#### Market terminology audit

I surveyed how competitors, analysts, and media describe tools in Aigon's space. The dominant terms in current use:

| Term | Who uses it | Mindshare | Ambiguity |
|------|------------|-----------|-----------|
| **AI coding agent** | Devin, Cline, Aider, OpenCode, most media | Very high | High — covers single-agent tools too |
| **Agentic IDE** | Kiro, Cursor marketing | High | Medium — implies IDE, excludes CLI-only |
| **AI coding assistant** | Copilot, Cursor (older), Augment | Very high | Very high — includes non-agentic tools |
| **Multi-agent coding** | Aigon, GSD, Cline (Kanban) | Low-medium | Low — specific, but niche awareness |
| **Spec-driven development** | Kiro, GSD, OpenSpec, BMad | Medium | Medium — "spec" means different things |
| **Agent orchestration** | LangGraph, Aigon, academic papers | Low | Medium — overlaps with infra frameworks |
| **Coding workflow orchestration** | None widely | Negligible | Low — but nobody uses it |
| **Context engineering** | GSD, Tessl, some bloggers | Low-medium | Medium — trendy but imprecise |
| **AI software engineer** | Devin | Medium | High — aspirational, not descriptive |

#### Recommended primary category: "AI coding agent"

This is the term with the strongest existing mindshare and lowest ambiguity for the broad market. However, Aigon is not just another AI coding agent — it is a **meta-agent** or **orchestrator** that coordinates other coding agents. The right positioning is:

**Primary category alignment:** AI coding agent (the market's term)
**Differentiating sub-category:** Multi-agent orchestration / spec-driven workflow

The key insight from competitor language: **Kiro** calls itself "Agentic AI development" and "spec-driven development." **GSD** calls itself "meta-prompting, context engineering and spec-driven development." **Cline** calls itself "The Open Coding Agent." Nobody has claimed the "orchestration" or "meta-agent" lane convincingly.

#### Recommended primary term: **"AI coding agent orchestrator"**

- Aligns with "AI coding agent" (market's term) but adds the differentiator
- "Orchestrator" implies coordination of multiple agents — Aigon's unique capability
- Low ambiguity: "orchestrator" clearly means "I manage other agents," not "I am an agent"
- Alternative: "multi-agent coding orchestrator" — more specific but less recognizable

#### Positioning copy

**One-liner:**
> Aigon orchestrates multiple AI coding agents on the same feature — run them head-to-head, then ship the best result.

**One-paragraph:**
> Aigon is an open-source orchestrator for AI coding agents. It runs Claude Code, Gemini CLI, Codex CLI, and Cursor in parallel on the same feature in isolated worktrees, evaluates their implementations, and manages the full spec lifecycle from inbox to done. Unlike single-agent tools that help you write code one session at a time, Aigon manages the development workflow — specs, agents, evaluation, feedback — so you can focus on what to build, not how to run it.

**One-page:** (see Recommendation section below for the full page structure)

#### Reusable copy chunks

| Chunk ID | Surface | Copy |
|----------|---------|------|
| `hero` | Landing page hero | Run Claude, Gemini, Codex, and Cursor as a team on the same feature — then ship the best result. |
| `bio` | Social bio, repo description | Open-source orchestrator for AI coding agents. Spec-driven, multi-agent, vendor-independent. |
| `readme` | README opener | Aigon is an open-source, spec-driven orchestration system for AI coding agents — run them head-to-head on the same feature, then score their work so you can ship with confidence. |
| `conference` | Conference abstract | Aigon introduces the concept of multi-agent coding orchestration: running multiple AI coding agents in parallel on the same spec, in isolated git worktrees, with structured evaluation. We'll show how Fleet mode works, how spec-driven development provides durable context across sessions, and how the feedback loop closes the gap between user input and shipped features. |
| `llms` | llms.txt | Aigon: open-source AI coding agent orchestrator. Manages spec lifecycle (inbox→backlog→in-progress→done), runs multiple agents (Claude Code, Gemini CLI, Codex CLI, Cursor) in parallel on the same feature with isolated worktrees, evaluates implementations with structured rubrics, and provides a Kanban dashboard. CLI + web dashboard. No vendor lock-in. |
| `agents` | AGENTS.md descriptor | Aigon is a spec-driven AI coding agent orchestrator — it manages feature and research lifecycles across multiple agents with structured evaluation. |
| `elevator` | Verbal elevator pitch | You know how each AI coding tool works in isolation? Aigon runs them together on the same task, in parallel, and picks the best result. It's like having Claude, Gemini, and Codex compete for you. |

---

### 2. Competitive Landscape (Updated from Research-21)

#### Tier 1: Closest competitors (spec-driven / multi-agent workflow tools)

| Tool | Primary unit of work | Source of truth | Isolation model | Multi-agent behavior | Evaluation model | Interface | Pricing | OSS? |
|------|---------------------|-----------------|-----------------|---------------------|-----------------|-----------|---------|------|
| **Aigon** | Spec (markdown) | Git-committed specs + workflow events | Git worktrees + branches | Parallel competition (Fleet) + sequential (Drive) + set conductor | Formal review (different agent), rubric-based eval (Arena) | CLI + web dashboard | BYO subscriptions, free | Apache 2.0 |
| **Kiro** | Spec (EARS notation) | IDE project state + steering files | In-place (IDE workspace) | None (single agent) | None built-in | IDE + CLI | Free (uses Claude Sonnet) | No (AWS) |
| **GSD** | Spec (markdown plans) | `.planning/` directory (markdown) | Git worktrees (opt-in) | Sequential waves (sub-agents) | Plan checker + verifier agents | CLI (Claude Code / OpenCode / etc.) | Free (BYOK) | MIT |
| **Roo Code** | Task (via `new_task`) | Conversation + `.roomodes` | In-place (single VS Code) | Sequential only (Boomerang) | None (separate PR Reviewer product) | VS Code extension | Free + paid cloud | Apache 2.0 |

#### Tier 2: Adjacent commercial agents

| Tool | Primary unit of work | Source of truth | Isolation model | Multi-agent behavior | Evaluation model | Interface | Pricing | OSS? |
|------|---------------------|-----------------|-----------------|---------------------|-----------------|-----------|---------|------|
| **Cursor** | Session + Background Agent task | `.cursor/rules/`, IDE state | Cloud VMs (Background Agents) | Mission Control (visual orchestration) | Aggregated diff view | IDE + CLI (beta) | Free/Pro $20/Ultra $200 | No |
| **Devin** | Session (cloud) | Cloud workspace | Cloud sandbox | Fleet of Devins for large tasks | PR review + visual QA | Web app + API | $20-500/mo | No |
| **AmpCode** | Thread | Chat history | In-place | Oracle + Librarian sub-agents | Built-in code review (Checks) | CLI + web | Pay-as-you-go, no markup | No |
| **Augment** | Intent | Context Engine (proprietary) | Cloud + local | Multiple agents via Intent | None built-in | IDE + CLI + GitHub bot + Slack | Enterprise (contact sales) | No |
| **Copilot CLI** | Session | `.github/copilot-instructions.md` | In-place | Built-in `/fleet` parallelism | None | CLI | Included with Copilot ($10-39/mo) | No |

#### Tier 3: OSS alternatives

| Tool | Primary unit of work | Source of truth | Isolation model | Multi-agent behavior | Evaluation model | Interface | Pricing | OSS? |
|------|---------------------|-----------------|-----------------|---------------------|-----------------|-----------|---------|------|
| **Cline** | Task (Kanban card) | SQLite + `.clinerules` | In-place (IDE workspace) | Native parallel in CLI 2.0 | None built-in | VS Code + CLI + JetBrains | Free (BYOK) | Apache 2.0 |
| **Aider** | Conversation | Chat history + CONVENTIONS.md | In-place | None (single agent) | None | CLI | Free (BYOK) | Apache 2.0 |
| **OpenCode** | Session | SQLite | In-place | build/plan agents (same session) | None | TUI + desktop + IDE | Free (BYOK + Zen) | MIT |
| **Goose** | Recipe (YAML) | Recipe files | In-place | None | None | CLI | Free (BYOK) | Apache 2.0 |
| **Crush** | Session | `crush.json` + `AGENTS.md` | In-place | None (single agent) | None | TUI (Bubble Tea) | Free (BYOK) | FSL-1.1-MIT |
| **OpenSpec** | Proposal | Spec files (markdown) | In-place | None | None | CLI (slash commands) | Free | MIT |
| **BMad** | Phase | Spec + design docs | In-place | Sequential (adversarial review) | Adversarial review | CLI | Free | OSS |

#### Tier 4: Do NOT compare against

| Tool | Reason |
|------|--------|
| **LangGraph** | Agent infrastructure framework, not a coding tool |
| **Windsurf** | IDE-only, no CLI, less relevant than Cursor |
| **SWE-agent** | Research tool, not production |
| **Amazon Q Developer** | Enterprise cloud tool, different category |
| **Copilot Workspace** | Discontinued May 2025; spec ideas folded into Copilot Coding Agent |
| **Tessl** | Skill registry/marketplace, complementary not competitive |
| **Mentat** | Activity slowed significantly |
| **Sweep** | Team pivoted, archived |

#### New tools since research-21 (warranting inclusion)

| Tool | Why include | Status |
|------|------------|--------|
| **Crush** (charmbracelet) | Successor to archived OpenCode (Go); 23.5k stars, Go/Bubble Tea TUI, multi-model, LSP-enhanced, MCP support. Direct competitor to OpenCode and Aider in the terminal agent space. | Active, v0.62.1 |
| **Cline CLI 2.0** | Now has CLI (not just VS Code), native parallel agents, Kanban sidebar. Graduated from "monitor" to "include." | Active, Feb 2026 |
| **Copilot CLI** | GA since Feb 2026, built-in Fleet parallelism, multi-model. High relevance. | GA |
| **Kilo** | Referenced in GSD's supported runtimes list. Lightweight CLI agent. | Emerging |

#### Tools no longer relevant since research-21

| Tool | Reason |
|------|--------|
| **OpenCode (Go/TUI)** | Archived Sept 2025; continued as Crush |
| **Copilot Workspace** | Discontinued May 2025 |

---

### 3. Philosophy / Approach Axes

#### What competitor comparison pages actually use

I examined how competitors structure their own comparisons:

- **Cursor**: No public comparison page (404 on cursor.com/comparisons). Uses category positioning ("AI-first IDE") rather than explicit axes.
- **Kiro**: Compares against "vibe coding" — single axis: structured vs unstructured. Their positioning is entirely around spec-driven development vs. ad-hoc prompting.
- **Devin**: No explicit comparison page. Positioned as "AI software engineer" — the unit of work itself is the differentiator.
- **Aider**: No comparison page; uses benchmark leaderboards instead (Aider Polyglot scores). Comparison is purely quantitative (model quality).
- **OpenCode**: No comparison page; positioned on model breadth and community size.
- **Cline**: No comparison page; positioned on openness and install count.
- **GSD**: Implicitly compares via feature list (wave execution, context rot avoidance, multi-runtime support). No formal axes.

**Key finding:** Almost no competitor publishes an explicit philosophy-axis comparison. The ones that exist (like Aigon's current page) are unusual in the market. This is both an opportunity (differentiate) and a risk (nobody expects this format, may seem defensive).

#### Recommended 10 axes (revised from starting suggestions)

The axes below are renamed to use established market vocabulary where possible, and reordered by legibility:

| # | Axis | What it contrasts | Why this axis |
|---|------|-------------------|---------------|
| 1 | **Execution model** | Local CLI-in-tmux vs IDE-embedded vs cloud sandbox | Most fundamental: where does the work happen? |
| 2 | **Unit of work** | Spec / task card / session / branch / issue | What's the atomic deliverable? Directly comparable. |
| 3 | **Agent strategy** | Single agent vs sequential delegation vs parallel competition vs hybrid | Captures the multi-agent philosophy difference. Replaces "multi-agent behavior" and "orchestration model" — this is the market's vocabulary. |
| 4 | **Model selection** | BYO subscriptions vs platform fee vs single-model vs auto-routing | How does the user choose or pay for models? A critical purchase-decision axis. |
| 5 | **State ownership** | Git-committed files vs hosted workspace vs session-only vs proprietary engine | Where does truth live? Directly affects portability and vendor lock-in. |
| 6 | **Isolation model** | Git worktrees vs branches vs cloud sandbox vs in-place | How are parallel efforts kept separate? Technical but important. |
| 7 | **Quality assurance** | Formal review by different agent vs rubric eval vs diff review vs none | How is work evaluated before merging? |
| 8 | **Interface** | CLI + dashboard vs IDE vs TUI vs web app vs mixed | Where do you interact? |
| 9 | **Lifecycle scope** | Full kanban (inbox→done) vs single milestone vs session-only vs none | How much of the dev lifecycle is managed? |
| 10 | **Pricing model** | BYO subs / usage-based / platform fee / free / enterprise | How do you pay? |

**Axes dropped from starting list:**
- "Source of truth" → merged into "State ownership" (same concept, market term)
- "Orchestration model" → merged into "Agent strategy" (the market says "multi-agent" not "orchestration model")
- "Evaluation model" → renamed to "Quality assurance" (broader, less jargon)

**Axes renamed to match market vocabulary:**
- "Orchestration model" → "Agent strategy"
- "Source of truth" → "State ownership"
- "Evaluation model" → "Quality assurance"

#### 5 public axes vs 5 internal axes

**Public (most legible to casual reader):**
1. Agent strategy (parallel competition is the #1 differentiator)
2. Unit of work (spec vs session — easy to grasp)
3. Model selection (BYO vs locked — purchase decision)
4. Quality assurance (formal review vs none — risk management)
5. Pricing model (BYO subscriptions vs platform fee — money)

**Internal (deeper, for `docs/competitive/`):**
6. Execution model
7. State ownership
8. Isolation model
9. Interface
10. Lifecycle scope

#### Aigon's honest trade-offs per axis

For each public axis, where is Aigon's approach genuinely a trade-off (not a unilateral win)?

| Axis | Aigon's approach | Honest trade-off |
|------|-----------------|------------------|
| Agent strategy | Parallel competition (Fleet) | More resource-intensive; requires managing multiple subscriptions; overkill for simple tasks |
| Unit of work | Spec (markdown) | More upfront work than "just start coding"; specs can become stale if not maintained |
| Model selection | BYO subscriptions | User must procure and manage their own API keys/subscriptions — no turnkey billing |
| Quality assurance | Formal review + rubric eval | Adds a step; slower than "just ship it"; review agent quality depends on the model chosen |
| Pricing model | BYO subs (free tool) | Total cost depends on how many agent subscriptions you run; can be $0 or $200+/mo |

---

### 4. Honest Weaknesses

Where does each competitor genuinely beat Aigon?

| Competitor | What they do better | Who it matters for |
|------------|-------------------|--------------------|
| **Cursor** | Polished visual IDE experience; embedded browser testing; aggregated diff view; Background Agents on cloud VMs; zero-config setup | Teams embedded in VS Code; visual/QA-heavy workflows; anyone who wants zero terminal time |
| **Kiro** | Spec-driven development with zero setup; EARS notation is more structured than freeform markdown; autopilot mode works out of the box; AWS backing; free (includes Claude Sonnet) | Teams that want spec-driven dev without managing multiple agents; AWS shops; solo devs who want one tool |
| **GSD** | Wave-based execution with auto-dependency ordering; works with 14+ runtimes; context rot prevention; larger community (57.6k stars); spiking/sketching built in | Solo devs who want a lighter-weight spec system focused on a single milestone at a time; anyone using non-standard agent runtimes |
| **Roo Code** | Fine-grained per-mode tool control with fileRegex; project-level MCP config; codebase semantic indexing; checkpoint/rollback per modification; mode marketplace | Developers who want deep IDE integration with granular safety controls; teams sharing agent configurations |
| **Devin** | Full cloud execution (no local setup); fleet of Devins for large-scale migrations; fine-tuning on your codebase; integrations with Linear, Slack, Datadog | Enterprise teams doing large migrations; teams that want zero local infrastructure; scheduled/automated workflows |
| **Cline** | 5M+ installs and huge community; Kanban sidebar; CLI + IDE + JetBrains; MCP marketplace | Developers who want a single-agent tool with broad IDE support and community momentum |
| **OpenCode** | 132k stars, 650k MAU; 75+ models; desktop app + IDE extension; built-in web search | Developers who want maximum model flexibility and community support; cost-conscious users |
| **Aider** | Deepest git integration (auto-commits per change); broadest model support via litellm; simple and mature; repo-map for large codebases | Developers doing pair programming; anyone who wants the simplest possible terminal AI tool |
| **Crush** | Go-based (fast, low resource usage); LSP-enhanced context; Charm ecosystem integration; multi-platform including FreeBSD; AGENTS.md auto-initialization | Terminal-native developers; Go/Rust shops; Charm ecosystem users |
| **AmpCode** | Oracle + Librarian specialized sub-agents; pay-as-you-go with no markup; excellent code review (Checks); strong community testimonials | Developers who want CLI-first with built-in code review; cost-transparent users |

**Aigon's deepest weaknesses (the honest "what Aigon doesn't do"):**

1. **No IDE experience.** Aigon is CLI + web dashboard. If your team lives in an IDE and rarely opens a terminal, Aigon is the wrong tool. Cursor, Cline, and Kiro all offer native IDE experiences.

2. **No zero-config onboarding.** Getting started requires installing the CLI, understanding the spec lifecycle, learning slash commands, and configuring agent hooks. One-click IDE tools like Cursor or Cline are productive in minutes.

3. **No embedded visual testing.** No browser testing, no visual diffs, no screenshot-based verification. Cursor's aggregated diff view and embedded browser are better for visual comparison.

4. **Requires multiple subscriptions.** The value proposition depends on running multiple agents, which means you need multiple API keys or subscriptions. This is a barrier for solo devs or cost-conscious teams.

5. **Smaller community.** Aigon is new and small. Fewer tutorials, fewer Stack Overflow answers, less battle-testing. Cline has 5M+ installs, OpenCode has 132k stars.

6. **Spec maintenance overhead.** Specs can become stale if not actively maintained. The state machine enforces spec-driven flow, but doesn't enforce spec freshness. Unlike Kiro's EARS notation (which generates specs from prompts), Aigon requires manual spec writing.

7. **No cloud execution.** All agents run locally in tmux. There's no cloud sandbox option like Cursor Background Agents or Devin. This limits scalability for teams without powerful local machines.

---

### 5. Recurring-Update Mechanism Design

#### Recommended design: Monthly competitive-scan recurring feature

**What it scans:**
- GitHub releases/stars for tracked tools (via GitHub API `GET /repos/{owner}/{repo}/releases`)
- Product blogs and changelogs (RSS/Atom feeds where available, web scraping as fallback)
- Hacker News (Algolia API) for launch announcements and comparison discussions
- Reddit r/LocalLLaMA, r/ClaudeAI, r/ChatGPT (Reddit API) for new tool discoveries
- SWE-bench leaderboard (swebench.com) for benchmark changes

**What it produces:**
- **New tool entries**: Draft markdown files in `docs/competitive/entries/` for tools not yet tracked
- **Matrix patches**: Suggested edits to `docs/competitive/matrix.md` with changed axis values
- **Changelog**: `docs/competitive/changelog/{YYYY-MM}.md` with dated entries for what changed

**Scan frequency:** Monthly (aligned with Aigon's recurring feature engine)

**Output format:**
```markdown
# Competitive Scan: {YYYY-MM}

## New Tools
- **Tool Name** — one-line description. Stars: N. Relevance: Tier N. [Source]

## Changed Tools
- **Tool Name** — what changed (new feature, pricing change, status change). [Source]

## Stale Tools
- **Tool Name** — reason for removal (archived, inactive >90 days, mindshare collapsed). [Source]

## Benchmark Updates
- SWE-bench Verified: [updated scores]
- Aider Polyglot: [updated scores]
```

**Automation approach:**
- Use the existing recurring feature engine (`aigon schedule add`)
- Spawn a research topic each month with a standardized brief
- The research agent scans the above sources, produces the changelog, and proposes matrix patches
- A human reviews before merging (don't auto-update the competitive matrix)

**Implementation notes:**
- The recurring topic brief should include the current tool list and their last-known states
- GitHub star counts and release dates are machine-readable; use them as automated signals
- Qualitative judgments (relevance tier, honest weaknesses) always need human review
- Store scan results in `docs/competitive/scans/{YYYY-MM}.md` for historical tracking

---

## Sources

### Category & Positioning
- [Kiro homepage](https://kiro.dev) — "Agentic AI development from prototype to production," "spec-driven development"
- [AmpCode homepage](https://ampcode.com) — "Engineered For The Frontier," "frontier coding agent"
- [Cline homepage](https://cline.bot) — "The Open Coding Agent"
- [Devin homepage](https://devin.ai) — "The AI Software Engineer"
- [Crush GitHub](https://github.com/charmbracelet/crush) — "Glamourous agentic coding for all," 23.5k stars
- [GSD GitHub](https://github.com/gsd-build/get-shit-done) — "meta-prompting, context engineering and spec-driven development system," 57.6k stars
- [Aider homepage](https://aider.chat) — "AI pair programming in your terminal"
- [OpenCode docs](https://opencode.ai) — "Model-agnostic terminal agent"
- [MorphLLM 15 Agents Compared](https://www.morphllm.com/ai-coding-agent) — uses "AI coding agent" as the category
- [Awesome CLI Coding Agents](https://github.com/bradAGI/awesome-cli-coding-agents) — uses "CLI coding agents"

### Prior Research (Aigon internal)
- Research-21 CC findings — coding agent landscape (March 2026)
- Research-24 CC findings — Roo Code deep dive (March 2026)
- Research-25 CC findings — OpenCode deep dive (March 2026)
- `docs/comparisons-extended.md` — current internal comparison doc
- `site/content/comparisons.mdx` — current public comparison page
- `README.md` — current one-liner: "Spec-driven AI development and multi-agent orchestration"

### Benchmarks
- [Aider LLM Leaderboards](https://aider.chat/docs/leaderboards/) — polyglot coding benchmark (GPT-5 high: 88.0%, Grok 4: 79.6%, Claude Opus 4: 72.0%)
- [SWE-bench Verified leaderboard](https://www.swebench.com/) — referenced in research-21 (top 3 agents within 0.8%)

### Competitor Comparison Pages (examined)
- Cursor: no public comparison page (404 on cursor.com/comparisons)
- Kiro: positions against "vibe coding" rather than specific tools
- Devin: no comparison page; positioned by use case (migrations, PR review, etc.)
- Aider: uses benchmark leaderboards instead of feature comparison
- All others: no explicit comparison pages found

---

## Recommendation

### Positioning

Aigon should align to the market category **"AI coding agent"** and differentiate with the sub-category **"orchestrator."** The primary term to adopt: **"AI coding agent orchestrator."**

This is defensible because:
1. It meets the market where it is (people search for "AI coding agent")
2. "Orchestrator" immediately signals Aigon doesn't compete with the agents themselves — it coordinates them
3. It avoids the trap of inventing a new category (nobody searches for "spec-driven dev framework")
4. It's honest — Aigon literally orchestrates other agents

The current "spec-driven AI development and multi-agent orchestration" tagline is internally accurate but externally confusing. "Spec-driven" is Kiro's term too, and "multi-agent orchestration" is abstract. Lead with what's unique and concrete: **running multiple agents in parallel on the same feature.**

### Revised public comparison page

The public page should use 5 philosophy axes (not feature checkmarks), structured as "how does each tool approach X?" not "does tool Y have X?":

1. **Agent strategy** — single vs sequential vs parallel competition
2. **Unit of work** — session vs spec vs task card
3. **Model selection** — BYO vs platform vs locked
4. **Quality assurance** — none vs diff vs formal review
5. **Pricing model** — BYO subs vs platform fee vs usage-based

Each axis should include an honest framing of Aigon's trade-off, not just a win. The "Where Aigon falls short" section should stay and be expanded.

### Internal competitive matrix

Use all 10 axes in `docs/competitive/matrix.md` with per-tool entries. Update monthly via the recurring scan mechanism.

### Three-category framing

Keep the three-category mental model from the current page, but refine it:

1. **Coding agents** (Aider, OpenCode, Crush, Goose) — write code in a session
2. **Agentic IDEs** (Cursor, Kiro, Cline, Windsurf) — embed agents in a visual environment
3. **Workflow orchestrators** (Aigon, GSD, BMad, OpenSpec) — manage the development lifecycle

Aigon is the only tool at the intersection of workflow orchestration and multi-vendor agent competition.

### GSD specifically deserves more attention

GSD (57.6k stars) is the closest competitor in the "orchestrator" category. Key differences to emphasize:
- GSD: single-milestone focus, wave-based execution, works inside one agent at a time
- Aigon: full kanban lifecycle, parallel agent competition (Fleet), cross-agent evaluation
- GSD's 14-runtime support is broader than Aigon's current 4, which is a genuine advantage for GSD

### Copy chunk adoption

The reusable copy chunks in this findings document should be adopted as the canonical source. Specifically:
- **README.md** line 8: change from "Spec-driven AI development and multi-agent orchestration" to the `readme` chunk
- **Landing hero**: adopt the `hero` chunk
- **AGENTS.md**: adopt the `agents` chunk
- **llms.txt**: adopt the `llms` chunk
- **Social bio / repo description**: adopt the `bio` chunk

---

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| competitive-internal-matrix | Create `docs/competitive/` with the 10-axis matrix, per-tool deep-dive entries, and honest-weaknesses section | high | none |
| public-comparison-page-rewrite | Rewrite `site/content/comparisons.mdx` around the 5 public philosophy axes with honest trade-off framing (supersedes F238) | high | none |
| aigon-positioning-page | Create `docs/marketing/positioning.md` with one-liner / one-paragraph / one-page versions plus reusable copy chunks; update AGENTS.md, README, landing hero, llms.txt to use the canonical chunks | high | none |
| recurring-competitive-refresh | Recurring monthly feature that scans GitHub releases, product blogs, HN, Reddit for new tools and proposes updates to the internal matrix | medium | competitive-internal-matrix |
| close-f238 | Close F238 as superseded by the public-comparison-page-rewrite feature | high | public-comparison-page-rewrite |
| adopt-canonical-copy | Update README.md, AGENTS.md, site landing hero, and repo description to use the positioning copy chunks from this research | high | aigon-positioning-page |
