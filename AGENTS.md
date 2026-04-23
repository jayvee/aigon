# Aigon — Codebase Orientation

## Quick Facts
- **Entry point**: `aigon-cli.js` — dispatch only, no business logic
- **Commands**: 6 domain files in `lib/commands/` (feature, research, feedback, infra, setup, misc)
- **Shared logic**: `lib/*.js` — ~21 modules; see Module Map below
- **Template source of truth**: `templates/generic/commands/` — sync via `aigon install-agent cc` (or any agent)
- **Working copies** (gitignored): `.claude/commands/`, `.cursor/commands/`, etc.
- **AIGON server**: `aigon server start` serves the dashboard UI and API; restart it after any `lib/*.js` edit
- **Interrupting agents**: `aigon nudge <ID> [agent] "message"` is the canonical way to message a running session — do not handcraft `tmux send-keys`
- **Tests**: `npm test` · syntax: `node -c aigon-cli.js`
- **Version bumps**: after every commit — `npm version patch|minor|major && git push --tags`
- **Seed reset**: `aigon seed-reset ~/src/<repo> --force` — resets seed repos to initial state
- **Cross-machine sync**: `aigon sync` — backup/restore `.aigon/` via private git repo (see `lib/sync.js`)
- **Spec frontmatter (F313)**: `complexity:` (low/medium/high/very-high) and `recommended_models:` in feature/research specs drive the dashboard start modal's per-agent `{model, effort}` pre-selection. Missing frontmatter falls back to `templates/agents/<id>.json` `cli.complexityDefaults` and then to `aigon config models`. Parser + resolver live in `lib/spec-recommendation.js`; API `/api/recommendation/:type/:id`.

## The ctx Pattern
Commands receive dependencies via a `ctx` object — enables test overrides without mocking globals:

```js
// lib/commands/shared.js — buildCtx() wires every module
function buildCtx(overrides = {}) {
    return {
        utils:      { ...utils, ...overrides },
        git:        { ...git, ...overrides },
        board:      { ...board, ...overrides },
        feedback:   { ...feedbackLib, ...overrides },
        validation: { ...validation, ...overrides },
    };
}

// Each domain file exports a factory returning a command map:
module.exports = function featureCommands(ctx) {
    return {
        'feature-create': (args) => {
            const branch = ctx.git.getCurrentBranch();
            const { PATHS } = ctx.utils;
        },
    };
};
```

Test overrides: `createAllCommands({ getCurrentBranch: () => 'mock-branch' })`.

## Module Map
Run `wc -l lib/*.js lib/commands/*.js` for live counts.

| Module | ~Lines | Owns |
|--------|--------|------|
| `lib/agent-registry.js` | ~280 | Agent registry: scans `templates/agents/*.json`, provides lookup maps (display names, ports, providers, trust, capabilities). Zero hardcoded agent logic in `lib/` |
| `lib/commands/feature.js` | ~1950 | Thin dispatcher for `feature-*` handlers + `sessions-close`. Fat handlers (`feature-start`, `feature-eval`, `feature-do`, `feature-autonomous-start`) delegate to dedicated `lib/feature-*.js` modules. Entity-agnostic handlers come from `./entity-commands`. Uses `withActionDelegate` from `action-scope` for the main-repo delegation guard |
| `lib/feature-start.js` / `lib/feature-eval.js` / `lib/feature-do.js` / `lib/feature-autonomous.js` | ~800/~450/~250/~830 | Extracted handlers — each exports `run(args, deps)` where `deps` bundles ctx + local closures (`persistAndRunEffects`, `resolveFeatureMode`, etc.) from the parent dispatcher. Add new commands here when the body exceeds ~100 lines |
| `lib/feature-command-helpers.js` | ~95 | Shared helpers for feature handlers: `parseLogFrontmatterForBackfill`, `estimateExpectedScopeFiles`, `upsertLogFrontmatterScalars` |
| `lib/commands/research.js` | ~940 | All `research-*` handlers, research synthesis/review. Shares parallel handlers via `./entity-commands` |
| `lib/commands/entity-commands.js` | ~295 | Shared factory for parallel feature/research lifecycle commands. `createEntityCommands(FEATURE_DEF\|RESEARCH_DEF, ctx)` returns `${prefix}-{create,prioritise,spec-review,spec-review-check,spec-review-record,spec-review-check-record}`. `entityResetBase` drives feature-reset/research-reset with entity-specific pre/post-cleanup hooks. **When adding a new parallel command, put it here — not in feature.js/research.js — so both entities pick it up by construction** |
| `lib/commands/infra.js` | ~1460 | `aigon server` command, board, config, proxy-setup, dev-server |
| `lib/commands/setup.js` | ~1212 | init, install-agent, check-version, update, doctor + state reconciliation |
| `lib/dashboard-server.js` | ~2660 | HTTP/UI module: dashboard, API, WebSocket relay, HTTP action dispatch. Never mutates engine state directly and never reads engine-state/spec/log files directly |
| `lib/dashboard-routes.js` | ~1660 | OSS dashboard API route table and dispatcher |
| `lib/dashboard-status-collector.js` | ~830 | Read-side collector: repo/feature/research/feedback/summary status, log/detail reads |
| `lib/utils.js` | ~183 | Cross-cutting re-exports (config, proxy, dashboard, worktree, templates, git) + feedback constants, dev-server URL, terminal title, safeWrite |
| `lib/hooks.js` | ~146 | Hook lifecycle: parseHooksFile, getDefinedHooks, executeHook, runPreHook, runPostHook |
| `lib/analytics.js` | ~889 | Analytics: collectAnalyticsData, parseLogFrontmatterFull, buildCompletionSeries, buildWeeklyAutonomyTrend |
| `lib/version.js` | ~154 | Version management: getAigonVersion, compareVersions, upgradeAigonCli, checkAigonCliOrigin |
| `lib/spec-crud.js` | ~247 | Spec file CRUD: findFile, moveFile, modifySpecFile, getNextId, createSpecFile, readSpecSection |
| `lib/cli-parse.js` | ~256 | CLI option parsing + YAML helpers: parseCliOptions, parseFrontMatter, serializeYamlScalar, slugify, escapeRegex |
| `lib/deploy.js` | ~65 | Deploy command resolution and execution: resolveDeployCommand, runDeployCommand |
| `lib/worktree.js` | ~1300 | Worktree creation, tmux, shell-trap signal wrapper (terminal dispatch in `terminal-adapters.js`) |
| `lib/validation.js` | ~1045 | Iterate (Autopilot) loop, acceptance-criteria parsing |
| `lib/config.js` | ~950 | Global/project config, agent CLI config |
| `lib/telemetry.js` | ~1100 | Normalized session telemetry (cc JSONL, gg `~/.gemini/tmp/`, cx `~/.codex/sessions/`); cross-agent pricing |
| `lib/workflow-core/` | ~1500 | **Workflow engine**: event-sourced state, XState machine, action derivation, effect lifecycle |
| `lib/workflow-snapshot-adapter.js` | ~310 | Read adapter: workflow-core snapshots → dashboard/board formats |
| `lib/profile-placeholders.js` | ~500 | Profile presets, detection, instruction directive resolvers, `getProfilePlaceholders()` |
| `lib/feature-close.js` | ~740 | Feature-close phases: target resolution, merge, telemetry, engine close, cleanup |
| `lib/feature-review-state.js` | ~220 | Per-feature `review-state.json` (current + history); read by AutoConductor to confirm review completion |
| `lib/nudge.js` | ~250 | Shared nudge primitive: resolves tmux sessions from workflow state, rate-limits, delivers text atomically via paste-buffer, confirms pane echo, and records `operator.nudge_sent` events |
| `lib/feature-spec-resolver.js` | ~140 | Canonical spec lookup |
| `lib/feature-sets.js` | ~240 | Derived-state scanner: reads optional `set:` frontmatter from feature specs, builds `{setSlug → members}` index, topologically orders members using the existing `depends_on` graph (intra-set edges only). No new files or engine state — the dashboard/CLI derive set state from member workflow state. Consumed by `lib/commands/set.js` and `lib/dashboard-status-collector.js` (`sets` rollup + per-feature `set` key) |
| `lib/set-conductor.js` | ~500 | Set-level autonomous orchestration (`set-autonomous-start|stop|resume|reset`): resolves set members with strict cycle checks, starts/resumes per-feature `feature-autonomous-start`, polls `feature-<id>-auto.json`, and persists durable set state in `.aigon/state/set-<slug>-auto.json` |
| `lib/state-queries.js` | ~250 | Read-only UI helpers: feedback action/transition derivation (pure, no I/O) |
| `lib/agent-status.js` | ~130 | Per-agent status files (`.aigon/state/{prefix}-{id}-{agent}.json`), atomic writes |
| `lib/agent-prompt-resolver.js` | ~140 | Resolves launch prompt for agent + verb. Slash-invocable agents (cc/gg/cu) pass through `cliConfig.<verb>Prompt`; non-invocable agents (cx/op) inline the canonical template body directly |
| `lib/agent-launch.js` | ~130 | `resolveLaunchTriplet` + `buildAgentLaunchInvocation`. **Every** spawn path must route through this helper so per-feature `{model, effort}` overrides captured on `feature.started` survive every respawn |
| `lib/agent-failover.js` | ~140 | Token-exhaustion detection helpers, failover chain selection, handoff prompt builder, `clearTokenExhaustedFlag` (shared by supervisor + dashboard switch) |
| `lib/stats-aggregate.js` | ~270 | Rolled-up stats cache (`.aigon/cache/stats-aggregate.json`); rebuilt lazily; includes `perTriplet` rollup keyed on `agent\|model\|effort` |
| `lib/migration.js` | ~300 | Versioned state migrations with backup/restore/validate lifecycle |
| `lib/global-config-migration.js` | ~150 | Machine-wide `~/.aigon/config.json` migrations: versioned registry, backup/write-once runner, terminal settings rename (`terminal`/`tmuxApp` → `terminalApp`) |
| `lib/pro.js` | ~25 | Pro gate: lazy-require `@aigon/pro`. Only `lib/pro-bridge.js` calls it |
| `lib/pro-bridge.js` | ~180 | Pro extension point: `initialize({ helpers })` + in-process route registry |
| `lib/remote-gate-github.js` | ~170 | GitHub PR-aware close helper: `feature-close` gate based on `gh pr list` |
| `lib/proxy.js` | ~660 | Caddy management, port allocation, dev server utilities |
| `lib/sync.js` | ~900 | Cross-machine state backup/restore via private git repo |
| `lib/templates.js` | ~550 | Template loading, scaffolding, COMMAND_REGISTRY |
| `lib/git.js` | ~700 | Branch, worktree, status, commit helpers, attribution |
| `lib/security.js` | ~131 | Merge gate scanning (gitleaks + semgrep) |
| `lib/workflow-heartbeat.js` | ~160 | Display-only liveness computation (alive/stale/dead); never changes engine state |
| `lib/supervisor.js` | ~430 | Server monitoring: liveness, idle/awaiting-input notifications, and token-exhaustion detection (F308) that may append workflow events, pause a feature, or auto-switch a slot per `agentFailover` policy |
| `lib/supervisor-service.js` | ~175 | Server auto-restart (launchd/systemd) for `aigon server start --persistent` |
| `lib/terminal-adapters.js` | ~200 | Detect/launch/split per terminal (Warp, iTerm2, kitty, Terminal.app) |

Thin facades (re-exports only): `lib/constants.js`, `lib/dashboard.js`, `lib/devserver.js`.

## State Architecture
Feature and research lifecycle state are managed by the **workflow-core engine** (`lib/workflow-core/`):

- **Event log** (`.aigon/workflows/features/{id}/events.jsonl`) — append-only, immutable
- **Snapshot** (`.aigon/workflows/features/{id}/snapshot.json`) — derived from events
- **XState machine** — validates lifecycle transitions; `snapshot.can()` for action derivation
- **Effect lifecycle** — durable, resumable side effects (requested → claimed → succeeded/failed)
- **Exclusive file locking** — prevents concurrent modification
- **Create-time bootstrap** — `feature-create` / `research-create` write the spec file and seed the workflow snapshot in the same write path. Inbox entities use the slug as the engine id until prioritise re-keys them to the numeric id.

Supporting state:
- **Folders** (`docs/specs/features/0N-*/`) — shared ground truth, committed to git
- **Recurring templates** (`docs/specs/recurring/`) — weekly feature templates; scanned by `lib/recurring.js` at server startup and every 24 h; excluded from the Kanban board and dashboard discovery
- **Agent status files** (`.aigon/state/feature-{id}-{agent}.json`) — managed by `lib/agent-status.js`
- **Per-agent overrides** (`snapshot.agents[id].modelOverride` / `effortOverride`) — optional `{model, effort}` captured on `feature.started` and honoured by every respawn path via `lib/agent-launch.js:buildAgentLaunchInvocation`. Precedence: event override > workflow stage triplet > `aigon config models` > agent JSON default > null. Never read `cliConfig.models[...]` directly in a new spawn site
- **Shell trap signals**: `buildAgentCommand()` wraps agent commands with a bash `trap EXIT` that fires `agent-status submitted` / `review-complete` / `error`. A heartbeat sidecar touches `.aigon/state/heartbeat-{featureId}-{agentId}` every 30s. Controlled by `signals` in `templates/agents/*.json`.
- **Review state**: `.aigon/workflows/features/{id}/review-state.json` tracks `current` + `history[]`. Written by `agent-status reviewing`/`review-complete`; read by AutoConductor to confirm review completion.
- **AutoConductor** (`feature-autonomous-start __run-loop`): detached tmux session. Solo: polls allReady → review session (if `--review-agent`) → waits for `review-complete` → `feature-close`. Fleet: polls allReady → eval session → polls eval file for `**Winner:**` → `feature-close <winner>`. Kills its own tmux session on completion.
- **SetConductor** (`set-autonomous-start __run-loop`): detached tmux session `<repo>-s<slug>-auto` that runs set members sequentially in topological order, delegates each member to `feature-autonomous-start`, and persists durable set state at `.aigon/state/set-<slug>-auto.json` (lock-protected writes).
- **Heartbeat is display-only**: liveness tracking in memory only; never triggers engine transitions. Users manually mark agents as lost/failed — the system never does this automatically.
- **Idle detection is display-only**: supervisor derives `idleState` from workflow progress gaps while a matching tmux session is still alive. It may badge and notify, but never kills, restarts, or auto-approves agents for idle alone.
- **Token exhaustion (F308) is the exception**: when a positive detector fires, the supervisor may append `agent.token_exhausted`, pause the feature, notify, and (policy `switch`) kill that slot's tmux session and spawn the next agent in the failover chain via `buildAgentCommand` / `buildAgentLaunchInvocation`.
- Log files are **pure narrative markdown** — no frontmatter, no machine state

