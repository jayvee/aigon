# Aigon Architecture

## Purpose

This document gives agents and contributors a fast map of the Aigon codebase. It focuses on where workflow state lives, how the CLI is structured, and where new code should go.

## Repository Layout

- `aigon-cli.js`: thin CLI entrypoint. It parses argv, resolves aliases, dispatches commands, and handles top-level async errors.
- `lib/`: shared implementation modules used by the CLI.
- `lib/commands/`: command-family handlers. This is where most command behavior should live.
- `templates/`: prompt, docs, agent, and spec templates used by install and scaffolding commands.
- `templates/dashboard/index.html`: the dashboard UI — read fresh on every request, no restart needed for frontend changes.
- `tests/`: automated test suites. `tests/dashboard/` contains Playwright tests for the dashboard.
- `docs/specs/`: workflow state for features, research, feedback, logs, and evaluations.
- `docs/agents/`: agent-specific operational notes installed into projects (marker blocks updated by `install-agent`).
- `docs/aigon-project.md`: committed project-specific agent instructions. Read by `install-agent` and used when scaffolding `AGENTS.md` on first install. Edit this file to give all agents persistent project context.

## CLI Structure

The CLI is intentionally split into layers:

1. `aigon-cli.js`
   Responsibility: command dispatch only.
2. `lib/commands/*.js`
   Responsibility: user-facing command handlers grouped by domain.
3. `lib/*.js`
   Responsibility: reusable logic and shared data.

Current command families:

| File | Commands |
|------|----------|
| `lib/commands/feature.js` | All `feature-*` handlers, `sessions-close` |
| `lib/commands/research.js` | All `research-*` handlers |
| `lib/commands/feedback.js` | `feedback-create`, `feedback-list`, `feedback-triage` |
| `lib/commands/infra.js` | `server`, `dashboard` (compatibility alias), `terminal-focus`, `board`, `proxy-setup`, `dev-server`, `config`, `hooks`, `profile` |
| `lib/commands/setup.js` | `init`, `install-agent`, `check-version`, `update`, `project-context`, `doctor` |
| `lib/commands/misc.js` | `agent-status`, `status`, `deploy`, `next`, `help` |

### The ctx pattern

Commands receive dependencies via a `ctx` object rather than flat destructuring:

```js
// lib/commands/shared.js builds ctx and composes all domains
function buildCtx(overrides = {}) {
    return {
        utils:      { ...utils, ...overrides },
        git:        { ...git, ...overrides },
        board:      { ...board, ...overrides },
        feedback:   { ...feedbackLib, ...overrides },
        validation: { ...validation, ...overrides },
    };
}

// each domain file
module.exports = function featureCommands(ctx) {
    return {
        'feature-create': (args) => {
            const branch = ctx.git.getCurrentBranch();
            const { PATHS } = ctx.utils;
            // ...
        },
    };
};
```

Test overrides work by merging into ctx: `createAllCommands({ getCurrentBranch: () => 'mock' })`.

Current shared modules:

**Fully implemented modules** (logic lives in the module itself):

- `lib/board.js` (~501 lines): board rendering and board action helpers
  `collectBoardItems`, `displayBoardKanbanView`, `displayBoardListView`, `saveBoardMapping`, `getBoardAction`
- `lib/feedback.js` (~373 lines): feedback parsing, normalization, similarity, triage helpers
  `normalizeFeedbackMetadata`, `collectFeedbackItems`, `findDuplicateFeedbackCandidates`, `buildFeedbackTriageRecommendation`
- `lib/git.js` (~700+ lines): git helpers — branch/worktree/status, feature metrics, AI-attribution classification, commit analytics
  `getCurrentBranch`, `getFeatureGitSignals`, `classifyCommitAttributionRange`, `getFileLineAttribution`, `getCommitAnalytics`, `filterCommitAnalytics`, `buildCommitSeries`
- `lib/agent-status.js` (~130 lines): per-agent status file I/O in `.aigon/state/`, atomic JSON writes, candidate ID resolution
  `readAgentStatus`, `writeAgentStatus`, `writeAgentStatusAt`, `agentStatusPath`, `getStateDir`, `getLocksDir`
- `lib/state-queries.js` (~250 lines): read-only UI helpers — stage definitions, transition/action tables, guard functions. Pure module, no I/O.
  `getValidTransitions`, `getAvailableActions`, `getSessionAction`, `getRecommendedActions`, `isActionValid`, `shouldNotify`
