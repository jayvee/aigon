# Research Findings: Roo Code Comparison

**Agent:** Claude (cc)
**Research ID:** 24
**Date:** 2026-03-28

---

## Key Findings

### 1. Roo Code Core Features

Roo Code is a VS Code extension (forked from Cline in late 2024, Apache 2.0) that provides AI-powered coding assistance with a strong emphasis on modal workflows and MCP integration. As of March 2026, it has ~22.8k GitHub stars and ~1.2M VS Code Marketplace installs.

**Built-in Modes (5):**

| Mode | Role | Tool Access |
|------|------|-------------|
| **Code** (default) | Software engineer | Full: read, edit, command, mcp |
| **Architect** | Technical planner | Read, mcp, restricted edit (markdown only) |
| **Ask** | Knowledge assistant | Read, mcp only |
| **Debug** | Problem solver | Full: read, edit, command, mcp |
| **Orchestrator** | Workflow coordinator | None — delegates only via `new_task` |

Each mode has "sticky model" behavior — the UI remembers the last model used per mode, so users can assign cheap models to simple modes and expensive reasoning models to planning.

**Tool Inventory:**
- File tools: `read_file`, `list_files`, `search_files`, `codebase_search` (semantic/vector), `write_to_file`, `apply_diff`, `search_and_replace`
- Terminal: `execute_command`, `read_command_output` (with configurable timeouts 0-600s)
- MCP: `use_mcp_tool`, `access_mcp_resource`
- Mode: `switch_mode`, `new_task` (always available to all modes)
- Other: `ask_followup_question`, `attempt_completion`, `update_todo_list`, `generate_image`

**Tool Approval:** Per-category granularity (read, edit, command, mcp, modes, subtasks). Each can be individually auto-approved. Command execution supports allowlist/denylist patterns. Write operations have an optional delay that integrates with VS Code diagnostics.

Sources:
- https://docs.roocode.com/basic-usage/using-modes
- https://docs.roocode.com/features/custom-modes
- https://docs.roocode.com/features/auto-approving-actions

---

### 2. Multi-Agent Orchestration

**This is Roo Code's headline feature — but it is NOT true multi-agent parallelism.**

The Orchestrator (Boomerang) mode works as follows:
1. User gives a complex task to the Orchestrator
2. Orchestrator breaks it into discrete subtasks
3. Each subtask is dispatched to a specialized mode via `new_task` with `{ mode, message, todos? }`
4. The parent task **pauses** while the subtask runs
5. Subtask has **complete context isolation** — its own conversation history, no shared state
6. Subtask signals completion via `attempt_completion` with a summary string
7. Parent resumes with only that summary, decides next subtask or synthesizes results

**Critical design constraints:**
- **Sequential only** — one subtask at a time, parent pauses while child runs
- **Context-isolated** — information flows down via message, up via summary only
- **Capability-limited** — Orchestrator has zero tools; it can only delegate
- **Single VS Code instance** — no parallel execution across terminals/processes

There are two mode-switching mechanisms:
- `switch_mode`: changes mode within the same conversation (keeps context)
- `new_task`: creates an isolated child task (loses context, returns summary)

Both are always available to all modes — any mode can delegate, not just Orchestrator.

**Comparison to Aigon Fleet mode:**

| Aspect | Roo Code Orchestrator | Aigon Fleet Mode |
|--------|----------------------|------------------|
| Parallelism | Sequential only | True parallel (multiple worktrees + agents) |
| Context | Isolated per subtask | Each agent has full repo access |
| Coordination | `new_task` tool delegation | State machine + manifests + dashboard |
| Execution | Single VS Code process | Multiple terminals/processes (tmux) |
| Model diversity | Sticky model per mode | Different models per agent role |
| Evaluation | No built-in comparison | Feature-eval compares agent solutions |
| State tracking | None beyond conversation | Kanban board, manifests, logs |

**Verdict:** Roo Code's orchestration is better described as "sequential mode-switching with task isolation" — not a multi-agent system. Aigon's Fleet mode is fundamentally more capable for parallel work.

Sources:
- https://docs.roocode.com/features/boomerang-tasks
- https://github.com/RooCodeInc/Roo-Code/blob/main/packages/types/src/mode.ts
- https://github.com/RooCodeInc/Roo-Code/blob/main/src/shared/tools.ts

---

### 3. Custom Modes System

Custom modes are Roo Code's most flexible feature. Users can define modes with:

