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
| `lib/commands/feature.js` | Thin dispatcher for `feature-*` handlers + `sessions-close`. Fat handlers (`feature-start`, `feature-eval`, `feature-do`, `feature-autonomous-start`) delegate to sibling `lib/feature-*.js` modules via a shared `handlerDeps` bundle. Uses `withActionDelegate` from `action-scope` for the main-repo delegation guard. Parallel-with-research handlers (create, prioritise, spec-review quartet, reset base) come from `./entity-commands` via factory spread |
| `lib/feature-start.js`, `lib/feature-eval.js`, `lib/feature-do.js`, `lib/feature-autonomous.js` | Extracted handler modules. Each exports `run(args, deps)` — `deps.ctx` gives access to utils/git/hooks/specCrud; `deps` also surfaces the local closures still owned by the parent dispatcher (`persistAndRunEffects`, `resolveFeatureMode`, `resolveMainRepoPath`, etc.) |
| `lib/feature-command-helpers.js` | Shared helpers for feature handlers: `parseLogFrontmatterForBackfill`, `estimateExpectedScopeFiles`, `upsertLogFrontmatterScalars` |
| `lib/commands/research.js` | All `research-*` handlers. Parallel-with-feature handlers come from `./entity-commands` via factory spread |
| `lib/commands/entity-commands.js` | Shared factory for parallel feature/research lifecycle commands parameterised by `FEATURE_DEF` / `RESEARCH_DEF` from `lib/entity.js`. Exposes `createEntityCommands(def, ctx)` (create, prioritise, spec-review quartet) and `entityResetBase(def, id, ctx, hooks)` for reset plumbing. New parallel commands are added here — not in feature.js/research.js — so both entities pick them up by construction, eliminating the "defined but not whitelisted" drift class |
| `lib/commands/feedback.js` | `feedback-create`, `feedback-list`, `feedback-triage` |
| `lib/commands/infra.js` | `server`, `terminal-focus`, `board`, `proxy-setup`, `dev-server`, `config`, `hooks`, `profile`, `sync` |
| `lib/commands/setup.js` | `init`, `install-agent`, `uninstall`, `check-version`, `update`, `project-context`, `doctor` |
| `lib/commands/misc.js` | `agent-status`, `nudge`, `status`, `deploy`, `next`, `help` |

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
- `lib/agent-status.js` (~130 lines): per-agent status file I/O in `.aigon/state/`, atomic JSON writes, signal-health observation, candidate ID resolution, and dashboard-facing state reads
  `readAgentStatus`, `writeAgentStatus`, `writeAgentStatusAt`, `agentStatusPath`, `getStateDir`, `getLocksDir`
- `lib/signal-health.js` (~280 lines): append-only signal reliability telemetry in `.aigon/telemetry/signal-health/*.jsonl`, summary reads, missed-signal de-duplication, and doctor GC helpers
  `recordSignalEvent`, `readSignalEvents`, `summarizeSignalEvents`, `recordMissedSignalIfDue`, `gcSignalHealth`
- `lib/agent-prompt-resolver.js` (~140 lines): shared feature prompt resolution for agent launches; preserves configured slash-command prompts for slash-invocable agents (cc/gg/cu) and inlines the canonical `templates/generic/commands/feature-*.md` body for non-invocable agents (cx/op/km). Membership is derived from `capabilities.resolvesSlashCommands` in each `templates/agents/<id>.json`, so adding a new agent requires no code change here
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
- `lib/dashboard-status-collector.js` (~900 lines): shared AIGON server read-side collector so repo/entity status assembly, dashboard detail log reads, done-count aggregation, and derived set-card payloads stay separated from HTTP transport and notification code, including metadata-authoritative feedback status reads
  `collectDashboardStatusData`
- `lib/feature-set-workflow-rules.js` (~60 lines): central read-side action registry for set dashboard cards. Owns `set-autonomous-{start,stop,resume,reset}` eligibility and button metadata; the frontend renders only the returned `validActions`.
  `buildSetValidActions`
