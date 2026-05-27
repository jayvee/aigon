# Research Findings: skill vs command format evolution

**Agent:** Claude (cc)
**Research ID:** 49
**Date:** 2026-05-28

---

## Key Findings

### 1. All Six Aigon Agents Now Support SKILL.md Natively

The single most important finding: the Agent Skills open standard (SKILL.md) has been adopted by **32+ tools** since December 2025, including every agent Aigon supports. The original reason for Aigon's two-format split — that agents had different instruction-consumption capabilities — is no longer valid.

| Agent | SKILL.md Support | Discovery Path | Also Supports |
|-------|-----------------|----------------|---------------|
| **CC** (Claude Code) | `.claude/skills/*/SKILL.md` | Native | `.claude/commands/*.md`, CLAUDE.md |
| **CU** (Cursor) | `.cursor/skills/*/SKILL.md` | Native | `.cursor/commands/*.md`, `.cursor/rules/*.mdc` |
| **GG** (Gemini CLI) | `.gemini/skills/*/SKILL.md` | Native | `.gemini/commands/*.toml`, GEMINI.md |
| **CX** (Codex CLI) | `.agents/skills/*/SKILL.md` | Native | AGENTS.md (32-64 KiB cap) |
| **OP** (OpenCode) | `.agents/skills/*/SKILL.md` | Native | `.opencode/commands/*.md`, AGENTS.md |
| **KM** (Kimi CLI) | `.agents/skills/*/SKILL.md` | Native | AGENTS.md (32 KiB cap) |

All agents use **progressive disclosure**: only metadata (~100 tokens/skill) loads at startup; the full body loads on invocation. This is critical — 43 Aigon commands at ~700 tokens each would consume ~30K tokens if loaded eagerly, but progressive disclosure means only the invoked skill's body enters context.

