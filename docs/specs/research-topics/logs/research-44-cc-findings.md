# Research Findings: competitive positioning and landscape

**Agent:** Claude (cc)
**Research ID:** 44
**Date:** 2026-04-27

---

## Key Findings

### 1. Category & terminology — pick "harness" + "spec-driven" + "multi-agent"

The market vocabulary settled in Q1 2026 around three orthogonal terms. They name different things and Aigon sits at the intersection of all three:

| Term | What it names | Mindshare drivers |
|---|---|---|
| **AI coding agent harness** | Everything around the model — scaffolding, context, tool dispatch, safety gates. "Agent = Model + Harness." | Anthropic ("effective harnesses for long-running agents"), Martin Fowler ("harness engineering"), Augment Code, InfoQ ("Anthropic three-agent harness"). Coined late 2025, dominant by Q2 2026. |
| **Multi-agent (coding) orchestration** | Coordinating multiple agents on the same goal — typically across worktrees, branches, or containers. | Cline Kanban, Google Scion, oh-my-codex, Cursor 3 Agents Window, Anthropic agent-teams docs. |
| **Spec-driven development (SDD)** | Markdown specs as first-class executable artifacts; agent reasons against the spec, not the chat. | GitHub Spec Kit, BMAD, OpenSpec, Tessl, Kiro. VentureBeat: "Agentic coding at enterprise scale demands spec-driven development." |

"Agent orchestration platform" is **claimed by LangGraph / AutoGen / Microsoft** for general agent frameworks — using it for a coding tool is confusing. Avoid.
"Agentic coding" / "agentic engineering" is the **umbrella vibe phrase** — fine in long copy, too vague as a category claim.
"Vibe coding" is the **opposite pole** Aigon defines itself against.

**Recommendation:** Adopt "**spec-driven multi-agent harness**" as the canonical category claim. Lead with "harness" — it is the precise word and it cuts cleanly against "IDE", "agent" (singular), "framework", and "platform."

### 2. Landscape — 4 tiers, not one matrix

The space has fractured since research-21 (March 2026). Putting all tools on one matrix creates false equivalences. Use tiers:

**Tier A — direct competitors (multi-agent CLI orchestrators in worktrees).** Aigon's actual peer group; matrix should foreground these.
- **Cline Kanban** (`cline/kanban`, npm `cline`, Apache-2.0) — closest surface-area match: Kanban board, ephemeral worktree per task, CLI-agnostic (Claude Code + Codex + Cline), task linking for dependency chains, real-time diff review on cards, free OSS, no account required.
- **Google Scion** (`GoogleCloudPlatform/scion`, open-sourced 2026-04-07) — "hypervisor for agents": isolated container + git worktree + credentials per agent; supports Claude Code, Gemini CLI, OpenCode, Codex; runs locally, on remote VMs, or Kubernetes. Local mode stable; hub mode 80% verified.
- **oh-my-codex / oh-my-claudecode** — community templates wrapping Codex/Claude with worktrees + tmux + 30 role-specialized agents. oh-my-codex hit 18.8k stars April 2026.
- **Cursor 3 Agents Window** (April 2026) — up to 8 parallel agents in worktrees or remote machines; tiled pane UI; not CLI-agnostic but very close to Aigon's parallelism story inside the IDE.
- **Claude Squad / cmux / mux / Composio Agent Orchestrator / workmux** — long tail of similar tmux-and-worktree tools.

**Tier B — spec-driven workflow tools (overlap on lifecycle, not on multi-agent).**
- **GitHub Spec Kit** (`github/spec-kit`) — `/specify` `/plan` `/tasks` `/implement` slash commands, supports 30+ agents, Python CLI bootstrap, project "constitution" file. Closest to Aigon's slash-command + spec model; explicitly *not* an orchestrator.
- **OpenSpec** — minimalist delta-spec markdown workflow, tool-agnostic.
- **BMAD-METHOD** — named-persona pipeline (Mary/Preston/Winston/Sally/Simon/Devon/Quinn) for full SDLC. Heavyweight; methodology more than tool.
- **Tessl** — spec-driven framework + Spec Registry (open beta), Series A 2026. Hosted-leaning.
- **Kiro** (AWS) — spec-driven IDE; review noted "over-specification" friction outside AWS.
- **GSD** — Discuss → Plan → Execute → Verify; Claude-Code-only.

