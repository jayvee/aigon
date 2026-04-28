---
commit_count: 3
lines_added: 397
lines_removed: 3
lines_changed: 400
files_touched: 4
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 227
output_tokens: 89947
cache_creation_input_tokens: 390081
cache_read_input_tokens: 20592620
thinking_tokens: 0
total_tokens: 21072875
billable_tokens: 90174
cost_usd: 44.9524
sessions: 1
model: "claude-opus-4-7"
tokens_per_line_changed: null
---
# Implementation Log: Feature 434 - workflow-e2e-regression-harness
Agent: cc

Added `tests/dashboard-e2e/workflow-e2e.spec.js` (96 LOC) + 8 helpers in `_helpers.js` (~73 LOC); drives the full solo lifecycle (create → prioritise → start → submitted → close) with four-layer assertions (DOM, spec-on-disk, engine snapshot, tmux pane). Two consecutive isolated runs pass green (39.3s, 31.8s); test budget 7578/9540 (79%).

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage

## Planning Context

### ~/.claude/plans/reflective-giggling-grove.md

# Plan: Browser MCP + Workflow E2E Regression Harness

## Context

Today, validating dashboard changes means writing a one-off Playwright Node script, running it, screenshotting, and reading the PNG back. That's vision-token-expensive and high-friction — each change burns ~1 tool turn writing the script and another reading the image. I want a faster, cheaper feedback loop, plus a proper end-to-end regression suite that exercises the full feature-lifecycle state machine (create → backlog → in-progress → submitted → closed) including real tmux pane content.

Two goals, one umbrella:

1. **Cheap visual validation** — install a browser MCP server so I can drive the dashboard via tool calls and use accessibility-tree snapshots (structured text, ~10× cheaper than pixels) for most checks, dropping to screenshots only when pixel fidelity matters.
2. **Workflow E2E regression** — a new spec under `tests/dashboard-e2e/` that drives a full feature lifecycle in the UI, captures real tmux pane content, and asserts engine state lands on disk at every transition. Catches a class of bug that current mocked-API tests can't see (write-path/read-path divergence between dashboard, engine snapshot, and tmux session).

I'm proposing **two separate feature specs**, both in this plan, sequenced so the MCP lands first and the harness work then dogfoods it.

---

## Spec 1 — Browser MCP integration (small, ~½ day)

### Files

