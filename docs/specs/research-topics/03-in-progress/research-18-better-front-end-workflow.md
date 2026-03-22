# Research: Better Front-End Workflow for AI-Assisted Development

## Context

The current front-end debugging and modification workflow is manual: take a screenshot, paste it into a coding agent (Claude Code, Codex, Cursor, etc.), describe what's wrong or what to change, and wait for the agent to produce updated code. This works but is slow — the feedback loop requires human effort at every step (screenshot, describe, paste, review, repeat).

There are emerging tools and techniques that could dramatically tighten this loop:
- **Browser automation** (Playwright, Puppeteer) that lets agents programmatically see and interact with running apps
- **Agent-browser bridges** like [Agentation](https://www.agentation.com/) that provide real-time browser context to AI agents
- **Visual diff tools** that automatically detect and communicate UI changes
- **Hot-reload integrations** where the agent can observe its own changes live
- **MCP servers** that expose browser state to agents via standard protocols

This applies across all projects: Aigon's dashboard, Farline, and any web app. The goal is to find tools that make the build → view → feedback → rebuild cycle as fast and hands-off as possible.

## Questions to Answer

### Landscape & Tools
- [ ] What tools exist for giving AI coding agents direct browser access? (Playwright MCP, Browserbase, Agentation, browser-use, etc.)
- [ ] Which of these are free/open-source vs. paid? What are the pricing tiers?
- [ ] What MCP servers exist for browser automation? How mature are they?
- [ ] Are there VS Code / Cursor / Claude Code extensions or plugins that provide browser preview integration?
- [ ] What does Agentation specifically offer, and how does it compare to open-source alternatives?

### Workflow Patterns
- [ ] What is the fastest achievable feedback loop for "agent makes change → sees result → iterates"?
- [ ] How do teams currently use Playwright/Puppeteer with coding agents? What patterns work?
- [ ] Can an agent run a dev server, make changes, screenshot/snapshot the result, and self-evaluate — all autonomously?
- [ ] What role do visual regression tools (Percy, Chromatic, BackstopJS) play in agent workflows?
- [ ] How does the Vercel plugin's `agent-browser` / `agent-browser-verify` skill compare to standalone tools?

### Integration with Aigon
- [ ] Which tools could integrate into Aigon's existing workflow (e.g., as a step in `feature-do` or `feature-eval`)?
- [ ] Could Playwright snapshots replace or augment the current "paste screenshot" approach?
- [ ] What would an ideal `aigon frontend-verify` command look like?
- [ ] How would this interact with Aigon's proxy/dev-server infrastructure?

### Quality & Reliability
- [ ] How reliable are AI-driven browser interactions today? What breaks?
- [ ] What are the latency costs of browser automation in the agent loop?
- [ ] Do any tools support accessibility auditing alongside visual checks?
- [ ] How do these tools handle dynamic/interactive UIs (modals, animations, state transitions)?

## Scope

### In Scope
- Tools that help AI agents see, interact with, and evaluate web front-ends
- Browser automation frameworks and their agent integrations
- Visual regression and screenshot comparison tools
- MCP servers for browser state
- Free and paid options with pricing comparison
- Integration feasibility with Claude Code, Codex, Cursor, Gemini CLI
- Practical workflow patterns for solo developer + multi-agent setup

### Out of Scope
- Design tools (Figma plugins, design-to-code)
- Component library selection (shadcn, Material UI, etc.)
- CSS frameworks or styling approaches
- Mobile app testing (native iOS/Android)
- Full end-to-end testing strategy (this is about the development feedback loop, not CI testing)

## Inspiration / Starting Points
- [Agentation](https://www.agentation.com/) — agent-browser bridge product
- Playwright MCP server — gives agents browser control via MCP protocol
- Aigon's existing `agent-browser` and `agent-browser-verify` skills (Vercel plugin)
- The current workflow: screenshot → paste → describe → agent codes → repeat
- browser-use (open source) — AI browser automation
- Browserbase — cloud browser infrastructure for agents

## Research Instructions

Each agent should independently investigate the landscape. Prioritise hands-on findings over marketing claims — look for actual GitHub repos, real usage examples, and documented limitations. Pay special attention to:

1. **What's actually free and works today** vs. what's vapourware or enterprise-only
2. **Latency and reliability** — a tool that takes 30s per screenshot won't speed up the loop
3. **Integration effort** — how many lines of config/code to get it working with an AI coding agent?
4. **The autonomous loop** — can the agent drive the whole cycle without human intervention?