```yaml
# .roomodes (project-level)
customModes:
  - slug: security-reviewer
    name: "Security Reviewer"
    roleDefinition: |
      You are a security expert focused on finding vulnerabilities.
    whenToUse: "Use for security audits and code review"
    customInstructions: "Follow OWASP guidelines"
    groups:
      - read
      - - edit
        - fileRegex: \.(md|mdx)$
          description: "Markdown files only"
      - command
```

**Key properties:**
- Tool access controlled per-mode via `groups` with optional `fileRegex` restrictions
- `whenToUse` field guides Orchestrator delegation decisions
- `roleDefinition` injected at the start of the system prompt
- `customInstructions` appended near end of system prompt
- Precedence: project `.roomodes` > global `custom_modes.yaml` > built-in defaults
- Can override built-in modes by matching their slug
- Created via natural language prompt, UI, or manual file editing

**Comparison to Aigon agent profiles:**

| Aspect | Roo Code Custom Modes | Aigon Agent Profiles |
|--------|----------------------|---------------------|
| Scope | Per-task behavior within one tool | Per-agent identity across tools |
| Tool control | Fine-grained per-mode (read, edit, command, mcp with file regex) | Permissions managed by each agent CLI's native system |
| Model binding | Sticky per mode (user-configured) | Model set per agent role (cc=Opus, sonnet=Sonnet, etc.) |
| Instructions | roleDefinition + customInstructions per mode | AGENTS.md + per-agent docs + templates |
| Sharing | `.roomodes` file (committable) | Templates in `templates/` (source of truth) |
| Marketplace | Mode Gallery for community sharing | Not yet — modes are internal |

**What's worth adopting:** The `groups` system with `fileRegex` restrictions is elegant — it lets you create a mode that can only edit markdown, or only read test files. Aigon doesn't have this level of fine-grained tool control per role.

Sources:
- https://docs.roocode.com/features/custom-modes

---

### 4. MCP Integration

Roo Code has first-class MCP support:

**Transports:** stdio, streamable HTTP, SSE (legacy)

**Configuration:** JSON files at two levels:
- Global: `mcp_settings.json` (via VS Code settings)
- Project: `.roo/mcp.json` (committable, takes precedence)

**Per-server settings:** `command`, `args`, `env`, `url`, `headers`, `alwaysAllow` (auto-approve specific tools), `disabled` (toggle), `timeout` (1-3600s), `disabledTools`, `watchPaths` (auto-restart triggers).

**Built-in marketplace:** Discover and one-click install community MCP servers from within the extension.

**Comparison to Aigon:** Aigon doesn't manage MCP — it delegates to each agent CLI's native MCP support (Claude Code has `claude mcp add`, Cursor has its own config). Roo Code's unified per-project `.roo/mcp.json` is a stronger pattern for team-level MCP standardization.

Sources:
- https://docs.roocode.com/features/mcp/overview
- https://docs.roocode.com/features/mcp/using-mcp-in-roo
- https://docs.roocode.com/features/mcp/server-transports

---

### 5. Context Management & Memory

**Context condensing:** Triggers when context reaches a configurable threshold (default 100%, adjustable). Uses a 4-step process: Summarization → Essential Retention → Flow Maintenance → Command Preservation. The same model does the condensing. Original messages survive in Checkpoints for rollback. Custom condensing prompts let users specify what to preserve.

**Codebase indexing:** Tree-sitter parsing + vector embeddings (configurable providers: Gemini, OpenAI, Ollama, Mistral) stored in Qdrant. Exposed as `codebase_search` tool for semantic natural language queries.

**Memory:** Roo Code does **not** have automatic persistent memory across sessions. Persistence is achieved through:
- `.roo/rules/` directories (project-level instructions)
- `.roo/rules-{modeSlug}/` (mode-specific instructions)
- `AGENTS.md` (team-level)
- Skills system (`.roo/skills/{name}/SKILL.md` — on-demand specialized instructions with progressive disclosure)

**Checkpoints:** Shadow Git repo captures workspace state before each file modification. Two restore modes: "Files Only" or "Files & Task."

**Comparison to Aigon:** Aigon doesn't manage context windows — each agent CLI handles its own compression. Aigon's memory is project-level (CLAUDE.md, AGENTS.md, docs/) and persists across sessions. Roo Code's skills system with progressive disclosure (frontmatter → instructions → resources) is similar to Aigon's skill templates.

