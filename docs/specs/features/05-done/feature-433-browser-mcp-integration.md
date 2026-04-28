---
complexity: low
set: dashboard-feedback-loop
planning_context: ~/.claude/plans/reflective-giggling-grove.md
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-28T06:25:48.904Z", actor: "cli/feature-prioritise" }
---

# Feature: browser-mcp-integration

## Summary

Install `@playwright/mcp` at project scope so Claude Code can drive the dashboard via MCP tool calls and use a11y-tree snapshots instead of writing one-off Playwright scripts and reading PNGs back. Today, validating any dashboard change costs ~3 tool turns (write script → run node → read PNG) and burns vision tokens proportional to image size. After this feature: 1 tool call returns structured a11y text, ~10× cheaper.

## User Stories

- [ ] As an agent working in this repo, I can run `mcp__playwright__browser_navigate` + `browser_snapshot` to inspect the dashboard without authoring a Playwright script.
- [ ] As a contributor, the first time I open this repo in Claude Code I'm prompted to enable the `playwright` MCP server, with a brief explanation in `CONTRIBUTING.md`.
- [ ] As an agent, I prefer cheap a11y snapshots by default and only fall back to `browser_take_screenshot` when pixel fidelity matters (per updated `CLAUDE.md` Hot rule #4).

## Acceptance Criteria

- [ ] `.mcp.json` exists at repo root with the `playwright` server defined as `npx -y @playwright/mcp@latest --headless --isolated`.
- [ ] On a fresh CC session in this repo, `/mcp` lists `playwright` with non-zero tools after the user opts in.
- [ ] `mcp__playwright__browser_navigate` to `http://localhost:4100` followed by `browser_snapshot` returns a structured a11y tree containing the dashboard's Settings nav.
- [ ] `CONTRIBUTING.md` has a "Browser MCP" section (≤15 lines) covering: what it is, that CC prompts to opt-in, and how to verify (`/mcp`).
- [ ] `CLAUDE.md` Hot rule #4 is updated to allow a11y snapshot as the cheaper default for dashboard verification, with screenshot reserved for pixel-fidelity checks.
- [ ] `.gitignore` confirmed to ignore `.playwright-mcp/` (or rule added if missing).
- [ ] No existing tests regress (`npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`).

## Validation

```bash
node --check aigon-cli.js
node -e "JSON.parse(require('fs').readFileSync('.mcp.json','utf8'))"
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

**`.mcp.json` content** (project root, checked in):

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest", "--headless", "--isolated"]
    }
  }
}
```

Rationale:
- `--headless` — deterministic, no popup window during agent sessions.
- `--isolated` — clean profile per session, matches the test-suite ethos and prevents stale auth/cookie state from polluting visual checks.
- No `--browser` — defaults to Chromium, which Playwright already pulled into `node_modules` (no extra binary download).
- `npx -y @playwright/mcp@latest` — pinned-by-tag rather than vendored; CC fetches on first launch and caches.

**Why project scope (`.mcp.json`) not user scope:**
- Discoverable to every contributor and every future agent that opens this repo.
- Enforces a consistent feedback loop across the team without requiring each user to edit `~/.claude/settings.json`.
- CC's per-user opt-in prompt preserves consent — checking it in is safe.

**`CLAUDE.md` Hot rule update.** Current rule #4 reads "After any `templates/dashboard/index.html` edit, take a Playwright screenshot." Replace with: "After any `templates/dashboard/index.html` edit, take an MCP `browser_snapshot` (a11y tree) — fall back to `browser_take_screenshot` only when the change is purely visual (CSS, layout, color)."

**Risks:**
- MCP first-run UX — `.mcp.json` triggers a CC enable-prompt for every contributor on first session. Decline = no harm (fall back to old script flow). Mitigation: CONTRIBUTING.md note + the CLAUDE.md nudge.
- `npx -y @playwright/mcp@latest` first invocation downloads the package (~once per machine). Subsequent calls are cached. Acceptable.

## Dependencies

-

## Out of Scope

- Workflow E2E regression harness (separate feature: `workflow-e2e-regression-harness`).
- Mirroring the MCP config into `~/.claude/settings.json` for non-aigon use — users do that themselves if desired.
- Replacing existing `tests/dashboard-e2e/` Playwright tests with MCP-driven equivalents — those keep their current Playwright runner.

## Open Questions

-

## Related

- Research:
- Set: dashboard-feedback-loop
- Prior features in set:
- Follow-up: `workflow-e2e-regression-harness` dogfoods this MCP while authoring its helpers.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="568" height="132" viewBox="0 0 568 132" role="img" aria-label="Feature dependency graph for feature 433" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-433" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-433)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#433</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">browser mcp integration</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#434</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">workflow e2e regression h…</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
