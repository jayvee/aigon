# Research Findings: better front end workflow

**Agent:** Codex (cx)
**Research ID:** 18
**Date:** 2026-03-22

---

## Key Findings

### 1. The most practical baseline is local Playwright, preferably exposed to agents through MCP

- Microsoft's Playwright MCP server is open source and installs with a single `npx @playwright/mcp@latest` command across Codex, Claude Code, Cursor, VS Code, Gemini CLI, and others. That makes it the lowest-friction standard interface for agent browser control.
- Playwright already covers the core primitives Aigon needs: navigation, clicking, form fill, screenshots, snapshots, traces, and direct test execution. It also has first-party visual comparison (`toHaveScreenshot`) and ARIA snapshot support.
- For Aigon, this fits the existing stack best because the repo already has Playwright-based verification guidance and a managed dev-server/proxy workflow. The missing piece is orchestration, not a new browser framework.
- Inference: this should be the default path because it is free, local-first, cross-agent, and does not require a hosted browser vendor.

### 2. Browserbase is the strongest hosted option when local Playwright is not enough

- Browserbase offers remote browsers with free and paid tiers. As of 2026-03-22 their docs show: Free `$0`, Developer `$20`, Startup `$99`, Enterprise custom, with concurrency scaling from `3` to `250+`.
- Browserbase explicitly positions Stagehand as the AI-native layer on top of browser sessions. Their docs recommend Stagehand for AI-native workflows and Playwright for traditional automation.
- Stagehand's value is not raw browser access, but a hybrid model: prompt-driven actions when the page is unfamiliar, code-driven control when flows are deterministic, plus caching/self-healing for repeatable flows.
- Browserbase also ships an official MCP server, so it can be integrated into agent workflows without inventing a new protocol surface.
- Trade-off: Browserbase adds vendor dependency and API keys, so it should be an optional Aigon backend for cases like protected previews, long-lived sessions, stealth, or remote execution.

### 3. Browser Use is real, popular, and useful, but it is a heavier opinionated agent stack

- Browser Use is open source and active. Its main repo is large and current, and the docs include a dedicated "Coding Agent Quickstart" meant to be pasted into coding-agent environments.
- Their cloud offering is usage-priced rather than free/local. Docs currently list `$0.01` task init, per-step pricing, `$0.06/hour` browser sessions on pay-as-you-go, and separate pricing for skills and proxies.
- Browser Use is attractive when you want a higher-level agent loop quickly, but for Aigon it overlaps with orchestration Aigon already owns. That makes it better as inspiration or an optional adapter than as the default core workflow.
- Inference: adopting Browser Use wholesale would likely fight Aigon's command model more than Playwright MCP would.

### 4. Agentation is narrower than the original prompt suggested, but still interesting

- As of 2026-03-22, `agentation.com` is live again and documents a React component plus local MCP server for annotation sync.
- Agentation is explicitly desktop-only, React-only, dev-only, and local-first. It does not replace Playwright or Browserbase for autonomous browser control.
- What it appears to do well is human-in-the-loop visual feedback: annotate UI issues in-browser, sync them to the agent over MCP, and preserve session continuity across refreshes.
- That makes it better for "point at what is wrong" review loops than for "agent edits code, drives browser, verifies acceptance criteria" loops.

### 5. Vercel's `agent-browser` skill is a packaging/distribution layer, not a browser engine

- Vercel's official skills directory lists `agent-browser` as a browser automation CLI skill for navigation, forms, screenshots, and extraction.
- This is useful evidence that packaging browser workflows as reusable "skills" works across many agent environments.
- But it is not a substitute for Playwright/Browserbase/Browser Use underneath. For Aigon, the lesson is product shape: ship a reusable `frontend-verify` workflow with opinionated defaults instead of handing agents a generic toolbox.

### 6. The fastest useful loop is hybrid, not fully agentic all the time

- For deterministic checks after a code change, pure Playwright is faster and more reliable than prompting an agent to rediscover the page each run.
- For exploratory work on unfamiliar UI, MCP-driven browser control or Stagehand-style promptable actions help the agent get unstuck.
- Playwright's own docs reinforce the right split: use screenshots and traces for visual/debug feedback, ARIA snapshots for structure, and pair accessibility checks with Axe rather than relying only on raw accessibility tree dumps.
- Recommended loop:
  1. `aigon dev-server start`
  2. resolve preview URL from Aigon proxy
  3. run deterministic Playwright checks for acceptance criteria
  4. on failure, attach screenshot + trace + console/network errors
  5. let the agent patch code and rerun

### 7. Reliability constraints are real and should shape the command design

- Visual screenshot diffs are sensitive to environment drift; Playwright explicitly warns that rendering varies by OS, version, hardware, and execution environment.
- Agent-style browser tools add latency from model calls and can fail on auth, dynamic selectors, animations, and flaky timing.
- Therefore `aigon frontend-verify` should prefer stable assertions in this order:
  1. console/network/runtime errors
  2. semantic assertions and ARIA snapshots
  3. targeted screenshots
  4. full-page visual diffs only where the UI is intentionally stable

### 8. Aigon is already close to supporting this

- The repo already has:
  - managed preview startup via `aigon dev-server`
  - proxy-aware URLs
  - Playwright verification templates for web/api profiles
  - existing Playwright tests and dashboard screenshot conventions
- So the highest-leverage change is not "add browser automation" in the abstract. It is to wrap the existing pieces into a first-class command and agent prompt contract.

## Sources

- Playwright MCP server (Microsoft GitHub): https://github.com/microsoft/playwright-mcp
- Playwright browser automation for agents: https://playwright.dev/agents/playwright-mcp-browser-automation
- Playwright visual comparisons: https://playwright.dev/docs/test-snapshots
- Playwright ARIA snapshots: https://playwright.dev/docs/aria-snapshots
- Playwright accessibility testing guidance: https://playwright.dev/docs/next/accessibility-testing
- Browserbase plans: https://docs.browserbase.com/account/plans
- Browserbase getting started: https://docs.browserbase.com/introduction/getting-started
- Browserbase Stagehand intro: https://docs.browserbase.com/introduction/stagehand
- Browserbase MCP server repo: https://github.com/browserbase/mcp-server-browserbase
- Browserbase Stagehand repo: https://github.com/browserbase/stagehand
- Browser Use coding-agent quickstart: https://docs.browser-use.com/open-source/coding-agent-quickstart
- Browser Use cloud pricing: https://docs.browser-use.com/cloud/pricing
- Browser Use GitHub org: https://github.com/browser-use
- Vercel agent skills directory: https://vercel.com/docs/agent-resources/skills
- Vercel Browserbase marketplace announcement: https://vercel.com/changelog/browserbase-joins-the-vercel-agent-marketplace
- Agentation install docs: https://www.agentation.com/install

## Recommendation

Build `aigon frontend-verify` around Playwright first, with Browserbase as an optional remote backend and Agentation kept separate as a human-review add-on.

Concretely:

1. Default engine: local Playwright or Playwright MCP.
   - Reuse `aigon dev-server start` and proxy URL resolution.
   - Run a small generated verification script per feature or per acceptance criterion.
   - Persist screenshot, trace, console errors, network failures, and an ARIA snapshot as artifacts.

2. Optional backend: Browserbase.
   - Use only when local browser control is blocked by environment, auth, long-lived session needs, or remote execution needs.
   - Keep the command contract the same so the backend is swappable.

3. Do not make Browser Use the default.
   - It is useful, but it duplicates too much of Aigon's orchestration layer.
   - Borrow ideas from it; do not hand over the workflow core.

4. Keep visual review separate from autonomous verify.
   - Agentation-like annotation flows are valuable for design review, but they solve a different problem from acceptance verification.

If I had to pick the first implementation slice, it would be:
- start preview
- discover URL
- run Playwright checks
- save artifacts
- summarize pass/fail back into the agent session

That closes the current screenshot-copy-paste loop without requiring any hosted vendor.

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
| frontend-verify-command | Add `aigon frontend-verify` to start or reuse the managed preview, resolve the proxy URL, run browser checks, and publish artifacts for agent review. | high | none |
| frontend-verify-playwright-backend | Implement the default verification backend with local Playwright or Playwright MCP using screenshots, traces, console logs, and ARIA snapshots. | high | frontend-verify-command |
| frontend-verify-acceptance-spec | Let specs or feature prompts declare lightweight browser verification steps so agents can rerun deterministic checks after code changes. | high | frontend-verify-playwright-backend |
| frontend-verify-accessibility | Add optional Axe plus ARIA-snapshot checks so agents catch accessible-name and structure regressions alongside visual issues. | medium | frontend-verify-playwright-backend |
| frontend-verify-browserbase-adapter | Add a remote-browser adapter for Browserbase so the same command can run against hosted browsers when local execution is insufficient. | medium | frontend-verify-playwright-backend |
| frontend-review-annotations | Add a separate annotation-oriented review loop for UI feedback capture, potentially inspired by Agentation rather than mixed into autonomous verify. | low | none |
