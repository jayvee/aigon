# Research Findings for roocode-comparison (gg)

This document contains research findings by Gemini (gg) for research topic #24.

## Q1: What are Roo Code's core features?

*   **Multi-Agent Orchestration ("Roo Cru"):** Roo Code offers a multi-agent system, both locally in the VS Code extension and as a cloud service. This allows for assembling a "team" of AI agents (e.g., Planner, Coder, Reviewer) to collaborate on complex tasks. This is analogous to Aigon's Fleet mode.
*   **Role-Specific Modes:** Roo Code uses "modes" to constrain the AI's behavior and tool access. Examples include Architect, Code, Ask, Debug, and Test. This is similar to Aigon's agent profiles but seems more integrated into the core UX.
*   **Model Agnosticism & MCP Integration:** It supports a wide range of models from various providers (OpenAI, Anthropic, Google) and allows users to bring their own keys. It uses a "Model Context Protocol" (MCP) to extend capabilities, though the specifics of MCP are not deeply detailed in the public docs.
*   **Dual Form Factors (Local vs. Cloud):**
    *   **VS Code Extension:** For individual developers, with manual approval and IDE integration. It is open-source.
    *   **Roo Code Cloud:** A team-oriented, autonomous service that integrates with GitHub and Slack.
*   **Agentic Capabilities:**
    *   **Multi-file edits:** Can read and write to multiple files.
    *   **Command execution:** Can run terminal commands.
*   **Security & Privacy:** The extension is open source (Apache 2.0), SOC2 Type 2 compliant, and can run with local/offline models. It respects a `.rooignore` file.

## Q2: How does Roo Code handle multi-agent orchestration?

*   Roo Code's orchestration is called "Roo Cru". In the Cloud version, this is an autonomous team of agents (Planner, Coder, Reviewer) that can be assigned tasks. In the VS Code extension, it appears to be a more manual process of switching between modes to accomplish a larger goal. This is a key difference from Aigon's Fleet mode, which is a local-first concept. Roo Code's cloud offering seems to be their primary multi-agent solution.

## Q3: What is Roo Code's "custom modes" system and how does it compare to Aigon's agent profiles?

*   Roo Code's "Custom Modes" allow teams to create specialized modes for their specific workflows. This is directly comparable to Aigon's agent profiles. The key difference is that Roo Code has a set of pre-defined, built-in modes that are central to its UX (Architect, Code, etc.), whereas Aigon's profiles are more of a customization feature.

## Q4: How does Roo Code handle MCP server integration?

*   The documentation mentions MCP (Model Context Protocol) servers as a way to extend capabilities, but provides little public detail on what this entails or which servers are supported out-of-the-box. This appears to be a more advanced or perhaps enterprise-level feature. The primary model integration is through direct API calls to providers like OpenAI, Anthropic, and Google.

## Q5: What is Roo Code's approach to context management and memory across sessions?

*   Roo Code claims to have "long-term memory" and can pull context from files, git history, and the web. The VS Code extension manages context locally. The specifics of the long-term memory implementation are not detailed in the public documentation.

## Q6: How does Roo Code handle code review and evaluation of AI-generated code?

*   In the VS Code extension, the user is the reviewer, with manual approval of every action and live previews.
*   In the Roo Code Cloud, there is a dedicated "Reviewer" agent that is part of the "Roo Cru". This suggests an automated or semi-automated code review process as part of their cloud workflow.

## Q7: What observability/dashboard features does Roo Code offer?

*   The public documentation and website do not highlight any dashboards, cost tracking, or analytics features. This is a significant difference from Aigon's focus on observability through its dashboard. It's possible these features exist in the paid/cloud product but are not part of their public marketing.

## Q8: What is Roo Code's pricing model and how does it compare to Aigon's open-source + Pro model?

*   The VS Code extension is open-source and free.
*   The Roo Code Cloud is a paid, team-based service. The pricing is not publicly listed; interested parties must contact sales. This is a classic "open core" model, similar to Aigon's open-source + Pro strategy.

## Q9: Which Roo Code features would be most valuable to add to Aigon?

*   **Formalized Agent Roles/Modes:** The concept of built-in, first-class "modes" like Architect, Debug, and Test is very compelling. It provides a clearer user experience than a generic "chat" interface. Aigon could adopt a similar model on top of its existing profile system.
*   **Cloud-Based Autonomous Agents:** While Aigon's Fleet mode is powerful, a fully autonomous cloud-based offering that integrates with Git providers and communication platforms (like Roo Code Cloud) is a logical next step for Aigon Pro.
*   **SOC2 Compliance:** Achieving SOC2 compliance would be a major asset for Aigon's enterprise GTM strategy.

## Q10: Which Aigon features does Roo Code lack?

*   **Observability Dashboard:** Aigon's dashboard with its focus on cost, performance, and session history is a major differentiator. Roo Code does not appear to have a comparable feature, or at least does not market it.
*   **Local-First Fleet Mode:** Aigon's Fleet mode is designed to run locally, which is a big advantage for developers who want to maintain control and privacy. Roo Code's multi-agent system seems to be primarily a cloud-based offering.
*   **Transparent State Management:** Aigon's explicit state machine and agent lifecycle are core to its design and observability. Roo Code's internal state management is not as transparent from the outside.
*   **Focus on Research and Specs:** The Aigon workflow, with its emphasis on `research-*` and `feature-*` specs, is a more structured and transparent approach to development than what is described in the Roo Code documentation.
---

*This concludes my research based on the publicly available information.*
