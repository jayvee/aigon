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
<!-- Summary of recommended approach based on findings -->

## Output
<!-- Based on your recommendation, create the necessary feature specs by running the `aigon feature-create "<name>"` command. Link the newly created files below. -->
- [ ] Feature:
