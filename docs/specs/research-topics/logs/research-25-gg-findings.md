# Research Findings: opencode comparison

**Agent:** Gemini (gg)
**Research ID:** 25
**Date:** 2026-03-29

---

## Key Findings

**CRITICAL LIMITATION: All primary and secondary sources for OpenCode, including its GitHub repository and documentation website, were inaccessible during this research (returned 404 errors). The following findings are based solely on web search results and may be incomplete or outdated.**

### Core capabilities
- **What is OpenCode?**
  - OpenCode is described as an open-source AI coding agent built for the terminal.
  - It appears to be written in Go and uses the Bubble Tea framework for its TUI.
  - License, community size, and maturity are unknown due to inaccessible sources.

- **Models/Providers:**
  - It is provider-agnostic, supporting Claude, OpenAI (GPT-4), Google Gemini, and local models via Ollama.
  - The provider system seems to be based on a `/connect` command, but the architecture is unclear. This contrasts with Aigon's explicit multi-agent approach where each agent can have its own model.

- **Context Management:**
  - OpenCode uses a file named `AGENTS.md` for project-specific instructions and context, initialized with a `/init` command. This is very similar to Aigon's `AGENTS.md` file.
  - It claims to have Git integration that automatically handles context, but details are unavailable.
  - It's unclear how it handles codebase indexing or conversation history.

- **Tool/Function Calling:**
  - No information was found regarding its tool or function calling capabilities. It is unknown if it supports MCP (Model-in-the-middle, a likely typo for something like Multi-turn Conversation Protocol, or similar).

- **Permissions and Safety:**
  - OpenCode has two modes: "Build Mode" (full read/write access) and "Plan Mode" (read-only analysis). This suggests a permissions model, but details on auto-approval, sandboxing, or confirmation flows are not available.

### Workflow and orchestration
- **Multi-agent/Orchestration:**
  - There is no evidence of multi-agent or orchestration capabilities equivalent to Aigon's Fleet mode, worktrees, or parallel agents.

- **Task Management:**
  - It appears to be primarily conversational. There is no indication of a concept of features, tasks, or work items like in Aigon.

- **Long-running Tasks:**
  - No information was found on how it handles long-running tasks, session persistence, or background work.

- **Project Management Integration:**
  - It claims Git integration for undo/redo of changes. There is no mention of PR creation or issue tracking integration.

### Developer experience
- **TUI/Dashboard:**
  - OpenCode has a TUI built with Bubble Tea. A direct comparison to Aigon's web-based dashboard is not possible without access.

- **Customization/Configuration:**
  - It supports custom agents via the `AGENTS.md` file. It is unclear if it offers other customization like profiles, custom commands, or hooks.

- **Multi-repo/Monorepo:**
  - No information was found on its capabilities for handling multi-repo or monorepo setups.

- **Onboarding:**
  - The onboarding seems to be via a simple `curl` command. The "time to productive" is unknown.

### Enterprise features
- No information was found on any enterprise-level features like team support, shared config, usage tracking, compliance, cost tracking, or business model.

### Gap analysis
- **Where does OpenCode clearly beat Aigon?**
  - Based on the limited information, OpenCode's potential advantages could be its TUI (which might be preferred by some users over a web dashboard) and its support for local models via Ollama.

- **Where does Aigon clearly beat OpenCode?**
  - Aigon's strengths appear to be its multi-agent orchestration (Fleet mode), its formal concept of work items (features, research), the web-based dashboard for richer UI, and its evaluation capabilities.

- **What OpenCode features could Aigon adopt?**
  - **Local Model Support:** Integrating with Ollama to allow users to run models locally could be a powerful feature for privacy, cost-saving, and offline work.
  - **TUI Interface:** While Aigon has a web dashboard, a lightweight TUI for quick interactions could be a valuable addition.

- **What Aigon strengths should be highlighted in competitive positioning?**
  - **Orchestration:** Aigon's ability to coordinate multiple agents on a single task is a clear differentiator.
  - **Workflow Management:** The built-in concepts of features, research, and lifecycle states provide a structured workflow that appears to be absent in OpenCode.
  - **Dashboard:** The web dashboard provides a richer and more extensible user experience than a TUI.

## Sources

**IMPORTANT:** The primary GitHub repository and documentation links for OpenCode were inaccessible (404 Not Found) during this research. The following links were found via web search but were not directly accessible.

- **Claimed GitHub (defunct):** `https://github.com/opencode-ai/opencode`
- **Claimed GitHub 2 (defunct):** `https://github.com/sst/opencode`
- **Claimed Docs (defunct):** `https://opencode.ai/docs`

All findings are based on a `google_web_search` for "OpenCode AI documentation". The search provided aggregated results from various secondary sources like `buildtavern.com`, `evroc.com`, `dev.to`, and others.


## Recommendation

Based on this limited research, my primary recommendation is for Aigon to **investigate and prioritize local model support via Ollama**. This feature addresses user concerns about privacy, cost, and offline access, and appears to be a key feature of OpenCode.

A secondary recommendation is to **explore the development of a lightweight Terminal User Interface (TUI)**. While Aigon's web dashboard is a major strength, a TUI could provide a faster, more integrated terminal experience for certain workflows, which seems to be OpenCode's main selling point.

The fact that OpenCode's resources are unavailable could be a business opportunity. Aigon could capture users who are looking for a tool like OpenCode but are unable to find it.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| local-model-ollama-support | Integrate with Ollama to allow users to run and use local LLMs. | high | none |
| lightweight-tui-mode | Provide a terminal-based UI for core Aigon workflows as an alternative to the web dashboard. | medium | none |