Sources:
- https://docs.roocode.com/features/intelligent-context-condensing
- https://docs.roocode.com/features/codebase-indexing
- https://docs.roocode.com/features/custom-instructions
- https://docs.roocode.com/features/skills

---

### 6. Code Review & Evaluation

**PR Reviewer** — a separate standalone product at roocode.com/reviewer:
- Connects to GitHub repos, runs on every PR
- Multi-step: diff analysis → context gathering → impact mapping → contract validation
- Analyzes dependency graphs, code ownership, team conventions, historical patterns
- BYOK model — no built-in code review within the main extension

**No built-in evaluation of AI-generated code.** The PR Reviewer is the closest equivalent, but it's a separate product, not integrated into the extension's workflow.

**Comparison to Aigon:** Aigon has `feature-eval` which performs structured comparison of agent solutions in Arena mode, plus `feature-review` for solo mode code review. This is tightly integrated into the workflow — not a separate product.

Sources:
- https://roocode.com/reviewer

---

### 7. Observability & Analytics

**Roo Code Cloud Analytics dashboard:**
- Tracks: tasks, tokens (input + output), inference cost, cloud usage runtime
- Aggregation: by user, cloud agent, model, repository
- Filters: task source, creator, repository, PR, provider, timeframe

**Local extension tracking:**
- Per-request cost estimate inline in chat history
- Task history sortable by cost or token usage

**Third-party:** Portkey integration for enterprise-grade tracking (40+ metrics).

**Comparison to Aigon:**
- Aigon dashboard shows feature/research state, agent status, worktree health — workflow-level observability
- Aigon telemetry tracks session-level costs and cross-agent reporting
- Roo Code tracks model-level costs (tokens, inference) — compute-level observability
- Different focus: Aigon = workflow orchestration visibility; Roo Code = LLM spend visibility

Sources:
- https://docs.roocode.com/roo-code-cloud/analytics
- https://docs.roocode.com/advanced-usage/rate-limits-costs

---

### 8. Pricing Model

| Tier | Price | What You Get |
|------|-------|-------------|
| **VS Code Extension** | Free (Apache 2.0) | Unlimited local use, BYOK, custom modes, MCP |
| **Cloud Free** | $0/month + credits | Cloud Agents ($5/hr), Roo Router, analytics |
| **Cloud Team** | $99/month + credits | Unlimited users, shared config, Slack/Linear integrations |
| **Enterprise** | Custom | SAML/SCIM, large deployments |

**Comparison to Aigon:** Aigon is fully open source (free CLI + dashboard). Aigon Pro is the planned commercial tier with an insights engine, the Insights tab and extended analytics, and AI coaching. Both use a freemium model: open-source core + paid advanced features.

Source: https://roocode.com/pricing

---

### 9. Feature-by-Feature Comparison

| Feature | Roo Code | Aigon | Advantage |
|---------|----------|-------|-----------|
| **True parallel agents** | No (sequential only) | Yes (Fleet mode, multiple worktrees) | **Aigon** |
| **Agent evaluation/comparison** | No built-in | Yes (feature-eval, Arena mode) | **Aigon** |
| **Workflow state machine** | None | Full Kanban (inbox → backlog → in-progress → eval → done) | **Aigon** |
| **Research workflow** | None | Research lifecycle with evaluation | **Aigon** |
| **Dashboard** | Cloud Analytics (cost/tokens) | Feature dashboard (state, agents, worktrees) | **Aigon** (workflow); **Roo** (cost) |
| **Multi-agent CLI support** | VS Code only | cc, gg, cx, cu, mv (5 agent CLIs) | **Aigon** |
| **Custom modes/roles** | Excellent (fine-grained tool control, file regex) | Agent profiles (6 project types) | **Roo Code** |
| **Tool access control** | Per-mode with regex file restrictions | Per-agent via native CLI permissions | **Roo Code** |
| **MCP management** | First-class (project config, marketplace, transports) | Delegates to each agent CLI | **Roo Code** |
| **Context condensing** | Built-in with custom prompts, checkpoints | Delegates to agent CLI | **Roo Code** |
| **Codebase indexing** | Vector search with configurable providers | None | **Roo Code** |
| **Checkpoints/rollback** | Shadow git per modification | Git branches/worktrees | **Roo Code** |
| **Mode marketplace** | Built-in gallery for community modes | None | **Roo Code** |
| **Skills system** | Progressive disclosure (frontmatter → instructions → resources) | Template-based commands | **Tie** |
| **Pricing** | Free extension, paid cloud | Free CLI, planned Pro tier | **Tie** |
| **IDE requirement** | VS Code only | IDE-agnostic (terminal-based) | **Aigon** |
| **PR code review** | Standalone product (PR Reviewer) | Built-in (feature-review) | **Tie** |
| **Cost tracking** | Per-request inline + Cloud Analytics | Session telemetry | **Roo Code** |