Research lifecycle also uses workflow-core (`.aigon/workflows/research/{id}/`). Feedback stays outside the engine; its frontmatter `status` is the authority and folder position is a reconciled projection.

### Dashboard read-only rule
The dashboard may not mutate engine state directly and may not parse engine-state/spec/log files directly from `dashboard-server.js` or frontend code. File-format ownership stays with read-side owner modules (`state-queries.js`, `workflow-snapshot-adapter.js`, `action-command-mapper.js`, `spec-reconciliation.js`, `agent-status.js`, `feature-spec-resolver.js`, `dashboard-status-collector.js`).

### Write-Path Contract
Every write path (CLI command, autonomous-loop injection, hook-triggered transition) must produce the engine state its matching read path assumes exists — snapshot, event, or skill-file-pointer prompt for non-slash-command agents. Writes seed engine state; reads derive from it — never the reverse.

Recent incidents — every one of these is a case of a read path paving over a missing producer instead of failing loudly:
- **F270 → `1c2766bc`** — prioritise assumed a snapshot existed; when it didn't, the read path silently fell through. Fix: fail loud and point at `aigon doctor --fix`.
- **F272 → `cbe3aeba` + `98ed172b`** — the reconciler moved spec files across repos on every dashboard refresh. Fix: detect-only on read paths; `AIGON_AUTO_RECONCILE=1` opt-in for mutations.
- **AutoConductor → `b9c39a26`** — cx injection arrived as a phantom because the read path assumed a skill-file-pointer prompt it never got. Fix: respect `capabilities.resolvesSlashCommands`.
- **F283 → spec-review scanner deletion** — the dashboard scanned git log for `spec-review:` commits to derive badges, paving over the fact that the engine snapshot already carried `pendingCount`/`pendingAgents`. Fix: read-model copies verbatim from the snapshot.
- **F271 → `legacyStatusFile` fallback** — research rows silently fell through to `feature-<id>-<agent>.json` when the canonical path was missing. Fix: canonical path only; missing file = no status.
- **F285 → F293 → F294** — three features in a row on the same bug class. Snapshotless features first got a silent read-only `LEGACY_MISSING_WORKFLOW` degrade, then kept producing follow-on gaps. The final cut (F294) collapses both `COMPAT_INBOX` and `LEGACY_MISSING_WORKFLOW` into one `MISSING_SNAPSHOT` state with no actions and no badge — forcing producer fixes instead of papering over them.
- **F294 + `b1db12d3` → F296** — deleting `COMPAT_INBOX` was correct, but create still produced slug-keyed inbox specs with no snapshot, so `b1db12d3` had to re-derive inbox actions from folder stage. F296 closes the producer gap: create bootstraps inbox snapshots immediately and prioritise re-keys slug → numeric under one shared workflow helper.
- **jvbot duplicate-match (2026-04-20)** — `listVisibleSpecMatches` accepted any `/^\d+-/` folder, so a stale pre-rename `04-done/` sibling caused the resolver to return two spec copies. Fix: tight allow-list (`CANONICAL_STAGE_DIRS` in `lib/workflow-core/paths.js`).

