# Research Findings: OpenCode Comparison

**Agent:** Claude (cc)
**Research ID:** 25
**Date:** 2026-03-29

---

## Key Findings

### Critical Context: Two Projects Named "OpenCode"

There was a project split in mid-2025 that generated significant community drama:

1. **`opencode-ai/opencode`** (Go, Bubble Tea TUI) — the original project, **archived Sept 2025**. Development continues as **Crush** (`charmbracelet/crush`) by the Charm team.
2. **`anomalyco/opencode`** (TypeScript/Bun) — the actively maintained project that owns the `opencode.ai` domain. Built by the SST/Serverless Stack team (Dax Raad, Jay V, Frank Wang, Adam Elmore). This is the project everyone now refers to as "OpenCode."

The naming dispute generated HN drama. The SST team's project won the name and mindshare. All analysis below focuses primarily on the **active TypeScript project** (`anomalyco/opencode`), with notes on the archived Go version where relevant.

---

### 1. What is OpenCode?

| Attribute | Active (`anomalyco/opencode`) | Archived (`opencode-ai/opencode`) |
|-----------|-------------------------------|-----------------------------------|
| **Language** | TypeScript (56.8%), MDX (39.3%) | Go |
| **License** | MIT | MIT |
| **GitHub Stars** | 132,000 | 11,600 |
| **Forks** | 14,100 | — |
| **Contributors** | 828 | — |
| **Created** | April 30, 2025 | Earlier 2025 |
| **Current Version** | v1.3.5 (March 29, 2026) | Archived; continued as Crush |
| **Release Cadence** | Multiple per week, sometimes per day (953 tags total) | — |
| **MAU** | 650,000+ (claimed 5M+) | — |
| **UI** | TUI + Desktop app (Tauri) + IDE extension | Bubble Tea TUI only |
| **Built by** | Anomaly (SST/terminal.shop creators) | Developer who later joined Charm |

**Architecture:** Client/server model. Two built-in agents: "build" (full-access development) and "plan" (read-only analysis). Custom subagents definable via config. The archived Go version had a similar pattern: `CoderAgent` (primary) + `TaskAgent` (read-only sub-agent for parallel search) + `TitleAgent` + `SummarizerAgent`.

---

### 2. Models & Providers

OpenCode supports **75+ models** across 10+ providers. This is its #1 differentiator.

| Provider | Auth | Notes |
|----------|------|-------|
| Anthropic | `ANTHROPIC_API_KEY` | Claude 4 Opus/Sonnet, 3.7 Sonnet, 3.5 Sonnet/Haiku |
| OpenAI | `OPENAI_API_KEY` | GPT-4.1/4.1-mini/4.1-nano, GPT-4.5, O1/O3/O4-mini |
| Google Gemini | `GEMINI_API_KEY` | Gemini 2.5 Pro, 2.5 Flash, 2.0 Flash |
| GitHub Copilot | `GITHUB_TOKEN` | GPT, Claude, Gemini via Copilot (auto-discovered) |
| AWS Bedrock | AWS credential chain | Claude models |
| Azure OpenAI | `AZURE_OPENAI_ENDPOINT` | Full GPT suite |
| Google VertexAI | `VERTEXAI_PROJECT` | Gemini models |
| Groq | `GROQ_API_KEY` | Llama, Deepseek, QWQ-32b |
| OpenRouter | `OPENROUTER_API_KEY` | Meta-provider |
| X.AI | `XAI_API_KEY` | Grok models |
| **Local models** | Custom endpoint | Any OpenAI-compatible server (Ollama, LM Studio) |

**Auto-detection priority:** Copilot > Anthropic > OpenAI > Gemini > Groq > OpenRouter > XAI > Bedrock > Azure > VertexAI.

Users can switch models mid-conversation via `Ctrl+O`. Config supports `disabled_providers` and `enabled_providers` for organizational control.

**Comparison with Aigon:** Aigon's multi-agent approach assigns specific models to specific agents (e.g., Opus for planning, Sonnet for implementation). OpenCode's model system is more about user choice than role specialization. Aigon could potentially offer model-per-role flexibility while retaining its orchestration advantage.

---

### 3. Context Management

**Context file loading:** Reads project instructions from a configurable list of paths (loaded concurrently with deduplication):
- `CLAUDE.md`, `opencode.md`, `OPENCODE.md`
- `.github/copilot-instructions.md`, `.cursorrules`, `.cursor/rules/`
- Custom paths via `instructions` config array