- `templates/dashboard/js/autonomous-plan.js` (~80 lines): shared dashboard renderer for the server-owned autonomous stage timeline so card markup stays pure and testable outside the full browser bundle
  `buildAutonomousPlanHtml`
- `templates/dashboard/js/set-cards.js` (~100 lines): shared dashboard renderer for set cards and the dep-graph mini-view so SVG/layout markup is testable outside the full browser bundle.
  `buildSetCardBodyHtml`, `buildSetDepGraphSvg`
- `lib/server-runtime.js` (~90 lines): shared AIGON server lifecycle helpers extracted from infra command wiring
  `launchDashboardServer`, `stopDashboardProcess`
- `lib/validation.js` (~1,045 lines): Iterate (Autopilot) loop and smart validation helpers
  `runRalphCommand`, `runSmartValidation`, `parseAcceptanceCriteria`, `runFeatureValidateCommand`

**Domain modules** (logic lives in the module itself):

- `lib/proxy.js` (~660 lines): Caddy management (Caddyfile generation, route add/remove, reload), port allocation, dev server utilities
  `writeCaddyfile`, `addCaddyRoute`, `removeCaddyRoute`, `reloadCaddy`, `allocatePort`
- `lib/dashboard-server.js` (~1,980 lines): AIGON server HTTP/UI module — serves the dashboard UI, polls state, handles WebSocket relay, notifications, static assets, and OSS/Pro route dispatch. It should not parse engine-state/spec/log files directly.
  `runDashboardServer`, `collectDashboardStatusData`, `buildDashboardHtml`, `runDashboardInteractiveAction`
- `lib/dashboard-routes.js` (~60 lines): thin aggregator — composes the per-domain route modules in `lib/dashboard-routes/` and exposes the dispatcher
  `createDashboardRouteDispatcher`
  - `analytics.js` — analytics, telemetry, signal-health, weekly autonomy trend endpoints
  - `config.js` — config read/write endpoints (`/api/config/*`)
  - `entities.js` — feature/research/feedback CRUD endpoints
  - `recommendations.js` — `/api/recommendation/*` (spec-frontmatter-driven start-modal defaults)
  - `sessions.js` — tmux/session endpoints, PTY token issuance
  - `system.js` — health, version, repo metadata
  - `util.js` — shared response helpers + the route-table builder consumed by the aggregator
- `lib/worktree.js` (~1,300 lines): worktree creation, permissions, git attribution metadata bootstrap, tmux sessions
  `setupWorktreeEnvironment`, `ensureAgentSessions`, `buildTmuxSessionName`, `openSingleWorktree`
- `lib/set-conductor.js` (~500 lines): detached set-level autonomous sequencer (`set-autonomous-start|stop|resume|reset`) that resolves set members in topo order, delegates each member to `feature-autonomous-start`, and persists `.aigon/state/set-<slug>-auto.json`
  `run`, `resolveSetExecutionPlan`, `buildSetAutoSessionName`
- `lib/supervisor.js` (~430 lines): server monitoring — liveness from tmux + heartbeat, idle/awaiting-input notifications, and token-exhaustion handling (F308) that may append workflow events, pause a feature, or auto-switch an agent slot per `agentFailover` policy
  `startSupervisorLoop`, `sweepEntity`, `getAgentLiveness`
- `lib/agent-failover.js` (~140 lines): token-exhaustion signal construction, failover chain selection, handoff prompt text, and clearing per-slot status flags after a switch
  `buildTokenExhaustionSignal`, `chooseNextAgent`, `buildFailoverPrompt`, `clearTokenExhaustedFlag`
- `lib/terminal-adapters.js` (~200 lines): data-driven terminal detection/dispatch — adapter table with `detect(env)`, `launch(cmd, opts)`, `split(configs, opts)` per terminal. **Registry API** (F350): each macOS adapter carries `id`, `displayName`, `pickerLabel`, `platforms`, `aliases`, `hiddenFromPicker` — all consumer surfaces (dashboard enum, onboarding picker, display-name map, canonicaliser, help text) derive from this single source. Adding a new terminal requires only a new adapter object here.
  `findAdapter`, `getAdapter`, `tileITerm2Windows`, `closeWarpWindow`, `getTerminalIds`, `getPickerOptions`, `getDashboardOptions`, `getDisplayName`, `canonicalize`, `isValidId`, `registerAdapter`
- `lib/config.js` (~951 lines): global/project config, profiles, agent CLI config, editor detection, and runtime compatibility for legacy `terminal`/`tmuxApp` reads while `terminalApp` rolls out
  `loadGlobalConfig`, `loadProjectConfig`, `getActiveProfile`, `getEffectiveConfig`, `getAgentCliConfig`
- `lib/global-config-migration.js` (~150 lines): machine-wide `~/.aigon/config.json` migration registry and runner; write-once backups + schemaVersion tracking for global config renames
  `registerGlobalConfigMigration`, `runPendingGlobalConfigMigrations`, `migrateLegacyTerminalSettings`
- `lib/templates.js` (~550 lines): template loading, command registry, scaffolding, content generation
  `readTemplate`, `processTemplate`, `readGenericTemplate`, `formatCommandOutput`, `COMMAND_REGISTRY`
- `lib/utils.js` (~183 lines): thin re-export hub for config/proxy/dashboard/worktree/templates/git, feedback constants, dev-server URL, safeWrite. Do not add domain logic here — route new code to its domain module instead.
  `safeWrite`, `safeWriteWithStatus`, `setTerminalTitle`, `resolveDevServerUrl`, `FEEDBACK_STATUS_TO_FOLDER`
- `lib/hooks.js` (~146 lines): hook lifecycle — parses `.aigon/hooks.json`, executes pre/post hooks
  `parseHooksFile`, `getDefinedHooks`, `executeHook`, `runPreHook`, `runPostHook`
- `lib/analytics.js` (~889 lines): usage analytics — log parsing, completion series, autonomy trend
  `collectAnalyticsData`, `parseLogFrontmatterFull`, `buildCompletionSeries`, `buildWeeklyAutonomyTrend`
- `lib/version.js` (~154 lines): version management — reads/writes installed version, compares, upgrades CLI
  `getAigonVersion`, `getInstalledVersion`, `compareVersions`, `upgradeAigonCli`
- `lib/spec-crud.js` (~247 lines): spec file operations — find, move, create, modify, section-read
  `findFile`, `findUnprioritizedFile`, `moveFile`, `modifySpecFile`, `getNextId`, `createSpecFile`, `readSpecSection`
- `lib/cli-parse.js` (~256 lines): CLI option parsing + YAML/frontmatter helpers — stateless, no I/O
  `parseCliOptions`, `getOptionValue`, `parseFrontMatter`, `serializeYamlScalar`, `slugify`, `escapeRegex`
- `lib/deploy.js` (~65 lines): deploy command resolution — reads config/package.json, runs deploy/preview
  `resolveDeployCommand`, `runDeployCommand`
- `lib/sync.js` (~800 lines): solo multi-laptop sync orchestration for portable `.aigon` state via private git sync repo
  `handleSyncCommand`, `sync init/register/export/bootstrap-merge/push/pull/status`, preflight/version safety checks
- `lib/sync-merge.js` (~300 lines): bootstrap merge engine for data-type-specific merge behavior
  `mergeBundleIntoRepos` (workflow event dedupe, telemetry union, state manifest merge, derived cache invalidation)

**Additional modules:**

- `lib/telemetry.js` (~144 lines): normalized session telemetry — common schema across all agents (agent, model, tokens, cost, turns, duration), records to `.aigon/telemetry/`
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

## Workflow State

The Aigon workflow now has two layers:

- Spec location under `docs/specs/` remains the user-visible workflow stage.
- For **features and research**, the authoritative lifecycle state lives in the workflow engine under `.aigon/workflows/`.

That means "state-as-location" is still true at the UX level, but feature commands no longer mutate workflow by directly treating folder position as the only source of truth. The engine owns the lifecycle and moves the spec as a side effect.

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

**State files** (gitignored, under `.aigon/workflows/`):
- `.aigon/workflows/features/{id}/events.jsonl` — immutable event log
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

