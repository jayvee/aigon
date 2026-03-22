# Research Findings: Better Front-End Workflow

**Agent:** Claude (cc)
**Research ID:** 18
**Date:** 2026-03-22

---

## Key Findings

### 1. Landscape & Tools

#### Tier 1: Purpose-Built for AI Coding Agents

**Vercel agent-browser** — The clear winner for our use case.
- **URL:** [github.com/vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) (~12,100 stars)
- **License:** Open source, free
- **Architecture:** Rust CLI → Node.js daemon → Chrome via CDP. The daemon persists the browser between commands, enabling efficient chaining.
- **Key workflow:** `agent-browser open <url>` → `agent-browser snapshot -i` (accessibility tree with refs @e1, @e2) → `agent-browser click @e3` → `agent-browser screenshot --annotate` (numbered labels on interactive elements)
- **Token efficiency:** Snapshots use ~200-400 tokens vs ~15,000+ for screenshots. This is **93% less context**, meaning agents can run **5.7x more iterations** before hitting context limits.
- **Already integrated:** The Vercel plugin for Claude Code includes `agent-browser` and `agent-browser-verify` skills. The `agent-browser-verify` skill auto-triggers when a dev server starts and runs a visual gut-check.
- **Install:** `npm install -g agent-browser && agent-browser install`

**Microsoft Playwright MCP Server** — Mature, well-maintained alternative.
- **URL:** [github.com/microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) (~28,500 stars)
- **License:** MIT, free
- **How it works:** Exposes browser automation via MCP protocol. Default "snapshot mode" uses accessibility tree (structured YAML) rather than screenshots. Tools: `browser_navigate`, `browser_click`, `browser_type`, `browser_snapshot`, `browser_screenshot`.
- **Install:** `npx @playwright/mcp@latest`
- **Token cost:** ~114K tokens per typical task (full MCP overhead). The newer `@playwright/cli` reduces this to ~27K tokens (4x reduction).
- **Limitation:** Some compatibility issues reported with Claude Code. More heavyweight than agent-browser.

**Playwright Test Agents (v1.56+, October 2025)** — Built-in AI agents within Playwright itself.
- Three agents: **Planner** (explores app, produces test plans), **Generator** (creates tests), **Healer** (analyzes failures, repairs tests, validates fixes).
- The Healer creates a self-correcting loop — directly relevant to autonomous workflows.

#### Tier 2: Complementary / Niche

