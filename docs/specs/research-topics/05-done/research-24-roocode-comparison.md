# Research: roocode-comparison

## Context

Roo Code (https://roocode.com/) is a VS Code extension for AI-powered coding that has gained traction with features like multi-agent orchestration, custom modes, and MCP integration. As Aigon builds out its multi-agent development workflow (AADE), understanding Roo Code's feature set and UX patterns can reveal gaps in Aigon's offering and inspire new features. This research should identify what Roo Code does well, where Aigon already matches or exceeds it, and what features would be worth adopting.

## Questions to Answer

- [ ] What are Roo Code's core features? (modes, orchestration, tool use, context management)
- [ ] How does Roo Code handle multi-agent orchestration? Does it have a concept similar to Aigon's Fleet mode?
- [ ] What is Roo Code's "custom modes" system and how does it compare to Aigon's agent profiles?
- [ ] How does Roo Code handle MCP server integration? What MCP servers does it support out of the box?
- [ ] What is Roo Code's approach to context management and memory across sessions?
- [ ] How does Roo Code handle code review and evaluation of AI-generated code?
- [ ] What observability/dashboard features does Roo Code offer (cost tracking, session history, analytics)?
- [ ] What is Roo Code's pricing model and how does it compare to Aigon's open-source + Pro model?
- [ ] Which Roo Code features would be most valuable to add to Aigon? (gap analysis)
- [ ] Which Aigon features does Roo Code lack? (competitive advantages to highlight)

## Scope

### In Scope
- Roo Code feature inventory from docs and marketing materials
- Feature-by-feature comparison with Aigon
- Gap analysis with prioritized recommendations
- UX patterns worth adopting

### Out of Scope
- Deep technical implementation analysis of Roo Code internals
- Other AI coding tools (Cursor, Windsurf, etc.) — focus on Roo Code only
- Pricing strategy decisions

## Inspiration
- Roo Code website: https://roocode.com/
- Roo Code docs: https://docs.roocode.com/
- Roo Code GitHub: https://github.com/RooVetGit/Roo-Code

## Findings
<!-- Document discoveries, options evaluated, pros/cons -->

## Recommendation

All three agents agree: Aigon should NOT try to clone Roo Code. Roo wins as a vertically integrated IDE+cloud agent suite; Aigon's lane is **agent-agnostic workflow control plane** built on git, worktrees, specs, and explicit evaluation.

**Adopt selectively from Roo Code's strengths:**
1. **Workflow modes** — Roo's custom modes with tool/file restrictions are more expressive than Aigon's profiles. Add reusable role definitions with capability restrictions, model preferences, and `whenToUse` metadata.
2. **Cost analytics** — Users running multiple agents care deeply about spend. Extend existing telemetry into a dashboard panel with per-feature and per-agent breakdowns.
3. **Safe checkpoints** — Roo's shadow-git checkpoints reduce risk during long agent runs. Aigon is already git-native, so lightweight checkpoint/undo around agent edits is a natural fit.

**Do NOT adopt:** Roo's sequential-only orchestrator (Aigon's Fleet is superior), cloud-hosted agents (different product model), or vendor-locked IDE extension approach.

**Lean into Aigon's advantages:** True parallel execution, Arena evaluation, multi-CLI support, spec-driven lifecycle, and transparent repo-local workflow state.

## Output

### Selected Features

| Feature Name | Description | Priority | Spec |
|---|---|---|---|
| workflow-modes | Reusable agent roles with role definitions, tool/file restrictions, model preferences, and whenToUse metadata | high | `docs/specs/features/01-inbox/feature-workflow-modes.md` |
| cost-tracking-dashboard | Aggregate per-agent cost/token analytics in the dashboard with per-feature and per-session breakdowns | high | `docs/specs/features/01-inbox/feature-cost-tracking-dashboard.md` |
| safe-checkpoints | Lightweight checkpoints/undo around agent-driven edits for safer experimentation | medium | `docs/specs/features/01-inbox/feature-safe-checkpoints.md` |
| roocode-comparison-pages | Add Roo Code to Aigon's comparison pages on the docs site and website | medium | `docs/specs/features/01-inbox/feature-roocode-comparison-pages.md` |

### Not Selected
- **mcp-registry** (#1): Valuable but large scope; revisit after workflow-modes establishes the role abstraction layer
- **semantic-codebase-search** (#4): Depends on MCP infrastructure; defer until mcp-registry is built
- **reviewer-ux-improvements** (#5): Aigon already has the workflow primitives; packaging can happen incrementally without a dedicated feature
- **role-marketplace** (#7): Low priority; needs workflow-modes first and a critical mass of community roles