**Rule:** When adding a new read path, grep for every parallel write path that produces the state it now assumes, and pin the invariant with a test. When a read path can't find the state it needs, **fail loudly and cite the repair command** (`aigon doctor --fix`) — do not add a silent fallback or a half-state.

## Install Architecture
`aigon install-agent` writes **only aigon-owned files** — it never touches `CLAUDE.md` or `AGENTS.md` (after initial scaffold).

**Per-agent outputs:**
- **cc**: `.claude/commands/aigon/*.md`, `.claude/settings.json` (permissions + hooks), `.claude/skills/aigon/SKILL.md`
- **gg**: `.gemini/commands/aigon/*.toml`, `.gemini/settings.json` (hooks), `.gemini/policies/aigon.toml`
- **cx**: `.agents/skills/aigon-*/SKILL.md` (project-local), `.codex/config.toml`. Codex also needs exact-path trust entries in `~/.codex/config.toml` for each worktree; trusting only `~/.aigon/worktrees/<repo>` is not enough for child worktrees to inherit the repo `.codex/config.toml`.
- **cu**: `.cursor/commands/aigon-*.md`, `.cursor/cli.json`, `.cursor/hooks.json`, `.cursor/rules/aigon.mdc`
- **op**: `.agents/skills/aigon-*/SKILL.md` (project-local). OpenCode is a router/harness; Aigon does not own its config or hardcode a default model — model/provider selection stays in the user's OpenCode config. Aigon-spawned sessions use `opencode run "<inline prompt body>"` via the shared non-slash launch path (see `lib/agent-prompt-resolver.js`).

**Shared:** `AGENTS.md` (scaffolded on first install only, never overwritten), `docs/agents/{agent}.md` (marker blocks), `docs/development_workflow.md` (full overwrite)

**Context delivery** (no root file injection):
- CC/GG: SessionStart hook `aigon project-context` prints doc pointers to stdout → agent ingests as conversation context
- CU: `.cursor/rules/aigon.mdc` with `alwaysApply: true`
- CX: `.codex/prompt.md` with marker blocks; aigon-spawned Codex sessions inline template bodies directly