**Auto-compact:** When token usage reaches ~95% of context window, automatically triggers summarization:
```json
{
  "compaction": {
    "auto": true,
    "prune": true,
    "reserved": 10000
  }
}
```
- `prune`: removes old tool outputs to free tokens
- `reserved`: token buffer (default 10,000) to prevent overflow

**Session persistence:** SQLite database stores sessions and messages. Multiple concurrent sessions switchable via `Ctrl+A` (TS version) or `Ctrl+S` (Go version).

**File change tracking:** Monitors modifications during sessions with snapshot-based undo/redo (`"snapshot": true`). Sidebar shows diffs (additions/removals) for all modified files.

**Comparison with Aigon:** Aigon has no auto-compaction — it relies on the underlying agent CLI's context management. OpenCode's approach is more explicit but also more complex for users to tune.

---

### 4. Tool/Function Calling & MCP Support

**14 built-in tools:**

| Tool | Permission Key | Description |
|------|---------------|-------------|
| `bash` | `bash` | Execute shell commands |
| `edit` | `edit` | Modify files via string replacement |
| `write` | `edit` | Create/overwrite files |
| `read` | `read` | Read file contents |
| `grep` | `grep` | Regex search in files |
| `glob` | `glob` | File pattern matching |
| `list` | `list` | List directories |
| `lsp` | `lsp` | LSP code intelligence (experimental) |
| `patch` | `edit` | Apply patch files |
| `skill` | `skill` | Load skill file content |
| `todowrite` | `todowrite` | Manage todo lists |
| `webfetch` | `webfetch` | Fetch web content |
| `websearch` | `websearch` | Search web via Exa AI |
| `question` | `question` | Ask user questions |

**MCP support — full, first-class:**

```json
{
  "mcp": {
    "local-server": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-everything"],
      "env": { "KEY": "value" },
      "timeout": 5
    },
    "remote-server": {
      "type": "remote",
      "url": "https://mcp.example.com",
      "headers": { "Authorization": "Bearer ..." }
    }
  }
}
```

- OAuth support via Dynamic Client Registration (RFC 7591)
- CLI management: `opencode mcp list/auth/logout/debug`
- Tool control: MCP tools can be enabled/disabled per-agent using glob patterns

**Comparison with Aigon:** Aigon delegates tool calling to the underlying agent CLI (Claude Code, Gemini CLI). OpenCode manages its own tool system. Both support MCP. OpenCode's built-in web search (via Exa AI) is notable — Aigon relies on the agent CLI's capabilities.

---

### 5. Permissions & Safety

**Three permission levels** (per-tool, configurable in `opencode.json`):

| Level | Behavior |
|-------|----------|
| `allow` | Runs without restriction (default for all tools) |
| `ask` | Requires user approval before execution |
| `deny` | Tool cannot be used |

**Approval flow:** When `ask` is set, a modal dialog appears:
- `a` = allow once
- `A` = allow for session (persistent grant, scoped to tool+action+path+session)
- `d` = deny

**Auto-approve mode:** Sessions can be registered for full auto-approval (yolo mode).

**What's missing:**
- No sandboxing — commands execute directly in user's shell
- No file-level allowlists
- No network isolation

**Security incident:** CVE-2026-22812 (CVSS 8.8) — unauthenticated HTTP server allowed arbitrary shell command execution. Fixed in v1.0.216, but damaged trust.

**Privacy concern:** Prompts were sent to Grok for session title generation without explicit consent, contradicting "privacy-first" marketing. Discovered by user via mitmproxy.

**Comparison with Aigon:** Aigon inherits permissions from underlying agent CLIs. OpenCode's permission system is more granular but has had security issues. The CVE is a significant trust concern.

---

### 6. Multi-Agent & Orchestration

**No true multi-agent orchestration.** The Go version had:
- `CoderAgent` (primary, full tool access)
- `TaskAgent` (read-only sub-agent for parallel search — glob, grep, ls, view, sourcegraph)
- `TitleAgent` (generates session titles)
- `SummarizerAgent` (compacts long conversations)

The TS version has `build` and `plan` agents, plus custom subagents via config. But these are all within a single session — there is no concept of:
- Parallel agents working on different worktrees
- Agent coordination or delegation
- State machines or lifecycle management
- Fleet mode equivalent