**Sources:**
- [Agent Skills open standard](https://www.agensi.io/learn/agent-skills-open-standard) — 32+ tools adopted within months
- [Claude Code Skills docs](https://code.claude.com/docs/en/skills)
- [Gemini CLI Skills](https://geminicli.com/docs/cli/skills/)
- [Codex CLI Skills](https://developers.openai.com/codex/skills)
- [OpenCode Skills](https://opencode.ai/docs/skills/)
- [Kimi CLI Skills](https://moonshotai.github.io/kimi-cli/en/customization/skills.html)

### 2. Industry Has Converged on a Three-Layer Model

The 2026 consensus across agent documentation, blog posts, and standards bodies:

1. **Rules / Always-on context** (constraints): CLAUDE.md, AGENTS.md, GEMINI.md, `.cursor/rules/`. Loaded every session. Short, stable, behavioral. Analogous to a team style guide. Recommended <200 lines / <2,000 tokens.

2. **Skills / Commands** (on-demand expertise): SKILL.md directories, slash commands. Loaded only when triggered. Longer, procedural, task-specific. Analogous to a runbook. Recommended <5,000 tokens per skill.

3. **MCP / Tools** (runtime actions): JSON-RPC protocol for tool discovery and execution. Stateless action calls. Analogous to an API.

The widely repeated formulation: **MCP = hands** (execute/query), **Skills = brain** (how to orchestrate), **Rules = constraints** (what to remember).

**Aigon maps cleanly to this model:** AGENTS.md / CLAUDE.md = Layer 1, command templates / SKILL.md = Layer 2, `aigon` CLI = Layer 3. The insight is that Aigon's current two formats (commands vs skill manifest) both belong to Layer 2 — they should converge.

**Sources:**
- [Agent Skills specification](https://www.agensi.io/learn/skill-md-specification-open-standard)
- [Linux Foundation AAIF](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation) — AGENTS.md is a founding project alongside MCP
- [AGENTS.md in 60,000+ repos](https://www.infoq.com/news/2025/08/agents-md/) by mid-2026
- [Skills vs MCP deep dive](https://www.llamaindex.ai/blog/skills-vs-mcp-tools-for-agents-when-to-use-what)

### 3. The Current Skill Manifest Has a Measurable Guidance Gap

Aigon's `templates/generic/skill.md` contains **17 tool entries** with one-line descriptions and a **3-line system_prompt**. Meanwhile, the 43 command templates total **3,374 lines** of procedural guidance including:

- Step-by-step workflow sequences ("Run this FIRST, then read the output...")
- Behavioral constraints ("COMMIT EARLY AND OFTEN", time budgets)
- Mode-specific branching (Drive vs Fleet vs Solo)
- Error recovery instructions
- Scope guardrails ("Do NOT delete/move files unrelated to your spec")
- Next-step suggestions ("End with the suggested next command")

**What skill-only agents receive vs command-format agents:**

| Guidance Element | Command Agents (cc, cu, gg) | Skill-Only Agents (cx, op, km) |
|-----------------|---------------------------|-------------------------------|
| Full procedural playbook | Yes (50-300 lines per command) | No — one-line description only |
| Scope guardrails | Yes (embedded in template) | No |
| Mode-specific branching | Yes (Drive/Fleet/Solo sections) | No |
| Commit/logging discipline | Yes (explicit rules) | No |
| Error recovery | Yes (if-then guidance) | No |
| Next-step suggestion | Yes (prompt suggestion section) | No |
| CLI command to run | Yes (embedded) | Yes (tool `command` field) |

**However**, this gap is misleading. Aigon already generates per-command SKILL.md files for skill-format agents via `renderSkillMd()` in `lib/templates.js`. These installed files carry the **full template body** as the SKILL.md body — meaning CX, OP, and KM actually DO receive the full guidance when they invoke a skill. The thin `skill.md` manifest is only used for tool-list discovery by agents that don't support the directory-based SKILL.md format.

The real gap is: **the tool-list manifest (`skill.md`) is maintained manually and has only 17 of 43 commands** — so skill-only agents can only discover 17 workflow steps, not 43.

### 4. Multi-Agent Orchestrators Are Converging on Agent Skills

| Orchestrator | Instruction Format | Skills Support | Notes |
|-------------|-------------------|----------------|-------|
| **Goose** (Block) | YAML recipes + MCP | Via MCP extensions | MCP-first architecture |
| **Amp** (Sourcegraph) | AGENTS.md + SKILL.md | Yes (native) | Also uses MCP servers |
| **Continue.dev** | `.continue/rules/*.md` | Yes (via Hub) | Agent configs bundle skills |
| **Aider** | CONVENTIONS.md | No formal system | Plain markdown only |
| **OpenHands** | AGENTS.md + SKILL.md | Yes (progressive) | Extensions repo for community skills |
| **SWE-agent** | YAML tool bundles | No | Minimal agent loop |

The Agent Skills standard is the clearest convergence story. Launched December 2025, adopted by 32+ tools within months, endorsed by the Linux Foundation's Agentic AI Foundation (190 member orgs including AWS, Anthropic, Block, Google, Microsoft, OpenAI).

**Sources:**
- [Agent Skills GitHub](https://github.com/agentskills/agentskills)
- [AAIF 190 members](https://aaif.io/press/agentic-ai-foundation-adds-43-new-members-as-enterprise-and-government-adoption-of-open-agent-standards-accelerates/)
- [Agent Skills interoperability](https://www.paperclipped.de/en/blog/agent-skills-open-standard-interoperability/)

### 5. MCP Is Complementary, Not a Replacement for File-Based Skills

**MCP adoption is massive** — 97M monthly SDK downloads, 10,000+ servers, 177,000+ registered tools. Every Aigon agent supports MCP. But MCP and file-based skills serve different layers:

**Why MCP Tools can't replace command templates:**
- MCP Tools have `name`, `description`, and `inputSchema` — no field for multi-paragraph procedural guidance
- `feature-do.md` is 4,703 bytes of behavioral instructions; an MCP tool description cannot carry this
- MCP is stateless request/response; Aigon workflows are multi-step stateful lifecycles
- Every MCP tool description loads into context at tool-list time — 43 long descriptions would be costly

**Where MCP adds value as a complement:**
- **Distribution**: One MCP server config vs. file installation per agent — zero-install discovery
- **Dynamic content**: Server generates responses dynamically (fresh state, computed data)
- **MCP Prompts**: Could deliver procedural guidance (returns structured messages on invocation), but replicates what SKILL.md body already does with added infrastructure overhead

**Verdict**: An optional Aigon MCP server exposing CLI commands as tools would provide convenience for agents that prefer MCP discovery, but it is not a substitute for the SKILL.md body that carries behavioral guidance. The Agent Skills standard already provides cross-agent file-based discovery with zero infrastructure.

**Sources:**
- [MCP 97M downloads](https://www.digitalapplied.com/blog/mcp-97-million-downloads-model-context-protocol-mainstream)
- [MCP 2026 roadmap](https://a2a-mcp.org/blog/mcp-2026-roadmap) — plans to add "skills" as a native MCP primitive
- [MCP Prompts specification](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts)
- [Workflows MCP server](https://github.com/cyanheads/workflows-mcp-server) — closest existing analogue
- [MCP stateless proposal (SEP-1442)](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1442)

### 6. Auto-Generation: Aigon Already Does It, But Can Be Improved

**Current state**: `renderSkillMd()` already transforms command templates into SKILL.md format during `aigon install-agent`. The installed files carry the full template body. This works.

**What's broken**: The `templates/generic/skill.md` tool manifest is **maintained manually** with only 17 of 43 entries. It's the only place skill-only agents discover what tools exist. This manifest is out of sync with the command templates.

**What could be improved:**

| Improvement | Feasibility | Impact |
|------------|-------------|--------|
| Auto-generate tool manifest from `COMMAND_REGISTRY` (43 entries) | Trivial — data already in registry | HIGH — all commands become discoverable |
| Enrich SKILL.md frontmatter (`argument-hint`, `disable-model-invocation`, `allowed-tools`) | Easy — data in registry + config arrays | MEDIUM — better agent-native behaviour |
| Progressive disclosure for large templates (>5K tokens) | Moderate — split into `references/` | MEDIUM — better compaction survival |
| Auto-generate MCP tool definitions from registry | Moderate — new MCP server module | LOW — convenience, not necessity |

**What cannot be auto-generated**: The procedural body of each template (the actual workflow instructions) — these are hand-authored behavioral guidance and are Aigon's core product.

### 7. Token/Context Capacity Is Not a Constraint

All agents have ample capacity for Aigon's command templates:

| Agent | Context Window | Aigon Template Avg Size | Fits? |
|-------|---------------|------------------------|-------|
| CC (Opus 4.7) | 1M tokens | ~700 tokens | Yes (0.07%) |
| GG (Gemini 2.5 Pro) | 1M tokens | ~700 tokens | Yes (0.07%) |
| CX (Codex) | 128-192K tokens | ~700 tokens | Yes (0.4-0.5%) |
| CU (Cursor) | Model-dependent | ~700 tokens | Yes |
| OP (OpenCode) | Model-dependent | ~700 tokens | Yes |
| KM (Kimi) | 256K tokens | ~700 tokens | Yes (0.3%) |

The largest templates (feature-code-review at 9,818 bytes / ~2,400 tokens, feature-close at 9,102 bytes / ~2,200 tokens) are still well within the SKILL.md recommended <5,000 token body limit. No template splitting is strictly necessary, though it would improve compaction survival in Claude Code (which keeps the first 5,000 tokens per skill during context compression, with a 25,000 combined budget).

### 8. The Minimal Instruction Set for Skill-Only Agents

Given that all agents now support SKILL.md with full body content, the question becomes: **what's the minimum guidance a skill body needs?**

Analysis of command template structure reveals five critical guidance categories, ordered by impact on workflow adherence and output quality:

1. **Lifecycle state management** (CRITICAL): `aigon agent-status implementing` → work → `aigon agent-status implementation-complete`. Without this, the dashboard and coordinator lose track of agent state.

2. **Scope guardrails** (HIGH): "Only modify YOUR findings file", "Do NOT run feature-close automatically", "Do NOT modify source code". Prevents cross-agent interference and lifecycle violations.

3. **Commit discipline** (HIGH): "Commit early and often", "Commit ONLY your file", "Use conventional commit format". Ensures work is recoverable and diffs are reviewable.

4. **Mode-specific branching** (MEDIUM): Drive/Fleet/Solo instructions. Without this, agents in Fleet mode may try to close features or merge branches they don't own.

5. **Next-step suggestion** (LOW): "End with suggested next command" aids user workflow but doesn't affect output quality.

Categories 1-3 are the minimum viable instruction set. A skill body carrying these (~200-300 tokens) would close most of the quality gap between command-format and skill-only agents.

## Sources

### Agent Documentation
- [Claude Code Skills](https://code.claude.com/docs/en/skills)
- [Claude Code Customization Guide](https://alexop.dev/posts/claude-code-customization-guide-claudemd-skills-subagents/)
- [Cursor Rules docs](https://cursor.com/docs/rules) — `.mdc` format, four activation modes
- [Cursor Rules guide (2026)](https://www.vibecodingacademy.ai/blog/cursor-rules-complete-guide)
- [Gemini CLI Skills](https://geminicli.com/docs/cli/skills/) — Agent Skills standard adopted
- [Gemini CLI Creating Skills](https://geminicli.com/docs/cli/creating-skills/)
- [GEMINI.md docs](https://geminicli.com/docs/cli/gemini-md/)
- [Codex CLI AGENTS.md](https://developers.openai.com/codex/guides/agents-md) — 32-64 KiB cap, truncation warning
- [Codex CLI Skills](https://developers.openai.com/codex/skills) — progressive disclosure
- [OpenCode Rules](https://opencode.ai/docs/rules/) — AGENTS.md with CLAUDE.md fallback
- [OpenCode Skills](https://opencode.ai/docs/skills/)
- [Kimi CLI Skills](https://moonshotai.github.io/kimi-cli/en/customization/skills.html)

### Industry Standards
- [Agent Skills open standard](https://www.agensi.io/learn/agent-skills-open-standard) — 32+ adopters
- [SKILL.md specification](https://www.agensi.io/learn/skill-md-specification-open-standard)
- [Agent Skills GitHub](https://github.com/agentskills/agentskills)
- [AGENTS.md as open standard (InfoQ)](https://www.infoq.com/news/2025/08/agents-md/)
- [Linux Foundation AAIF](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation) — 190 member orgs
- [OpenSSF Security Guide for AI Instructions](https://best.openssf.org/Security-Focused-Guide-for-AI-Code-Assistant-Instructions)

### MCP
- [MCP 97M monthly downloads](https://www.digitalapplied.com/blog/mcp-97-million-downloads-model-context-protocol-mainstream)
- [MCP 2026 roadmap](https://a2a-mcp.org/blog/mcp-2026-roadmap) — skills as planned MCP primitive
- [MCP Tools specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [MCP Prompts specification](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts)
- [Workflows MCP server](https://github.com/cyanheads/workflows-mcp-server)

### Multi-Agent Orchestrators
- [Goose (Block)](https://goose-docs.ai/) — YAML recipes + MCP extensions
- [Amp (Sourcegraph)](https://ampcode.com/) — AGENTS.md + SKILL.md + MCP
- [Continue.dev Rules](https://docs.continue.dev/customize/rules)
- [Aider Conventions](https://aider.chat/docs/usage/conventions.html)
- [Skills vs MCP (LlamaIndex)](https://www.llamaindex.ai/blog/skills-vs-mcp-tools-for-agents-when-to-use-what)

### Aigon Codebase (Verified)
- `templates/generic/skill.md` — 17 tool entries, 3-line system_prompt (manually maintained)
- `templates/generic/commands/*.md` — 43 command templates, 3,374 total lines
- `lib/templates.js:386` — `renderSkillMd()` auto-generates SKILL.md from templates
- `lib/templates.js:281` — `extractDescription()` parses HTML comment descriptions
- `lib/templates.js:290` — `COMMAND_REGISTRY` has metadata for all 43 commands
- `lib/commands/setup.js` — installation pipeline with format-specific transforms
- `templates/agents/*.json` — per-agent config (cc, cu, gg, cx, op, km)

## Recommendation

### The Core Insight

Aigon's two-format split (commands for cc/cu/gg, skill manifest for cx/op/km) was designed when agent capabilities diverged. **That divergence no longer exists.** All six agents now support the Agent Skills (SKILL.md) standard with progressive disclosure. The question is no longer "commands vs skills" but "how to deliver the same rich guidance to all agents via SKILL.md."

### Recommended Strategy: Unified SKILL.md-First Delivery

1. **Maintain command templates as the single source of truth** — keep writing `templates/generic/commands/*.md` with the full procedural guidance. These are Aigon's core product and cannot be auto-generated.

2. **Auto-generate the skill manifest from `COMMAND_REGISTRY`** — replace the manually-maintained 17-entry `skill.md` with one generated from the 43-entry registry. Every command becomes discoverable by every agent.

3. **Install full SKILL.md files for ALL agents** — extend `renderSkillMd()` usage to all six agents. Currently cc gets skills in `.claude/skills/`, cx/op/km get them in `.agents/skills/`. Add `.cursor/skills/` for cu and `.gemini/skills/` for gg. The full template body goes in the SKILL.md body, providing all agents with the same guidance depth.

4. **Keep agent-specific command formats as a secondary layer** — slash commands for cc (`.claude/commands/`), TOML commands for gg (`.gemini/commands/`), etc. These provide the invocation UX users expect but are now redundant with skills for guidance delivery. They can be deprecated gradually.

5. **Optional MCP server as a future convenience layer** — expose Aigon CLI commands as MCP tools for zero-install discovery. Not urgent since Agent Skills already provides cross-agent discovery, but the MCP 2026 roadmap plans to add "skills" as a native primitive, which would make this more natural.

6. **Enrich SKILL.md frontmatter** — add `argument-hint`, `disable-model-invocation`, and `allowed-tools` from existing registry data. This improves agent-native behavior without changing template content.

### What This Changes for Users

- **No workflow change** — users still type `/afd 55` or `aigon feature-do 55`
- **All agents get the same guidance depth** — the quality gap between command-format and skill-only agents closes
- **Fewer maintenance surfaces** — one template source generates all output formats automatically
- **Future-proof** — aligned with the Agent Skills open standard adopted by the industry

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| auto-generate-skill-manifest | Generate the `skill.md` tool manifest from `COMMAND_REGISTRY` instead of manual maintenance, covering all 43 commands | high | none |
| unified-skill-install | Install SKILL.md files for ALL six agents (add `.cursor/skills/` and `.gemini/skills/` to the install pipeline) | high | none |
| enriched-skill-frontmatter | Auto-populate `argument-hint`, `disable-model-invocation`, `allowed-tools` in generated SKILL.md frontmatter from registry data | medium | auto-generate-skill-manifest |
| progressive-disclosure-split | Split templates >5K tokens (feature-close, feature-code-review) into SKILL.md body + `references/` for better compaction survival | medium | unified-skill-install |
| deprecate-dual-format | Deprecate the command/skill format distinction in docs and templates; update AGENTS.md to describe unified SKILL.md delivery | medium | unified-skill-install |
| mcp-aigon-server | Optional MCP server exposing Aigon CLI commands as discoverable tools for zero-install agent integration | low | auto-generate-skill-manifest |
| skill-quality-metrics | Instrument eval data to compare workflow adherence and output quality between agents receiving skills vs commands | low | unified-skill-install |
