# Aigon Architecture

## Purpose

This document gives agents and contributors a fast map of the Aigon codebase. It focuses on where workflow state lives, how the CLI is structured, and where new code should go.

## Repository Layout

- `aigon-cli.js`: thin CLI entrypoint. It parses argv, resolves aliases, dispatches commands, and handles top-level async errors.
- `lib/`: shared implementation modules used by the CLI.
- `lib/commands/`: command-family handlers. This is where most command behavior should live.
- `templates/`: prompt, docs, agent, and spec templates used by install and scaffolding commands.
- `templates/dashboard/`: dashboard UI assets — `index.html`, ordered stylesheets under `styles/` (concatenated by the server at `/styles.css`, order defined by `styles/manifest.json` — F628), native ES modules under `js/` (single entry `js/main.js` — F623), and vendored third-party libraries under `js/vendor/` (Alpine, marked, Chart.js, xterm — no CDN fetches, F627). All are read fresh on every request, so frontend-only changes do not require a server restart. See **Dashboard Frontend** below for the full client architecture.
- `tests/`: automated test suites. `tests/integration/` and `tests/workflow-core/` are the core non-browser suites; `tests/dashboard-e2e/` contains Playwright E2E tests (the slow browser tier).
- `docs/specs/`: workflow state for features, research, feedback, logs, and evaluations.
- `.aigon/docs/`: aigon-vendored documentation installed into consumer projects (F421). Includes `development_workflow.md`, `feature-sets.md`, and `agents/<id>.md` per installed agent. Marker blocks in `agents/<id>.md` are updated by `install-agent`. The consumer's own `docs/` folder is never touched.
- `AGENTS.md`, `CLAUDE.md`, `README.md`: user-owned. Aigon does not write or modify these (F420). Discovery happens via per-agent skill descriptions and always-loaded rule files installed under `.claude/`, `.cursor/`, etc.

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
| `lib/commands/feature.js` | Thin dispatcher for `feature-*` handlers + `sessions-close`. Fat handlers delegate to sibling `lib/feature-*.js` modules via a shared `handlerDeps` bundle. Uses `withActionDelegate` from `action-scope` for the main-repo delegation guard. Parallel-with-research handlers (create, prioritise, spec-review quartet, reset base) come from `./entity-commands` via factory spread |
| `lib/feature-start.js`, `lib/feature-eval.js`, `lib/feature-do.js`, `lib/feature-autonomous.js` | Extracted implementation/eval/autonomous handler modules. Each exports `run(args, deps)` — `deps.ctx` gives access to utils/git/hooks/specCrud; `deps` also surfaces the local closures still owned by the parent dispatcher (`persistAndRunEffects`, `resolveFeatureMode`, `resolveMainRepoPath`, etc.) |
| `lib/feature-close.js` | Feature-close target resolution, merge, telemetry, engine close, cleanup, and close command orchestration |
| `lib/feature-lifecycle.js`, `lib/feature-now.js`, `lib/feature-open.js`, `lib/feature-backfill-timestamps.js` | Extracted feature pause/resume/unprioritise, fast-track create, worktree open, and timestamp backfill handlers |
| `lib/feature-command-helpers.js` | Shared helpers for feature handlers: log frontmatter helpers, scope estimation, and submission evidence (`getFeatureSubmissionEvidence`) |
| `lib/commands/research.js` | All `research-*` handlers. Parallel-with-feature handlers come from `./entity-commands` via factory spread |
| `lib/commands/entity-commands.js` | Shared factory for parallel feature/research lifecycle commands parameterised by `FEATURE_DEF` / `RESEARCH_DEF` from `lib/entity.js`. Exposes `createEntityCommands(def, ctx)` (create, prioritise, spec-review quartet) and `entityResetBase(def, id, ctx, hooks)` for reset plumbing. New parallel commands are added here — not in feature.js/research.js — so both entities pick them up by construction, eliminating the "defined but not whitelisted" drift class |
| `lib/commands/feedback.js` | `feedback-create`, `feedback-list`, `feedback-triage` |
| `lib/commands/infra.js` | `server`, `terminal-focus`, `board`, `proxy`, `proxy-setup`, `dev-server`, `config`, `hooks`, `profile`, `vault`, and the Pro-delegating `sync` / `backup` stubs |
| `lib/commands/setup.js` + `lib/commands/setup/*.js` | Setup dispatcher and per-command entry modules for `init`, `install-agent`, `remove`, `check-version`, `apply`, `update` (deprecated alias), `project-context`, `doctor`, seed commands, and setup checks. Shared helpers live under `lib/commands/setup/` (`init-bootstrap.js`, `seed-reset.js`, `gitignore-and-hooks.js`, etc.). |
| `lib/commands/agent-signals.js` | Agent lifecycle and operator signals: `agent-status`, `agent-context`, `agent-resume`, `nudge`, `check-agent-signal`, `check-agent-submitted`, `force-agent-ready`, `drop-agent` |
| `lib/commands/ops.js` | Operational commands: `repair`, `status`, `deploy`, `session-list`, `agent-probe`, `agent-quota`, `next`, `help`, `rollout`, `workflow-rules` |
| `lib/commands/insights.js` | Analytics and telemetry commands: `insights`, `stats`, `commits`, telemetry capture, and `token-window` |
| `lib/commands/workflow.js` | `workflow` definition CRUD and reporting |
| `lib/commands/set.js` | `set-*` feature-set actions and derived set operations |
| `lib/commands/signal-health.js` | `signal-health` diagnostics over signal telemetry |
| `lib/commands/security-scan.js` | Standalone `security-scan` CLI surface |
| `lib/commands/pro.js` | `pro activate/status` free-tier activation/status commands |
| `lib/commands/recurring.js`, `lib/commands/schedule.js`, `lib/commands/agent-launch.js` | OSS stubs that delegate to `@aigon/pro` when installed, otherwise print the standard "Pro feature — coming later" notice |

`aigon-cli.js` is the executable's authoritative composition point: it imports and spreads every command factory above into the runtime command map. `lib/commands/shared.js` still exists for tests and legacy helper callers that need a ctx-overridable command map; do not assume it includes every user-facing command wired by the executable.

### The ctx pattern

Commands receive dependencies via a `ctx` object rather than flat destructuring:

```js
// lib/commands/shared.js builds ctx for ctx-aware command domains
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
- `lib/agent-status.js` (~130 lines): per-agent status file I/O in `.aigon/state/`, atomic JSON writes, signal-health observation, candidate ID resolution, and dashboard-facing state reads
  `readAgentStatus`, `writeAgentStatus`, `writeAgentStatusAt`, `agentStatusPath`, `getStateDir`, `getLocksDir`
- `lib/signal-health.js` (~280 lines): append-only signal reliability telemetry in `.aigon/telemetry/signal-health/*.jsonl`, summary reads, missed-signal de-duplication, and doctor GC helpers
  `recordSignalEvent`, `readSignalEvents`, `summarizeSignalEvents`, `recordMissedSignalIfDue`, `gcSignalHealth`
- `lib/auto-nudge.js` (~190 lines): dashboard-side idle ladder. Combines idle-at-prompt detection with stale agent status writes, derives visible idle / nudged / needs-attention state, optionally sends one nudge per session, and records signal-health telemetry.
  `computeIdleLadder`, `pauseAutoNudgeForSession`
- `lib/agent-prompt-resolver.js` (~140 lines): shared feature prompt resolution for agent launches; preserves configured slash-command prompts for slash-invocable agents (cc/cu) and inlines the canonical `templates/generic/commands/feature-*.md` body for non-invocable agents (cx/op/km/ag). Membership is derived from `capabilities.resolvesSlashCommands` in each `templates/agents/<id>.json`, so adding a new agent requires no code change here
  `resolveAgentPromptBody`, `resolveCxPromptBody`
- `lib/state-queries.js` (~250 lines): read-only UI helpers — feedback action/transition derivation (pure, no I/O). Feature/research constants retained for diagram generation only; action derivation for features/research lives in workflow-core.
  `getValidTransitions`, `getAvailableActions`, `getSessionAction`, `getRecommendedActions`, `isActionValid`, `shouldNotify`
- `lib/feature-spec-resolver.js` (~200 lines): canonical feature/research visible-spec lookup so consumers stop guessing from visible folders or hardcoding dashboard folder scans
  `resolveEntitySpec`, `resolveFeatureSpec`, `resolveResearchSpec`
- `lib/spec-review-state.js` (~120 lines): shared spec-review helpers for commit parsing, reviewer validation, and workflow-facing pending-review summary shaping
  `parseSpecReviewSubject`, `extractSpecReviewerId`, `buildSpecReviewSummary`, `readHeadSpecReviewCommit`
- `lib/spec-reconciliation.js` (~130 lines): shared self-healing spec projection helper for feature/research workflow drift and feedback status->folder drift, reused by dashboard/list read paths and `aigon repair`
  `reconcileEntitySpec`
  `resolveFeatureSpec`, `listVisibleFeatureSpecs`, `isPlaceholderSpecPath`
- `lib/action-command-mapper.js` (~75 lines): shared command formatting for dashboard and board consumers so snapshot reads emit the same CLI actions
  `formatActionCommand`
- `lib/dashboard-status-helpers.js` (~200 lines): shared dashboard status helpers so tmux detection, worktree lookup, and stale-session heuristics are not buried in the HTTP server module
  `safeTmuxSessionExists`, `resolveFeatureWorktreePath`, `normalizeDashboardStatus`, `maybeFlagEndedSession`
- `lib/auto-session-state.js` (~100 lines): durable autonomous run-state helpers so feature and set conductor status survive tmux/session loss and can be reported by the dashboard/CLI
  `readFeatureAutoState`, `writeFeatureAutoState`, `clearFeatureAutoState`, `readSetAutoState`, `writeSetAutoState`, `clearSetAutoState`
- `lib/dashboard-status-collector.js` (~2,300 lines): shared AIGON server read-side collector so repo/entity status assembly, dashboard detail log reads, done-count aggregation, and derived set-card payloads stay separated from HTTP transport and notification code, including metadata-authoritative feedback status reads
  `collectDashboardStatusData`
- `lib/feature-set-workflow-rules.js` (~60 lines): central read-side action registry for set dashboard cards. Owns `set-autonomous-{start,stop,resume,reset}` eligibility and button metadata; the frontend renders only the returned `validActions`.
  `buildSetValidActions`
- `templates/dashboard/js/autonomous-plan.js` (~80 lines): shared dashboard renderer for the server-owned autonomous stage timeline so card markup stays pure and testable outside the full browser bundle
  `buildAutonomousPlanHtml`
- `templates/dashboard/js/set-cards.js` (~100 lines): shared dashboard renderer for set cards and the dep-graph mini-view so SVG/layout markup is testable outside the full browser bundle.
  `buildSetCardBodyHtml`, `buildSetDepGraphSvg`
- **F519 dashboard action split** (`templates/dashboard/js/actions.js` + `actions/`): `actions.js` is the action dispatch shell (`renderActionButtons`, `handleFeatureAction`, `handleSetAction`, `showNudgeModal`) with lazy `import()` of modules under `templates/dashboard/js/actions/<action>.js` (`open(ctx)` / optional `close(ctx)`). Shared triplet/picker DOM helpers live in `actions-picker.js`; budget/quota widget in `budget-widget.js`. Action modules receive `ctx.helpers` / `./shared.js` — they must not rely on unqualified globals.
- `lib/server-runtime.js` (~90 lines): shared AIGON server lifecycle helpers extracted from infra command wiring
  `launchDashboardServer`, `stopDashboardProcess`
- `lib/validation.js` (~1,115 lines): Iterate (Autopilot) loop and smart validation helpers
  `runRalphCommand`, `runSmartValidation`, `parseAcceptanceCriteria`, `runFeatureValidateCommand`
- `lib/agent-quota-read.js` / `lib/agent-quota-poller.js`: unified agent-quota state and poller. Reads/writes `.aigon/state/agent-quota.json`, merges legacy budget/quota state during doctor migration, coordinates budget scrapes, headless probes, and provider HTTP polling, and exposes the surviving dashboard API at `GET /api/agent-quota` / `POST /api/agent-quota/refresh`.
  `readAgentQuotaState`, `readFilteredAgentQuotaState`, `patchAgentQuotaState`, `startAgentQuotaPoller`, `triggerRefresh`
- `lib/quota-probe.js`: probe classifier and `scripts/probe-agent.js` integration for model availability verdicts consumed by the unified poller.
  `classifyProbeResult`, `probePair`, `probePairAsync`, `listTargets`
- `lib/budget-poller.js`: scrape primitives for agent budget surfaces consumed by `lib/agent-quota-poller.js`; no standalone poller or cache writer.
  `pollClaudeBudget`, `pollCodexBudget`, `pollKimiBudget`, budget parsers

**Domain modules** (logic lives in the module itself):

- `lib/proxy.js` (~865 lines): Caddy management (Caddyfile generation, route add/remove, reload), port allocation, dev server utilities
  `writeCaddyfile`, `addCaddyRoute`, `removeCaddyRoute`, `reloadCaddy`, `allocatePort`
- `lib/dashboard-server.js` (~1,530 lines): AIGON server HTTP/UI shell — serves dashboard HTML/static assets, orchestrates status refresh (fs-watch driven + 60s safety-net interval poll), handles WebSocket relay, notifications, screenshots, and OSS/Pro route dispatch. It delegates dashboard-triggered mutations to `lib/dashboard-actions/`, detail/settings/static helper work to focused modules, and status versioning / push / watch / styles to the four F620–F628 modules below.
  `runDashboardServer`, `buildDashboardHtml`
- `lib/dashboard-status-version.js` (~120 lines, F620): server-side structural fingerprint of the status payload + monotonic `statusVersion`, cached serialized body, and `If-None-Match`/ETag helpers so `/api/status` answers unchanged polls with a 0-byte 304.
  `createStatusSnapshotStore`, `computeStatusFingerprint`, `ifNoneMatchSatisfied`
- `lib/dashboard-sse.js` (~90 lines, F622): SSE hub for `GET /api/events` — broadcasts `status` (version ping → client does a conditional fetch), `notification`, and `server-restarting` events to connected dashboards.
  `createDashboardSseHub`
- `lib/dashboard-fs-watch.js` (~340 lines, F621): debounced (400ms) filesystem watchers on `.aigon/state`, `.aigon/workflows`, and the spec stage trees per registered repo; each event triggers a targeted `pollRepoStatus(repoPath)`. Recursive `fs.watch` on macOS, per-directory fallback on Linux; failures fall back to the interval poll. Opt-out via `dashboard.fsWatch: false` (global or per-repo config).
  `createDashboardFsWatch`, `resolveRepoWatchPaths`
- `lib/dashboard-styles.js` (~80 lines, F628): concatenates the ordered sheets in `templates/dashboard/styles/` (order from `styles/manifest.json`) for the `/styles.css` route, with an mtime-keyed cache. A missing manifest entry throws — new sheets must be registered in the manifest.
  `concatDashboardStyles`
- `lib/dashboard-actions/` (~550 lines): dashboard action boundary for session launch, interactive CLI action execution, nudges, agent control, and mark-complete workflow signals.
  `handleLaunchReview`, `handleLaunchSpecReview`, `handleLaunchEval`, `handleLaunchCloseResolve`, `handleLaunchImplementation`, `runDashboardInteractiveAction`
- `lib/dashboard-detail.js`, `lib/dashboard-settings.js`, `lib/dashboard-pro-assets.js`, `lib/dashboard-action-command.js`: focused helpers for detail drawer payloads, settings schema resolution, Pro dashboard asset/stub resolution, and `/api/action` parsing/validation.
- `lib/dashboard-routes.js` (~60 lines): thin aggregator — composes the per-domain route modules in `lib/dashboard-routes/` and exposes the dispatcher
  `createDashboardRouteDispatcher`
  - `analytics.js` — analytics, telemetry, signal-health, weekly autonomy trend endpoints
  - `commits.js` — `GET /api/feature/:id/commits` — git commits for a feature at any lifecycle stage; resolves from worktree (in-progress) or merge commit on main (done)
  - `config.js` — config read/write endpoints (`/api/config/*`)
  - `entities.js` — feature/research/feedback CRUD endpoints
  - `events.js` — `GET /api/events` SSE live push channel (F622)
  - `recommendations.js` — `/api/recommendation/*` (spec-frontmatter-driven start-modal defaults)
  - `sessions.js` — tmux/session endpoints, PTY token issuance
  - `system.js` — health, version, repo metadata
  - `transcripts.js` — agent transcript records + per-session transcript download endpoints (reads via `lib/transcript-read.js`)
  - `version-status.js` — `GET /api/version-status` repo/multi-repo upgrade-drift snapshot for the dashboard chrome upgrade pill (F499)
  - `util.js` — shared response helpers + the route-table builder consumed by the aggregator
- `lib/doctor/` — `aigon doctor` implementation, extracted from `lib/commands/setup.js` into its own module dir:
  - `report.js` (F550) — `DoctorReport`, the structured issue collector + triage digest; the severity table is the single source of truth and sections call `report.issue({ section, check, message, fix })`
  - `fix-dispatch.js` (F552) — consent-driven fix dispatch for `aigon doctor --fix` (per-issue prompts, fix summary, manual-issue printing)
  - `scopes.js` (F552) — scoped doctor views: parses scope/detail flags from argv (`parseDoctorScopes`, `sectionInScope`)
- `lib/worktree.js` (~2,300 lines): worktree creation, permissions, git attribution metadata bootstrap; **tmux compatibility facade** (F554) — re-exports `lib/agent-sessions/names.js`, `createDetachedTmuxSession` delegates to `TmuxSessionHost`
  `setupWorktreeEnvironment`, `ensureAgentSessions`, `buildTmuxSessionName`, `openSingleWorktree`
- `lib/set-conductor.js` (~500 lines): detached set-level autonomous sequencer (`set-autonomous-start|stop|resume|reset`) that resolves set members in topo order, delegates each member to `feature-autonomous-start`, and persists `.aigon/state/set-<slug>-auto.json`
  `run`, `resolveSetExecutionPlan`, `buildSetAutoSessionName`
- `lib/supervisor.js` (~430 lines): server monitoring — liveness from tmux + heartbeat, idle/awaiting-input notifications, and token-exhaustion handling (F308) that may append workflow events, pause a feature, or auto-switch an agent slot per `agentFailover` policy
  `startSupervisorLoop`, `sweepEntity`, `getAgentLiveness`
- `lib/agent-failover.js` (~140 lines): token-exhaustion signal construction, failover chain selection, handoff prompt text, and clearing per-slot status flags after a switch
  `buildTokenExhaustionSignal`, `chooseNextAgent`, `buildFailoverPrompt`, `clearTokenExhaustedFlag`
- `lib/terminal-adapters.js` (~200 lines): data-driven terminal detection/dispatch — adapter table with `detect(env)`, `launch(cmd, opts)`, `split(configs, opts)` per terminal. **Registry API** (F350): each macOS adapter carries `id`, `displayName`, `pickerLabel`, `platforms`, `aliases`, `hiddenFromPicker` — all consumer surfaces (dashboard enum, onboarding picker, display-name map, canonicaliser, help text) derive from this single source. Adding a new terminal requires only a new adapter object here. **Background launch (F520)**: `launch(cmd, { background })` threads through every macOS adapter — `background: true` (the default, controlled by `terminal.focusOnLaunch`) drops `activate` lines and wraps the AppleScript with a `wrapBackgroundAppleScript` capture/restore-frontmost frame so the user's focus is preserved. Warp uses `open -g` instead. Linux is unaffected — newly-spawned windows obey the WM's focus-stealing-prevention policy, which aigon does not try to override.
  `findAdapter`, `getAdapter`, `tileITerm2Windows`, `closeWarpWindow`, `getTerminalIds`, `getPickerOptions`, `getDashboardOptions`, `getDisplayName`, `canonicalize`, `isValidId`, `registerAdapter`, `wrapBackgroundAppleScript`
- `lib/config.js` (~1,395 lines): global/project config, profiles, agent CLI config, editor detection, and runtime compatibility for legacy `terminal`/`tmuxApp` reads while `terminalApp` rolls out
  `loadGlobalConfig`, `loadProjectConfig`, `getActiveProfile`, `getEffectiveConfig`, `getAgentCliConfig`, `isAgentDisabled`
- `lib/config-core.js`: leaf config file I/O and default config primitives used by lower layers that must not import the config facade
  `loadGlobalConfig`, `loadProjectConfig`, `saveGlobalConfig`, `saveProjectConfig`, `buildDefaultGlobalConfigBase`
- `lib/config-agent-layer.js` (~65 lines): agent-aware config composition above config-core + agent-registry; `lib/config.js` imports this instead of agent-registry directly, breaking the facade↔registry require cycle
  `buildDefaultGlobalConfig`, `getAgent`
- `lib/global-config-migration.js` (~150 lines): machine-wide `~/.aigon/config.json` migration registry and runner; write-once backups + schemaVersion tracking for global config renames
  `registerGlobalConfigMigration`, `runPendingGlobalConfigMigrations`, `migrateLegacyTerminalSettings`
- `lib/templates.js` (~550 lines): template loading, command registry, scaffolding, content generation
  `readTemplate`, `processTemplate`, `readGenericTemplate`, `formatCommandOutput`, `COMMAND_REGISTRY`
- `lib/safe-write.js`: leaf atomic file-write helpers shared by template/setup code without importing the utils facade
  `safeWrite`, `safeWriteWithStatus`
- `lib/binary-check.js`: leaf PATH probe for CLI availability checks without importing security/config layers
  `isBinaryAvailable`
- `lib/utils.js` (~183 lines): thin re-export hub for config/proxy/worktree/templates/git, feedback constants, dev-server URL, and safe-write helpers. Do not add domain logic here — route new code to its domain module instead. It does not re-export dashboard-server.
  `safeWrite`, `safeWriteWithStatus`, `setTerminalTitle`, `resolveDevServerUrl`, `FEEDBACK_STATUS_TO_FOLDER`
- `lib/hooks.js` (~146 lines): hook lifecycle — parses `.aigon/hooks.json`, executes pre/post hooks
  `parseHooksFile`, `getDefinedHooks`, `executeHook`, `runPreHook`, `runPostHook`
- `lib/analytics.js` (~960 lines): usage analytics — log parsing, completion series, autonomy trend
  `collectAnalyticsData`, `parseLogFrontmatterFull`, `buildCompletionSeries`, `buildWeeklyAutonomyTrend`
- `lib/version.js` (~154 lines): version management — reads/writes installed version, semver compare, changelog excerpts, origin-behind hint for CLI checkout
  `getAigonVersion`, `getInstalledVersion`, `compareVersions`, `getChangelogEntriesSince`, `checkAigonCliOrigin`
- `lib/spec-crud.js` (~247 lines): spec file operations — find, move, create, modify, section-read
  `findFile`, `findUnprioritizedFile`, `moveFile`, `modifySpecFile`, `getNextId`, `createSpecFile`, `readSpecSection`
- `lib/cli-parse.js` (~256 lines): CLI option parsing + YAML/frontmatter helpers — stateless, no I/O
  `parseCliOptions`, `getOptionValue`, `parseFrontMatter`, `serializeYamlScalar`, `slugify`, `escapeRegex`
- `lib/deploy.js` (~65 lines): deploy command resolution — reads config/package.json, runs deploy/preview
  `resolveDeployCommand`, `runDeployCommand`
- `lib/repo-identity.js` (~40 lines): identifies when a command is running inside the Aigon source repo itself (vs a consumer project) so install/scaffold behavior is skipped here
  `isAigonSourceRepo`

> **Moved to Pro:** the solo multi-laptop sync engine (`sync.js`, `sync-merge.js`) moved to `@aigon/pro` with feature 236 (2026-04-27), alongside backup and scheduling. `aigon sync` / `aigon backup` are now Pro-delegating stubs in `lib/commands/infra.js`. See "Scheduling and recurring work" below.

**Additional modules:**

- `lib/telemetry.js` (~1,735 lines): normalized session telemetry — common schema across all agents (agent, model, tokens, cost, turns, duration), records to `.aigon/telemetry/`
  `writeNormalizedTelemetryRecord`, `captureFeatureTelemetry`
- `lib/security.js` (~131+ lines): merge gate scanning — runs gitleaks + semgrep at feature-close/submit, severity-aware thresholds, diff-aware scanning, graceful degradation
  `runSecurityScan`, `parseSemgrepOutput`, `formatSemgrepFindings`
- `lib/remote-gate-github.js` (~170 lines): GitHub PR gate for feature-close — queries `gh pr list` for the feature branch, returns a provider-neutral result shape. If a PR is open, feature-close blocks. If merged, feature-close syncs local main from origin. Degrades to local close when `gh` is unavailable or remote is not GitHub.
  `checkGitHubGate`, `queryPrList`, `getOriginUrl`, `isGitHubRemote`
- `lib/nudge.js` (~250 lines): shared operator-to-agent message channel for CLI and dashboard. Resolves tmux sessions from workflow-backed entity state, delivers text atomically with tmux paste-buffer, confirms pane echo, rate-limits per session, and records `operator.nudge_sent` workflow events.
  `sendNudge`, `resolveSessions`, `resolveSubmitKey`
- `lib/entity.js`: entity pipeline — shared feature/research processing, dependency parsing (`depends_on` frontmatter), DFS cycle detection at prioritise time
  `parseFrontMatter`, `resolveDependencies`, `detectCycles`
- `lib/research-draft.js` (~180 lines): agent-assisted research draft flow — mirrors `lib/feature-draft.js`. Spawns the configured agent with `templates/prompts/research-draft.md`, validates CLI availability, computes a file hash before and after, and reports whether the spec was edited. Called by `entityCreate` when `entityType === 'research'` and `--agent` is passed.
  `runResearchDraft`

**Thin re-export facades:**

- `lib/constants.js`: re-exports command metadata and path constants (used by `aigon-cli.js`)

## SpecStore (`lib/spec-store/`)

Durable spec storage boundary introduced in feature 573 and extended through the git-branch storage set (609-613). Specs are the top-level work objects; `feature` and `research` are spec kinds addressed by keys (`F42`, `R43`). See **[`docs/specstore-architecture.md`](specstore-architecture.md)** for the current model (events, snapshots, leases, indexes, projections) and layering:

- **SpecStore** — durable storage protocol (`listSpecs`, `readSpec`, `readEvents`, `appendEvent`, `readSnapshot`, `writeSnapshot`, `lock`, `sync`, `health`, lease helpers)
- **workflow-core** — lifecycle semantics (XState machine, projector, effects)
- **Spec markdown files** — human/agent-facing projections carried by normal Git
- **Stage folders** — derived from lifecycle for UX, not authoritative state

Backends:

| Backend | Authority | Sync behavior |
|---------|-----------|---------------|
| `local` | `.aigon/workflows/**` event logs and snapshots in the current checkout | Default; no cross-machine storage sync beyond normal Git for specs/code |
| `git-branch` (F609) | Canonical events as a file tree on an orphan branch (default `aigon-state`): `meta.json` + `specs/<KEY>/events.jsonl` + `leases/<KEY>.json` | Fetched to `refs/aigon-internal/state`, union-merged by event id, pushed to `refs/heads/<branch>`; never checked out (all I/O via git plumbing). CAS lease files are authoritative on this backend (F610). |

Git-branch storage is opt-in through `.aigon/config.json` or `aigon storage convert --backend=git-branch --remote=origin`. Legacy `git-ref` config is rejected — convert first (F613). Existing numeric local workflow events are imported on first sync/convert. Mutating commands do a pre-write fetch/merge unless storage is offline (`storage.git.offline`, `--offline`, or `AIGON_STORAGE_OFFLINE=1`). Snapshots/locks stay local-projection-only.

Leases are advisory append-only `lease.*` events in the same canonical stream. Defaults are a 30 minute TTL and renew checkpoints at most every 10 minutes; `--takeover` records `lease.taken_over` for auditable conflict resolution. `aigon storage status|doctor|report`, `aigon storage sync`, and `aigon board --storage` are the public CLI surfaces. `lib/dashboard-storage.js` provides server-owned DTOs for dashboard repo/settings storage health and active feature/research lease metadata.

Projection boundaries are explicit: `.aigon/workflows/**` remains the local read cache, snapshots are disposable, spec markdown and code changes still move through normal Git (lifecycle commands and explicit `aigon repair` only — **not** storage fetch/sync projection rebuild), and analytics files such as `.aigon/workflows/**/stats.json` plus `.aigon/cache/stats-aggregate.json` are local projections/caches. Canonical `stats.recorded` events sync through git-branch storage and rebuild those local stats projections where available.

Feedback is not a top-level spec kind — it becomes research origin metadata (feature 574).

## Workflow State

The Aigon workflow now has two layers:

- Canonical feature/research spec content lives under `docs/specs/*/00-specs/` in stable-layout repositories.
- Lifecycle folders under `docs/specs/` remain the user-visible workflow stage as generated local views.
- For **features and research**, authoritative lifecycle state lives in SpecStore workflow events — under `.aigon/workflows/` for the local backend, or on the `aigon-state` branch when git-branch storage is enabled. See the SpecStore section above for backends, sync, leases, and projection boundaries.

That means "state-as-location" is a UX projection, not storage authority. Feature and research commands publish workflow events, then refresh generated lifecycle views; under stable layout they do not move canonical spec markdown for lifecycle-only transitions.

- `docs/specs/features/01-inbox` to `06-paused`
- `docs/specs/research-topics/01-inbox` to `06-paused`
- `docs/specs/feedback/01-inbox` to `06-duplicate`
- `docs/specs/features/logs/`: implementation logs
- `docs/specs/features/evaluations/`: evaluation outputs

Core rule: use the CLI to move specs between states. Do not rename or move spec files manually.

### Workflow-Core Engine (`lib/workflow-core/`)

The workflow-core engine is the sole lifecycle authority for features and research. It uses **event sourcing** — the event log is the source of truth, and all other state is derived from it.

### Event Sourcing Glossary

| Term | Aigon equivalent | Description |
|------|------------------|-------------|
| **Event log** | `events.jsonl` | Append-only file. Source of truth. Every state change is recorded as an event (`feature.started`, `signal.agent_ready`, `feature.closed`, etc.). Never edited, never deleted. |
| **Projector** | `projector.js` `projectContext()` | Replays all events from the log and rebuilds the current state. Deterministic — same events always produce the same state. |
| **Snapshot** | `snapshot.json` | Cached result of running the projector. Performance optimisation so the dashboard doesn't replay events on every poll. **Disposable** — can be deleted and rebuilt from events at any time. |
| **Aggregate** | Feature or research entity | The domain object that owns the events and enforces business rules (valid lifecycle transitions via XState machine). |
| **Read model** | Dashboard status collector | Read-optimised view shaped for the UI. Reads from snapshots, enriches with live data (tmux, dev server). |

**Key invariant:** The projector must be able to rebuild any snapshot from `events.jsonl` alone. If a snapshot is deleted, `showFeature()` / `showResearch()` replays the events and recreates it. If the projector can't handle an event type, the system is broken.

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
| `engine.js` | Full orchestration: command dispatch, event persistence, effect execution for feature + research |
| `entity-lifecycle.js` | Shared `isEntityDone(repoPath, entityType, id, folderFallback)` engine-first done-state helper (F397). Snapshot is authoritative; folder is consulted only when no engine dir exists. Also exports `engineDirExists`, `readSnapshotSync` |
| `migration.js` | Explicit pre-cutover migration helpers (idempotent lifecycle backfill to workflow-core) |
| `index.js` | Barrel export for all public API |

**Key properties:**

| Aspect | How it works |
|--------|-------------|
| State authority | Event log + projected snapshot |
| Action source | XState machine + `snapshot.can()` for workflow; bypass guards for infra/view |
| Lock model | Exclusive file creation (`wx` flag) |
| Effects | Explicit, durable, resumable lifecycle (requested → claimed → succeeded/failed) |
| Dependency | `xstate` npm package |

**State files** (gitignored local projection under `.aigon/workflows/`; canonical git-branch events live on `refs/heads/aigon-state` as `specs/<KEY>/events.jsonl`):
- `.aigon/workflows/features/{id}/events.jsonl` — append-only event log (local copy; rebuilt from the state branch on sync when git-branch storage is enabled)
- `.aigon/workflows/features/{id}/snapshot.json` — derived snapshot
- `.aigon/workflows/features/{id}/lock` — transient lock file

### Per-Feature Model/Effort Overrides (feature 291)

`feature.started` / `research.started` events carry optional `modelOverrides` and `effortOverrides` maps keyed by agent ID. The projector surfaces these as `snapshot.agents[id].modelOverride` and `snapshot.agents[id].effortOverride` so every respawn path can honour the original choice.

**Resolution precedence** (highest wins, implemented in `lib/agent-launch.js`):
1. event-log override (from `snapshot.agents[id].{model,effort}Override`)
2. workflow-stage triplet (from `lib/workflow-definitions.js` stage `agents:` object form)
3. global `aigon config models` default
4. per-agent JSON default (`templates/agents/<id>.json` `cli.models[taskType]`)
5. CLI-flag fallback / null

**Central launch helper:** Every spawn path (`feature-start`, dashboard "restart agent", autopilot iterate, AutoConductor review spawn, `feature-open`) MUST go through `buildAgentLaunchInvocation({agentId, snapshot, stageDefaultModel})`. Direct reads of `cliConfig.models[...]` in new spawn sites will silently bypass the override — this is exactly the bug the helper exists to prevent.

### Spec Frontmatter: complexity (feature 313)

Feature and research specs may carry a YAML frontmatter block with the authoring AI's **complexity** assessment only:

```yaml
---
complexity: low | medium | high | very-high
---
```

Per-agent **model and effort** defaults for the start modal are **not** stored in the spec — they are resolved at start time from `templates/agents/<id>.json` `cli.complexityDefaults[<complexity>]`, then global `aigon config models`, so provider SKUs can change without editing specs.

- **What's allowed:** `complexity` (single enum). The CLI may also maintain **`transitions:`** here for audit trail (entity commands).
- **What's not allowed:** workflow state. Lifecycle stage, agents, review status etc. live in the workflow-core snapshot — frontmatter is advisory, not authoritative. **Do not** embed `recommended_models` or other per-agent model IDs in specs (legacy fields should be removed in spec review).
- **Parser:** `lib/cli-parse.js` `parseFrontMatter`.
- **Resolver:** `lib/spec-recommendation.js` applies `agent.cli.complexityDefaults[<complexity>] → null` and exposes the per-agent recommendation via `/api/recommendation/:type/:id`.
- **Missing / malformed `complexity` is valid** — treated as "no recommendation, use config defaults" (pre-F313 behaviour preserved).
- Producers: `feature-create`, `research-create`, and `feature-spec-review` touch frontmatter. Readers: the dashboard start modal (banner + pre-selection), backlog card complexity badge.

### Spec Pre-authorisation

Feature specs may include an optional `## Pre-authorised` section after `## Validation`.

- Each bullet is a bounded standing approval for that feature only.
- Agents must check the section before stopping on a policy gate.
- If an agent proceeds under a matching line, the commit must carry a `Pre-authorised-by:` footer citing that approval.
- Blank or absent means current behavior: stop and ask.

### Agent Sessions

`lib/agent-sessions/` defines Aigon's runtime domain for long-lived interactive agent work. An `AgentSession` is the Aigon-owned record for one agent slot working in one context: an entity session for a feature or research role, or a repo-level session when no entity applies.

The domain owns runtime identity and metadata: the stable `sessionId`, category, entity reference, role, provider agent id, optional specialist profile, runtime state, host binding, paths, transcript binding, timestamps, and future-compatible metadata. It deliberately does not own feature or research lifecycle state. Workflow-core remains the authority for lifecycle transitions, while Agent Sessions describe the external interactive process that may help produce those transitions.

The current store is backwards-compatible with `.aigon/sessions/{sessionName}.json` sidecars. Legacy tmux fields such as `tmuxId` and `shellPid` are normalized into `host: { kind: 'tmux', handle }`, while remaining available on the sidecar shape for existing readers. Provider transcript fields (`agentSessionId`, `agentSessionPath`) normalize into `transcriptBinding`. Tmux is therefore one `SessionHost`, not the domain model itself.

Tmux session mechanics live in `lib/agent-sessions/hosts/tmux.js` (`TmuxSessionHost` implementing the `SessionHost` contract). Supporting modules: `names.js` (session naming/parsing), `console.js` (snapshot DTOs), `hosts/index.js` (host registry). `lib/worktree.js` keeps backwards-compatible exports and still owns worktree creation plus `buildAgentCommand` launch composition; `createDetachedTmuxSession` is a thin wrapper over the host.

New consumers should use `createAgentSessionService()` for session lookup, live session listing (`listLiveSessions`), console snapshots, and operator-message delivery — not raw tmux calls or workflow-core internals for session metadata.

Session facts that may carry lifecycle meaning go through `lib/agent-sessions/workflow-signal-bridge.js`. The rule is: `AgentSession` emits runtime facts such as `agent_session.status_reported`, `agent_session.task_completed`, `agent_session.task_failed`, and `agent_session.lost`; `WorkflowSignalBridge` maps selected facts to feature/research workflow events such as `agent-ready`, `agent-waiting`, code-review completion, or spec-review completion. Tmux hosts and shell wrappers may know role, task type, exit code, and legacy `aigon agent-status` names for compatibility, but they do not own workflow event names. `aigon agent-status` and dashboard mark-complete are compatibility adapters that record session signals first, then let the bridge dispatch lifecycle effects.

### Workflow Authority Split

The post-cutover system is easier to reason about if you separate lifecycle truth from runtime/session metadata:

| Concern | Authority | Notes |
|--------|-----------|-------|
| Feature lifecycle (`implementing`, `evaluating`, `ready_for_review`, `closing`, `done`, `paused`) | `lib/workflow-core/` snapshot + event log | Sole write path for feature lifecycle |
| Feature close failure details | `lib/workflow-core/` event log + snapshot `lastCloseFailure` projection | `feature_close.failed` on merge/push failures; `feature.close_gate_failed` only for blocking close-integrity failures. Advisory review escalation, preauth, and post-merge findings use `feature.close_finding_advisory` and do not project `lastCloseFailure`. Projector sets `lastCloseFailure` (`kind`, `conflictFiles` or `gateCommand`/`logPath`, `stderrTail`, `at`) for mechanical/blocking failures; cleared on `feature.closed`. Dashboard swaps "Close" for "Resolve & close" when `kind === 'merge-conflict'`. Blocking post-merge gate failures use `kind === 'post-merge-gate'` and enter `close_recovery_in_progress`; advisory post-merge failures update the repo-level red-main condition instead. |
| Feature close-recovery lifecycle (`close_recovery_in_progress`) | `lib/workflow-core/` snapshot + event log | F432: dashboard "Close with agent" appends `feature.close_recovery.started` (engine-first) before spawning the `role: 'close'` tmux session. Projector moves `currentSpecState` to `close_recovery_in_progress` and stores `closeRecovery { agentId, startedAt, returnSpecState, sessionName, source }`. Exit via `feature.close_recovery.ended` / `.cancelled` returns lifecycle to `ready` (machine-authoritative); `feature.close_requested` clears `closeRecovery` and transitions to `closing`. `lastCloseFailure` persists across the recovery transition (cleared only by `feature.closed`). Dashboard surfaces the role-`close` tmux session via `recoveryTmuxSession`. |
| Feature spec-review pending/acked state | `lib/workflow-core/` event log + snapshot `specReview` projection | `spec_review.*` events; dashboard reads snapshot metadata, not `git log` |
| Feature spec content path | `docs/specs/features/00-specs/` under `specLayout: stable` | Canonical Markdown path; lifecycle transitions do not move it |
| Feature spec lifecycle folders | `lib/spec-view.js` generated symlink view | User-visible reflection of engine state; disposable and locally repairable |
| Feature agent runtime status (`running`, `waiting`, `ready`, `lost`, etc.) | Engine signals plus per-agent status files in `.aigon/state/feature-{id}-{agent}.json` | Session/runtime metadata, not the lifecycle authority |
| Feature autonomous conductor runtime (`starting`, `running`, `completed`, `failed`, etc.) | `.aigon/state/feature-{id}-auto.json` plus tmux session presence | Durable proof that autonomous orchestration started, what session it used, and how it ended |
| Research lifecycle (`backlog`, `implementing`, `evaluating`, `closing`, `done`) | `lib/workflow-core/` snapshot + event log | Sole write path for research lifecycle |
| Research spec content path | `docs/specs/research-topics/00-specs/` under `specLayout: stable` | Canonical Markdown path; lifecycle transitions do not move it |
| Research spec-review pending/acked state | `lib/workflow-core/` event log + snapshot `specReview` projection | Same typed state model as features |
| Feature code-review lifecycle (`code_review_in_progress`, `code_review_complete`, `code_revision_in_progress`, `code_revision_complete`) | `lib/workflow-core/` snapshot + event log | F342: four states; `*_complete` are transient. AutoConductor polls `currentSpecState === 'code_revision_complete'` from snapshot — not the legacy `review-complete` sidecar |
| tmux session identity | `.aigon/sessions/{name}.json` sidecar (`tmuxId`, `shellPid`, `category`) | F351: `tmuxId` is the durable FK (stable across renames); `category` is `entity` or `repo`. `aigon session-list` surfaces all live sessions. Internal routing uses `-t $N` via `tmuxId` |
| agent session signal facts | `.aigon/sessions/events.jsonl` | Append-only record of runtime facts before bridge dispatch. Entries include `id`, `at`, `sessionId`, `entity`, `role`, `agent`, `eventType`, optional `status`, and payload. Duplicate completion/status facts are idempotent for workflow dispatch. |
| agent transcript binding | `.aigon/sessions/{name}.json` fields `agentSessionId` + `agentSessionPath` | F357: populated post-launch by background capture process (`lib/session-sidecar.js`). `agentSessionId` is the Claude UUID / Codex stem / Gemini sessionId; `agentSessionPath` is the full transcript path. Read as optional — absent on pre-F357 sidecars. Used by `aigon feature-do --resume` to resume a dead tmux session deterministically. |
| Feedback lifecycle | Spec folder location + command logic | Feedback does not use workflow-core |

Important distinction: `.aigon/state/` still exists after the cutover, but it is no longer the coordinator manifest system that decides feature lifecycle.

### Write-Path Contract

When a command updates workflow-backed entity state, the workflow-core write is authoritative and must succeed before any derived caches are updated. Per-agent status files in `.aigon/state/` are a read cache for dashboard/session consumers, not a fallback that can mask engine write failures. If the engine event cannot be persisted, the CLI must fail and leave the cache untouched.

Create paths follow the same contract. `feature-create` / `research-create` do not report success or open an editor until the inbox spec file and the initial workflow snapshot both exist. If bootstrap fails, the command removes the just-written spec instead of leaving a snapshotless inbox entity behind. Inbox entities use the slug as the workflow id at creation time; `feature-prioritise` / `research-prioritise` re-key that workflow state to the assigned numeric id through one shared workflow-core helper.

Spec review follows the same contract. `feature-spec-review` / `feature-spec-revise` and their research equivalents may still write informational git commits for audit history, but those commits are not load-bearing state. The authoritative write is the workflow-core `spec_review.submitted` / `spec_review.acked` event persisted immediately after the commit. Dashboard reads and close gating must use the projected snapshot metadata, not commit-subject scans.

**Spec-review cycle stage contract (F354):** spec review and spec revise are only permitted while the entity is in **inbox** or **backlog** (pre-implementation). Once the entity moves to `implementing` or later, spec-review actions are absent from `validActions`, the CLI exits non-zero with a message citing the allowed stages, and the engine write path (`recordSpecReviewStarted`) throws. The predicate is `isSpecReviewCycleAllowed(lifecycle)` in `lib/spec-review-state.js` — a single source of truth used by the action registry guards and the CLI. Spec-revise additionally allows `spec_review_in_progress` (continuing an already-started review cycle) but not any implementing/post state.

### Unified Action Registry

All user-facing actions — workflow transitions and infrastructure operations — are defined in central candidate lists with consistent shape, eligibility guards, and metadata. Any UI surface (dashboard, board, macOS app) can discover available actions from the API without reimplementing eligibility logic.

**Two kinds of candidates:**

| Kind | Source | Guard mechanism | Examples |
|------|--------|----------------|----------|
| Workflow | `FEATURE_ACTION_CANDIDATES` / `RESEARCH_ACTION_CANDIDATES` | XState `snapshot.can()` or `bypassMachine` guards | start, pause, eval, close, open-session |
| Infra/View | `FEATURE_INFRA_CANDIDATES` / `RESEARCH_INFRA_CANDIDATES` | `bypassMachine` guards on enriched context | dev-server-poke, mark-submitted, view-findings, view-eval |

**Action categories** (`ActionCategory` enum in `types.js`):
- `lifecycle` — workflow transitions (start, pause, close, eval)
- `session` — terminal session management (open-session)
- `agent-control` — per-agent controls (restart, force-ready, drop)
- `infra` — infrastructure operations (dev server, flags)
- `view` — read-only viewing (findings, eval results); `clientOnly: true`

**How infra data reaches guards:**
1. `dashboard-status-collector.js` builds agent rows with infra fields (`devServerPokeEligible`, `flags`, `findingsPath`, etc.)
2. `workflow-read-model.js` enriches the workflow snapshot context with this infra data via `enrichSnapshotWithInfraData()`
3. `deriveAvailableActions()` evaluates all candidates (workflow + infra) against the enriched context
4. `/api/status` returns all valid actions in `validActions`

**Action shape in API response:**
```js
{
  action: 'dev-server-poke',   // Action identifier
  kind: 'dev-server-poke',     // ManualActionKind
  label: 'Start preview',      // User-facing label
  agentId: 'cc',               // null for feature-level actions
  category: 'infra',           // ActionCategory
  scope: 'per-agent',          // per-agent | per-feature | per-repo
  metadata: { apiEndpoint: 'dev-server/poke' },
  clientOnly: false,           // true = UI-only, no API call needed
}
```

**Rule:** Never add action buttons or eligibility logic in dashboard frontend files. All actions must be defined in the central action registry. Frontend files contain only rendering and dispatch logic.

### Read-Side Consumers

Feature writes go through the engine, but the read side is still mixed:

- `lib/read-model/entity-view.js` is the **canonical single-entity read model (F517)**. `buildEntityView(repoPath, entityType, id, options)` joins the workflow snapshot, spec metadata, dependency state, and agent-session observations into one shape (`{ lifecycle, stage, closed, blocked, blockedBy, agentRows, sessions, specPath, snapshotPath, complexity, set, criteria, name, source }`) so consumers stop re-deriving overlapping facets. It composes the F397 `isEntityDone` precedence rather than duplicating it; it reads sessions only through the `lib/agent-sessions` (F554) boundary; and it keeps dashboard-specific DTO shaping out (that stays in `dashboard-status-collector.js`). Migrated consumers: `feature-status.js#collectFeatureDeepStatus`, `feature-dependencies.js#checkUnmetDependencies`, and the dashboard collector's backlog `blockedBy` annotation. This is the strangler target that finishes the F294/F397 consolidation; remaining `workflow-read-model.js` / `dashboard-status-collector.js` projections migrate behind it over time.
- `lib/workflow-snapshot-adapter.js` is the preferred feature/research read adapter for lifecycle/actions when a workflow snapshot exists, and the low-level snapshot reader `entity-view.js` composes.
- `lib/feature-spec-resolver.js` is the preferred visible-spec lookup for active feature/research entities. Consumers should not hardcode visible-folder probes.
- `lib/spec-reconciliation.js` is the only shared spec-drift repair path. It is one-way: workflow snapshot -> visible folder for feature/research, and feedback frontmatter `status` -> visible folder for feedback. It never bootstraps lifecycle state from folder position.
- `aigon feature-list` and `aigon feature-spec` are the preferred CLI query surfaces for active features. Do not use `board` output as a data API.
- `lib/workflow-read-model.js` provides shared dashboard read state (snapshot-backed for features/research) and derives recommended actions for feedback via `lib/state-queries.js`.
- `lib/feedback.js` provides feedback metadata parsing/collection so feedback list and dashboard reads derive status from frontmatter rather than folder position.
- `lib/dashboard-status-collector.js` owns the AIGON server's dashboard-facing repo/entity reads — spec-review state copied verbatim from engine snapshots, log reads, and done-count aggregation.
- **F590 poll-payload diet (continues F469's list-vs-detail split):** `done`-stage rows in `repo.features` ship only the **lean list shape** (`buildLeanDoneFeatureRow` — `id`, `displayKey`, `name`, `stage`, `specPath`, `updatedAt`, `createdAt`, `set`, `logPaths`); no `agents`/`detailFingerprint`/`cardHeadline`/`stateRenderMeta`/`validActions` (those stay behind `/api/feature/:id/details`). The poll payload is bounded to the **15** most recent done features per repo (`doneTotal` still reports all). The full uncapped list (F67's All Items view contract) is no longer shipped on `/api/status` — it is fetched on demand from `GET /api/repos/all-features?repoPath=…` (`collectAllFeaturesLean`), lazy-loaded once per All Items mount in `templates/dashboard/js/logs.js`. JSON responses gzip-compress above 8 KB when `Accept-Encoding: gzip` is present (`sendJsonSerialized` in `lib/dashboard-routes/util.js`; all `sendJson` consumers inherit). Perf self-reporting: `pollStatus()` auto-logs when a poll exceeds 1 s (naming the slowest repos) even without `AIGON_DASH_TIMING`; `/api/status` logs serialize-ms + uncompressed bytes; the client `poll()` emits a fetch/parse/fingerprint/render breakdown behind `?debug=perf` / `localStorage.aigon-debug-perf`.
- `lib/feature-set-workflow-rules.js` owns set-card action eligibility; dashboard frontend code must not infer when `set-autonomous-*` is allowed.
- `templates/dashboard/js/autonomous-plan.js` renders the dashboard card's autonomous timeline from the server-provided `autonomousPlan` payload. It does not infer stage state; `workflow-read-model.js` owns that read-side derivation.
- `templates/dashboard/js/set-cards.js` renders set-card body/graph markup from the server-provided `sets[]` payload. It does not derive status or action eligibility; `dashboard-status-collector.js` and `feature-set-workflow-rules.js` own those read-side derivations.
- `lib/dashboard-server.js` owns HTTP transport, polling orchestration, notifications, static serving, and dispatches API requests through `lib/dashboard-routes.js`. Route files parse requests and serialize responses; dashboard-triggered side effects live behind `lib/dashboard-actions/`.

So the architecture after F171 → F283 → F294 is:

1. Feature lifecycle writes: engine only.
2. Feature lifecycle reads: workflow snapshots only — no permissive legacy fallbacks.
3. Agent/session reads: combine snapshot data, `.aigon/state/` files, and tmux state.

**Every feature and research entity has a workflow-core snapshot from creation onward.** A spec without a snapshot is still a migration problem: the read model tags the row `WORKFLOW_SOURCE.MISSING_SNAPSHOT`, and **CLI** commands that need engine state exit non-zero with `aigon doctor --fix`. The **dashboard** does not 500 the grid: for specs that sit in **inbox** or **backlog** folders but lack `snapshot.json`, `buildMissingSnapshotState` still derives **pre-engine** `validActions` from folder stage (Prioritise / Start, etc.) via `snapshotToDashboardActions(..., null, stage)`; rows in later lifecycle folders without a snapshot keep empty actions. Inbox entities are no longer a carve-out at create time: create bootstraps a slug-keyed inbox snapshot immediately, and prioritise re-keys it to the numeric id. F294 deleted `COMPAT_INBOX` on the right principle; `b1db12d3` was the narrow stopgap that re-derived inbox actions from folder stage while create still violated the invariant. F296 removes that producer drift for newly created entities.

**Surface split:** `getFeatureDashboardState` / `getResearchDashboardState` do not throw for a missing snapshot — they return the `MISSING_SNAPSHOT` row shape so the HTTP dashboard can load the full table. Interactive CLI commands (`feature-list`, `feature-status`, research equivalents, close helpers) **error** with the same migration hint (`aigon doctor --fix`).

**Migration for pre-cutover entities:** Commands bootstrap lifecycle history via `aigon doctor --fix` before normal engine operations continue. A future F-series may swap that in for `aigon workflow --migrate-from-legacy` once Phase 2 ships.

### Install manifest (`lib/install-manifest.js`)

`install-agent` records every aigon-owned file it writes into `.aigon/install-manifest.json`. The schema is:

```json
{
  "version": "1.0",
  "aigonVersion": "<semver>",
  "files": [
    { "path": ".claude/commands/aigon/feature-create.md",
      "sha256": "<hex64>",
      "version": "<aigonVersion at write time>",
      "installedAt": "<ISO 8601>" }
  ]
}
```

**Lifecycle:**
- Created/updated atomically on every `install-agent` run (write to `.tmp`, then rename).
- Pre-install check: if any tracked file's on-disk sha256 differs from the manifest, the user is warned; interactive mode prompts for confirmation; `AIGON_NONINTERACTIVE=1` or `--force` skips the prompt.
- `aigon remove [--dry-run] [--force] [--purge]`: reads the manifest, lists all files, deletes them (with confirmation), removes empty parent dirs, deletes the manifest, and deregisters the repo from the global registry. Without `--purge` never removes `.aigon/workflows/`, `.aigon/state/`, `.aigon/sessions/`, `.aigon/config.json`; with `--purge` removes `.aigon/` entirely.
- Migration 2.61.0 (`migrate_initialize_install_manifest`): synthesizes a manifest for repos installed before F422 by scanning standard aigon dirs. Idempotent — skips if manifest already exists.
- `aigon doctor` reports: missing files (in manifest but not on disk), modified files (sha256 differs), untracked aigon-pattern files. `aigon doctor --fix` triggers migration 2.61.0.

**Module API (`lib/install-manifest.js`):**
- `readManifest(repoRoot)` — returns parsed manifest or null; throws on corrupt JSON.
- `writeManifest(repoRoot, manifest)` — atomic write via tmp rename.
- `recordFile(manifest, absPath, repoRoot, aigonVersion)` — adds or updates entry (computes sha256, normalizes relative path).
- `removeFile(manifest, relPath)` — removes entry.
- `getModifiedFiles(manifest, repoRoot)` — returns entries whose on-disk sha256 differs.
- `getMissingFiles(manifest, repoRoot)` — returns entries not on disk.
- `createEmptyManifest(aigonVersion)` — returns a fresh manifest skeleton.

**Tracked files** (fully aigon-owned, full overwrite): `.aigon/docs/*.md`, command files (`.claude/commands/aigon/*.md`, aliases), skill files (`.claude/skills/aigon/SKILL.md`, `.codex/skills/aigon-*/SKILL.md`), cursor rules (`.cursor/rules/aigon.mdc`). **Not tracked**: merged config files (`.claude/settings.json`, `.gemini/settings.json`, `.codex/config.toml`), hooks file, upserted agent docs (user can add content after marker blocks).

## Setting scopes (F521)

Every entry in `DASHBOARD_SETTINGS_SCHEMA` (`lib/dashboard-settings.js`) carries a `scope` field with one of three values:

- **`user`** — global only. The value belongs to the *user*, not the repo. Project-layer values are ignored at resolution time; PUT `/api/settings` with `scope: 'project'` returns HTTP 400 `scope_violation`. UI renders these under **Settings → Preferences** (or **Settings → Terminal** for the two terminal-related rows) with a single value, no per-repo override column.
- **`shared`** — global default with optional per-repo override (legacy behaviour). The resolver honours `project > global > default` precedence. UI renders these under **Settings → Repository Settings** with the two-column "Shared | Repository" table.
- **`repo`** — per-repo only; no meaningful global default (often auto-detected). PUT `/api/settings` with `scope: 'global'` returns HTTP 400 `scope_violation`. UI renders these as read-only **Repo context** cards.

Current classification:

| Scope    | Keys                                                                                                                            |
|----------|----------------------------------------------------------------------------------------------------------------------------------|
| `user`   | `backgroundAgents`, `terminalApp`, `terminal.focusOnLaunch`, `autoNudge.enabled`, `autoNudge.idle*Sec`, `agents.<id>.cli`, `agents.<id>.implementFlag` |
| `shared` | `defaultAgent`, `security.enabled`, `security.mode`, `agents.<id>.<role>.model`                                                 |
| `repo`   | `profile`, `devServer.enabled`                                                                                                  |

The authoritative user-scope list lives in `USER_SCOPE_KEYS` (`lib/config.js`); the schema scope tags are checked against it by `tests/unit/settings-scope.test.js`. If you add a new setting, set its `scope` explicitly and — if it's `user` — add the key to `USER_SCOPE_KEYS` so `getEffectiveConfig` short-circuits the project layer correctly.

Stale per-repo overrides of user-scope keys are listed by `listStaleUserScopeProjectOverrides(projectConfig)` and surface as a one-line warning at dashboard startup. They are *ignored*, not deleted — cleanup is the user's call.

## Dashboard Frontend (`templates/dashboard/`)

Rearchitected by the **dash-arch** set (F620–F628, 2026-07). No build step, no framework beyond Alpine.js for declarative bindings — but the ad-hoc script soup is gone.

### Live update pipeline (F620 → F621 → F622)

Change-to-pixel latency is ~1–2s (previously up to ~80s of stacked poll intervals):

1. **fs-watch** (`lib/dashboard-fs-watch.js`): a change under a repo's `.aigon/state`, `.aigon/workflows`, or spec stage dirs triggers a debounced (400ms) targeted `pollRepoStatus(repoPath)` re-collect. The old interval poll survives only as a 60s safety net (tmux liveness, watcher misses).
2. **statusVersion** (`lib/dashboard-status-version.js`): each collected payload is structurally fingerprinted server-side; a change bumps a monotonic `statusVersion` and re-serializes the cached body. `/api/status` carries `ETag: "<version>"` and answers matching `If-None-Match` with a 0-byte 304.
3. **SSE push** (`lib/dashboard-sse.js` + `GET /api/events`): a version bump broadcasts a `status` ping; the client responds with one conditional fetch. While SSE is connected the client poll stretches to 60s; on SSE loss it falls back to 10s polling (`POLL_MS`). `notification` and `server-restarting` events ride the same channel (restart banner, bell refresh).

Rules that follow from this design:
- **Never bypass `replaceLatestStatus`** in `dashboard-server.js` when producing a new status payload — it is the single write path that versions, caches, and broadcasts. (Write-path contract.)
- Anything the collector emits that should repaint cards **must be captured by `computeStatusFingerprint`** — a field that changes without changing the fingerprint will not bump the version and will not repaint until the next full fetch.

### Client architecture (F623–F626)

- **ES modules** (F623): `index.html` loads one entry — `js/main.js` — whose sequential side-effect imports encode the old script load order. Server-injected bootstrap is a single `window.__AIGON_BOOTSTRAP__` object (initial data, instance name, agents, default agent) read by `js/injected.js`. *Wave 1 only*: modules still publish via `Object.assign(globalThis, …)` shims and cross-file calls are bare globals — real imports and cycle-breaking are follow-up work.
- **Central store** (F624, `js/store.js`): owns raw server data, a declarative localStorage persistence map (`PERSISTENCE`), and the **optimistic overlay engine**: overlays are `{key, patch(draft), settled(raw), ttlMs}` entries replayed onto a clone of the last raw payload. `replaceData(next)` is the only data entry point; `subscribeDataChange(listener)` is how renderers react. Never hand-mutate `state.data` for optimism — add an overlay.
- **Keyed kanban** (F625, `js/pipeline.js`): columns reconcile per-card by key with a per-card fingerprint (`reconcileKeyedCards` / `reconcileKanbanColumn`) instead of `innerHTML = ''` rebuilds. Reconcile stats (`+created/~updated/-removed`) surface in the `?debug=perf` console line.
- **View registry** (F626, `js/view-registry.js`): every tab is a `{id, elementId, usesRepoSidebar, usesRepoHeader, mount, update, unmount}` entry; the old `render()` if/else display ladder is gone. New views register here — do not toggle `style.display` from elsewhere.
- **Perf debugging**: `?debug=perf` (or `localStorage['aigon-debug-perf']='1'`) logs per-poll fetch/parse/render/kanban timings client-side; `AIGON_DASH_TIMING=1` does the server side.

### Styling (F628) and vendoring (F627)

- CSS lives in `templates/dashboard/styles/*.css`, concatenated in `styles/manifest.json` order by `lib/dashboard-styles.js` at `/styles.css`. **A new sheet must be added to the manifest** — unlisted files are not served; listed-but-missing files throw.
- All third-party JS is vendored under `js/vendor/` (Alpine, marked, Chart.js + date-fns adapter, xterm) with licenses and pinned versions in `js/vendor/VERSIONS.md`. Do not add CDN `<script>` tags.

### Card state hierarchy (F650)

Feature/research cards use a server-owned presentation model (`lib/card-presentation.js` → `entity.cardPresentation` on poll rows) layered on `lib/card-headline.js`. The model supplies timeline items, a single context line, suppression flags for duplicate legacy panels, compact agent summary on failures, and `showRecoveryActions` for the action row. Rules and examples: **`docs/dashboard-card-design.md`**; visual reference: **`docs/card-design-wireframe.html`**. Client HTML: `templates/dashboard/js/card-presentation.js` (shared by pipeline + monitor).

### Known deferred debt (from the dash-arch logs)

- F623 waves 2–3: real `import`s replacing `globalThis` shims, breaking the `state↔api↔init` cycles, deleting the eslint `dashboardAppGlobals` allowlist and `typeof fn === 'function'` guards.
- Alpine expressions in `index.html` still call bare globals (documented boundary).
- ~220 inline `style="…"` occurrences across `index.html` + `js/**` awaiting migration into `styles/` sheets.

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
- `{agent}` — agent short code (`cc`, `ag`, `cx`, `cu`)
- `{desc}` — kebab-case feature description from the spec filename

## Scheduling and recurring work

Scheduled and recurring work is no longer implemented in the OSS package. The former scheduler engine and `agent_prompt` runner moved to `@aigon/pro` with feature 236. In this repo:

- `lib/commands/schedule.js` keeps the `aigon schedule` verb as a thin delegating stub.
- `lib/commands/recurring.js` keeps `aigon recurring-run` and `aigon recurring-list` as thin delegating stubs.
- `lib/commands/agent-launch.js` keeps the internal `aigon agent-launch` primitive as a thin delegating stub.
- `lib/dashboard-status-collector.js` may decorate feature, research, and feature-set read models with pending schedule metadata when Pro exposes a schedule index.

Each stub tries to load the matching `@aigon/pro/commands/*` implementation when Pro is installed. Without Pro, it prints the standard "Pro feature — coming later" notice and exits non-zero. Do not add scheduler engine behavior back to OSS unless the free/pro boundary changes.

## Aigon Pro (`@aigon/pro`)

Aigon has a **free/pro split**. The free tier (this repo) is open source under Apache 2.0. The commercial Pro tier is a separate package that augments aigon with deeper insights, AI coaching, and the autonomous-mode "AutoConductor" — **Pro is in development and not yet available for purchase**, and gate messages in the CLI explicitly say so.

| | Aigon (this repo) | Aigon Pro |
|---|---|---|
| **Status** | Free, open source (Apache 2.0) | In development, not yet for sale |
| **Package** | `aigon` | `@aigon/pro` (separate package) |
| **Contains** | CLI, workflow engine, dashboard, free-tier features | Insights engine, AI coaching, autonomous-mode runner |
| **Data collection** | Yes — `getFeatureGitSignals()` in `lib/git.js` | No — consumes the free tier's data |

### Integration shape

The free tier is the **host**. Pro is an optional **subscriber** loaded via a single extension seam. There are exactly two files in aigon that may import `@aigon/pro`:

1. **`lib/pro.js`** — lazy-require gate. Exposes `isProAvailable()` and `getPro()`. Respects the `AIGON_FORCE_PRO` environment variable so the free tier can be simulated as the only tier for testing.
2. **`lib/pro-bridge.js`** — the single extension point. At server startup it invites Pro (if installed) to register itself, then dispatches incoming requests to whichever side owns them.

```js
// lib/pro.js — the entire integration surface visible to consumers
let pro = null;
try { pro = require('@aigon/pro'); } catch { /* free tier */ }
module.exports = { isProAvailable, getPro: () => pro };
```

When `@aigon/pro` is absent (the default for everyone right now), the CLI gracefully degrades: the dashboard shows "Pro — coming later" placeholders, and `aigon insights` prints a friendly message pointing at the free alternatives (`aigon board`, `aigon commits`, `aigon feature-status`).

**Honest gate messaging is non-negotiable** — gate messages in the CLI must never imply that a purchase flow exists. There is no "buy" button anywhere because there is nothing to sell yet.

### Specs for Pro features

Since 2026-04-07, Pro feature specs live in a private companion repo, not in this one. Historical Pro feature IDs that moved out are listed in `docs/specs/features/MOVED-TO-AIGON-PRO.md`. For day-to-day OSS development this is invisible — you only notice it if you see a gap in feature numbering and want to know what filled it.

If a future contribution to aigon needs to make a coordinated change with the Pro side, the convention is documented in `CLAUDE.md` and `AGENTS.md` under "Cross-repo features".

## Design Rules

- Keep `aigon-cli.js` free of business logic.
- Prefer explicit CommonJS exports.
- Keep command handlers grouped by domain, not one file per command.
- Avoid circular dependencies between `lib/*.js` modules. Enforced mechanically by `scripts/check-module-graph.js` (runs in `test:core`): require-cycle detection plus declarative boundary rules (agent-sessions purity, workflow-core barrel-only with `paths.js` sanctioned as a constants leaf, dashboard read-only owners, commands one-way), ratcheted against `scripts/module-graph-baseline.json`. The baseline only shrinks — `--write-baseline` refuses growth unless `--allow-growth "<reason>"` records the justification in the baseline's `growthLog`; remaining boundary violations are individually justified in `violationJustifications`. Run `node scripts/check-module-graph.js --report` for cycle/violation summaries.
- Treat `templates/` as source-of-truth for generated agent docs and prompts.
- Project-specific agent instructions belong in `AGENTS.md` and/or `CLAUDE.md` (user-owned, never written by aigon — F420). Per-agent context is delivered via skills and rule files under `.claude/`, `.cursor/`, etc.
- The AIGON server is the foreground HTTP process. It serves the dashboard UI at `localhost:4100`. Named URLs (`aigon.localhost`, `cc-71.aigon.localhost`) are provided by the optional Caddy reverse proxy.
- The proxy uses Caddy (`brew install caddy`). `aigon proxy install` sets it up as a system service on port 80. Routes are written to a Caddyfile at `~/.aigon/dev-proxy/Caddyfile` — they survive process crashes (Caddy returns 502 until the backend recovers). No PID tracking or registration lifecycle.

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
3. `.aigon/docs/development_workflow.md`
4. the active spec under `docs/specs/...`
5. the relevant command module under `lib/commands/`

## Testing

For the full canonical reference on test discipline (iterate vs deploy gates, what NOT to do mid-iteration, where rules live), see `docs/testing.md`. This section is a brief architectural summary.

### Test stages

| Script | What it runs | When |
|---|---|---|
| `npm run test:iterate` / `test:quick` | scoped lint + matched integration/workflow + smoke fallback | every code change mid-iteration |
| `npm test` / `npm run test:core` | lint + workflow diagram check + `tests/integration/` + `tests/workflow-core/` (parallelised, ~12s) | core non-browser suite |
| `npm run test:browser` / `test:ui` | full Playwright E2E in `tests/dashboard-e2e/` (MOCK_DELAY=fast, ~90s) | deploy gate, CI push-to-main |
| `npm run test:browser:smoke` | Playwright `@smoke` subset only | auto-run in iterate gate on dashboard changes |
| `npm run test:deploy` / `test:all` | `test:core` + `security:package-config` + `security:suspicious-deps` + `npm audit --omit=dev --audit-level=high` + `test:browser` + `scripts/check-test-budget.sh` | before `git push` / `feature-close` |

### Test directory layout

```
tests/
├── _helpers.js              Shared test() / report() helpers
├── commands/                CLI command-handler tests (run via integration glob)
├── integration/             Engine + filesystem + workflow integration tests
├── workflow-core/           XState machine core invariants
├── utils/                   Shared test utilities
└── dashboard-e2e/           Playwright browser E2E (the slow tier)
    ├── playwright.config.js
    ├── setup.js / teardown.js
    ├── solo-lifecycle.spec.js    @deploy — full solo branch/worktree lifecycle
    ├── fleet-lifecycle.spec.js   @deploy — fleet multi-agent lifecycle
    ├── workflow-e2e.spec.js      @deploy — mock create→close lifecycle
    ├── failure-modes.spec.js     @deploy — crash/recovery/idle states
    ├── state-consistency.spec.js
    ├── close-failure-event.spec.js  @smoke
    ├── review-badges.spec.js        @smoke
    └── set-agent-picker-reviewer.spec.js  @smoke
```

### Writing tests

- **Integration tests** go in `tests/integration/<name>.test.js` — standalone Node scripts using built-in `assert`; run individually with `node tests/integration/foo.test.js`
- **Workflow-core tests** go in `tests/workflow-core/` — XState machine invariants
- **Dashboard E2E tests** go in `tests/dashboard-e2e/` — use `setup.js` to create real fixtures and mock agents; tag with `@smoke` for fast subset, `@deploy` for lifecycle-heavy tests
- **Feature-specific validation** goes in the spec's `## Validation` section as bash commands

### Quick reference

```bash
npm run test:iterate            # iterate gate — scoped, fast (<30s)
npm run test:core               # full non-browser suite (~12s)
npm run test:browser:smoke      # Playwright @smoke subset
npm run test:browser            # full Playwright E2E (~90s)
npm run test:deploy             # deploy gate — core + dependency/security release checks + browser + budget
npm run test:migration          # Brewboard legacy→current migration test
node -c aigon-cli.js            # Quick syntax check (no tests)
node -c lib/<module>.js         # Quick syntax check for a module
```

### Migration testing

`scripts/test-brewboard-migration.sh` runs the F420–F422 doctor migrations (2.59.0 / 2.59.1 / 2.60.0 / 2.61.0) end-to-end against a real legacy fixture committed in `legacy-fixtures/brewboard/`. This verifies:

1. Migration 2.59.0 strips the `<!-- AIGON_START -->...<!-- AIGON_END -->` block from `AGENTS.md`.
2. Migration 2.59.1 deletes `docs/aigon-project.md`.
3. Migration 2.60.0 moves `docs/development_workflow.md` and `docs/agents/*.md` to `.aigon/docs/`.
4. Migration 2.61.0 creates `.aigon/install-manifest.json` from the aigon-owned files it discovers.
5. Running `doctor --fix` a second time is a no-op (idempotent).

To run locally:
```bash
npm run test:migration
# or directly:
bash scripts/test-brewboard-migration.sh
```

The fixture lives in `legacy-fixtures/brewboard/` — update it when you add a new migration that should be exercised in this suite.
### Read Models

There are currently two read-side paths:

- `lib/workflow-snapshot-adapter.js`: maps workflow-core snapshots into dashboard/board-friendly shapes for features and research. This is the preferred workflow read path.
- `lib/workflow-read-model.js`: shared read model used by dashboard collectors/detail payloads for features/research (snapshot-backed), and derives recommended actions from `lib/state-queries.js` for feedback. It also invokes shared spec reconciliation on snapshot-backed reads.
- `lib/spec-reconciliation.js`: shared self-healing visible-spec reconciliation for workflow-backed features/research plus feedback status-derived folder projection, and the reusable diagnosis path for `aigon repair`.
- `lib/action-command-mapper.js`: keeps command strings aligned between those two read paths so UI surfaces do not drift.
- `lib/dashboard-status-helpers.js`: keeps session/worktree/status heuristics aligned between dashboard reads and command flows.

If you are changing feature lifecycle behavior, update the engine first. Then check whether snapshot consumers and fallback read-model consumers still present the same behavior.
