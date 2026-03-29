# Research: opencode-comparison

## Context

OpenCode is gaining adoption among engineers in company environments as a terminal-based AI coding assistant. It occupies a similar space to Aigon — CLI-first, developer-focused, multi-model support. Understanding how OpenCode compares to Aigon is critical for positioning, identifying feature gaps, and learning from their approach. This research should produce a deep feature comparison, identify where Aigon leads and trails, and recommend concrete features to close any gaps.

## Questions to Answer

### Core capabilities
- [ ] What is OpenCode? (architecture, language, license, community size, maturity)
- [ ] What models/providers does OpenCode support? How does its provider system compare to Aigon's multi-agent approach?
- [ ] How does OpenCode handle context management? (file references, codebase indexing, conversation history)
- [ ] What is OpenCode's tool/function calling model? Does it support MCP?
- [ ] How does OpenCode handle permissions and safety? (auto-approve, sandboxing, confirmation flows)

### Workflow and orchestration
- [ ] Does OpenCode have any multi-agent or orchestration capabilities? (equivalent to Aigon's Fleet mode, worktrees, parallel agents)
- [ ] Does OpenCode have a concept of features, tasks, or work items? Or is it purely conversational?
- [ ] How does OpenCode handle long-running tasks? (session persistence, resume, background work)
- [ ] Does OpenCode have any project management integration? (Git workflow, PR creation, issue tracking)

### Developer experience
- [ ] What is the OpenCode TUI like? How does it compare to Aigon's dashboard?
- [ ] What customization/configuration does OpenCode offer? (profiles, custom commands, hooks)
- [ ] How does OpenCode handle multi-repo or monorepo setups?
- [ ] What is the onboarding experience? How fast can a new user get productive?

### Enterprise features
- [ ] Does OpenCode have team/enterprise features? (shared config, usage tracking, compliance)
- [ ] How does OpenCode handle cost tracking and observability?
- [ ] Is there a paid tier? What's the business model?

### Gap analysis
- [ ] Where does OpenCode clearly beat Aigon? (features, UX, performance, adoption)
- [ ] Where does Aigon clearly beat OpenCode? (multi-agent, workflow, dashboard, evaluation)
- [ ] What OpenCode features could Aigon adopt? (prioritized by impact)
- [ ] What Aigon strengths should be highlighted in competitive positioning?

## Scope

### In Scope
- OpenCode feature inventory from docs, GitHub, and community
- Feature-by-feature comparison with Aigon
- Gap analysis with prioritized recommendations
- UX and developer experience comparison
- Enterprise readiness comparison

### Out of Scope
- Other AI coding tools (Cursor, Roo Code — covered in separate research)
- Implementation of gap-closing features
- Marketing or go-to-market strategy

## Inspiration
- OpenCode GitHub: https://github.com/opencode-ai/opencode
- OpenCode docs: https://opencode.ai/ (if available)
- Aigon architecture: `docs/architecture.md`

## Findings
<!-- Document discoveries, options evaluated, pros/cons -->

## Recommendation

OpenCode's explosive growth (132k stars, 650k MAU) validates the market for CLI-first AI coding tools. However, OpenCode and Aigon are **fundamentally different products**:

- **OpenCode is a coding assistant** — interactive sessions with model flexibility
- **Aigon is a development workflow orchestrator** — feature lifecycles across multiple agents with structured quality gates

**Strategic recommendations:**
1. **Don't compete on model breadth.** OpenCode's 75+ model support is solved. Aigon's value is orchestration.
2. **Double down on orchestration.** Fleet mode, worktree isolation, state machine lifecycle are architectural moats.
3. **Adopt selectively:** model-role-assignment, local model support, session cost visibility, and a lightweight TUI for quick interactions.
4. **Position clearly.** "If you need a smart code editor, use OpenCode. If you need to manage a development workflow with multiple agents, quality gates, and project-level visibility, use Aigon."
5. **Learn from their mistakes.** CVE-2026-22812 and privacy leaks show the cost of moving fast without security review. Aigon's delegation to battle-tested agent CLIs is safer.

## Output

### Selected Features

| Feature Name | Description | Priority | Spec |
|--------------|-------------|----------|------|
| model-role-assignment | Configure different models for different agent roles (impl, eval, plan) within Fleet mode | high | `docs/specs/features/01-inbox/feature-model-role-assignment.md` |
| local-model-support | Support Ollama and OpenAI-compatible local model endpoints as agent backends | medium | `docs/specs/features/01-inbox/feature-local-model-support.md` |
| session-cost-dashboard | Display per-session and per-agent cost breakdowns in the Aigon dashboard | medium | `docs/specs/features/01-inbox/feature-session-cost-dashboard.md` |
| lightweight-tui-mode | Terminal-based UI for core Aigon workflows as alternative to web dashboard | medium | `docs/specs/features/01-inbox/feature-lightweight-tui-mode.md` |

### Feature Dependencies
- No hard dependencies between selected features

### Not Selected
- `context-compaction-awareness` — Low priority; agent CLIs handle their own context management
- `plugin-system` — Medium priority but large scope; defer to a later research cycle
- `opencode-agent-backend` — Low priority; depends on local-model-support and unclear demand