**Comparison with Aigon:** This is Aigon's strongest differentiator. Aigon's Fleet mode with parallel worktree agents, state machine lifecycle, and coordinated evaluation has no equivalent in OpenCode. OpenCode is fundamentally a single-agent tool.

---

### 7. Work Items & Project Management

**Purely conversational.** The unit of work is a **session** — a flat conversation thread stored in SQLite. Sessions have:
- `id`, `title`, `message_count`, `prompt_tokens`, `completion_tokens`, `cost`
- `parent_session_id` for task sub-sessions
- `summary_message_id` for compacted sessions

**No concept of:**
- Features, tasks, or work items
- Kanban board or state machine
- Lifecycle management
- Spec files or research topics

**Git integration:** Minimal — the LLM handles git via bash. System prompt instructs "NEVER commit changes unless the user explicitly asks you to." No built-in PR creation, issue tracking, or branch management. Recent addition: git-backed session review (review uncommitted changes/branch diffs within OpenCode).

**Comparison with Aigon:** Aigon's structured workflow (feature-create → start → do → submit → review → close) with state machine enforcement is a fundamental architectural difference. OpenCode offers conversational flexibility but no workflow guardrails.

---

### 8. Developer Experience

**TUI (Go version):** Rich Bubble Tea TUI with:
- Sidebar showing session info, LSP diagnostics, modified files with diff stats
- 10+ dialogs: permission, session switcher, command palette, model selector, theme switcher, file picker
- Status bar: token usage (with 80% warning), cost, LSP diagnostics, current model
- 10 built-in themes: opencode, catppuccin, dracula, flexoki, gruvbox, monokai, onedark, tokyonight, tron
- Vim-like text input with `Ctrl+E` for external editor

**Desktop App (TS version):** Tauri-based native app on macOS/Windows/Linux (beta).

**IDE Extension:** Available alongside TUI and desktop.

**Custom commands:** Markdown files in `~/.config/opencode/commands/` (user-scoped, `user:` prefix) or `.opencode/commands/` (project-scoped, `project:` prefix). Support subdirectory organization and named argument placeholders with interactive input dialogs.

**Plugin system:** npm-based plugins with custom tools and hooks (TS version).

**Config hierarchy:** `~/.opencode.json` (global) → `$XDG_CONFIG_HOME/opencode/.opencode.json` → `./.opencode.json` (project-local).

**No hooks system** in Go version; TS version has plugin-based hooks.

**Comparison with Aigon:** OpenCode's TUI is polished and themed. Aigon's web dashboard offers richer visualization (kanban, telemetry, multi-agent status) but requires a browser. OpenCode's custom commands are similar to Aigon's slash commands.

---

### 9. Enterprise Features

**None.** OpenCode is single-user, local-only:
- No shared configuration
- No team management or SSO/SAML
- No audit logging or compliance
- No role-based access control
- No centralized policy management

**Cost tracking:** Per-session in status bar — token usage + dollar cost calculated from embedded per-model pricing. Rolls up sub-agent costs to parent session. All stored in SQLite.

**Observability:** Debug mode writes to `.opencode/debug.log`. Logs page (`Ctrl+L`) shows runtime logs. No external observability integration (no OpenTelemetry, no metrics export).

**Business model:** Free and open source (MIT). Revenue comes from **OpenCode Zen** — curated, benchmarked model hosting service with pay-as-you-go ($20 balance increments) and subscription ($10/month) tiers. Generating "several million dollars in annualized revenue."

**Comparison with Aigon:** Aigon's planned AADE commercial tier would be differentiated by enterprise features. OpenCode's revenue model (hosting curated models) is orthogonal — they monetize the model layer, not the workflow layer.

---

### 10. Community Reception

**Adoption:** 132k GitHub stars, 650k MAU within 5 months. Major spike in Jan 2026 (+18k stars in two weeks) when Anthropic blocked consumer Claude subscriptions from third-party tools.