- `lib/validation.js` (~1,045 lines): Ralph/autonomous loop and smart validation helpers
  `runRalphCommand`, `runSmartValidation`, `parseAcceptanceCriteria`, `runFeatureValidateCommand`

**Domain modules** (logic lives in the module itself):

- `lib/proxy.js` (~711 lines): Caddy management, port allocation, dev-proxy registry, route reconciliation
  `generateCaddyfile`, `reloadCaddy`, `registerDevServer`, `deregisterDevServer`, `reconcileProxyRoutes`, `allocatePort`
- `lib/dashboard-server.js` (~1,913 lines): AIGON server HTTP/UI module — serves the dashboard UI, polls state, handles WebSocket relay, notifications, and action dispatch from engine snapshots
  `runDashboardServer`, `collectDashboardStatusData`, `buildDashboardHtml`, `runDashboardInteractiveAction`
- `lib/worktree.js` (~1,122 lines): worktree creation, permissions, git attribution bootstrap, tmux sessions, terminal launching
  `setupWorktreeEnvironment`, `ensureAgentSessions`, `buildTmuxSessionName`, `openSingleWorktree`
- `lib/config.js` (~951 lines): global/project config, profiles, agent CLI config, editor detection
  `loadGlobalConfig`, `loadProjectConfig`, `getActiveProfile`, `getEffectiveConfig`, `getAgentCliConfig`
- `lib/templates.js` (~550 lines): template loading, command registry, scaffolding, content generation
  `readTemplate`, `processTemplate`, `readGenericTemplate`, `formatCommandOutput`, `COMMAND_REGISTRY`
- `lib/utils.js` (~1,474 lines): shared utilities — hooks, spec CRUD, analytics, version, deploy
  `parseHooksFile`, `parseFrontMatter`, `findFile`, `collectAnalyticsData`, `safeWrite`

**Additional modules:**

- `lib/telemetry.js` (~144 lines): normalized session telemetry — common schema across all agents (agent, model, tokens, cost, turns, duration), records to `.aigon/telemetry/`
  `writeNormalizedTelemetryRecord`, `captureFeatureTelemetry`
- `lib/security.js` (~131+ lines): merge gate scanning — runs gitleaks + semgrep at feature-close/submit, severity-aware thresholds, diff-aware scanning, graceful degradation
  `runSecurityScan`, `parseSemgrepOutput`, `formatSemgrepFindings`
- `lib/entity.js`: entity pipeline — shared feature/research processing, dependency parsing (`depends_on` frontmatter), DFS cycle detection at prioritise time
  `parseFrontMatter`, `resolveDependencies`, `detectCycles`

**Thin re-export facades:**

- `lib/constants.js`: re-exports command metadata and path constants (used by `aigon-cli.js`)
- `lib/dashboard.js`: re-exports from `lib/dashboard-server.js` (backward compat)
- `lib/devserver.js`: re-exports from `lib/proxy.js` (backward compat)

## Workflow State

The Aigon workflow now has two layers:

- Spec location under `docs/specs/` remains the user-visible workflow stage.
- For **features only**, the authoritative lifecycle state lives in the workflow engine under `.aigon/workflows/`.

That means "state-as-location" is still true at the UX level, but feature commands no longer mutate workflow by directly treating folder position as the only source of truth. The engine owns the lifecycle and moves the spec as a side effect.

- `docs/specs/features/01-inbox` to `06-paused`
- `docs/specs/research-topics/01-inbox` to `06-paused`
- `docs/specs/feedback/01-inbox` to `06-duplicate`
- `docs/specs/features/logs/`: implementation logs
- `docs/specs/features/evaluations/`: evaluation outputs

Core rule: use the CLI to move specs between states. Do not rename or move spec files manually.

### Workflow-Core Engine (`lib/workflow-core/`)

The workflow-core engine is the sole lifecycle authority for features. All feature lifecycle commands (`feature-start`, `feature-close`, `feature-eval`, `feature-pause`, `feature-resume`) route through this engine.

**Module layout:**

| File | Purpose |
|------|---------|
| `types.js` | Enum constants (LifecycleState, AgentStatus, FeatureMode, etc.) and factory helpers |
| `paths.js` | Path computation for `.aigon/workflows/` state files |
| `event-store.js` | Append-only JSONL event persistence |
| `snapshot-store.js` | JSON snapshot read/write |
| `lock.js` | Exclusive file-based locking |
| `projector.js` | Event replay — rebuilds FeatureContext from event stream |
| `machine.js` | XState state machine defining valid lifecycle transitions |
| `actions.js` | Action derivation via `snapshot.can()` — machine is single source of truth |
| `effects.js` | Pluggable effect runner + default feature effect implementations |
| `engine.js` | Full orchestration: command dispatch, event persistence, effect execution |
| `index.js` | Barrel export for all public API |