### Workflow Authority Split

The post-cutover system is easier to reason about if you separate lifecycle truth from runtime/session metadata:

| Concern | Authority | Notes |
|--------|-----------|-------|
| Feature lifecycle (`implementing`, `evaluating`, `ready_for_review`, `closing`, `done`, `paused`) | `lib/workflow-core/` snapshot + event log | Sole write path for feature lifecycle |
| Feature close failure details | `lib/workflow-core/` event log + snapshot `lastCloseFailure` projection | `feature_close.failed` event emitted by `feature-close` on non-zero exit; projector sets `lastCloseFailure` (`kind`, `conflictFiles`, `stderrTail`, `at`) on snapshot; cleared on `feature.closed`. Dashboard swaps "Close" for "Resolve & close" when `kind === 'merge-conflict'`. |
| Feature close-recovery lifecycle (`close_recovery_in_progress`) | `lib/workflow-core/` snapshot + event log | F432: dashboard "Close with agent" appends `feature.close_recovery.started` (engine-first) before spawning the `role: 'close'` tmux session. Projector moves `currentSpecState` to `close_recovery_in_progress` and stores `closeRecovery { agentId, startedAt, returnSpecState, sessionName, source }`. Exit via `feature.close_recovery.ended` / `.cancelled` returns lifecycle to `submitted` (machine-authoritative); `feature.close_requested` clears `closeRecovery` and transitions to `closing`. `lastCloseFailure` persists across the recovery transition (cleared only by `feature.closed`). Dashboard surfaces the role-`close` tmux session via `recoveryTmuxSession`. |
| Feature spec-review pending/acked state | `lib/workflow-core/` event log + snapshot `specReview` projection | `spec_review.*` events; dashboard reads snapshot metadata, not `git log` |
| Feature spec folder location | Engine effects (`move_spec`) | User-visible reflection of engine state |
| Feature agent runtime status (`running`, `waiting`, `ready`, `lost`, etc.) | Engine signals plus per-agent status files in `.aigon/state/feature-{id}-{agent}.json` | Session/runtime metadata, not the lifecycle authority |
| Feature autonomous conductor runtime (`starting`, `running`, `completed`, `failed`, etc.) | `.aigon/state/feature-{id}-auto.json` plus tmux session presence | Durable proof that autonomous orchestration started, what session it used, and how it ended |
| Research lifecycle (`backlog`, `implementing`, `evaluating`, `closing`, `done`) | `lib/workflow-core/` snapshot + event log | Sole write path for research lifecycle |
| Research spec-review pending/acked state | `lib/workflow-core/` event log + snapshot `specReview` projection | Same typed state model as features |
| Feature code-review lifecycle (`code_review_in_progress`, `code_review_complete`, `code_revision_in_progress`, `code_revision_complete`) | `lib/workflow-core/` snapshot + event log | F342: four states; `*_complete` are transient. AutoConductor polls `currentSpecState === 'code_revision_complete'` from snapshot — not the legacy `review-complete` sidecar |
| tmux session identity | `.aigon/sessions/{name}.json` sidecar (`tmuxId`, `shellPid`, `category`) | F351: `tmuxId` is the durable FK (stable across renames); `category` is `entity` or `repo`. `aigon session-list` surfaces all live sessions. Internal routing uses `-t $N` via `tmuxId` |
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