**Auto-update**: SessionStart hook `aigon check-version` detects version mismatch → runs `aigon update` → re-runs `install-agent` for all detected agents

## Aigon Pro (`@aigon/pro`)
- **Private repo**: `~/src/aigon-pro`
- **Two integration files only**: `lib/pro.js` (lazy-require gate) and `lib/pro-bridge.js` (extension point). New Pro features extend the bridge — never add `getPro()` calls elsewhere.
- **Bridge contract**: `proBridge.initialize({ helpers })` at server start invites Pro to `register(api)`. `api.registerRoute(method, path, handler)` is the current shape.
- **Dev setup**: `cd ~/src/aigon-pro && npm link`, then `cd ~/src/aigon && npm link @aigon/pro`
- See `docs/architecture.md` § "Aigon Pro" for full details

### Pro feature specs live in aigon-pro
`aigon feature-create` inside aigon-pro writes there automatically. Historical Pro features that were moved out are listed in `docs/specs/features/MOVED-TO-AIGON-PRO.md`.

### Cross-repo features
A feature whose primary purpose is Pro behavior but that needs to edit OSS aigon code — the spec lives in aigon-pro. In the aigon commit, add this footer:

```
Cross-repo: aigon-pro feature N
```

## Where To Add Code
- **New command** → `lib/commands/{domain}.js`
- **Parallel feature + research command** → `lib/commands/entity-commands.js` (factory auto-generates both `feature-*` and `research-*` variants; avoids drift). Entity-specific extras (feature-create's `--agent`, feature-close's Fleet logic, research-open) stay in their respective command module as overrides after the factory spread.
- **Shared logic (2+ commands)** → `lib/{domain}.js` (most specific owner)
- **Constants / command metadata** → `lib/constants.js`
- **Agent prompts or install content** → `templates/`; run `aigon install-agent cc` after
- **Workflow state changes** → update command module AND affected templates together

## Resetting / Cancelling Work
**To start a feature over — there is ONE command:**

```
aigon feature-reset <ID>
```

It runs the entire sequence: `sessions-close` (kill processes, tmux, preview dashboards, Warp tabs) → remove worktrees → delete branches → clear `.aigon/state/feature-<id>-*` → move spec back to `02-backlog/` → clear workflow-core engine state → GC dev-proxy entries.

**Do not stitch this together manually** with `feature-cleanup` + `git mv` + `rm -rf .aigon/workflows/...`. That path leaks autonomous tmux sessions and predates `feature-reset`.

`feature-cleanup <ID>` is a strict subset (worktrees + branches) — use to GC Fleet branches after `feature-close`. `sessions-close <ID>` is a subset too; `feature-reset` calls it internally.

**Research reset**: `aigon research-reset <ID>` — analogous full reset for research topics.

## Publishing Branches & Remote Review Gate
`aigon feature-push [ID] [agent]` pushes the feature branch to `origin` with upstream tracking. It does not alter workflow state.

When `origin` is GitHub and `gh` is available, `feature-close` does a best-effort PR check:
- No PR found: normal local close
- Open PR found: `feature-close` blocks so Aigon does not bypass remote review
- Merged PR found: syncs `main`, writes close-state commit, pushes, cleans up