**Key properties:**

| Aspect | How it works |
|--------|-------------|
| State authority | Event log + projected snapshot |
| Action source | XState machine + `snapshot.can()` |
| Lock model | Exclusive file creation (`wx` flag) |
| Effects | Explicit, durable, resumable lifecycle (requested → claimed → succeeded/failed) |
| Dependency | `xstate` npm package |

**State files** (gitignored, under `.aigon/workflows/`):
- `.aigon/workflows/features/{id}/events.jsonl` — immutable event log
- `.aigon/workflows/features/{id}/snapshot.json` — derived snapshot
- `.aigon/workflows/features/{id}/lock` — transient lock file

### Workflow Authority Split

The post-cutover system is easier to reason about if you separate lifecycle truth from runtime/session metadata:

| Concern | Authority | Notes |
|--------|-----------|-------|
| Feature lifecycle (`implementing`, `evaluating`, `ready_for_review`, `closing`, `done`, `paused`) | `lib/workflow-core/` snapshot + event log | Sole write path for feature lifecycle |
| Feature spec folder location | Engine effects (`move_spec`) | User-visible reflection of engine state |
| Feature agent runtime status (`running`, `waiting`, `ready`, `lost`, etc.) | Engine signals plus per-agent status files in `.aigon/state/feature-{id}-{agent}.json` | Session/runtime metadata, not the lifecycle authority |
| Research / feedback lifecycle | Spec folder location + command logic | Research and feedback do not use workflow-core |

Important distinction: `.aigon/state/` still exists after the cutover, but it is no longer the coordinator manifest system that decides feature lifecycle.

### Read-Side Consumers

Feature writes go through the engine, but the read side is still mixed:

- `lib/workflow-snapshot-adapter.js` is the preferred feature read adapter for the AIGON server's dashboard and board consumers when a workflow snapshot exists.
- `lib/workflow-read-model.js` and `lib/state-queries.js` still provide derived action suggestions for research, feedback, and feature fallback paths.
- `lib/dashboard-server.js` still carries compatibility logic for the AIGON server's dashboard-facing reads, agent discovery, and older repos that may not have a complete workflow snapshot yet.

So the architecture after Feature 171 is:

1. Feature lifecycle writes: engine only.
2. Feature lifecycle reads: prefer workflow snapshots.
3. Agent/session reads: still combine snapshot data, `.aigon/state/` files, tmux state, and some compatibility fallbacks.

**Bootstrap for pre-cutover features:** Features started before the engine existed have no event log. When `feature-close` encounters this, it synthesizes events (started → agent_ready × N → eval_requested → winner.selected) to bootstrap engine state before closing.

**Compatibility note:** `feature-eval` and `feature-close` still contain bootstrap/signal-synthesis paths for pre-cutover features. New features should stay on the normal engine path; older in-flight features may still hit those compatibility branches.

## Where To Make Changes

- Add or change a CLI command:
  edit the relevant file in `lib/commands/`.
- Add shared behavior used by multiple commands:
  prefer the most specific `lib/*.js` module that owns the domain.
- Add shared constants, registry data, or command metadata:
  update `lib/constants.js`.
- Add agent-install content or generated docs:
  update files under `templates/`.
- Change workflow file conventions:
  update the owning command module and any affected templates/docs together.

## Naming Conventions

Aigon uses consistent naming across worktrees, branches, and tmux sessions:

| Layer          | Pattern                              | Example                                    |
|----------------|--------------------------------------|--------------------------------------------|
| Branch         | `feature-{num}-{agent}-{desc}`       | `feature-07-cc-restore-on-scan`            |
| Worktree dir   | `feature-{num}-{agent}-{desc}`       | `feature-07-cc-restore-on-scan`            |
| Tmux session   | `{repo}-f{num}-{agent}-{desc}`       | `whos-buy-is-it-f07-cc-restore-on-scan`   |
| Window title   | (same as tmux session)               | `whos-buy-is-it-f07-cc-restore-on-scan`   |

Research follows the same pattern with `r` instead of `f`:

| Layer          | Pattern                              | Example                                    |
|----------------|--------------------------------------|--------------------------------------------|
| Tmux session   | `{repo}-r{num}-{agent}`              | `aigon-r05-cc`                             |

Components:
- `{repo}` — repository directory name (e.g., `aigon`, `farline-ai`, `whos-buy-is-it`)
- `{num}` — zero-padded feature/research ID (e.g., `07`, `140`)
- `{agent}` — agent short code (`cc`, `gg`, `cx`, `cu`, `mv`)
- `{desc}` — kebab-case feature description from the spec filename

## Aigon Pro (`@aigon/pro`)

Aigon has a **free/pro split**. Commercial AADE (Amplification) features live in a separate private repo to keep them out of the public git history.

| | Aigon (this repo) | Aigon Pro (`~/src/aigon-pro`) |
|---|---|---|
| **Repo** | `github.com/jayvee/aigon` (public) | `github.com/jayvee/aigon-pro` (private) |
| **Package** | `aigon` | `@aigon/pro` |
| **Contains** | CLI, workflow engine, AIGON server, dashboard UI, free-tier features | Insights engine, amplification dashboard, AI coaching |
| **Data collection** | Yes — `getFeatureGitSignals()` in `lib/git.js` collects metrics | No — uses data collected by the free tier |
| **Analysis/insights** | Rule-based basics only | Full insights, trends, AI coaching |

### How the integration works

`lib/pro.js` is the single integration point:

```js
let pro = null;
try { pro = require('@aigon/pro'); } catch { /* free tier */ }
module.exports = { isProAvailable: () => !!pro, getPro: () => pro };
```

When `@aigon/pro` is installed (via `npm link` during development), Pro features light up. When absent, the CLI gracefully degrades — dashboard shows "Upgrade to Pro" placeholders, `aigon insights` shows a free-tier message.

### Cross-repo development

Features are always tracked in the **aigon** repo (specs, logs, board). When a feature touches Pro code:

1. The feature spec in aigon should note which `@aigon/pro` files need changes
2. The agent should `cd ~/src/aigon-pro` to make and commit Pro changes
3. Run `npm link` in `~/src/aigon-pro`, then `npm link @aigon/pro` in aigon to test integration
4. Both repos need separate commits — aigon for the integration, aigon-pro for the Pro logic

### Aigon Pro repo structure

```
~/src/aigon-pro/
├── index.js            # main entry: exports insights, dashboard components
├── lib/insights.js     # rule-based + AI insights engine
├── dashboard/
│   └── amplification.js  # amplification metrics dashboard view
├── commands/
│   └── insights.md     # slash command template for insights
└── tests/
    └── insights.test.js
```

## Design Rules

- Keep `aigon-cli.js` free of business logic.
- Prefer explicit CommonJS exports.
- Keep command handlers grouped by domain, not one file per command.
- Avoid circular dependencies between `lib/*.js` modules.
- Treat `templates/` as source-of-truth for generated agent docs and prompts.
- Project-specific agent instructions belong in `AGENTS.md` and/or `CLAUDE.md` (user-owned, never overwritten by aigon). `docs/aigon-project.md` provides committed defaults used when scaffolding `AGENTS.md` on first install.
- The AIGON server is the foreground HTTP process. It serves the dashboard UI, registers with the proxy registry (`~/.aigon/dev-proxy/servers.json`) on start, and deregisters on shutdown, giving it named URLs (`aigon.localhost`, `cc-71.aigon.localhost`) via the aigon-proxy daemon.
- The proxy (`lib/aigon-proxy.js`) is a ~100-line Node.js reverse proxy that reads `servers.json` and routes by Host header. Installed as a system daemon on port 80 via `aigon proxy install`.

## Remote Access

The AIGON server binds to `0.0.0.0` by default, making the dashboard UI accessible from any device on the local network.