- `lib/workflow-snapshot-adapter.js` is the preferred feature/research read adapter for lifecycle/actions when a workflow snapshot exists.
- `lib/feature-spec-resolver.js` is the preferred visible-spec lookup for active feature/research entities. Consumers should not hardcode visible-folder probes.
- `lib/spec-reconciliation.js` is the only shared spec-drift repair path. It is one-way: workflow snapshot -> visible folder for feature/research, and feedback frontmatter `status` -> visible folder for feedback. It never bootstraps lifecycle state from folder position.
- `aigon feature-list` and `aigon feature-spec` are the preferred CLI query surfaces for active features. Do not use `board` output as a data API.
- `lib/workflow-read-model.js` provides shared dashboard read state (snapshot-backed for features/research) and derives recommended actions for feedback via `lib/state-queries.js`.
- `lib/feedback.js` provides feedback metadata parsing/collection so feedback list and dashboard reads derive status from frontmatter rather than folder position.
- `lib/dashboard-status-collector.js` owns the AIGON server's dashboard-facing repo/entity reads — spec-review state copied verbatim from engine snapshots, log reads, and done-count aggregation.
- `lib/feature-set-workflow-rules.js` owns set-card action eligibility; dashboard frontend code must not infer when `set-autonomous-*` is allowed.
- `templates/dashboard/js/autonomous-plan.js` renders the dashboard card's autonomous timeline from the server-provided `autonomousPlan` payload. It does not infer stage state; `workflow-read-model.js` owns that read-side derivation.
- `templates/dashboard/js/set-cards.js` renders set-card body/graph markup from the server-provided `sets[]` payload. It does not derive status or action eligibility; `dashboard-status-collector.js` and `feature-set-workflow-rules.js` own those read-side derivations.
- `lib/dashboard-server.js` owns HTTP transport, polling orchestration, notifications, static serving, and dispatches API requests through `lib/dashboard-routes.js`. It is read-only with respect to both mutations and engine-state/spec/log file access.

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
- `aigon uninstall [--dry-run] [--force]`: reads the manifest, lists all files, deletes them (with confirmation), removes empty parent dirs, deletes the manifest. Never removes `.aigon/workflows/`, `.aigon/state/`, `.aigon/sessions/`, `.aigon/config.json`.
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
- `{agent}` — agent short code (`cc`, `gg`, `cx`, `cu`)
- `{desc}` — kebab-case feature description from the spec filename

## Scheduler (`aigon schedule add`) — when to use which kind

The scheduler (`lib/scheduled-kickoff.js`) supports three job kinds. Pick by what you want to *fire*:

- **`feature_autonomous` <id>** — start an autonomous run on a specific spec that already exists in `02-backlog/` or `03-in-progress/`. Use this to defer/queue a known feature; the scheduler validates the spec is present and dispatches `feature-autonomous-start` at `runAt`.
- **`research_start` <id>** — start a research run on a spec already in `02-backlog/` or `03-in-progress/`. Same shape as `feature_autonomous` but for research entities.
- **`agent_prompt`** — spawn a fresh agent session (no entity required) carrying an arbitrary prompt or slash command (e.g. `--prompt=/security-review`). Optional `--cron=<expr>` re-arms the job after each fire, so this is the right kind for **periodic agent tasks** like a weekly security digest, an architecture audit, or a TODO sweep. The scheduler shells into `aigon agent-launch` (a dedicated internal CLI) which opens a tmux tab in the target repo. The agent is responsible for everything that happens in-session, including filing follow-up features via `afc` for any work it discovers.

`agent_prompt` jobs use the `--label` slug as their `entityId` (since there is no backing entity); the dashboard schedule glyph index ignores them. They appear only in `aigon schedule list`.

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
- Avoid circular dependencies between `lib/*.js` modules.
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
- **Iterate validation** — during `feature-do --iterate`, the agent runs commands from the spec's `## Validation` section after each iteration; all must exit 0

### Writing tests

- **Unit tests** go in `aigon-cli.test.js` (core logic) or the relevant `lib/<name>.test.js` (module-specific)
- **Dashboard UI tests** go in `tests/dashboard/<view>.spec.js` — they mock API responses via `page.route()` and test HTML rendering
- **Dashboard E2E tests** go in `tests/dashboard-e2e/` — they use `setup.js` to create real fixtures and `mock-agent.js` to simulate agents
- **Mock E2E tests** go in `test/e2e-mock-*.test.js` — they exercise the CLI with `test/mock-agent.js`
- **Feature-specific validation** goes in the spec's `## Validation` section as bash commands

### Test utilities

- `test/setup-fixture.js` — generates realistic fixture repos (brewboard, trailhead) with known feature/research/feedback IDs
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
npm run test:migration          # Brewboard legacy→current migration test (see below)
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