- **`/Users/jviner/src/aigon/.mcp.json`** *(new, checked in)* — registers `@playwright/mcp` at project scope. Claude Code prompts each contributor to opt-in on first session, so checking it in is safe.
- **`/Users/jviner/src/aigon/CONTRIBUTING.md`** *(modify, ~10 lines)* — short "Browser MCP" section: what it is, that CC will prompt to enable, how to verify it loaded (`/mcp` slash command).
- **`/Users/jviner/src/aigon/CLAUDE.md`** *(modify, ~6 lines under Hot rules)* — agent guidance: for dashboard visual checks prefer `mcp__playwright__browser_snapshot` (a11y tree) over writing one-off Playwright scripts; drop to `browser_take_screenshot` only when pixel fidelity matters. Cross-reference Hot rule #4 (which currently mandates Playwright screenshot after `templates/dashboard/index.html` edits — update to allow a11y snapshot as the cheaper default).
- **`/Users/jviner/src/aigon/.gitignore`** *(verify only)* — `.playwright-mcp/` (the MCP's runtime cache directory) should already be ignored by the existing `.playwright/` rule; if not, add it.

### `.mcp.json` content

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

- `--headless`: deterministic, CI-safe, no window pop-up while I'm working
- `--isolated`: clean profile per session, mirrors the test-suite ethos
- No `--browser` flag → uses Chromium, which Playwright already pulled into `node_modules` (no extra binary download)
- A user wanting head-ful debug can override in `~/.claude/settings.json` mcpServers without touching the project file

### Verification

1. From a fresh CC session in this repo: confirm CC prompts to enable the new server. Approve.
2. Run `/mcp` — should list `playwright` with N tools available.
3. Drive the live dashboard: `mcp__playwright__browser_navigate` to `http://localhost:4100`, `browser_snapshot`, confirm the a11y tree includes the Settings nav. Token cost should be a small fraction of the equivalent screenshot.
4. Compare to the previous flow: writing `/tmp/aigon-pro-verify.js` + `node` + Read PNG. Should be 1 tool call vs 3, and structured text output vs vision tokens.

### Why this scope only

Pure infra. Zero test impact. Reviewable in a single PR with one verification step. Once merged, I (and any future agent) immediately get cheaper visual validation — and Spec 2's author can use it interactively while building the harness.

**Complexity:** `low`

---

## Spec 2 — Workflow E2E regression harness (medium, ~2–3 days)

Builds on top of `tests/dashboard-e2e/` (existing fresh-server + brewboard-fixture setup, runs under `npm run test:ui`).

### Files

- **`/Users/jviner/src/aigon/tests/dashboard-e2e/workflow-e2e.spec.js`** *(new, ≤180 LOC budget)* — full lifecycle spec.
- **`/Users/jviner/src/aigon/tests/dashboard-e2e/_helpers.js`** *(modify, ~50 LOC added)* — new helpers (see below).
- **`/Users/jviner/src/aigon/tests/dashboard-e2e/screenshots/`** — no new baselines; spec uses a11y assertions, not visual diff.
- **`scripts/check-test-budget.sh`** — do NOT modify. Suite has ample headroom at current ceiling (~6,869 LOC against 9,540). If implementation overflows, that's a signal to refactor into helpers, not raise the ceiling.

### Spec outline (`workflow-e2e.spec.js`)

One `test.describe('Workflow E2E (full lifecycle)')` containing:

```
test('mock lifecycle: create → backlog → in-progress → submitted → closed', async ({ page }) => {
  await gotoPipelineWithMockedSessions(page);

  // Phase 1 — CREATE
  const paddedId = await createInboxFeatureViaUI(page, 'wf e2e feature');
  await expectSpecAt(ctx.tmpDir, paddedId, '01-inbox/');
  // No snapshot yet — engine snapshot only created at prioritise

  // Phase 2 — PRIORITISE
  await prioritiseInboxFeature(page, 'wf e2e feature');
  await expectSpecAt(ctx.tmpDir, paddedId, '02-backlog/');
  await expectSnapshotState(ctx.tmpDir, paddedId, 'backlog');

  // Phase 3 — START with cc
  await startFeatureWithAgents(page, 'wf e2e feature', ['cc']);
  await expectSnapshotState(ctx.tmpDir, paddedId, 'implementing');
  const session = tmuxSessionFor(paddedId, 'cc', ctx.tmpDir, 'implement');
  await expectTmuxPaneContains(session, /feature-\d+.*cc/i);

  // Phase 4 — drive MockAgent to submitted
  await new MockAgent({ paddedId, agent: 'cc', role: 'implement', tmpDir: ctx.tmpDir }).run();
  await expectSnapshotState(ctx.tmpDir, paddedId, 'submitted');
  await expectTmuxPaneIdleAfter(session, /implementation complete|submitted/i);

  // Phase 5 — CLOSE (solo skips review)
  await clickCardAction(page, card, 'feature-close', 'feature-close');
  await expectFeatureClosed(page, 'wf e2e feature');
  await expectSpecAt(ctx.tmpDir, paddedId, '04-done/');
  await expectSnapshotState(ctx.tmpDir, paddedId, 'done');
});

test.skip(!process.env.AIGON_E2E_REAL, 'real-agent smoke');
test('real-agent smoke (AIGON_E2E_REAL=1): create → start cc → assert agent prompt landed', ...);
```

Order matters: each transition asserts **DOM → spec-on-disk → engine-snapshot → tmux-pane** before moving on. A failure points to which layer drifted.

The gated real-agent test (`AIGON_E2E_REAL=1`) is opt-in — runs a tiny real `cc` session for ~30s, asserts only the agent banner shows up in the pane. Not in the default `test:ui` run; intended for manual confidence checks before risky refactors and as a quarterly sanity sweep.

### New `_helpers.js` functions

```js
/** Create an inbox feature via dashboard UI modal; falls back to CLI if modal absent. Returns paddedId. */
async function createInboxFeatureViaUI(page, title): Promise<string>

/** Read .aigon/workflows/<id>/snapshot.json (note: workflows, not workflow-state) and assert state. */
async function expectSnapshotState(repoPath, paddedId, expectedState): Promise<void>

/** Assert the spec file lives in the expected lifecycle folder (01-inbox/, 02-backlog/, 04-done/). */
async function expectSpecAt(repoPath, paddedId, folder): Promise<void>

/** Poll `tmux capture-pane -p -t <session> -S -200` up to timeoutMs; assert regex matches. */
async function expectTmuxPaneContains(sessionName, regex, timeoutMs = 8000): Promise<void>

/** Like expectTmuxPaneContains but asserts the regex is the LAST non-empty line (post-action idle prompt). */
async function expectTmuxPaneIdleAfter(sessionName, regex, timeoutMs = 8000): Promise<void>

/** Wrap lib/supervisor.js's session-name builder to compute the same name the dashboard supervisor uses. */
function tmuxSessionFor(paddedId, agentId, repoPath, role): string

/** Read snapshot JSON or null if not yet created. */
function readSnapshot(repoPath, paddedId): object | null
```

`tmuxSessionFor` and `expectSnapshotState` are the load-bearing additions — both reuse logic that already exists in `lib/supervisor.js` (capture-pane invocation + per-agent regex patterns at line 248) and `lib/workflow-snapshot-adapter.js` (snapshot read path). Sugar helpers compose those.

### Critical files to read while implementing

- `tests/dashboard-e2e/setup.js` — fresh-server bootstrap, fixture seed, `/tmp/aigon-dashboard-e2e-ctx.json`
- `tests/dashboard-e2e/_helpers.js:55` — current session-mock pattern (skip when running this spec)
- `tests/dashboard-e2e/failure-modes.spec.js` — model for tmux-attached assertions; has the working pattern
- `tests/dashboard-e2e/solo-lifecycle.spec.js` — UI-driving pattern for create / prioritise / start
- `tests/integration/mock-agent.js` — MockAgent harness (drives agent transitions deterministically under `MOCK_DELAY=fast`)
- `lib/supervisor.js:243-249` — capture-pane regexes per agent; spec assertions should target stable banner fragments, not transient progress lines
- `lib/worktree.js:1273` — `createDetachedTmuxSession` — confirms session-name format
- `lib/workflow-snapshot-adapter.js` — snapshot read API
- `lib/commands/feature.js:317` — `feature-create` flow (UI helper falls back to CLI here)

### Verification

1. `MOCK_DELAY=fast npm run test:ui -- workflow-e2e` — runs the new spec only, must pass green in <30s.
2. `MOCK_DELAY=fast npm run test:ui` — full suite + new spec, must pass green and stay under the existing test budget (`bash scripts/check-test-budget.sh`).
3. `AIGON_E2E_REAL=1 npm run test:ui -- workflow-e2e` — opt-in real-agent run, manual smoke (~30s with a live `cc` session). Should pass on a configured dev machine; skipped in default CI.
4. Soak: run the spec 10× consecutively (`for i in $(seq 1 10); do MOCK_DELAY=fast npm run test:ui -- workflow-e2e || break; done`). Must be 10/10. tmux-timing flakes get caught here, not in production.

**Complexity:** `medium`

---

## Risks & tradeoffs (top 3)

1. **tmux-timing flakiness.** `MOCK_DELAY=fast` compresses implementing→submitted to ~600ms — `expectTmuxPaneContains` must poll, not single-shot, and assertions must target *stable* prompt fragments (the agent banner, the post-action idle line) rather than transient progress text. Mitigation: copy the exact regex patterns `lib/supervisor.js:243-249` already uses for idle detection, and add the 10× soak run to the verification step before merging.
2. **MCP first-run UX.** `.mcp.json` triggers a CC enable-prompt for every contributor on first session in this repo. If they decline, no harm — they fall back to the old script flow. Mitigation: CONTRIBUTING.md note + the CLAUDE.md nudge so CC itself recommends enabling on first encounter. Don't auto-enable; respect the consent flow.
3. **Scope of "state machine" assertions.** The plan asserts at five transitions (create, prioritise, start, submitted, close). It does NOT exercise: review/eval (solo skips them), failure recovery (already covered by `failure-modes.spec.js`), Fleet multi-agent (covered by `fleet-lifecycle.spec.js`), or the F397 engine-first lifecycle precedence rules. If the user wants those layered into this same spec, that's another ~80 LOC and pushes us closer to the test budget — better as a follow-up.

## Sequencing

1. **Spec 1 first** (browser MCP, ~½ day, low complexity). Single PR. After merge, agents in this repo get the cheaper visual feedback loop immediately.
2. **Spec 2 next** (workflow E2E harness, ~2–3 days, medium complexity). Author can use the freshly-installed Playwright MCP to interactively explore the dashboard while writing helpers — dogfooding Spec 1 while building Spec 2.

Both specs ship via the standard `aigon feature-create` → `feature-prioritise` → `feature-start` flow. Per project memory, this is agent-discovered work, so use `afc` (feature-create), not `afbc` (feedback-create reserved for actual user voice).