**Tier C — single-agent coding tools (engines or complements, not competitors).**
- **Claude Code, Gemini CLI, Codex CLI** — engines Aigon orchestrates. Cite as such, never compare against.
- **Aider** (Apache-2.0) — chat-first pair-programmer, ~70% of its own code AI-written, last release Feb 2026. Smallest cognitive overhead.
- **OpenCode** (`anomalyco/opencode`, ex-SST) — TUI/CLI single agent, 75+ providers, Anomaly subscriptions ($10/mo Go, PAYG Zen, Black enterprise). The Go fork at `sst/opencode` is the older project and has been **superseded**, not archived as the spec assumed; the *anomalyco* fork is the active one.
- **Goose** (Apache-2.0, now under Linux Foundation's AAIF) — multi-provider, 70+ extensions, can spawn parallel subagents.
- **Crush** (`charmbracelet/crush`) — Go-based TUI, multi-provider, LSP + MCP.
- **AmpCode** (Sourcegraph) — VS Code + CLI, semantic code-graph context, parallel subagents, threads-as-first-class.
- **Augment Code, Windsurf** (Cognition-owned), **Cursor** (non-Agents-Window mode), **GitHub Copilot CLI** — IDE-leaning.

**Tier D — autonomous cloud agents (different shape entirely).**
- **Devin 2.0** (Cognition) — $20/mo + $2.25/ACU; cloud sandbox; 13.86% real-GitHub-issue resolution; 83% more tasks per ACU vs v1.
- **Jules** (Google) — out of public beta, Gemini 3 Pro; "Project Jitro" (KPI-driven) waitlisted, expected Google I/O 2026.
- **GitHub Copilot Coding Agent** — hosted, PR-first.

**Drops since research-21 (March 2026):**
- **Roo Code** — products (Extension/Cloud/Router) shut down 2026-05-15. Drop entirely; useful as a cautionary "VC-funded harness shutdown" data point in honest-weaknesses.
- **OpenCode-Go** (`sst/opencode`) — superseded by `anomalyco/opencode`, not strictly archived.
- **GitHub Copilot Workspace** — discontinued.
- **Mistral Vibe** — still scoring weakly, drop.
- **BMad Method, OpenSpec, GSD** — keep as tier-B mentions, not full matrix rows; they aren't multi-agent orchestrators.

**Net new since research-21:**
- Google Scion (Apr 2026) — most strategically significant.
- Cline Kanban — closest direct competitor, must compare head-to-head.
- Cursor 3 Agents Window (Apr 2026) — multi-agent inside the IDE.
- oh-my-codex / oh-my-claudecode — community orchestration templates.
- Anthropic three-agent harness pattern (planner/generator/evaluator) — pattern, not a tool, but reframes axes.

### 3. Axes — the right 10 for this space

I surveyed how Cline, Cursor, Devin, Aider, Spec Kit, and Augment structure their own comparison pages. The axes that **actually appear** in market vocabulary (vs Aigon-internal axes) are: orchestration substrate, isolation, multi-agent posture, model flexibility (BYO vs locked), interface, autonomy level, and pricing. Aigon-internal terms like "evaluation model" and "source of truth" don't appear on competitor pages but capture genuine philosophical differences — keep them.

**Final 10 (replace the spec's starting 10):**

| # | Axis | Established vocab? | Replaces / merges |
|---|---|---|---|
| 1 | **Unit of work** (spec / task card / prompt session / issue) | Yes (Cline, Spec Kit) | same as starting |
| 2 | **Source of truth** (Markdown specs in git / board cards / hosted workspace / chat history) | Aigon-internal but legible | same as starting |
| 3 | **Orchestration substrate** (CLI-in-tmux+worktrees / cloud sandbox / IDE-embedded / API-direct) | Yes — replaces "orchestration model" | starting term |
| 4 | **Isolation model** (per-feature git worktrees / branches / cloud containers / in-place) | Yes (Scion, Cline Kanban) | same |
| 5 | **Multi-agent posture** (parallel competition / dependency chain / sequential delegation / single-agent) | "Multi-agent posture" coined here; closest market vocab is "agent topology" | merges starting "multi-agent behavior" |
| 6 | **Model flexibility** (BYO subscriptions / curated set / vendor-locked) | Yes — dominant axis on every comparison page | renames starting "model/agent selection" |
| 7 | **Evaluation model** (cross-agent diff review / human review / rubric / none) | Aigon-idiosyncratic but defensible — Anthropic's three-agent harness validates it | same |
| 8 | **Autonomy level** (interactive pair / supervised agent / autonomous) | Yes (Devin pages, Cursor pages) | replaces nothing; net new |
| 9 | **Interface surface** (CLI + dashboard / TUI / IDE-embedded / web app) | Yes | same |
| 10 | **Pricing model** (BYO subscriptions / platform fee / pay-per-ACU / free OSS) | Yes — universal | same |

**Dropped from starting list:** "Lifecycle stage coverage" (collapses into unit-of-work + source-of-truth in practice) and "State ownership" (collapses into source-of-truth). "Community" / "Setup" from `comparisons.mdx` are not philosophical axes — keep them out of the matrix and address in prose.

**Public 5 (most legible):**
1. **Unit of work**
2. **Source of truth**
3. **Multi-agent posture**
4. **Model flexibility**
5. **Pricing model**

These are the five readers can verify from competitor docs in under a minute. Casual readers can place each tool from these five alone.

**Internal-only 5 (need context to read):**
6. Orchestration substrate
7. Isolation model
8. Evaluation model
9. Autonomy level
10. Interface surface

### 4. Where Aigon's choice on each axis is genuinely a trade-off

This is the section the public page must do honestly. Each axis has an "Aigon picks X *because* Y, *which costs* Z" framing.

| Axis | Aigon's choice | Why | What it costs |
|---|---|---|---|
| Unit of work | Markdown spec | Reasoning against artifact ≫ chat history; survives context resets | Upfront friction; hostile to vibe-coding |
| Source of truth | Markdown specs in git | Diffs, blames, PRs, review tools all just work | No rich linking, no semantic search |
| Orchestration substrate | Local CLI in tmux + worktrees | Reuses your existing CLI subscriptions; debuggable with `tmux attach`; no cloud egress | Setup friction (tmux, terminal app) vs cloud "open URL and go" |
| Isolation | Per-feature git worktree | True parallel branches; physical file isolation; conflicts surface only at merge | More disk; more directories to mentally track |
| Multi-agent posture | Parallel competition + cross-agent eval (Fleet) OR solo | Best implementation wins; reviewers diverse | $$N× cost on Fleet; only worth it for high-stakes |
| Model flexibility | BYO subscriptions to Claude / Gemini / Codex | Use the tier you already pay for; no markup | Setup per-CLI; no curated default |
| Evaluation model | Cross-agent diff review | Different models catch different issues (research-21 finding) | Slower than no-review; needs eval-capable agent |
| Autonomy | Supervised + Autopilot mode | User decides per feature; not a one-knob product | More cognitive overhead than "set it and forget it" Devin |
| Interface | Dashboard + CLI + slash | Same workflow at all three control levels | Three things to keep in sync |
| Pricing | Free OSS + BYO | No markup, no lock-in | No cloud convenience; users handle keys |

### 5. Per-tool snapshot — 11-row public matrix

Cells are observable values, not dots. Order = closest to furthest from Aigon.

| Tool | Unit of work | Source of truth | Multi-agent posture | Model flexibility | Pricing |
|---|---|---|---|---|---|
| **Aigon** | Feature spec | Markdown specs in git | Parallel competition + sequential, with cross-agent eval | BYO Claude / Gemini / Codex / Cursor / OpenCode | Free OSS + BYO |
| **Cline Kanban** | Task card | Hosted board state | Sequential dependency chains | BYO Claude Code / Codex / Cline | Free OSS + BYO |
| **Google Scion** | Task graph node | Hosted graph (or local) | Parallel + sequential, declarative graph | BYO Claude Code / Gemini / OpenCode / Codex | Free OSS + BYO |
| **GitHub Spec Kit** | Spec | Markdown specs in git | Single-agent (delegates) | Any of 30+ agents (one at a time) | Free OSS + BYO |
| **Cursor 3 Agents Window** | Prompt | Chat history (per agent) | Up to 8 parallel agents | Curated (Cursor Composer + frontier) | $20/mo + overages |
| **Claude Code (alone)** | Prompt session | Chat history | Single-agent w/ subagents | Anthropic-locked | Anthropic subscription |
| **Aider** | Chat message | Git commit history | Single-agent | BYO any LLM | Free OSS + BYO |
| **OpenCode (anomalyco)** | TUI session | Chat history | Single-agent | 75+ providers | $10/mo Go, PAYG Zen, BYO |
| **Goose** | Recipe / session | Recipe YAML or chat | Subagent spawn | 15+ providers | Free OSS + BYO |
| **Devin 2.0** | Issue | Hosted workspace | Multiple cloud "Devins" in parallel | Cognition-locked | $20/mo + $2.25/ACU |
| **Jules** | Issue | Hosted workspace | Single-agent (async) | Gemini-locked | Google AI tiers |

The spec's ask was 5 public axes × 10 tools — this delivers it, plus one extra row (Aigon).

### 6. Honest weaknesses — what each competitor does better

For the public page's "what Aigon doesn't do well" section and the internal `docs/competitive/`:

- **Cline Kanban**: zero-friction onboarding (`npm i -g cline`), no account, GUI PR-style review on each card with comments agents read, dependency chains by Cmd+click. Aigon's review flow is CLI/dashboard split; the GUI is read-only.
- **Cursor 3**: best inline completion (Composer model is sub-second), tightest IDE integration, tiled multi-agent panes. Aigon has no editor surface at all.
- **Google Scion**: container-grade isolation (Docker / Kubernetes / Apple containers), declarative task graphs, Google backing. Aigon's worktree+tmux is lighter but has no production-grade isolation story.
- **GitHub Spec Kit**: 30+ agent support out of the box, project `constitution.md`, lightest spec wrapper. Aigon supports ~6 agents natively.
- **Devin 2.0 / Jules**: zero local setup, fully autonomous on cloud sandbox, browser tooling. Aigon requires terminal + agent CLIs.
- **Aider**: smallest cognitive overhead — opens a chat, edits files, commits. Aigon is heavy by comparison.
- **OpenCode (anomalyco)**: 75+ provider support including local Ollama; mid-session model switch (`Ctrl+O`). Aigon's per-feature model selection is heavier and lacks first-class local-model support — gap from research-25 still open.
- **Goose**: 70+ extensions and Linux Foundation governance. Aigon's extension story is `templates/`-and-skills only.
- **AmpCode**: semantic code graph (Sourcegraph) for repo-aware retrieval. Aigon has no semantic context layer.
- **Roo Code (until 2026-05-15)**: per-request cost surfaced inline, Cloud Analytics dashboard, fine-grained per-mode tool restrictions (`fileRegex`). Aigon has telemetry but no cost dashboard — gap from research-24 still open.

**Where every competitor wins on community/maturity:**
- Aigon's contributor count is small. Cline Kanban, Aider, Spec Kit, Goose all have 10×+ stars and a much wider extension ecosystem.

### 7. Positioning — multi-length copy

**One-liner (recommended replacement for current memory):**

> Aigon is a spec-driven multi-agent harness — orchestrate Claude Code, Gemini CLI, and Codex CLI from one Kanban board, one CLI, or one slash command.

Trade-offs vs current memory line: the proposed line names the **category** ("multi-agent harness") instead of the **artifact** ("AI development tool with a Kanban dashboard"). It also drops "one workflow at every level of control" because it's vague — "one Kanban board, one CLI, or one slash command" makes the same claim concretely.

If preferred to keep the current line, **at minimum** swap "AI development tool" → "AI coding harness" so it lands in a real category.

**Hero subtitle (one-line tagline, social bio):**

> One Kanban for many agents — on real branches, in real worktrees, against real specs.

**One-paragraph version (~70 words, README opener / press blurb):**

> Aigon is a spec-driven harness for orchestrating multiple AI coding agents on the same codebase. Each feature is a Markdown spec in git; each agent runs in its own git worktree under tmux; the lifecycle moves through inbox → backlog → in-progress → review → done on a local Kanban board. Aigon doesn't try to be a model — it orchestrates Claude Code, Gemini CLI, and Codex CLI as engines.

**One-page version (~250 words, landing page / docs intro):**

> Aigon turns one repository into a fleet of coordinated coding agents. The artifact at the centre of every workflow is a Markdown spec, committed to git, that names a feature and its acceptance criteria. From there, Aigon spawns one or more agents — Claude Code, Gemini CLI, Codex CLI, Cursor, OpenCode — each in its own git worktree under tmux, each working independently against the same spec.
>
> When the agents are done, you compare diffs and merge a winner. When you want one agent in driver's seat, you run Solo. When you want three agents racing, you run Fleet. The same spec, the same lifecycle, the same Kanban board.
>
> Aigon doesn't replace your coding agent — it orchestrates the ones you already pay for. You bring your Claude Pro, your Gemini key, your Codex CLI session. Aigon brings the workflow: feature lifecycle, isolated worktrees, cross-agent evaluation, structured reviews, recurring background tasks, and a dashboard you actually want to leave open.
>
> What Aigon is not: it is not an IDE, it is not a hosted product, and it is not a single-agent assistant. If you want inline completions, use Cursor. If you want zero-setup cloud autonomy, use Devin. If you want a single chat to make edits, use Aider. If you want all of the above, *coordinated* — that's Aigon.

**Conference abstract (~60 words):**

> Aigon is a local, open-source harness for multi-agent coding. Markdown specs are the unit of work; git worktrees are the isolation boundary; tmux is the substrate. Claude Code, Gemini CLI, and Codex CLI run in parallel on the same feature, with cross-agent diff review as the merge gate — a working answer to Anthropic's three-agent (planner/generator/evaluator) pattern, on your laptop.

**GitHub repo description (≤120 chars):**

> Spec-driven multi-agent coding harness for Claude Code, Gemini CLI, and Codex CLI — one Kanban, many agents, real worktrees.

**llms.txt / AGENTS.md scaffold blurb:**

> Aigon: spec-driven multi-agent harness. Feature lifecycle, git-worktree isolation, slash-command orchestration of Claude Code / Gemini CLI / Codex CLI. Workflow state in `.aigon/workflows/`, specs in `docs/specs/`, dashboard at `aigon server start`.

### 8. Recurring-update mechanism

Per `project_recurring_features.md`, the engine creates weekly recurring features at server startup from `docs/specs/recurring/`. Add **one** new template:

**`recurring-competitive-refresh`** (cadence: monthly — implement as `every: 4w` or scan-and-skip in the recurring engine if monthly isn't a first-class period).

**Sources scanned (per run):**
1. **GitHub trending repos** in topics `agentic-coding`, `ai-coding-agent`, `coding-agent`, `multi-agent` — last 30 days.
2. **Major-vendor release notes**: Anthropic blog, Google AI blog, OpenAI blog, Cognition blog, Cursor changelog, Cline changelog.
3. **Direct competitor release pages** (RSS/atom or scraped): Cline Kanban, Scion, Spec Kit, OpenCode (anomalyco), Goose, Aider, Devin, Jules.
4. **Hacker News** front page — last 30 days, keyword filter (`agent`, `coding`, `claude code`, `codex`, `multi-agent`, `worktree`, `spec-driven`).
5. **r/LocalLLaMA + r/ChatGPTCoding** — top monthly, keyword filter.
6. **Twitter/X** — saved-search of named competitor handles (optional, lower signal-to-noise).

**Output (the spec the recurring feature produces — a working draft, not a merged change):**
- Patch to `docs/competitive/matrix.md` — added rows, removed rows, axis-cell flips with citations.
- "What's new this month" list at the top of the spec — bullets only, with source URLs.
- For any cell flip that **changes Aigon's positioning** (acquisition, shutdown, new entrant in Tier A), an inline suggestion: "Consider feature `<slug>` to respond" — but the agent does NOT auto-create those features. User decides at evaluation time.
- Untouched: `site/content/comparisons.mdx` (public page only updated in batches by hand) and `docs/marketing/positioning.md` (positioning copy only updated when category-shaping moves happen).

**Why monthly, not weekly:**
- Most weeks have zero substantive changes; weekly creates noise.
- Monthly aligns with how the market reports — release cadences, Hacker News top-monthly.
- Existing 8 weekly recurring types already cover the high-frequency loops; this is deliberately the slow-loop one.

**Implementation notes for the downstream feature:**
- Use Aigon's existing `WebSearch` / `WebFetch` tooling — no new infrastructure.
- Cap output length: max 2,000 words; agent must summarize, not paste.
- Idempotency: if no material change since last run, the spec writes "no material changes; matrix unchanged" and closes itself.

## Sources

**Internal (verbatim):**
- `docs/specs/research-topics/05-done/research-21-coding-agent-landscape.md` + cc/gg findings
- `docs/specs/research-topics/05-done/research-24-roocode-comparison.md` + cc findings
- `docs/specs/research-topics/05-done/research-25-opencode-comparison.md` + cc findings
- `docs/specs/features/01-inbox/feature-238-merge-comparisons-extended-into-public-site.md`
- `docs/comparisons-extended.md`
- `site/content/comparisons.mdx`
- Memory: `project_standard_descriptor.md`, `project_recurring_features.md`

**External (web research, April 2026):**

Category & terminology:
- [Effective harnesses for long-running agents — Anthropic](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Harness engineering for coding agent users — Martin Fowler](https://martinfowler.com/articles/harness-engineering.html)
- [What Is Harness Engineering? — NxCode](https://www.nxcode.io/resources/news/what-is-harness-engineering-complete-guide-2026)
- [Harness Engineering for AI Coding Agents — Augment Code](https://www.augmentcode.com/guides/harness-engineering-ai-coding-agents)
- [Anthropic Designs Three-Agent Harness — InfoQ](https://www.infoq.com/news/2026/04/anthropic-three-agent-harness-ai/)
- [Agent orchestration: 10 Things That Matter — MIT Technology Review](https://www.technologyreview.com/2026/04/21/1135654/agent-orchestration-ai-artificial-intelligence/)
- [Agentic coding at enterprise scale demands SDD — VentureBeat](https://venturebeat.com/orchestration/agentic-coding-at-enterprise-scale-demands-spec-driven-development)
- [The Code Agent Orchestra — Addy Osmani](https://addyosmani.com/blog/code-agent-orchestra/)
- [2026 Agentic Coding Trends Report — Anthropic](https://resources.anthropic.com/hubfs/2026%20Agentic%20Coding%20Trends%20Report.pdf?hsLang=en)

Competitors — Tier A:
- [Cline Kanban](https://cline.bot/kanban) · [GitHub: cline/kanban](https://github.com/cline/kanban) · [Announcing Cline Kanban](https://cline.bot/blog/announcing-kanban)
- [Google Scion — InfoQ](https://www.infoq.com/news/2026/04/google-agent-testbed-scion/) · [GitHub: GoogleCloudPlatform/scion](https://github.com/GoogleCloudPlatform/scion) · [Scion: A Hypervisor for AI Agents — Agent Wars](https://agent-wars.com/news/2026-04-07-google-scion-hypervisor-ai-agents-open-source)
- [oh-my-codex — Codex Blog](https://codex.danielvaughan.com/2026/04/10/oh-my-codex-omx-orchestration-layer/)
- [Cursor 3 — Cursor blog](https://cursor.com/blog/cursor-3) · [Cursor 3 Agent-First Interface — InfoQ](https://www.infoq.com/news/2026/04/cursor-3-agent-first-interface/)
- [LLM Codegen Brrr: Worktrees + Tmux — DEV](https://dev.to/skeptrune/llm-codegen-go-brrr-parallelization-with-git-worktrees-and-tmux-2gop)

Competitors — Tier B (SDD):
- [GitHub Spec Kit](https://github.com/github/spec-kit)
- [Spec Kit vs BMAD vs OpenSpec — DEV](https://dev.to/willtorber/spec-kit-vs-bmad-vs-openspec-choosing-an-sdd-framework-in-2026-d3j)
- [Spec-Driven Development with Tessl](https://docs.tessl.io/use/spec-driven-development-with-tessl)
- [Understanding SDD: Kiro, spec-kit, Tessl — Martin Fowler](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)
- [SDD: GSD vs Spec Kit vs OpenSpec — Medium](https://medium.com/@richardhightower/agentic-coding-gsd-vs-spec-kit-vs-openspec-vs-taskmaster-ai-where-sdd-tools-diverge-0414dcb97e46)

Competitors — Tier C/D:
- [Aider releases](https://github.com/Aider-AI/aider/releases)
- [Goose now under Linux Foundation AAIF](https://github.com/aaif-goose/goose)
- [OpenCode (anomalyco)](https://github.com/anomalyco/opencode)
- [Crush — charmbracelet](https://github.com/charmbracelet/crush)
- [AmpCode — Sourcegraph](https://sourcegraph.com/amp)
- [Devin 2.0 — VentureBeat](https://venturebeat.com/programming-development/devin-2-0-is-here-cognition-slashes-price-of-ai-software-engineer-to-20-per-month-from-500)
- [Devin pricing](https://devin.ai/pricing/)
- [Jules out of beta — Google blog](https://blog.google/technology/google-labs/jules-now-available/)
- [Project Jitro — DEV](https://dev.to/om_shree_0709/googles-project-jitro-just-redefined-what-a-coding-agent-is-heres-what-it-actually-changes-4oc3)
- [Roo Code shutdown notice — RooCodeInc/Roo-Code](https://github.com/RooCodeInc/Roo-Code)
- [Windsurf acquired by Cognition — TechCrunch coverage / DevOps.com](https://devops.com/openai-acquires-windsurf-for-3-billion/)

Comparison-page structure references:
- [Cline vs Cursor — DataCamp](https://www.datacamp.com/tutorial/cline-vs-cursor)
- [AI Coding Harness comparison — jock.pl](https://thoughts.jock.pl/p/ai-coding-harness-agents-2026)
- [Cursor Alternatives — Morph](https://www.morphllm.com/comparisons/cursor-alternatives)
- [OpenCode vs Claude Code — Morph](https://www.morphllm.com/comparisons/opencode-vs-claude-code)
- [From Conductor to Orchestrator — htdocs.dev](https://htdocs.dev/posts/from-conductor-to-orchestrator-a-practical-guide-to-multi-agent-coding-in-2026/)

## Recommendation

**Adopt the category claim "spec-driven multi-agent harness."** It's precise, it sits in established 2026 vocabulary (harness + multi-agent + SDD), and it cuts cleanly against IDE-embedded tools (Cursor), single-agent assistants (Aider, OpenCode), spec-only wrappers (Spec Kit), and cloud-autonomous agents (Devin, Jules). Update `project_standard_descriptor.md`, `AGENTS.md`, README, llms.txt, and the landing hero from the canonical chunks in §7.

**Restructure the public page (`comparisons.mdx`) around 5 observable axes × 11 tools** (§5 matrix). Replace binary dots with concrete cell values. Drop the "AmpCode / Augment Code / OpenCode-Go / Roo Code" rows and add Cline Kanban, Scion, Cursor 3, Devin 2.0, Jules. Keep the "Native CLIs" entry pattern from F238.

**Build `docs/competitive/` as the internal source of truth** (the 4-tier landscape § 2, the 10-axis matrix §3, the trade-off table §4, and the per-tool weaknesses §6). The public page is a *projection* of this internal doc — never the other way around.

**Close two open gaps surfaced repeatedly in research-21/24/25 and confirmed here:** cost-visibility dashboard (Roo Code does this, every parallel-agent user wants it) and first-class local-model support (OpenCode and Goose make this table-stakes).

**Close F238** as superseded once the public-comparison-page-rewrite feature lands. Cross-link in the close-out commit.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| competitive-internal-matrix | Create `docs/competitive/` with the 4-tier landscape, 10-axis matrix, per-tool deep-dive entries, trade-off table, and honest-weaknesses section. Becomes the source of truth for the public page. | high | none |
| public-comparison-page-rewrite | Rewrite `site/content/comparisons.mdx` around the 5 public axes × 11 tools (§5). Replace binary dots with observable cell values. Supersedes F238; close F238 in the same PR. Delete `docs/comparisons-extended.md`. | high | competitive-internal-matrix |
| aigon-positioning-page | Create `docs/marketing/positioning.md` with the multi-length copy in §7. Update `project_standard_descriptor.md`, `AGENTS.md` opener, `README.md` opener, GitHub repo description, `site/llms.txt`, landing hero. Single source for every category claim. | high | competitive-internal-matrix |
| recurring-competitive-refresh | Monthly recurring feature that scans the sources in §8 and produces a draft matrix patch + "what's new" summary. Idempotent — emits "no change" when nothing material moves. | medium | competitive-internal-matrix |
| agent-cost-dashboard | Per-agent / per-feature cost tracking surfaced in the dashboard. Closes the Roo Code gap (research-24) and the parallel-agent-spend gap surfaced in honest-weaknesses (§6). | medium | none |
| local-model-first-class-support | Make local Ollama / OpenAI-compatible endpoints first-class in agent config (parity with OpenCode and Goose). Closes the gap from research-25. | medium | none |