---

### 10. Aigon's Competitive Advantages (Features Roo Code Lacks)

1. **True parallel execution** — Multiple agents working simultaneously in isolated worktrees, not sequential subtask delegation
2. **Arena mode** — Multiple agents implement the same feature independently, then an LLM judge evaluates and picks a winner
3. **Structured workflow** — Full Kanban lifecycle for features AND research topics, with state machine enforcement
4. **Multi-CLI support** — Works with Claude Code, Gemini, Codex, Cursor, Mistral Vibe — not locked to one IDE
5. **Research lifecycle** — Dedicated workflow for exploratory research before building features
6. **Feedback triage** — AI-assisted feedback management with duplicate detection
7. **Spec-driven development** — Features always start from a spec, enforced by the state machine
8. **Worktree management** — Automated git worktree creation, tmux sessions, terminal launching
9. **Feature logs/evaluations** — Persistent narrative logs and structured evaluations

---

## Sources

- Roo Code Docs: https://docs.roocode.com/
- Roo Code GitHub: https://github.com/RooCodeInc/Roo-Code
- Roo Code Pricing: https://roocode.com/pricing
- Roo Code PR Reviewer: https://roocode.com/reviewer
- Roo Code MCP: https://docs.roocode.com/features/mcp/overview
- Roo Code Custom Modes: https://docs.roocode.com/features/custom-modes
- Roo Code Boomerang Tasks: https://docs.roocode.com/features/boomerang-tasks
- Roo Code Context Condensing: https://docs.roocode.com/features/intelligent-context-condensing
- Roo Code Codebase Indexing: https://docs.roocode.com/features/codebase-indexing
- Roo Code Cloud Analytics: https://docs.roocode.com/roo-code-cloud/analytics
- Portkey Integration: https://portkey.ai/docs/integrations/libraries/roo-code
- VS Code Marketplace: https://marketplace.visualstudio.com/items?itemName=RooVeterinaryInc.roo-cline

---

## Recommendation

Aigon's core competitive advantage — **true parallel multi-agent execution with structured evaluation** — is something Roo Code fundamentally lacks. Roo Code's "Orchestrator" is sequential mode-switching, not parallelism. Aigon should lean into this strength.

However, Roo Code has several UX patterns worth adopting:

1. **Fine-grained tool control per role** — Roo Code's `groups` system with `fileRegex` restrictions is elegant. Aigon could offer per-agent tool restrictions (e.g., "this agent can only edit test files") as part of the worktree setup.

2. **Project-level MCP configuration** — A `.aigon/mcp.json` that Aigon pushes to each agent CLI's native MCP config during `install-agent` would standardize MCP tooling across agents.

3. **Cost tracking dashboard** — Roo Code's per-request cost inline + aggregated analytics is a gap in Aigon. The existing telemetry module could be extended into a dashboard panel.

4. **Mode/role marketplace** — Aigon could offer a community registry for agent role configurations (beyond the 6 built-in profiles).

5. **Codebase indexing** — Vector search for semantic code navigation would benefit agents during research and implementation phases.

The highest-impact features to adopt are **cost tracking** (users care deeply about spend across multiple agents) and **fine-grained tool control** (safety for autonomous agents).

---

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| agent-tool-restrictions | Per-agent file/tool restrictions during worktree setup (inspired by Roo Code's groups with fileRegex) | medium | none |
| unified-mcp-config | Project-level MCP configuration in `.aigon/mcp.json` that syncs to each agent CLI during install-agent | medium | none |
| cost-tracking-dashboard | Aggregate per-agent cost tracking in the Aigon dashboard with per-feature and per-session breakdowns | high | none |
| role-marketplace | Community registry for shareable agent role configurations beyond the 6 built-in profiles | low | none |
| codebase-semantic-search | Vector indexing of codebase for semantic search, available to all agents during research/implementation | low | none |