**What users praise:**
- Model flexibility (#1) — no vendor lock-in, switch mid-task
- Stability over extended sessions (compared favorably to Claude Code)
- Agentic loop — "first time I felt like I could write up a large prompt, walk away, and come back to a lot of work done"
- Zero-friction onboarding — works immediately without sign-up
- Cost efficiency via model switching

**What users complain about:**
- **Resource usage:** "1GB of RAM or more. For a TUI" (HN)
- **Feature bloat:** "so full of features that I don't really need... hard to use" (HN)
- **TUI bugs:** Scrolling glitches, copy/paste hijacked, keyboard input issues
- **Privacy contradictions:** Prompts sent to Grok for title generation without consent
- **Unsafe defaults:** Reports of OpenCode deploying to prod without asking consent
- **Context window confusion:** Difficulty understanding what the agent can "see"
- **CVE-2026-22812:** Critical RCE vulnerability damaged trust

**Key comparison takeaways from community:**
- Claude Code wins on model quality and agentic reasoning depth
- OpenCode wins on model choice, cost control, and privacy
- Aider wins on git integration and reviewable edits
- Many developers use 2+ tools for different tasks

---

### 11. Gap Analysis

#### Where OpenCode Clearly Beats Aigon

| Area | OpenCode Advantage | Impact |
|------|-------------------|--------|
| **Model flexibility** | 75+ models, 10+ providers, switch mid-task | High — users want cost optimization and model choice |
| **Local model support** | Ollama, LM Studio integration out of the box | Medium — privacy-conscious users, offline work |
| **TUI polish** | 10 themes, rich sidebar, integrated model/session switching | Medium — terminal-native devs prefer this |
| **Desktop app** | Tauri native app alongside CLI | Medium — accessibility for non-terminal users |
| **Adoption/community** | 132k stars, 650k MAU, 828 contributors | High — network effects, ecosystem momentum |
| **Plugin system** | npm-based plugins with custom tools | Medium — extensibility |
| **GitHub Actions** | `/opencode` mentions in issues/PRs for automated work | Medium — CI/CD integration |

#### Where Aigon Clearly Beats OpenCode

| Area | Aigon Advantage | Impact |
|------|----------------|--------|
| **Multi-agent orchestration** | Fleet mode: parallel agents across worktrees | High — the core differentiator |
| **Structured workflow** | Feature lifecycle with state machine enforcement | High — prevents chaos on complex tasks |
| **Work item management** | Features, research topics with specs, kanban board | High — project-level visibility |
| **Web dashboard** | Real-time multi-agent status, telemetry, board view | High — richer than any TUI |
| **Evaluation/review** | Built-in review step with different agent | Medium — quality assurance built into workflow |
| **Cross-agent telemetry** | Cost tracking across agents and sessions | Medium — enterprise-grade observability |
| **Agent specialization** | Different agents for different roles (impl, eval) | Medium — right tool for the job |
| **Worktree isolation** | Each agent works in its own git worktree | Medium — prevents conflicts |

#### What OpenCode Features Aigon Could Adopt

| Feature | Priority | Rationale |
|---------|----------|-----------|
| **Model switching within session** | High | Users want to use cheaper models for simple tasks, expensive models for complex ones |
| **Auto-compaction** | Medium | Explicit context management would help long sessions |
| **Built-in themes** | Low | Dashboard already has a UI; TUI theming is less relevant |
| **Custom commands with argument dialogs** | Low | Aigon already has slash commands; argument prompting is a nice UX touch |
| **Plugin system** | Medium | Extensibility beyond slash commands and hooks |
| **Local model support** | Medium | Privacy, cost-saving, offline development |

#### What Aigon Strengths to Highlight in Positioning

1. **"OpenCode is a tool. Aigon is a workflow."** — OpenCode helps you write code in a session. Aigon manages the entire feature lifecycle across multiple agents.
2. **"Parallel agents, not sequential sessions."** — Fleet mode is architecturally unique.
3. **"Built-in quality gates."** — Evaluation and review steps are part of the workflow, not afterthoughts.
4. **"Visibility at scale."** — Dashboard shows what all agents are doing, not just the current session.
5. **"Agent specialization."** — Right model for the right job, assigned automatically.

---

## Sources

### Primary Sources
- [anomalyco/opencode GitHub (132K stars)](https://github.com/anomalyco/opencode)
- [opencode-ai/opencode GitHub (archived, 11.6K stars)](https://github.com/opencode-ai/opencode)
- [OpenCode Official Site](https://opencode.ai/)
- [OpenCode Docs - MCP Servers](https://opencode.ai/docs/mcp-servers/)
- [OpenCode Docs - Tools](https://opencode.ai/docs/tools/)
- [OpenCode Docs - Config](https://opencode.ai/docs/config/)
- [OpenCode Docs - CLI](https://opencode.ai/docs/cli/)
- [OpenCode Releases](https://github.com/anomalyco/opencode/releases)
- [OpenCode Changelog](https://opencode.ai/changelog)

### Community & Comparisons
- [HN: OpenCode — Open source AI coding agent (March 2026)](https://news.ycombinator.com/item?id=47460525)
- [HN: Opencode — AI coding agent, built for the terminal (June 2025)](https://news.ycombinator.com/item?id=44482504)
- [HN: OpenCode naming dispute](https://news.ycombinator.com/item?id=44738140)
- [HN: OpenCode RCE vulnerability](https://news.ycombinator.com/item?id=46539718)
- [Infralovers: Claude Code vs OpenCode (Jan 2026)](https://www.infralovers.com/blog/2026-01-29-claude-code-vs-opencode/)
- [DataCamp: OpenCode vs Claude Code (Feb 2026)](https://www.datacamp.com/blog/opencode-vs-claude-code)
- [NxCode: OpenCode vs Claude Code vs Cursor (2026)](https://www.nxcode.io/resources/news/opencode-vs-claude-code-vs-cursor-2026)
- [NxCode: Aider vs OpenCode (2026)](https://www.nxcode.io/resources/news/aider-vs-opencode-ai-coding-cli-2026)
- [MorphLLM: We Tested 15 AI Coding Agents](https://www.morphllm.com/ai-coding-agent)
- [TechFundingNews: OpenCode Background Story](https://techfundingnews.com/opencode-the-background-story-on-the-most-popular-open-source-coding-agent-in-the-world/)

### Security
- [CVE-2026-22812 (Critical RCE, CVSS 8.8)](https://nvd.nist.gov/vuln/detail/CVE-2026-22812)

### Related Projects
- [Charmbracelet/Crush (original OpenCode successor)](https://github.com/charmbracelet/crush)
- [OpenCode Zen (curated model hosting)](https://opencode.ai/zen)
- [DeepWiki: MCP and External Tools](https://deepwiki.com/opencode-ai/opencode/6.3-mcp-and-external-tools)

---

## Recommendation

OpenCode's explosive growth (132k stars, 650k MAU) validates the market for CLI-first AI coding tools. However, OpenCode and Aigon are **fundamentally different products** despite surface similarities:

- **OpenCode is a coding assistant** — it helps you write code in interactive sessions with model flexibility.
- **Aigon is a development workflow orchestrator** — it manages feature lifecycles across multiple agents with structured quality gates.

**Strategic recommendations:**

1. **Don't compete on model breadth.** OpenCode's 75+ model support is a solved problem for them. Aigon's value is in orchestration, not in being another model switcher. Instead, ensure Aigon works well with whatever agent CLI the user chooses.

2. **Double down on orchestration.** Fleet mode, worktree isolation, state machine lifecycle, and cross-agent evaluation are architectural moats that OpenCode has no equivalent for and would be extremely difficult to bolt on.

3. **Consider selective feature adoption:**
   - **Model switching per role** (high priority) — let users configure cheaper models for implementation and expensive models for evaluation within Aigon's existing multi-agent framework.
   - **Local model support** (medium priority) — privacy-conscious and cost-sensitive users want Ollama integration.
   - **Plugin/extensibility system** (medium priority) — allow community-contributed commands and integrations.

4. **Position clearly.** The messaging should be: "If you need a smart code editor, use OpenCode. If you need to manage a development workflow with multiple agents, quality gates, and project-level visibility, use Aigon." These tools are complementary, not directly competitive.

5. **Learn from their mistakes.** The CVE-2026-22812 and privacy leak incidents show the cost of moving fast without security review. Aigon's approach of delegating tool execution to battle-tested agent CLIs (Claude Code, Gemini CLI) is safer.

---

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| model-role-assignment | Allow users to configure different models for different agent roles (impl, eval, plan) within Fleet mode | high | none |
| local-model-support | Support Ollama and OpenAI-compatible local model endpoints as agent backends | medium | none |
| session-cost-dashboard | Display per-session and per-agent cost breakdowns in the Aigon dashboard | medium | none |
| context-compaction-awareness | Surface context window usage and compaction status in the dashboard for each active agent | low | none |
| plugin-system | Allow npm-based community plugins for custom commands, tools, and integrations | medium | none |
| opencode-agent-backend | Support OpenCode as an agent backend alongside cc/gg/cx/mv | low | local-model-support |