**Stagehand** (by Browserbase) — Natural language browser control.
- **URL:** [github.com/browserbase/stagehand](https://github.com/browserbase/stagehand) / [stagehand.dev](https://www.stagehand.dev)
- **License:** Open source
- Three primitives: `act` (perform action), `extract` (pull data), `observe` (inspect page). v3 is 44% faster than v2 (500K+ weekly npm downloads at v2).
- Adds NLP abstraction over Playwright ("click the login button" vs CSS selectors). Caches discovered elements to avoid repeat LLM calls.
- Best with Browserbase cloud, but works locally. Adds LLM API cost per interaction.
- **Verdict:** Overkill for coding agent verification where we control the UI and know what to look for.

**browser-use** — Most popular AI browser automation (80K+ GitHub stars).
- **URL:** [github.com/browser-use/browser-use](https://github.com/browser-use/browser-use)
- Python-first (requires Python >=3.11). TypeScript port exists but less mature.
- 89.1% success rate on WebVoyager benchmark. 3 seconds per step average.
- **Verdict:** Wrong ecosystem (Python) for a Node.js CLI tool. Great for Python-based agents.

**Browserbase** — Cloud browser infrastructure.
- **URL:** [browserbase.com](https://www.browserbase.com) — $40M Series B at $300M valuation.
- Pricing: Free tier → $20/mo (Dev) → $99/mo (Startup) → Custom (Scale).
- Has its own MCP server. Customers include Perplexity, Vercel.
- **Verdict:** Unnecessary for local development. We don't need cloud browsers for dev server verification.

**Cursor Browser Preview / Visual Editor** — Impressive but not programmatically accessible.
- Shipped December 2025 in Cursor 2.2. Drag-and-drop visual editing, React component inspection, design sidebar.
- IDE-only feature — no API for agent automation. Cannot be used by Claude Code or other CLI agents.

**playwright-coding-agent-reporter** — Optimized test failure output for AI agents.
- **URL:** [github.com/getzenai/playwright-coding-agent-reporter](https://github.com/getzenai/playwright-coding-agent-reporter)
- Outputs a single `all-failures.md` with exact line numbers, error messages, screenshots, console/network errors, and ready-to-run commands. Minimizes tokens while maximizing debugging signal.
- Works with Claude Code, Codex, Aider, Roo Code, Cursor.
- **Verdict:** Useful addon for test-driven workflows.

#### Tier 3: Not Relevant or Not Real

**Agentation** (agentation.com) — Could not find any evidence this product exists. Multiple searches returned zero results. Not indexed, not in any AI browser roundup articles. Possibly vapourware or pre-launch.

**Screenshot-as-a-Service APIs** (ScreenshotOne, screenshotlayer, etc.) — Unnecessary when you have Playwright/agent-browser locally. External API adds latency and cost for something that takes <200ms locally.

#### MCP Server Landscape

| Server | Stars | Notes |
|--------|-------|-------|
| Microsoft Playwright MCP | ~28,500 | Gold standard, snapshot mode |
| Puppeteer MCP (official) | Moderate | From MCP org, Puppeteer-based |
| Browserbase MCP | Moderate | Cloud browsers via Stagehand |
| agent-browser MCP wrapper | Small | Community wrap of agent-browser |
| Various community Puppeteer MCPs | Small | Niche features (stealth, Python, SSE) |

#### Visual Regression Tools

| Tool | Type | Free Tier | Agent-Friendly |
|------|------|-----------|----------------|
| **Percy** | SaaS | 5,000 screenshots/month | Good — CLI-based, AI Review Agent filters false positives |
| **BackstopJS** | Open source (MIT) | Fully free | Good — self-hosted, Puppeteer/Playwright, HTML diff reports |
| **reg-suit** | Open source (MIT) | Fully free | Good — CLI, S3/GCS storage, GitHub PR comments |
| **Chromatic** | SaaS | 5,000 snapshots/month | Moderate — tightly coupled to Storybook |

For agent workflows, **BackstopJS** is the best free option. **Percy** is best if you want managed service with a generous free tier.

### 2. Workflow Patterns

#### The Autonomous Loop — What Works Today

The proven pattern (documented by Pulumi, Vercel Labs, and others) is the **Ralph Wiggum Loop**:

1. Agent receives feature prompt
2. Implements the feature
3. Starts dev server (or waits for HMR)
4. Launches browser automation to verify
5. If verification fails → fixes and retries
6. Repeats up to N iterations

**Key insight from Pulumi:** "Without browser verification, the AI finishes and says 'done,' but you can't trust that claim." Agent-browser catches issues like CloudFront 403 errors that passing tests wouldn't reveal.

Vercel Labs published a reference implementation: [ralph-loop-agent](https://github.com/vercel-labs/ralph-loop-agent).

#### Snapshot-First, Screenshot-Fallback

The most efficient approach for agent feedback loops:

| Method | Latency | Token Cost | Use When |
|--------|---------|------------|----------|
| Accessibility tree snapshot | ~50-200ms | 200-400 tokens | Structure, content, interactions |
| Annotated screenshot | ~200-500ms | 15,000+ tokens | Visual layout, styling, colors |
| Video recording | N/A (post-hoc) | N/A | Human review, evaluator evidence |

**Strategy:** Default to snapshots for the agent's self-evaluation loop. Add screenshots only when the change is visual (CSS, layout, design). Record video for the implementation log / evaluator review.

#### Latency Budget

| Operation | Latency |
|-----------|---------|
| Vite/Next.js HMR update | 10-20ms |
| Agent-browser snapshot | ~50-200ms |
| LLM evaluation of snapshot | ~1-3s |
| **Full round-trip (snapshot)** | **~2-4s** |
| Full round-trip (screenshot) | ~4-6s |
| Webpack HMR | 500-1600ms |

**Practical throughput:** An agent can do **15-20 verify-and-iterate cycles per minute** with snapshots, or ~10/min with screenshots. Context efficiency (not latency) is the real bottleneck.

### 3. Integration with Aigon

#### What Already Exists

1. **Proxy infrastructure** (`lib/proxy.js`) — Routes dev servers through `http://serverId.appId.localhost`. Registry in `~/.aigon/dev-proxy/servers.json`. Process health checking.
2. **Dev server management** (`lib/commands/infra.js`) — `aigon dev-server start/stop/list/logs/url/open`. Spawns detached process, health checks via HTTP polling, auto-registers port.
3. **`captureDashboardScreenshot()`** (`lib/dashboard-server.js:1097-1150`) — Puppeteer-based screenshot function that exists but is unused in any CLI command. Fallback to macOS AppleScript + screencapture.
4. **Playwright test infrastructure** (`playwright.config.js`, `tests/dashboard-e2e/`) — Video recording, screenshots, traces. Not integrated into agent workflow.
5. **Feature-56 spec** (DONE status) — Detailed spec for Playwright verification in `feature-do`. Config flag `verification.playwright.enabled`, test data fixtures, video recording. **Not yet implemented in code.**

#### What an `aigon frontend-verify` Command Would Look Like

```
aigon frontend-verify [--url <url>] [--mode snapshot|screenshot|both]

1. Resolve target URL:
   - If --url provided, use it
   - Else check `aigon dev-server url` for running dev server
   - Else start dev server via `aigon dev-server start`

2. Capture state:
   - Default: agent-browser snapshot (accessibility tree + refs)
   - With --mode screenshot: annotated screenshot
   - With --mode both: snapshot + screenshot

3. Output:
   - Print snapshot/screenshot path
   - Return structured data for agent consumption
   - In Fleet mode: save artifacts to worktree-specific location
```

#### Integration Points

- **`feature-do` workflow:** Insert after implementation, before submission. Use agent-browser snapshot to verify acceptance criteria are met. This aligns with feature-56's design.
- **`feature-eval` workflow:** Evaluator can run `frontend-verify` to independently check each agent's implementation. Compare snapshots across Fleet agents.
- **Dev server infrastructure:** Already handles port allocation and health checking. Agent-browser just needs the URL from `aigon dev-server url`.
- **Dashboard verification:** The existing `captureDashboardScreenshot()` could be replaced by agent-browser for richer interaction testing.

### 4. Quality & Reliability

#### What Breaks

1. **Accuracy compounding:** 85% accuracy per action → 20% success for 10-step workflows. Keep verification steps short and focused.
2. **Vision-based navigation fragility:** Pixel-coordinate clicking is "powerful in theory, fragile in practice." Accessibility tree refs (@e1, @e2) are far more reliable.
3. **Context window exhaustion:** 20 iterations with screenshots = ~300K tokens on screenshots alone. With snapshots: ~8K tokens. **Snapshots enable 5-6x more iterations.**
4. **Dynamic content:** Loading states, animations, and modals can confuse agents. Mitigate with `waitUntil: 'networkidle'` and checking for `aria-busy` states.
5. **The translation gap:** LLMs hallucinate non-existent elements when thinking in natural language but needing precise DOM paths. Agent-browser's ref system (@e1, @e2) bridges this gap well.
6. **Prompt injection risk:** Hidden instructions on pages can command agents. Less relevant for dev servers (we control the content), but worth noting for production testing.

#### Accessibility Auditing

Agent-browser's snapshot mode inherently uses the accessibility tree, which means it naturally surfaces a11y issues (missing labels, wrong roles, missing alt text). This is a free bonus — no additional tool needed.

## Sources

### Primary Tools
- [Vercel agent-browser GitHub](https://github.com/vercel-labs/agent-browser) (~12,100 stars)
- [agent-browser Documentation](https://agent-browser.dev/)
- [agent-browser Diffing](https://agent-browser.dev/diffing)
- [agent-browser npm](https://www.npmjs.com/package/agent-browser)
- [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp) (~28,500 stars)
- [Stagehand GitHub](https://github.com/browserbase/stagehand) / [stagehand.dev](https://www.stagehand.dev)
- [Stagehand v3 Blog](https://www.browserbase.com/blog/stagehand-v3)
- [browser-use GitHub](https://github.com/browser-use/browser-use) (~80,000 stars)
- [Browserbase Pricing](https://www.browserbase.com/pricing)
- [Browserbase MCP](https://www.browserbase.com/mcp)

### Workflow Patterns
- [Self-Verifying AI Agents: Vercel's Agent-Browser in the Ralph Wiggum Loop (Pulumi)](https://www.pulumi.com/blog/self-verifying-ai-agents-vercels-agent-browser-in-the-ralph-wiggum-loop/)
- [Ralph Loop Agent (Vercel Labs)](https://github.com/vercel-labs/ralph-loop-agent)
- [The Context Wars: Why Your Browser Tools Are Bleeding Tokens](https://paddo.dev/blog/agent-browser-context-efficiency/)
- [Why agent-browser Is Winning the Token Efficiency War](https://dev.to/chen_zhang_bac430bc7f6b95/why-vercels-agent-browser-is-winning-the-token-efficiency-war-for-ai-browser-automation-4p87)

### Latency & Performance
- [Playwright MCP Burns 114K Tokens vs CLI's 27K](https://scrolltest.medium.com/playwright-mcp-burns-114k-tokens-per-test-the-new-cli-uses-27k-heres-when-to-use-each-65dabeaac7a0)
- [Speed Matters: How Browser Use Achieves Fastest Agent Execution](https://browser-use.com/posts/speed-matters)
- [How Accessibility Tree Formatting Affects Token Cost](https://dev.to/kuroko1t/how-accessibility-tree-formatting-affects-token-cost-in-browser-mcps-n2a)
- [Vite HMR Performance](https://vite.dev/guide/performance)

### Testing & Agents
- [Playwright Test Agents Documentation](https://playwright.dev/docs/test-agents)
- [Playwright Coding Agent Reporter](https://github.com/getzenai/playwright-coding-agent-reporter)
- [Write Playwright Tests with Claude Code](https://shipyard.build/blog/playwright-agents-claude-code/)
- [MCP and CLI Tools for AI Test Automation Comparison](https://qtrl.ai/blog/mcp-cli-tools-ai-test-automation)

### Visual Regression
- [Percy Pricing](https://percy.io/pricing)
- [BackstopJS GitHub](https://github.com/garris/BackstopJS)
- [reg-suit GitHub](https://github.com/reg-viz/reg-suit)

### Reliability
- [AI Agents: Reliability Challenges & Solutions](https://www.edstellar.com/blog/ai-agent-reliability-challenges)
- [The State of AI & Browser Automation in 2026 (Browserless)](https://www.browserless.io/blog/state-of-ai-browser-automation-2026)
- [The State of AI Coding Agents (2026)](https://medium.com/@dave-patten/the-state-of-ai-coding-agents-2026-from-pair-programming-to-autonomous-ai-teams-b11f2b39232a)

### Existing Aigon Infrastructure
- `lib/proxy.js` — Proxy routing, port allocation, dev server registry
- `lib/commands/infra.js` — Dev server CLI commands
- `lib/dashboard-server.js:1097-1150` — Existing `captureDashboardScreenshot()` function
- `docs/specs/features/05-done/feature-56-playwright-verification.md` — Playwright verification spec (designed but not implemented)
- `playwright.config.js` — Existing Playwright config for dashboard e2e tests

## Recommendation

**Use Vercel agent-browser as the primary tool for AI-driven front-end verification in Aigon.**

Rationale:
1. **Already integrated** with Claude Code via the Vercel plugin. Zero new infrastructure needed for CC agents.
2. **Purpose-built** for the exact workflow we need: agent makes change → snapshot → evaluate → iterate.
3. **Token-efficient** (200-400 tokens per snapshot vs 15K+ for screenshots) — enables 5-6x more iterations per context window.
4. **The right abstraction** — ref-based element selection (@e1, @e2) is more reliable than CSS selectors or pixel coordinates for agent use.
5. **Free and open source** — no SaaS costs, no cloud dependency.

**Implementation strategy:**

1. **Phase 1 (Quick Win):** Add `agent-browser` as a recommended global install in `aigon doctor`. Update `feature-do.md` template to include a snapshot-based verification step (implementing feature-56's design with agent-browser instead of raw Playwright).

2. **Phase 2 (Deeper Integration):** Create `aigon frontend-verify` command that wraps agent-browser with Aigon's dev server infrastructure. Auto-detects running dev server URL, captures snapshot, and returns structured output.

3. **Phase 3 (Autonomous Loop):** Wire into the Ralph loop — after implementation, agent runs `frontend-verify`, evaluates the snapshot against acceptance criteria, and iterates if needed. Record video for evaluator review in Fleet mode.

**Secondary tool:** Keep Playwright directly for test generation (Playwright's built-in Healer agent for self-correcting tests) and for video recording (evaluator evidence). Agent-browser handles the fast feedback loop; Playwright handles the detailed verification.

**Skip:** Browserbase (cloud unnecessary), browser-use (Python ecosystem), Stagehand (NLP abstraction adds latency without value when we control the UI), Cursor Visual Editor (not programmable).

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| agent-browser-setup | Add agent-browser to `aigon doctor` checks and `aigon init` setup, ensuring it's installed globally | high | none |
| frontend-verify-command | New `aigon frontend-verify` command that wraps agent-browser with dev server URL resolution and structured output | high | agent-browser-setup |
| feature-do-browser-step | Add snapshot-based browser verification step to `feature-do.md` template (implements feature-56 with agent-browser) | high | frontend-verify-command |
| agent-browser-mcp-config | Add agent-browser MCP server config to `install-agent` for agents that support MCP (CC, Cursor) | medium | agent-browser-setup |
| ralph-loop-browser-verify | Wire frontend-verify into the autonomous Ralph loop for self-correcting front-end implementation | medium | feature-do-browser-step |
| fleet-visual-comparison | In Fleet eval, capture snapshots from each agent's implementation and present side-by-side for comparison | medium | frontend-verify-command |
| playwright-video-recording | Add Playwright video recording to feature-do for evaluator evidence (complements snapshot-based agent feedback) | low | feature-do-browser-step |
| visual-regression-backstop | Optional BackstopJS integration for pixel-diff regression testing between implementations | low | frontend-verify-command |
