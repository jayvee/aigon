# Research Findings: Coding Agent Landscape

**Agent:** Claude (cc)
**Research ID:** 21
**Date:** 2026-03-27

---

## Key Findings

### 1. Current Aigon Agents — State of Play

#### Claude Code (cc)
- **Version:** 2.1.84 (`@anthropic-ai/claude-code`)
- **Headless:** `claude -p "prompt"` — single prompt, prints response, exits. `--output-format json` for structured output
- **Context:** CLAUDE.md (auto-discovered), `.claude/commands/` slash commands, `.claude/settings.json` hooks/permissions, `.claude/skills/`
- **Models:** Opus 4.6 ($5/$25 MTok), Sonnet 4.6 ($3/$15 MTok), Haiku 4.5 ($1/$5 MTok)
- **SWE-bench Verified:** Opus 4.6 = **80.8%**, Sonnet 4.6 = **79.6%**
- **Strengths:** Best SWE-bench score, richest context delivery (hooks, skills, slash commands), strong shell execution, sub-agent support
- **Sources:** [Claude Code docs](https://code.claude.com/docs/en/headless), [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), [SWE-bench](https://www.swebench.com/)

#### Gemini CLI (gg)
- **Version:** 0.35.0 (`@google/gemini-cli`)
- **Headless:** `gemini --yolo` (auto-approves all tool calls), dedicated headless mode returning structured JSON
- **Context:** GEMINI.md (hierarchical auto-discovery), `.gemini/settings.json`, `.gemini/policies/*.toml` for tool permissions, `.gemini/commands/`
- **Models:** Gemini 3.1 Pro Preview ($2/$12 MTok), Gemini 3 Flash Preview (free tier)
- **SWE-bench Verified:** Gemini 3.1 Pro = **80.6%**
- **Free tier:** 60 req/min, 1000 req/day with personal Google account (Flash model)
- **Strengths:** Free tier is unbeatable for batch work, competitive SWE-bench, policy engine for permissions
- **Sources:** [Gemini CLI GitHub](https://github.com/google-gemini/gemini-cli), [Gemini CLI pricing](https://geminicli.com/docs/resources/quota-and-pricing/)

#### Codex CLI (cx)
- **Version:** 0.44.0 (Rust binary)
- **Headless:** `codex --full-auto` — runs without confirmation. Also `--auto-edit` (confirms only shell commands)
- **Context:** AGENTS.md (auto-loaded, prioritized by proximity), `.codex/prompt.md`, `.codex/config.toml`, `~/.codex/prompts/` global slash commands
- **Models:** GPT-5.4 ($2.50/$15 MTok), GPT-5.3-Codex ($1.75/$14 MTok), GPT-5.4 Pro ($30/$180 MTok)
- **SWE-bench Verified:** GPT-5.2 = **80.0%** (GPT-5.4 not yet scored)
- **Terminal-Bench:** 77.3% overall, 67.7% composite
- **Strengths:** Rust-based (fast, 240+ tok/s), subagent parallelization, web search (`--search`), included with ChatGPT Plus
- **Sources:** [Codex CLI docs](https://developers.openai.com/codex/cli), [OpenAI pricing](https://developers.openai.com/api/docs/pricing)

### 2. New CLI Agents — Candidates for Aigon Integration

#### GitHub Copilot CLI — **TOP CANDIDATE**
- **Status:** GA since February 25, 2026
- **Install:** `curl -fsSL https://gh.io/copilot-install | bash` or `brew install copilot-cli` or `npm install -g @github/copilot`
- **Headless:** `copilot -p "prompt"` (print mode), `--autopilot` for full autonomy, combines as `copilot -p --autopilot "task"`
- **Context:** `.github/copilot-instructions.md` for repo-wide instructions, `@` syntax for file inclusion
- **Models:** Claude Sonnet 4.5 (default), Claude Opus 4.6, GPT-5, GPT-5.3-Codex, Gemini 3 Pro, Claude Haiku 4.5 — switchable via `/model`
- **Pricing:** Included with any Copilot subscription: Free (limited), Pro ($10/mo), Pro+ ($39/mo), Business ($19/user/mo). Uses "premium requests" with model-specific cost multipliers
- **Fleet mode:** Built-in `/fleet` command parallelizes sub-agents
- **Shell:** Full shell access via `!` prefix
- **tmux:** Explicitly supported, color fixes in v1.0.8
- **Strengths:** Multi-model choice, built-in parallelism, cheap (included with subscription), native GitHub integration (issues, PRs), mature tmux support
- **Weaknesses:** Subscription required (no pure API mode), premium request quotas can be limiting, newer than cc/gg/cx
- **Sources:** [Copilot CLI GA announcement](https://github.blog/changelog/2026-02-25-github-copilot-cli-is-now-generally-available/), [Copilot CLI docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli-agents/overview), [Copilot plans](https://github.com/features/copilot/plans)

#### Goose (Block/Square) — **STRONG CANDIDATE**
- **Status:** Active open-source (Apache 2.0), 29,400+ GitHub stars
- **Install:** Via package manager or binary
- **Headless:** `goose run -t "task"`, `GOOSE_MODE=auto` for non-interactive, `--no-session`, `--recipe` for YAML playbooks, `--params` for parameterized runs
- **Context:** Recipe system (YAML playbooks), built-in tool extensions, MCP server support
- **Models:** Fully model-agnostic (Anthropic, OpenAI, Google, local via Ollama). BYOK
- **Pricing:** Free and open source. You pay only model API costs
- **Shell:** Full shell access via developer tools
- **tmux:** Designed for headless operation. Works in servers, containers, CI/CD
- **Strengths:** Free, model-agnostic, recipe system for repeatable tasks, strong community, extensible via MCP
- **Weaknesses:** No built-in sub-agent parallelism, no auto-discovery of project instruction files (relies on recipes), less mature benchmarks
- **Sources:** [Goose GitHub](https://github.com/block/goose), [Goose headless docs](https://block.github.io/goose/docs/tutorials/headless-goose/)

#### Cline CLI 2.0 — **STRONG CANDIDATE**
- **Status:** CLI 2.0 released February 2026, open-source (Apache 2.0), 5M+ developers
- **Install:** Via npm or binary
- **Headless:** `-y` (yolo) flag for full autonomy, `--json` for structured output, stdin/stdout piping
- **Context:** Extension-based context providers
- **Models:** Every major provider (Anthropic, OpenAI, Google, Mistral, Bedrock, Ollama). BYOK
- **Pricing:** Free open source. Model costs only
- **Parallel:** Native parallel agent execution in CLI 2.0
- **Shell:** Full shell access
- **tmux:** Works in headless environments
- **Strengths:** Free, model-agnostic, native parallelism, huge user base, BYOK
- **Weaknesses:** CLI is very new (Feb 2026), previously IDE-only so CLI may have rough edges, no established project instruction file convention
- **Sources:** [Cline CLI 2.0 announcement](https://cline.bot/blog/announcing-cline-cli-2-0), [Cline CLI product page](https://cline.bot/cli)

#### Aider — **VIABLE CANDIDATE**
- **Version:** v0.86.0 (Apache 2.0), 42,400+ GitHub stars
- **Install:** `pip install aider-chat`
- **Headless:** `aider --yes --message "task"` (one-shot, exits after). `--yes-always` for full auto-confirm
- **Context:** `CONVENTIONS.md` or any file via `--read`, `.aider.conf.yml` for persistent config. No auto-discovery — must be explicitly configured
- **Models:** Any LLM via litellm (290+ models via OpenRouter). Full BYOK
- **Pricing:** Free. Model API costs only
- **Benchmarks:** Aider Polyglot: Grok 4 = 79.6%, Claude Opus 4.5 = 76.8%, Gemini 3 Flash = 75.8%
- **Shell:** `/run` command, but auto-execution in `--yes-always` has reliability bugs
- **Strengths:** Proven, free, any model, deep git integration (auto-commits), repo-map for large codebases
- **Weaknesses:** No auto-context discovery (must configure explicitly), shell auto-execution unreliable, no sub-agent delegation, no built-in parallelism
- **Sources:** [Aider docs](https://aider.chat/), [Aider scripting](https://aider.chat/docs/scripting.html), [Aider leaderboard](https://aider.chat/docs/leaderboards)

#### Augment Code (Auggie) — **NICHE CANDIDATE**
- **Version:** Auggie CLI via `npm install -g @augmentcode/auggie` (Node.js 22+)
- **Headless:** `auggie --print "task"` (one-shot, exits)
- **Context:** Semantic Context Engine — auto-indexes entire codebase, branch-aware, cross-repo. Available as MCP server
- **Models:** Proprietary model routing (not user-selectable). Used Claude Opus 4.5 for SWE-bench Pro submission
- **Pricing:** Community (free, 50 msg/mo), Indie ($20/mo), Developer ($50/mo), Team ($60-200/user/mo)
- **SWE-bench Pro:** #1 at **51.80%**
- **Strengths:** Best-in-class context engine, branch-aware indexing, sub-agent delegation
- **Weaknesses:** Proprietary, no model choice, expensive at scale, requires Node.js 22+, credits don't roll over
- **Sources:** [Auggie CLI docs](https://docs.augmentcode.com/cli/overview), [Augment pricing](https://www.augmentcode.com/pricing)

#### Cursor CLI — **MONITOR**
- **Status:** Launched January 2026, still beta
- **Headless:** `agent -p --force "task"` for local headless, Background Agents for cloud VMs
- **Context:** `.cursor/rules/` for project instructions
- **Models:** Claude Sonnet 4, GPT-5, proprietary models
- **Pricing:** Hobby (free, limited), Pro ($20/mo), Business ($40/user/mo)
- **Strengths:** Background Agents run on isolated Ubuntu VMs, push results to branches
- **Weaknesses:** Still beta, limited model documentation for CLI, expensive at Business tier
- **Sources:** [Cursor CLI docs](https://cursor.com/docs/cli/headless), [Cursor blog](https://cursor.com/blog/cli)

### 3. Not Viable for Aigon

| Agent | Reason |
|-------|--------|
| **Windsurf** | IDE-only, no CLI at all |
| **Devin** | Cloud-only execution (not local), expensive ($20-500/mo), proprietary |
| **SWE-agent** | Research tool, not production-ready for daily coding |
| **Mentat** | Activity slowing, community shrinking |
| **Sweep** | Team pivoted, likely archived |

### 4. Benchmarks Comparison (March 2026)

| Agent/Model | SWE-bench Verified | Other Benchmarks |
|-------------|-------------------|------------------|
| Claude Code (Opus 4.6) | **80.8%** | — |
| Gemini CLI (3.1 Pro) | **80.6%** | ARC-AGI-2: 77.1% |
| Codex CLI (GPT-5.2) | **80.0%** | Terminal-Bench: 77.3% |
| Claude Code (Sonnet 4.6) | **79.6%** | — |
| Aider (Grok 4) | — | Polyglot: 79.6% |
| Amazon Q | ~49-66% | — |
| Auggie | — | SWE-bench Pro: 51.8% (#1) |

**Key insight:** The top three Aigon agents (cc, gg, cx) are within 0.8% of each other on SWE-bench Verified. The gap is negligible — model quality has converged. Differentiation now comes from context delivery, tooling, and cost.

### 5. Pricing Comparison for Batch Mode (10-50 features/month)

| Agent | Monthly Cost (est.) | Model Cost Basis |
|-------|-------------------|------------------|
| Gemini CLI (free tier) | **$0** (within limits) | Flash model, 1K req/day |
| Aider + DeepSeek | **$1-50** | V3 API, cheapest quality option |
| Aider + Gemini Flash | **$5-30** | Via litellm |
| Goose + any model | **$10-250** | BYOK, varies by model |
| Cline + any model | **$10-250** | BYOK, varies by model |
| Copilot CLI (Pro) | **$10/mo flat** | Premium request quotas |
| Codex CLI (Plus) | **$20/mo flat** | Included with ChatGPT Plus |
| Claude Code (Max 5x) | **$100/mo flat** | 25x free usage |
| Claude Code (API) | **$10-250** | Per-token, Sonnet $3/$15 MTok |
| Auggie (Indie) | **$20/mo flat** | 40K credits |
| Auggie (Developer) | **$50/mo flat** | 600 messages |

### 6. Context Delivery Comparison

| Agent | Auto-Discovery | Instruction File | Hooks | Slash Commands | Policies/Permissions |
|-------|---------------|-----------------|-------|----------------|---------------------|
| Claude Code | Yes | CLAUDE.md | Yes | Yes | Yes (settings.json) |
| Gemini CLI | Yes | GEMINI.md | Yes | Yes | Yes (policies/*.toml) |
| Codex CLI | Yes | AGENTS.md | No | Yes (prompts/) | Yes (config.toml) |
| Copilot CLI | Yes | .github/copilot-instructions.md | Unknown | Unknown | Unknown |
| Goose | No | Recipes (YAML) | No | No | Built-in tools |
| Cline CLI | Unknown | Unknown | Unknown | Unknown | Unknown |
| Aider | No | CONVENTIONS.md (manual) | No | No | No |
| Auggie | Yes (semantic) | Auto-indexed | No | No | No |
| Amazon Q | No | Agent config JSON | Yes | No | Tool trust system |

### 7. Role-Specific Assessment

| Agent | Implementation | Evaluation | Research |
|-------|---------------|------------|----------|
| Claude Code (Opus) | Excellent | Excellent | Excellent |
| Claude Code (Sonnet) | Excellent | Good | Good |
| Gemini CLI | Excellent | Good | Excellent (long context) |
| Codex CLI | Excellent | Good | Good |
| Copilot CLI | Good-Excellent | Unknown | Unknown |
| Goose | Good | Unknown | Unknown |
| Cline CLI | Good | Unknown | Unknown |
| Aider | Good | Poor (no eval mode) | Poor |
| Auggie | Good-Excellent | Unknown | Unknown |

**Key insight:** For Aigon's Fleet mode, the most important capability is **implementation quality**. Evaluation and research are typically done by cc (Claude Code Opus). New agents only need to be strong implementers.

## Sources

### Primary Documentation
- [Claude Code docs](https://code.claude.com/docs/en/headless) — headless mode, permissions, hooks
- [Gemini CLI GitHub](https://github.com/google-gemini/gemini-cli) — CLI reference, GEMINI.md, policies
- [Codex CLI docs](https://developers.openai.com/codex/cli) — CLI reference, AGENTS.md, approval modes
- [Copilot CLI docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli-agents/overview) — agent mode, fleet, autopilot
- [Goose GitHub](https://github.com/block/goose) — headless mode, recipes, extensions
- [Cline CLI 2.0](https://cline.bot/blog/announcing-cline-cli-2-0) — CLI release, yolo mode
- [Aider docs](https://aider.chat/) — scripting, conventions, leaderboard
- [Auggie CLI docs](https://docs.augmentcode.com/cli/overview) — print mode, context engine

### Benchmarks & Pricing
- [SWE-bench Verified leaderboard](https://www.swebench.com/)
- [SWE-bench scores (llm-stats)](https://llm-stats.com/benchmarks/swe-bench-verified)
- [Aider Polyglot leaderboard](https://aider.chat/docs/leaderboards)
- [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [OpenAI pricing](https://developers.openai.com/api/docs/pricing)
- [Gemini pricing](https://geminicli.com/docs/resources/quota-and-pricing/)
- [Copilot plans](https://github.com/features/copilot/plans)
- [Augment pricing](https://www.augmentcode.com/pricing)

### Landscape & Comparison
- [Awesome CLI Coding Agents](https://github.com/bradAGI/awesome-cli-coding-agents) — curated list
- [Morphllm 15 Agents Compared](https://www.morphllm.com/ai-coding-agent) — feature comparison
- [SWE-bench Pro leaderboard](https://www.morphllm.com/swe-bench-pro) — latest benchmark

## Recommendation

### Keep Current Agents, Add Two New Ones

**Current agents (cc, gg, cx) are all within 0.8% on SWE-bench** — there's no reason to replace any of them. The focus should be on **expanding the Fleet** with complementary agents.

**Recommended additions (priority order):**

1. **GitHub Copilot CLI (`gh`)** — Highest priority. Multi-model (can use Claude, GPT, Gemini), built-in Fleet parallelism, included with Copilot Pro ($10/mo), excellent tmux support, GA quality. Its `.github/copilot-instructions.md` is a close analog to CLAUDE.md. Aigon integration would need: agent config (`gh.json`), context delivery via copilot-instructions.md, headless invocation `copilot -p --autopilot "prompt"`.

2. **Goose (`gs`)** — Second priority. Free and open-source, model-agnostic (can use the same Claude/GPT/Gemini APIs), recipe system maps well to Aigon's template system. Integration would need: agent config (`gs.json`), context delivery via recipes, headless invocation `goose run -t "prompt"`. Good as a cost-effective Fleet member using cheaper models (DeepSeek, Gemini Flash).

**Defer for now:**
- **Cline CLI** — Too new (Feb 2026), wait for CLI to stabilize and for context delivery conventions to emerge
- **Auggie** — Proprietary, expensive, no model choice. Monitor for context engine MCP integration
- **Cursor CLI** — Still beta, wait for GA
- **Aider** — Mature but lacks auto-context discovery and reliable shell execution needed for Aigon's `aigon agent-status` commands

### Role-Specific Agent Strategy

The mv experiment proved that agents don't need to excel at everything. Recommended role assignments:

| Role | Primary | Secondary | Notes |
|------|---------|-----------|-------|
| **Implementation** | cc (Sonnet), gg, cx, gh, gs | All agents | Core Fleet work |
| **Evaluation** | cc (Opus) | gg (long context) | Requires deep reasoning |
| **Research** | cc (Opus) | gg (free tier for broad sweeps) | Requires web search, synthesis |
| **Review** | cc (Opus), gh | — | Requires nuanced judgment |

### Model Update Recommendations

- **cx.json `implement`:** Consider updating from `gpt-5.3-codex` to `gpt-5.4` — quality improvement for modest cost increase ($1.75 → $2.50 input)
- **gg:** Gemini 3.1 Pro at 80.6% SWE-bench makes it essentially tied with cc/cx. Consider using Pro for implementation and Flash for cheaper batch runs

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| role-specific-agent-config | Support role-specific agent assignments in agent config (implementation-only, eval-only, research-only) | high | none |
| integrate-copilot-cli | Add GitHub Copilot CLI as a new agent (`gh`) with headless autopilot mode and copilot-instructions.md context delivery | high | role-specific-agent-config |
| integrate-goose | Add Goose as a new agent (`gs`) with recipe-based context delivery and model-agnostic headless mode | medium | role-specific-agent-config |
| agent-benchmark-tracking | Track per-agent implementation quality scores over time to inform Fleet composition decisions | medium | none |
| context-delivery-audit | Audit and document what context each agent actually receives vs what cc gets, to identify gaps causing quality differences | medium | none |
| model-config-update-cx | Update cx.json implement model from gpt-5.3-codex to gpt-5.4 for quality improvement | low | none |
| monitor-cline-cli | Track Cline CLI 2.0 maturity for potential future integration when context delivery conventions stabilize | low | none |
| monitor-cursor-cli | Track Cursor CLI for potential integration when it reaches GA | low | none |
