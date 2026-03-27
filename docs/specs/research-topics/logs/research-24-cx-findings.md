# Research Findings: roocode comparison

**Agent:** Codex (cx)
**Research ID:** 24
**Date:** 2026-03-28

---

## Key Findings

### 1. Roo Code's core feature set is broad and split across two products

Roo Code is now positioned as both:

- a local VS Code extension for interactive coding work, and
- a cloud agent platform that can be triggered from the web, GitHub, Slack, and Linear.

The extension's core local features are stronger than "chat in editor". Based on the current docs, Roo emphasizes:

- model/provider agnosticism and per-mode sticky model selection
- customizable modes with tool/file restrictions
- MCP integration with project-level and global config
- built-in orchestration via Orchestrator/Boomerang tasks
- semantic codebase indexing with embeddings + Qdrant
- automatic checkpoints via a shadow Git repo
- intelligent context condensing with visible cost/token accounting
- task history and cloud-side analytics/integrations

This is a more vertically integrated product than Aigon. Aigon is currently a workflow orchestrator around external coding agents rather than a monolithic agent IDE/platform.

### 2. Roo's "multi-agent" story is real, but it is not the same shape as Aigon Fleet mode

Roo has two orchestration patterns:

- local Orchestrator/Boomerang tasks inside the extension, where a parent task delegates subtasks to specialized modes and resumes with summaries
- cloud agents, where specialized remote agents such as Planner, Coder, PR Reviewer, and PR Fixer run in isolated cloud environments and report back through GitHub/web/Slack

That overlaps with Aigon's Fleet idea, but the operating model is different.

Roo strengths:

- orchestration is built into the agent product itself
- subtask context is isolated automatically
- cloud execution is first-class, with integrations outside the IDE
- specialized reviewer/fixer roles are productized

Aigon strengths:

- Fleet mode is git-native and repo-native
- each agent works in a real worktree / tmux session with explicit file isolation
- evaluation and merge are explicit workflow stages (`feature-eval`, `feature-review`, `feature-close`)
- the process is agent-agnostic rather than tied to one vendor's extension/cloud

My conclusion: Roo has a stronger "delegate work inside one product" experience, but Aigon has a stronger "compare multiple independent agents with explicit workflow state" model. Roo is closer to orchestration within one AI suite; Aigon is closer to a control plane for heterogeneous agents.

### 3. Custom modes are more expressive than Aigon's current agent profile model

Roo custom modes support:

- global or project-local mode definitions
- role prompt / instructions
- tool-group permissions (`read`, `edit`, `command`, `mcp`)
- file regex restrictions on edit access
- `whenToUse` metadata used by orchestration and mode switching
- import/export and marketplace sharing
- sticky model assignment per mode

Compared to that, Aigon profiles are useful but narrower. Aigon already has install-time agent-specific prompt/config generation plus profiles/config in `lib/config.js` and templates, but it does not appear to expose a Roo-style first-class "role object" with tool/file restrictions, import/export, and an ecosystem/marketplace around reusable workflow roles.

This is one of the clearest product gaps.

### 4. Roo's MCP support is materially ahead of Aigon's current surface area

Roo's MCP implementation includes:

- global `mcp_settings.json` plus project-level `.roo/mcp.json`
- precedence rules between global and project config
- support for STDIO, Streamable HTTP, and legacy SSE transports
- per-server `alwaysAllow`, `disabledTools`, `watchPaths`, and timeouts
- built-in instructions for having Roo create new MCP servers
- a curated recommendation page, currently centered on Context7 as the first recommended server

Aigon talks about agents and install flows well, but I did not find an equivalent first-class MCP control plane in the repo. That matters because MCP is increasingly the standard way users extend coding agents with docs, APIs, browsers, databases, and internal tooling.

This is the second clearest gap after custom modes.

### 5. Context management and memory are a Roo differentiator

Roo has several concrete context-management primitives that Aigon does not appear to expose directly:

- semantic codebase indexing using embeddings + Qdrant for `codebase_search`
- intelligent context condensing with visible token/cost accounting
- automatic checkpoints for file recovery using a shadow Git repo
- cloud task history / task sync in team mode

Aigon currently relies more on process structure than on agent-memory infrastructure:

- spec-driven lifecycle and folder-based state
- explicit per-agent status via manifests/status files
- worktrees for isolation
- docs/templates/prompt scaffolding to shape context

That is a valid design, but it means Aigon is weaker on "help the model remember and search intelligently inside a long-running task" and stronger on "make the workflow legible and reproducible at the repo level".

### 6. Roo has a more packaged code-review/evaluation product; Aigon has a stronger explicit workflow for comparative evaluation

Roo Code Cloud exposes PR Reviewer and PR Fixer as named product roles. The PR Reviewer pitch is deep repository-aware review with diff analysis, impact mapping, and contract validation, then the PR Fixer closes the loop on feedback.

Aigon already has explicit evaluation/review steps in the workflow:

- `feature-eval`
- `feature-review`
- `research-eval`
- explicit winner selection / merge in Fleet mode

So Aigon is not missing evaluation as a workflow concept. What it lacks is a more turnkey, specialized reviewer experience with clearer defaults, richer UX, and easier invocation from external systems like GitHub comments or Slack.

### 7. Observability and analytics are much stronger in Roo's cloud/team offering

Roo advertises:

- token usage analytics
- task history
- team-wide visibility with per-user filters
- centralized billing and policy enforcement
- extension task sync
- Slack / GitHub / Linear integrations

Aigon has a dashboard, manifest-based workflow state, agent status, and normalized telemetry files in `.aigon/telemetry/`. That is good infrastructure, but it is not yet the same thing as productized cost analytics, org-wide visibility, or remote task history.

Inference: Aigon's architecture could support this direction, especially with `lib/telemetry.js`, dashboard-server, and the Pro split, but the current OSS experience is not competitive with Roo's cloud observability surface.

### 8. Pricing model comparison

Roo's pricing as of the currently published pricing page:

- VS Code extension: free, plus inference costs
- Cloud Free: $0/month plus credits, with Cloud Agents charged at $5/hour plus inference
- Cloud Team: $99/month plus credits, no per-seat fee, plus the same Cloud Agent/inference charges

Aigon's model in this repo is still fundamentally "open-source CLI/workflow engine, optional Pro package" rather than hosted cloud platform pricing. That is a strategic difference:

- Roo monetizes hosted orchestration, router, analytics, and cloud agents
- Aigon can stay attractive to users who prefer local control, heterogeneous agents, repo-native workflow, and lower vendor lock-in

If Aigon expands Pro, Roo is a strong reference for what teams will expect to pay for centralized visibility and integrations.

### 9. Gap analysis: highest-value Roo features for Aigon to adopt

Most valuable to add, in priority order:

1. Project-level MCP registry and policy layer
Reason: this is becoming table stakes for serious coding-agent workflows and fits Aigon's agent-agnostic positioning.

2. Reusable workflow roles/profiles with permissions
Reason: Roo custom modes are a strong abstraction. Aigon should offer something similar but CLI/editor agnostic.

3. Built-in semantic repo search / indexing
Reason: would materially improve long-lived agent tasks, research, review, and large-repo navigation.

4. Better evaluation/reviewer UX
Reason: Aigon has the workflow primitives already; packaging them into named review modes and dashboard actions would raise usability fast.

5. Telemetry-backed usage/cost visibility
Reason: important for teams and a natural Aigon Pro expansion area.

6. Lightweight checkpoint / undo UX
Reason: Aigon is already git-native, so there is a plausible path to offer safer experimentation without copying Roo's exact shadow-repo model.

### 10. Competitive advantages Aigon should highlight

Roo is stronger as an integrated agent platform, but Aigon has real advantages:

- agent-agnostic orchestration instead of vendor lock-in
- explicit spec-driven workflow for research, feature delivery, evaluation, and close
- worktree-native parallel execution with isolation visible to the user
- explicit comparative evaluation of multiple agents, not just delegation within one suite
- repo-local, inspectable prompts/templates/docs instead of product-managed opaque behavior
- easier fit for teams that want control, git visibility, and heterogeneous agent mix

If Aigon tries to "be Roo inside VS Code", it will likely lose. If it doubles down on "the control plane for serious multi-agent software delivery", it has a clearer lane.

## Sources

- Roo docs home: https://docs.roocode.com/
- Roo custom modes: https://docs.roocode.com/features/custom-modes
- Roo checkpoints: https://docs.roocode.com/features/checkpoints
- Roo codebase indexing: https://docs.roocode.com/features/codebase-indexing
- Roo context condensing: https://docs.roocode.com/features/intelligent-context-condensing
- Roo boomerang/orchestrator tasks: https://docs.roocode.com/features/boomerang-tasks
- Roo MCP overview: https://docs.roocode.com/features/mcp/overview
- Roo MCP usage/config: https://docs.roocode.com/features/mcp/using-mcp-in-roo
- Roo recommended MCP servers: https://docs.roocode.com/features/mcp/recommended-mcp-servers
- Roo cloud agents: https://docs.roocode.com/roo-code-cloud/cloud-agents
- Roo pricing: https://roocode.com/pricing
- Roo team plan: https://roocode.com/cloud/team
- Roo PR Reviewer: https://roocode.com/reviewer
- Aigon architecture: `docs/architecture.md`
- Aigon development workflow: `docs/development_workflow.md`
- Aigon Codex agent docs: `docs/agents/codex.md`
- Aigon worktree/orchestration code: `lib/worktree.js`
- Aigon entity lifecycle/evaluation logic: `lib/entity.js`
- Aigon telemetry module: `lib/telemetry.js`

## Recommendation

Do not try to clone Roo end-to-end. Roo wins when the product is a vertically integrated IDE+cloud agent suite; Aigon's advantage is being an agent-agnostic workflow control plane built on git, worktrees, specs, and explicit evaluation stages.

Recommended strategy:

1. Add a first-class Aigon capability layer for external tools.
This should look like a repo-local/global tool registry with policy controls, transport config, and install helpers. MCP is the obvious standard to target.

2. Add reusable task roles that are richer than today's agent profiles.
The right abstraction is closer to "workflow modes" than "agent templates": role prompt, allowed capabilities, preferred models/agents, and intended use cases.

3. Improve intelligence infrastructure rather than only adding more workflow commands.
Semantic repo search, better long-context handling, and safer undo/checkpoint flows would close meaningful product gaps.

4. Package Aigon's existing evaluation strengths into a clearer reviewer product.
Aigon already has the primitives. It needs better affordances, more obvious review roles, and tighter dashboard/integration entry points.

5. Reserve team analytics, policy enforcement, and remote visibility for Pro.
Roo's pricing validates that teams will pay for centralized visibility. Aigon's existing telemetry/dashboard architecture gives a believable path here.

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
| mcp-registry-and-policies | Add project-local and global MCP server registry, transport config, approval policy, and install helpers for agent-agnostic tool integration. | high | none |
| workflow-modes | Introduce reusable Aigon workflow modes with role definitions, capability restrictions, preferred agent/model mapping, and intended-use metadata. | high | none |
| semantic-codebase-search | Add semantic repo indexing and natural-language code search to support research, review, and large-repo navigation workflows. | high | mcp-registry-and-policies |
| reviewer-role-and-dashboard-actions | Package evaluation and review into named reviewer flows with clearer dashboard actions and external trigger points. | medium | workflow-modes |
| telemetry-usage-analytics | Turn existing telemetry into per-task and per-agent usage/cost analytics for dashboard and Pro reporting. | medium | none |
| safe-checkpoints-for-agent-runs | Add lightweight checkpoints or undo points around agent-driven edits to make experimentation safer in long-running sessions. | medium | none |
