# Research Findings: competitive positioning and landscape

**Agent:** Gemini (gg)
**Research ID:** 44
**Date:** 2026-04-26

---

## Key Findings

<!-- Document discoveries, options evaluated, pros/cons -->

## Sources

<!-- Links to documentation, articles, code examples -->

## Recommendation

<!-- This agent's recommended approach based on findings -->

## Suggested Features

<!--
Use the table format below. Guidelines:
- feature-name: Use kebab-case, be specific (e.g., "user-auth-jwt" not "authentication")
- description: One sentence explaining the capability
- priority: high (must-have), medium (should-have), low (nice-to-have)
- depends-on: Other feature names this depends on, or "none"
-->

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| example-feature | Brief description of what this feature does | high | none |
# Findings: Competitive Positioning and Landscape (Gemini)

## 1. Category & Positioning

**Market Terminology:**
The broader market is consolidating around two key terms: **Spec-Driven Development (SDD)** (treating specs as executable contracts rather than static documents) and **Multi-Agent Orchestration** (managing fleets of agents across git worktrees or branches). Other common terms include "AI coding assistants" (mostly IDE plugins) and "Agentic frameworks" (like LangGraph, which are frameworks, not end-user tools).

**Recommended Category Alignment:**
Aigon should adopt **"Spec-Driven Development Orchestrator"** (or "Multi-Agent Workflow Orchestrator"). This strongly differentiates Aigon from simple coding assistants (Cursor, Aider) and task boards (Cline Kanban). It leans into Aigon’s core strengths: starting with a spec, running parallel agents, and strictly evaluating outcomes.

**Copy Chunks:**
- **One-liner:** Aigon is a spec-driven development orchestrator that manages your entire feature lifecycle across multiple AI agents.
- **One-paragraph:** Aigon is an open-source, multi-agent development workflow orchestrator. Unlike IDE assistants that require constant pairing or task boards that just run sequential scripts, Aigon takes a feature specification and manages the entire lifecycle. It handles planning, parallel implementation by competing agents, automated evaluation, and code review. Aigon delegates the actual coding to best-in-class CLI agents (like Claude Code, Gemini CLI, or Codex) while maintaining a rigorous, git-native source of truth.
- **One-page:** (Expands on the above by detailing Fleet mode, the `docs/specs/` source of truth, git worktree isolation, and the Arena evaluation model.)
- **Reusable Chunks (for marketing/social):**
  - *Hero:* Spec-driven development with competing AI agents.
  - *Social bio:* Open-source multi-agent workflow orchestrator. Manage feature lifecycles with Claude, Gemini, and local models.
  - *README Opener:* A CLI-first workflow orchestrator that runs multiple AI coding agents in parallel, evaluates their work, and merges the winner.

## 2. Competitive Landscape

**Closest Competitors (Orchestrators & SDD):**
- **Cline Kanban:** Closest orchestration UI, but task-board focused rather than spec-driven. Uses dependency chains rather than parallel competition.
- **SpecKit:** GitHub's SDD toolkit. Very similar philosophy on specs as code, but lacks Aigon's multi-agent Fleet engine.
- **GSD:** Wave-based parallel execution with milestone specs.
- **Kiro:** Commercial spec-driven platform, but IDE-first.

**Commercial Agents (Assistants & Autonomous):**
- **Cursor & Windsurf:** Dominant IDE-integrated assistants. Stronger editor flow, but single-agent/conductor models with weaker workflow orchestration.
- **Devin & Jules:** High-profile autonomous cloud agents. Opaque control models, fundamentally different from Aigon's local, transparent orchestration.

**OSS Alternatives:**
- **Roo Code:** OSS IDE extension with custom modes and multi-step workflows.
- **Aider:** Mature CLI pair programmer.

**Not Competitors (Engines):**
Claude Code, Gemini CLI, Codex CLI, Goose. These are the *engines* Aigon orchestrates. 

**Archived/Irrelevant:**
OpenCode (archived), Sweep, Mentat, Copilot Workspace (discontinued).

## 3. Philosophy / Approach Axes

Based on market vocabulary and F238, here are the 10 axes that best capture philosophical differences.

**Top 5 (For the Public Page):**
1. **Primary unit of work:** Feature spec (Aigon) vs. Task card (Cline) vs. Chat session (Cursor).
2. **Source of truth:** Markdown specs in git (Aigon) vs. Board cards vs. IDE project state.
3. **Multi-agent behavior:** Parallel competition/evaluation (Aigon) vs. Dependency chains (Cline) vs. Single-agent (Cursor/Aider).
4. **Isolation model:** Git worktrees (Aigon) vs. Single branch vs. Cloud sandbox (Devin).
5. **Evaluation model:** Formal rubric/review (Aigon) vs. Diff review vs. None.

**Internal 5 (For Internal Matrix):**
6. **Interface:** CLI/Dashboard (Aigon) vs. Native IDE vs. Cloud web app.
7. **State ownership:** Local files (Aigon) vs. Hosted workspace.
8. **Model selection:** Explicit per-feature choice (Aigon) vs. Auto-routing.
9. **Pricing model:** BYO subscriptions (Aigon) vs. Platform fee / usage-based.
10. **Open source status:** Yes (Aigon) vs. No / Partial.

## 4. Honest Weaknesses

Where Aigon genuinely loses and should be transparent about it:
- **No Native IDE Extension:** Aigon is heavyweight for quick, single-file edits or "one-liners." For tight code-editing loops, Cursor or Windsurf provide a better UX.
- **Board-centric UX:** Tools built natively around task boards (like Cline Kanban) offer better direct visibility into micro-tasks than Aigon's higher-level feature lifecycle dashboard.
- **No Embedded Testing:** Aigon does not provide embedded browser testing or visual diffs out of the box.
- **No Automatic Model Selection:** Users must explicitly choose which agent/model runs, whereas some competitors handle routing transparently.

## 5. Recurring-Update Mechanism

**Design for the Monthly Refresh:**
- **Trigger:** Scheduled monthly via Aigon's recurring feature system (`docs/specs/recurring/`).
- **Sources to Scan:** GitHub releases for known tools (Aider, Roo Code), Hacker News (search "AI agent", "coding agent"), Reddit (`r/LocalLLaMA`, `r/AIcoding`), and designated Twitter lists.
- **Action:** A designated agent (e.g., `cc` or a specialized researcher role) synthesizes the scanned data.
- **Output:** 
  1. A patch to the `docs/competitive/` matrix adding/updating tools.
  2. A new section in the ongoing `research-landscape.md` changelog.
  3. A generated summary of "What changed this month" to be reviewed before merging.