- **Same WiFi (phone/tablet):** open `http://<mac-ip>:4100` in a browser. Find your Mac's IP with `ipconfig getifaddr en0`.
- **Outside the LAN (cellular, travel):** install [Tailscale](https://tailscale.com/) (free) on both devices, then use `http://<tailscale-ip>:4100`.
- **What works remotely:** monitoring, board management, and state transitions — anything that doesn't require spawning a local terminal session.
- **Session peek (feature 106):** will add streaming tmux output viewable from any browser, closing the gap for remote implementation monitoring.

## Reading Order For New Agents

When orienting to the repo, read in this order:

1. `AGENTS.md`
2. `docs/architecture.md`
3. `docs/development_workflow.md`
4. the active spec under `docs/specs/...`
5. the relevant command module under `lib/commands/`

## Testing

### Test Layers

Aigon has five test layers, each serving a different purpose:

| Layer | Command | Framework | What it tests |
|-------|---------|-----------|---------------|
| **Unit tests** | `node aigon-cli.test.js` | Custom `test()` | Core logic: parsing, state machine, dashboard data, command routing, analytics |
| **Module tests** | `node lib/<name>.test.js` | Custom `test()` | Individual modules: workflow-core, workflow-signals, shell-trap, config, proxy, worktree, templates, dashboard-server |
| **Dashboard UI** | `npm run test:dashboard` | Playwright | Dashboard HTML rendering with mocked API data (monitor, pipeline, actions, analytics) |
| **Mock E2E** | `npm run test:e2e:mock-solo` / `mock-fleet` | Custom runner | Full feature lifecycle with mock agents — no AI tokens burned |
| **CLI E2E** | `npm run test:e2e` | Custom runner | Real git operations on fixture repos in `~/src/` |

There is also a **Dashboard E2E** layer (`npm run test:dashboard:e2e`) that runs full lifecycle tests through the dashboard browser UI with mock agents.

### What `npm test` runs

```
node aigon-cli.test.js                          # Unit tests (~195 tests)
node lib/workflow-core/workflow-core.test.js     # Workflow engine tests (~50 tests)
node lib/workflow-signals.test.js               # Signal/heartbeat tests (~39 tests)
node lib/shell-trap.test.js                     # Shell trap tests (~24 tests)
npx playwright test ...                         # Dashboard UI tests (~30 tests)
```

All three must pass for `npm test` to succeed.

### When tests run

- **`npm test`** — run manually or by agents during feature implementation (via `## Validation` section in feature specs)
- **Mock E2E** — run manually; exercises full feature lifecycle without AI tokens
- **CLI E2E** — run manually; creates real fixture repos and tests real git operations
- **No CI pipeline** — there are no GitHub Actions or pre-commit hooks; tests are run locally
- **Ralph validation** — during `feature-do --autonomous`, the agent runs commands from the spec's `## Validation` section after each iteration; all must exit 0

### Writing tests

- **Unit tests** go in `aigon-cli.test.js` (core logic) or the relevant `lib/<name>.test.js` (module-specific)
- **Dashboard UI tests** go in `tests/dashboard/<view>.spec.js` — they mock API responses via `page.route()` and test HTML rendering
- **Dashboard E2E tests** go in `tests/dashboard-e2e/` — they use `setup.js` to create real fixtures and `mock-agent.js` to simulate agents
- **Mock E2E tests** go in `test/e2e-mock-*.test.js` — they exercise the CLI with `test/mock-agent.js`
- **Feature-specific validation** goes in the spec's `## Validation` section as bash commands

### Test utilities

- `test/setup-fixture.js` — generates realistic fixture repos (brewboard, brewboard-api, trailhead) with known feature/research/feedback IDs
- `test/mock-agent.js` — `MockAgent` class that simulates agent work in a worktree (writes code, commits, updates status) with configurable delays
- `tests/dashboard/server.js` — minimal HTTP server that serves the dashboard HTML at `:4109` for Playwright tests

### Quick reference

```bash
npm test                        # Unit + workflow-core + dashboard UI (the default suite)
npm run test:e2e:mock-solo      # Solo Drive lifecycle with mock agent
npm run test:e2e:mock-fleet     # Fleet lifecycle with mock agents
npm run test:e2e                # Full CLI E2E with real git repos
npm run test:dashboard          # Dashboard Playwright tests only
npm run test:dashboard:e2e      # Dashboard E2E lifecycle tests
node -c aigon-cli.js            # Quick syntax check (no tests)
node -c lib/<module>.js         # Quick syntax check for a module
```
### Read Models

There are currently two read-side paths:

- `lib/workflow-snapshot-adapter.js`: maps workflow-core snapshots into dashboard/board-friendly shapes for features. This is the preferred feature read path.
- `lib/workflow-read-model.js`: derives recommended actions from `lib/state-queries.js` for research/feedback and for feature fallback cases where a workflow snapshot is unavailable.

If you are changing feature lifecycle behavior, update the engine first. Then check whether snapshot consumers and fallback read-model consumers still present the same behavior.