## Rules Before Editing
1. **Run args verbatim** — pass exactly the args the user gave; never add agents/flags from context
2. **Filter `.env.local`** — never let it block `feature-close` or `aigon agent-status submitted`
3. **Screenshot dashboard changes** — take a Playwright screenshot after any `templates/dashboard/index.html` edit
4. **Restart after backend edits** — after changing any `lib/*.js`, run `aigon server restart`
5. **Don't move spec files manually** — always use `aigon` CLI commands to transition state
6. **Update docs when you change architecture** — new modules/patterns/repo structure → update `AGENTS.md` (and `docs/architecture.md`) in the same PR
7. **Use the `frontend-design` skill for ALL visual work** — see below
8. **Never add action buttons or eligibility logic in dashboard frontend files** — all actions (workflow AND infra) must be defined in the central action registry (`lib/feature-workflow-rules.js` / `lib/research-workflow-rules.js`). The frontend renders actions from the `validActions` API response only.
9. **Fix the class, not the instance.** When a bug surfaces on feature / entity N, the question is *"what mechanism produced this state, and how do I delete that mechanism so N+1 doesn't hit the same bug"* — not *"how do I unblock N right now."* Apply a one-off fix only when you've also fixed (or explicitly filed a feature for) the root cause in the same response. **Never leave "worth a follow-up feature" as prose in chat** — that's how the same bug hits a different entity a day later (F285 → F293 on 2026-04-21: identical legacy-missing-snapshot state, same unfiled follow-up, predictable recurrence). Choose one: fix the producer now, OR file the feature now. Don't do neither.
10. **Check `## Pre-authorised` before stopping on a policy gate.** Before pausing to ask about a test-budget ceiling, security warning, or ambiguous criterion, read the spec's `## Pre-authorised` section. If the gate matches a listed line, proceed and include `Pre-authorised-by: <slug>` in the commit footer. If no line matches, stop and ask as normal.

## Testing Discipline (non-negotiable)

### T1 — run the test suite before pushing
Before any `git push` of a feature branch to `origin`, run:

```bash
npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh
```

All three must pass. Do NOT push with a failing suite. Do NOT skip hooks with `--no-verify`. Applies to `aigon agent-status submitted`, `feature-close`, and any direct `git push`.

### T2 — new code ships with a test
New modules, new exported functions with non-trivial logic, and bug fixes ship with a test in the same commit. Exceptions: pure config, pure docs, pure template edits, system-integration code (launchd, signals, sockets) — and state the exception in the commit message. Every new test includes a one-line comment naming the specific regression it prevents (`// REGRESSION: ...`).

### T3 — test suite hard ceiling
Total LOC in `tests/` must stay ≤ **2,500** (default in `scripts/check-test-budget.sh`). Enforced by `scripts/check-test-budget.sh`. Before adding a test, first check whether an older one can be deleted (integration test subsumes unit; code rewritten; duplicated coverage). Forbidden patterns: snapshot tests, mock-heavy tests where mock setup > assertion count, trivial-getter tests, private-implementation tests. Escape valve: if you hit the ceiling and genuinely need to add, ask the user for a one-time bump — never raise the ceiling silently; raising the default requires deleting at least one test file in the same commit (enforced by the budget script).

## Frontend & Visual Design Rules
**MANDATORY: Always invoke `Skill(frontend-design)` before editing any visual component** — page layouts, CSS, component styling, colors, typography, spacing, borders, shadows.

Process: invoke the skill → use shadcn/ui components where available → verify with a Playwright screenshot → compare side-by-side against the reference design if one exists. Never hand-write CSS or guess at Tailwind classes.

## Common Agent Mistakes
- **Inventing args**: adding `cc` or `--iterate` to a plain command → wrong mode (Drive vs Fleet)
- **Breaking dashboard visually**: passing syntax check but not verifying rendered UI → ships broken tabs
- **Complexity for simplicity**: responding to "simplify" with smarter/more code instead of removing code
- **`.env.local` blocking flow**: treating it as uncommitted changes → blocks `feature-close`
- **Editing working copies**: changing `.claude/commands/` instead of `templates/` → lost on next sync
- **Manual feature reset**: stitching `feature-cleanup` + `git mv` + `rm -rf .aigon/workflows/...` → use `aigon feature-reset <ID>` instead
- **Hardening a read path without auditing parallel write paths**: repeated source of bugs (`1c2766bc`, `cbe3aeba`, `b9c39a26`). Always grep every write path that produces the state.
- **Shipping architecture changes without docs**: adding modules, repos, or patterns without updating `AGENTS.md` / `docs/architecture.md` → next agent has no awareness of the change

## Reading Order
1. `AGENTS.md` (this file) — quick orientation
2. `docs/architecture.md` — full module docs, ctx details, design rules
3. `docs/development_workflow.md` — feature/research lifecycle
4. Active feature spec: `aigon feature-spec <ID>`
5. Agent-specific notes: `docs/agents/{id}.md`
