# Aigon — Codebase Orientation

> Aigon is a spec-driven multi-agent harness — feature lifecycle, git-worktree isolation, and slash-command orchestration of Claude Code, Antigravity CLI, Codex CLI, and Cursor.

## Quick Facts
- **Entry point**: `aigon-cli.js` — dispatch only, no business logic
- **Commands**: domain files in `lib/commands/` (feature, research, feedback, infra, setup, agent-signals, ops, insights)
- **Shared logic**: `lib/*.js` — ~21 modules; see Module Map below
- **Template source of truth**: `templates/generic/commands/` (slash commands); **`templates/generic/cursor-rule.mdc`** (Cursor **`.cursor/rules/aigon.mdc`** on `aigon install-agent cu`). Sync via `aigon install-agent <id>` — do not treat installed `.cursor` / `.claude` paths as the edit target; they are overwritten.
- **Working copies** (gitignored): `.claude/commands/`, `.cursor/commands/`, etc.
- **AIGON server**: `aigon server start` serves the dashboard UI and API; restart it after any `lib/*.js` edit
- **Interrupting agents**: `aigon nudge <ID> [agent] "message"` is the canonical way to message a running session — do not handcraft `tmux send-keys`
- **Tests**: `npm test` · syntax: `node -c aigon-cli.js`
- **Version bumps**: after every commit — `npm version patch|minor|major && git push --tags`
- **Seed reset**: `aigon seed-reset ~/src/<repo> --force` — resets seed repos to initial state. If you are making changes to a seed repo, read `docs/seeds.md` first — the two-repo architecture means a common mistake will silently wipe your work.
- **Cross-machine sync** (Pro): `aigon backup`, `aigon vault`, `aigon sync`, `aigon profile configure|push|pull|status` and the dashboard's Backup & Sync tab live in @aigon/pro (feature 236 moved F359, F380, F388 there). OSS keeps thin verb stubs that delegate to Pro when installed and otherwise print the standard "Pro feature — coming later" notice.
- **Spec frontmatter (F313)**: `complexity:` (low/medium/high/very-high) in feature/research specs drives the dashboard start modal's per-agent `{model, effort}` pre-selection via each agent's `cli.complexityDefaults[<complexity>]` in `templates/agents/<id>.json`, then `aigon config models`. Specs do not store model IDs. Parser + resolver live in `lib/spec-recommendation.js`; API `/api/recommendation/:type/:id`.
- **Spec review states (F341)**: spec review/revision is modelled as first-class engine states (`spec_review_in_progress`, `spec_review_complete`, `spec_revision_in_progress`, `spec_revision_complete`). The two `*_complete` states are transient (xstate `always:` → `backlog`) — declared in `TRANSIENT_STATES` inside `lib/feature-workflow-rules.js` / `lib/research-workflow-rules.js`. Owning-agent for spec revision resolves as: event-payload `nextReviewerId` > frontmatter `agent:` > `snapshot.authorAgentId` > `getDefaultAgent()` (see `resolveSpecRevisionAgent` in `lib/commands/entity-commands.js`). Sidecar `specReview` state on a backlog snapshot triggers a `MISSING_MIGRATION` read-model tag — `aigon doctor --fix` (migration 2.56.0) repairs it.
- **Code review states (F342, F501)**: code review/revision is first-class engine states (`code_review_in_progress`, `code_review_complete`, `code_revision_in_progress`, `code_revision_complete`). `code_review_complete` is transient: routes to `code_revision_in_progress` by default, or `ready` when the reviewer ran `aigon agent-status review-complete --approve`. Reviewers use the CLI flags only — `--approve` for clean reviews, `--request-revision` when fixes are needed; the flag is required (no default). AutoConductor polls `currentSpecState === 'code_revision_complete'` from the engine snapshot. Implementing-agent for code revision: solo → first key of `context.agents`; fleet → `context.winnerAgentId` if set, else `authorAgentId`. `feature-code-revise` is the implementer-side follow-up command.
- **Review escalations (F646)**: reviewers record `ESCALATE:<category> — <reason>` in the implementation log `## Code Review` section (`architectural`, `security`, `scope`, `spec-shortfall`, …). On `review-complete`, markers sync to `review.escalation_raised` events and `openEscalations[]` on the snapshot. `feature-close` blocks until the operator runs `aigon feature-escalation accept|follow-up|reopen <ID> <n>`. Parser: `lib/review-escalation.js`.
- **Close integrity policy (F659)**: review escalations, pre-authorisation footer mismatches, and post-merge gate failures are advisory by default. Strict repos opt in with `featureClose.integrityPolicy: "blocking"` or `featureClose.blockingGates: ["review-escalation", "preauth-validation", "post-merge-gate"]`. Criteria attestation was removed entirely; implementation logs may contain old prose sections, but Aigon ignores them.
- **Close-recovery state (F432)**: `close_recovery_in_progress` is a first-class engine state for the window between a failed `aigon feature-close` and a successful retry. The dashboard's "Close with agent" appends `feature.close_recovery.started` (engine-first) before spawning the `role: 'close'` tmux session — never spawn a recovery session without recording the event. Projector stores `closeRecovery { agentId, startedAt, returnSpecState, sessionName, source }` on the snapshot and keeps `lastCloseFailure` for forensics. Exit via `feature.close_recovery.ended` / `.cancelled` (machine-authoritative target: `ready`) or via `feature.close_requested` → `closing`. `parseTmuxSessionName` recognises the `close` role; the dashboard collector exposes `recoveryTmuxSession` for attach/peek when in this state. **Post-merge gate (F644):** after merge, `feature-close` runs `featureClose.postMergeGate` on merged main; failure emits `feature.close_gate_failed` and enters this recovery state with `lastCloseFailure.kind = 'post-merge-gate'` (full log under `.aigon/state/close-gates/`). When adding a new `currentSpecState`, touch every site listed in `## Adding a currentSpecState` below.
- **Session tracking (F351)**: `aigon session-list` prints all live Aigon-managed tmux sessions (category, entity, role, agent, session name, tmux ID, status). Session sidecars (`.aigon/sessions/{sessionName}.json`) now include `tmuxId` (durable foreign key — stable across renames), `shellPid`, and `category` (`entity` | `repo`). All internal routing uses `tmuxId` via `-t $N` instead of parsing session names. Sidecars without `tmuxId` fall back to name matching.
- **Token-window scheduling (F352)**: `aigon token-window [--message=<text>] [--agents=<list>] [--dry-run]` nudges all active agent sessions with a lightweight message to align rolling provider usage windows. Config key `tokenWindow` in `~/.aigon/config.json` accepts `message`, `targetAgents`, and `timezone`. Kickoff timestamp written to `.aigon/state/last-token-kickoff` (written by the `token-window` command). See `docs/token-maxing.md` for the rolling-window mental model and scheduler examples.
- **Schema migrations in doctor (F353)**: `aigon doctor --fix` now calls `runPendingMigrations(process.cwd())` as the first repair step (before workflow-state bootstrap) — making it the single front-door repair command. Without `--fix`, doctor detects pending migrations and lists them as a "needs fix" item. The migration framework is idempotent (per-version manifest at `.aigon/migrations/<version>/manifest.json`); running `doctor --fix` twice is safe.

## Repo boundary — OSS vs Pro/internal (load-bearing)

**This repo (`~/src/aigon`) is public on GitHub.** Anything you put here is visible to every user, every scraper, every AI training crawler. The repo boundary is non-negotiable:

- **OSS (this repo)** — the CLI source, dashboard, end-user docs under `site/`, generic install testing (e.g. `docker/clean-room/Dockerfile`, `run-f513.sh`, the OSS smoke). Nothing that references a credential, a Pro key, a beta-tester roster, a release-rehearsal script, or any maintainer-only workflow.
- **Pro / internal (`~/src/aigon-pro`)** — Pro source, Pro-related test infra (Dockerfiles, smoke scripts touching real keys), beta keys, pre-publish scripts, internal rehearsal docs.

**Hard rules:**
1. Never write a literal Pro key, beta key, or any credential into this repo. Use `<your-key>`, `$AIGON_PRO_KEY`, or read from env at runtime.
2. Filenames matching `*published-pro*`, `pro-test-*`, `*-pro-key*` belong in `aigon-pro/`, not here.
3. Any file describing how to test or rehearse a Pro release belongs in `aigon-pro/docker/` or `aigon-pro/scripts/`, not here.
4. The pre-commit hook at `.githooks/pre-commit` blocks (1) and (2) automatically — if it fires, do not bypass with `AIGON_ALLOW_SENSITIVE_COMMIT=1` unless you are the maintainer fixing the hook itself. Move the file to aigon-pro instead.

**If you find Pro/internal content in this repo, move it to aigon-pro and flag the find** — do not leave it and do not commit alongside it. There was a leak incident on 2026-05-10 (beta key `aigon-pro-beta-2026` in 3 pushed commits) and the recovery cost was hours of git-history rewriting and credential rotation. The hook exists to prevent a second one.

## Target-repo boundary — zero opinion (load-bearing)

**Aigon is installed into repos it knows nothing about.** Aigon's only domain is the **process** for managing features, research, feedback, and specs. It has **zero opinion** about anything else in the target repo.

Aigon may have opinions about:
- the feature / research / feedback lifecycle (create → prioritise → start → do → eval → close)
- the structure of spec files (frontmatter, `## Summary`, `## Acceptance Criteria`, `## Validation`)
- folders under `docs/specs/` (these are aigon's own folders, written by `aigon feature-create`)
- aigon's own state under `.aigon/` (workflows, state, sessions, config, manifest, telemetry, cache)
- worktrees, branches, tmux sessions (language-agnostic git concepts)
- the `aigon` CLI itself

Aigon may **NOT** have opinions about:
- the target repo's **language** (Node, Python, Rust, Go, …)
- the target repo's **package manager** (npm, pnpm, yarn, pip, cargo, …)
- the target repo's **test framework** or whether it has tests at all
- the target repo's **lint / formatter / type-checker** stack
- the target repo's **build / deploy** process
- the target repo's **directory structure** (no `lib/`, `src/`, `tests/`, `app/`, `pages/` assumptions)
- any **specific commands** like `npm test`, `npm run build`, `pytest`, `cargo build`, `eslint`, `prettier`, `tsc`, `playwright`, etc.
- the target repo's **conventions** around commits, PRs, code review, or test discipline beyond what aigon's own lifecycle imposes

**Where this rule applies:** anything under `templates/{generic,docs,specs,prompts,skill-pointers}/` — those files get installed verbatim into a user's repo via `aigon install-agent`. Every word in those files becomes a prompt or doc the user (or their agent) sees, in **their** repo, with **their** stack.

**Rule of thumb when authoring or editing a template:** if the sentence would be wrong in a Python monorepo, a Rust crate, a Go service, or a static-site repo — it's an opinion the template should not have. Strip it or generalise it.

**Why this matters:** every assumption is a bug for the users who don't match it. "Run `npm test`" is invisible to a Rust shop until their first feature; then it's nonsense. The template-leak guard (`scripts/check-template-leaks.js`) catches the common patterns mechanically and runs in `test:core` and `prepublishOnly` — but the guard is a backstop, not the rule. The rule is **zero opinion**.

**Per-worktree setup (`worktreeSetup`).** Worktrees are fresh checkouts without `node_modules`/virtualenvs/etc. If operators need per-worktree preparation, they declare it as a shell command in `.aigon/config.json` (e.g. `"worktreeSetup": "npm ci"` or `"worktreeSetup": "ln -s ../../node_modules node_modules"`). Aigon executes it once after `git worktree add`, before the agent launches, with a 120-second timeout; failure warns and continues. Aigon **does not** detect the stack and **does not** inject any install command into agent prompts. See `templates/docs/development_workflow.md` § Per-worktree setup and `site/content/reference/configuration.mdx`. F524.

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
| `lib/agent-registry.js` | ~655 | Agent registry: scans `templates/agents/*.json`, provides lookup maps (display names, ports, providers, trust, capabilities). Zero hardcoded agent logic in `lib/`. F414 runtime-dispatch helpers live here: `getSessionStrategy`, `getTelemetryStrategy`, `getTrustInstallScope`, `getResumeConfig` — all consumers read these instead of branching on agent id |
| `lib/model-catalog-diff.js` | ~280 | Weekly catalog diff classifier (F655): pure functions that diff `op` `modelOptions` against an OpenRouter catalog index and emit `active` / `retire-candidate` / `archive-candidate` / `unchanged` rows with proposed `quarantined` / `archived` blocks. No OSS CLI — consumed by maintainer/Pro tooling and `weekly-model-catalog-intelligence` |
| `lib/commands/feature.js` | large | Thin dispatcher for `feature-*` handlers + `sessions-close`. Fat handlers delegate to `lib/feature-*.js` modules (`feature-start`, `feature-eval`, `feature-do`, `feature-close`, `feature-autonomous`, `feature-lifecycle`, `feature-now`, `feature-open`, `feature-backfill-timestamps`, …). Entity-agnostic handlers come from `./entity-commands`. Uses `withActionDelegate` from `action-scope` for the main-repo delegation guard |
| `lib/feature-start.js` / `lib/feature-eval.js` / `lib/feature-do.js` / `lib/feature-autonomous.js` | large / medium / medium / large | Extracted handlers — each exports `run(args, deps)` where `deps` bundles ctx + local closures from the parent dispatcher |
| `lib/feature-close.js` | x-large | Feature-close target resolution, merge, telemetry, engine close, cleanup, and `run(args, deps)` orchestration |
| `lib/feature-lifecycle.js` / `lib/feature-now.js` / `lib/feature-open.js` / `lib/feature-backfill-timestamps.js` | medium | Extracted pause/resume/unprioritise, fast-track create, worktree open, and timestamp backfill commands (F636) |
| `lib/feature-command-helpers.js` | small | Shared helpers for feature handlers: log frontmatter, scope estimation, submission evidence (`getFeatureSubmissionEvidence`) |
| `lib/commands/research.js` | ~940 | All `research-*` handlers, research synthesis/review. Shares parallel handlers via `./entity-commands` |
| `lib/research-draft.js` | ~180 | Agent-assisted research draft flow — mirrors `lib/feature-draft.js`; spawns the configured agent with `templates/prompts/research-draft.md`, validates CLI availability, and reports whether the spec was edited. Consumed by `entityCreate` when `entityType === 'research'` and `--agent` is set |
| `lib/commands/entity-commands.js` | large | Shared factory for parallel feature/research lifecycle commands. `createEntityCommands(FEATURE_DEF\|RESEARCH_DEF, ctx)` returns `${prefix}-{create,prioritise,spec-review,spec-revise,spec-review-record,spec-revise-record}`. `entityResetBase` drives feature-reset/research-reset with entity-specific pre/post-cleanup hooks. **When adding a new parallel command, put it here — not in feature.js/research.js — so both entities pick it up by construction** |
| `lib/commands/agent-signals.js` / `lib/commands/ops.js` / `lib/commands/insights.js` | large / large / medium | Dissolved misc bucket (F636): agent lifecycle signals (`agent-status`, nudge, check/force/drop-agent), operational commands (`repair`, `deploy`, `session-list`, `agent-probe`, `agent-quota`), and analytics/telemetry (`insights`, `stats`, `commits`, `token-window`) |
| `lib/commands/infra.js` | x-large | `aigon server` command, board, config, proxy-setup, dev-server |
| `lib/commands/setup.js` / `lib/commands/setup/*.js` | ~90 / per-command | Setup dispatcher plus per-command entry modules (`init`, `install-agent`, `apply`, `update`, `doctor`, `remove`, `setup`, `global-setup`, checks, notices, seed commands, trust). Shared helpers: `init-bootstrap.js`, `seed-reset.js`, `seed-reset-run.js`, `worktree-cleanup.js`, `gitignore-and-hooks.js`, `pid-utils.js`, `agent-trust.js` |
| `lib/dashboard-server.js` | ~1530 | HTTP/UI shell: dashboard HTML/static serving, WebSocket attach, status-refresh orchestration (fs-watch driven + 60s safety-net poll), notifications, screenshots, and OSS/Pro route dispatch. It delegates dashboard mutations to `lib/dashboard-actions/`, detail/settings reads to focused modules, and status versioning/push/watch/styles to the F620–F628 modules below. **`replaceLatestStatus` is the single write path for status payloads** — never assign `latestStatus` around it |
| `lib/dashboard-status-version.js` / `lib/dashboard-sse.js` / `lib/dashboard-fs-watch.js` / `lib/dashboard-styles.js` | ~120/~90/~340/~80 | **dash-arch live-update + styles stack (F620–F628)**: server-side status fingerprint → monotonic `statusVersion` + ETag/304 on `/api/status` (fields that should repaint cards MUST be in `computeStatusFingerprint`); SSE hub for `GET /api/events` (`status` version pings, `notification`, `server-restarting`); debounced 400ms fs-watchers on `.aigon/state` + `.aigon/workflows` + spec stage trees → targeted `pollRepoStatus` (opt-out `dashboard.fsWatch: false`); ordered concat of `templates/dashboard/styles/*.css` at `/styles.css` (new sheets MUST be registered in `styles/manifest.json`) |
| `lib/dashboard-actions/` | ~550 | Dashboard-triggered side-effect boundary: launch review/spec-review/eval/close/implementation sessions, run interactive CLI actions, nudge sessions, agent control, and mark-complete workflow signals |
| `lib/dashboard-detail.js` / `lib/dashboard-settings.js` / `lib/dashboard-pro-assets.js` / `lib/dashboard-action-command.js` | ~550/~280/~40/~220 | Extracted dashboard read/config/static helpers: detail drawer payloads, settings schema resolution, Pro dashboard asset/stub resolution, and `/api/action` command parsing/validation |
| `lib/dashboard-routes.js` | ~60 | Thin aggregator — composes per-domain route modules and exposes the dispatcher (`createDashboardRouteDispatcher`). Composed from `lib/dashboard-routes/`: `analytics.js` (analytics + telemetry endpoints), `config.js` (config read/write endpoints), `entities.js` (feature/research/feedback CRUD endpoints), `events.js` (`GET /api/events` SSE push, F622), `recommendations.js` (`/api/recommendation/*`), `sessions.js` (tmux/session endpoints), `system.js` (health, version, repo metadata), `util.js` (shared response helpers + route-table builders) |
| `lib/dashboard-status-collector.js` | ~20 | Thin facade re-exporting `lib/dashboard-collect/` assembly + logs + compatibility shims |
| `lib/dashboard-collect/` | ~2500 | Decomposed read-side collector (F633): `assembly.js` (poll orchestration), `feature-poll.js` / `collect-research.js` / `collect-feedback.js` (per-entity), `entity-core.js` (agent rows, identity, pending-signal), `set-cards.js`, `tier-cache.js`, `infra-probes.js`, `safe-reads.js`, `logs.js` |
| `lib/read-model/entity-view.js` | ~250 | **Canonical single-entity read model (F517).** `buildEntityView(repoPath, entityType, id, options)` answers "what is the state of feature/research N?" in ONE place — returns `{ id, type, lifecycle, stage, closed, blocked, blockedBy, agentRows, sessions, specPath, snapshotPath, complexity, set, criteria, name, source }`. Does **one** snapshot read, **one** spec read, **one** session enumeration per call. Consumers project from it instead of re-deriving (`feature-status`, `checkUnmetDependencies`, dashboard `blockedBy`). NOT workflow-core: it lives outside `lib/workflow-core/` and consumes workflow-core only via the public barrel (`require('../workflow-core')`) + the low-level `workflow-snapshot-adapter.js`; sessions come **only** through the `lib/agent-sessions` (F554) boundary — never raw tmux. Dashboard DTO shaping stays in the collector, not here |
| `lib/dashboard-spec-index.js` | ~300 | Feature-spec read cache/index: builds canonical `{stage,id,slug,fullPath,setSlug,dependsOn,frontmatterRaw}` entries, reuses across `/api/status` polls behind stage-dir + per-file mtime checks, and runs watchdog cold-rebuild comparisons for drift detection |
| `lib/utils.js` | ~183 | Cross-cutting re-exports (config, proxy, worktree, templates, git) + feedback constants, dev-server URL, terminal title; safeWrite lives in `lib/safe-write.js` |
| `lib/safe-write.js` | ~35 | Leaf atomic file-write helpers (`safeWrite`, `safeWriteWithStatus`) — breaks templates ↔ utils cycle |
| `lib/binary-check.js` | ~25 | Leaf PATH probe (`isBinaryAvailable`) — breaks agent-availability → security → config cycle |
| `lib/hooks.js` | ~146 | Hook lifecycle: parseHooksFile, getDefinedHooks, executeHook, runPreHook, runPostHook |
| `lib/analytics.js` | ~889 | Analytics: collectAnalyticsData, parseLogFrontmatterFull, buildCompletionSeries, buildWeeklyAutonomyTrend |
| `lib/version.js` | ~154 | Version management: getAigonVersion, compareVersions, getChangelogEntriesSince, checkAigonCliOrigin |
| `lib/spec-crud.js` | ~247 | Spec file CRUD: findFile, moveFile, modifySpecFile, getNextId, createSpecFile, readSpecSection |
| `lib/cli-parse.js` | ~256 | CLI option parsing + YAML helpers: parseCliOptions, parseFrontMatter, serializeYamlScalar, slugify, escapeRegex |
| `lib/deploy.js` | ~65 | Deploy command resolution and execution: resolveDeployCommand, runDeployCommand |
| `lib/worktree.js` | ~460 | Git worktree lifecycle only: base paths, `git worktree add/remove`, `setupWorktreeEnvironment` (incl. `worktreeSetup`, F524), permissions/trust presetting, attribution install. **Compatibility facade (F632):** deprecated lazy re-exports for tmux, launch, terminal, and session read-model — importers migrate to `lib/agent-launch-command.js`, `lib/terminal-launch.js`, `lib/agent-sessions/` |
| `lib/agent-launch-command.js` | ~830 | Shell-trap wrapper, heartbeat sidecar, inline-prompt files, `buildAgentCommand` / `buildRawAgentCommand` / `buildResearchAgentCommand` (F632). Triplet resolution stays in `lib/agent-launch.js` |
| `lib/terminal-launch.js` | ~180 | Terminal app dispatch: `openTerminalAppWithCommand`, `openInWarpSplitPanes`, `openSingleWorktree`, `ensureTmuxSessionForWorktree` (F632). Adapter registry remains `lib/terminal-adapters.js` |
| `lib/validation.js` | ~1045 | Iterate (Autopilot) loop, acceptance-criteria parsing |
| `lib/config-core.js` | ~400 | Leaf config file I/O: paths, read/parse/merge/write for `~/.aigon/config.json` + `.aigon/config.json`. No imports from agent-registry, templates, proxy, instance-identity, or profile-placeholders. Consumed by `lib/config.js` facade and direct callers that must avoid the config hub cycle |
| `lib/config.js` | ~1240 | Compatibility facade: re-exports config-core plus agent/profile-aware resolution. Higher layers import this; new config keys should land in config-core when they do not need registry/profile |
| `lib/config-agent-layer.js` | ~65 | Agent-aware config composition above config-core + agent-registry (`buildDefaultGlobalConfig`, `getAgent`); `config.js` imports this instead of agent-registry directly — breaks the facade↔registry cycle |
| `lib/proxy-dns.js` | ~70 | Leaf DNS/port helpers (`sanitizeForDns`, `buildCaddyHostname`, `deriveServerIdFromBranch`, `hashBranchToPort`). Breaks `instance-identity` ↔ `proxy` cycle; `lib/proxy.js` re-exports |
| `lib/telemetry.js` | ~5 | Thin facade → `lib/telemetry/` package (F634): `core.js` (normalized records + aggregation), `pricing.js`, `sqlite.js`, `capture.js`, `providers/{cc,gg,ag,cx,op}.js` + `registry.js` dispatch via `getTelemetryStrategy` |
| `lib/workflow-core/` | ~1500 | **Workflow engine**: event-sourced state, XState machine, action derivation, effect lifecycle |
| `lib/spec-store/` | ~400 | **Durable spec storage boundary (F573).** `createSpecStore({ repoPath })` exposes spec-shaped I/O plus lease coordination (`acquireLease`, `renewLease`, `releaseLease`, `readLeases`), pre-write sync, `aigon storage doctor|report|convert`. Local backend thin-wraps workflow-core helpers; **git-branch** backend (F609/F613) stores canonical events as a file tree on an orphan branch (`aigon-state`: `meta.json` + `specs/<KEY>/events.jsonl` + `leases/<KEY>.json`) via `git-plumbing.js` tree helpers, never checking the branch out. Legacy `git-ref` config is rejected loudly — migrate with `aigon storage convert --backend=git-branch`. Design: `docs/specstore-architecture.md` |
| `lib/workflow-snapshot-adapter.js` | ~310 | Read adapter: workflow-core snapshots → dashboard/board formats |
| `lib/profile-placeholders.js` | ~500 | Profile presets, detection, instruction directive resolvers, `getProfilePlaceholders()`. **Does not inject package-manager commands** — per-worktree setup is operator-declared via `.aigon/config.json` `worktreeSetup` and executed by `lib/worktree.js` after `git worktree add` |
| `lib/nudge.js` | ~250 | Shared nudge primitive: resolves tmux sessions from workflow state, rate-limits, and records `operator.nudge_sent` events. **Delivery (paste-buffer / send-keys / pane-echo confirm) is owned by `TmuxSessionHost.deliverOperatorMessage` (F554)**; nudge prefers the sidecar `tmuxId` and falls back to the session name for old sidecars |
| `lib/auto-nudge.js` | ~190 | Display-only idle ladder for dashboard agent rows: derives visible idle / nudged / needs-attention states from idle-at-prompt + stale status writes, optionally dispatches one nudge per live session, records signal-health telemetry, and supports per-session pause |
| `lib/feature-spec-resolver.js` | ~140 | Canonical spec lookup |
| `lib/spec-view.js` | ~380 | **Generated lifecycle symlink view (F669).** Idempotent projector: `computeDesiredView(repoPath)` builds the complete `{linkPath → relativeTarget}` map from current snapshots + canonical `00-specs` identities (never replays move intents/event ledgers); `reconcileView` creates/replaces/removes only paths it can **prove** are Aigon-managed (a relative symlink resolving to a direct child of the matching kind's `00-specs`), leaving regular files, unmanaged/out-of-root symlinks, and duplicate-identity entities untouched with a structured diagnostic (`DIAG.*`). Gated on `specLayout: stable` (no-op under legacy). Writes a disposable manifest (`.aigon/state/spec-view-manifest.json`) and excludes generated links via the repo's local `info/exclude`. `refreshView` is the safe entry (never rolls back canonical state); wired into `spec-layout migrate`, `storage sync`, and `storage doctor --fix`. CLI: `aigon spec-view status\|refresh` (`lib/commands/spec-view.js`) |
| `lib/feature-sets.js` | ~240 | Derived-state scanner: reads optional `set:` frontmatter from feature specs, builds `{setSlug → members}` index, topologically orders members using the existing `depends_on` graph (intra-set edges only). No new files or engine state — the dashboard/CLI derive set state from member workflow state. A set is **complete** when all members are `done` (`aigon set list` hides completed sets; `set list --all` shows them). **Agents must not tag new specs into completed sets** — use standalone + `depends_on` for follow-up work. See `templates/docs/feature-sets.md` § *Completed sets — do not rejoin*. Consumed by `lib/commands/set.js` and `lib/dashboard-status-collector.js` (`sets` rollup + per-feature `set` key) |
| `lib/feature-set-workflow-rules.js` | ~60 | Central action registry for set dashboard cards: derives `set-autonomous-{start,stop,resume,reset}` eligibility and button metadata from derived set state. Frontend must render only from this server-owned `validActions` payload |
| `lib/set-conductor.js` | ~500 | Set-level autonomous orchestration (`set-autonomous-start|stop|resume|reset`): resolves set members with strict cycle checks, starts/resumes per-feature `feature-autonomous-start`, polls `feature-<id>-auto.json`, and persists durable set state in `.aigon/state/set-<slug>-auto.json` |
| `lib/state-queries.js` | ~250 | Read-only UI helpers: feedback action/transition derivation (pure, no I/O) |
| `lib/agent-status.js` | ~130 | Per-agent status files (`.aigon/state/{prefix}-{id}-{agent}.json`), atomic writes, signal-health observation |
| `lib/signal-health.js` | ~280 | Signal reliability telemetry: append-only JSONL under `.aigon/telemetry/signal-health/`, summaries for CLI/API/doctor, missed-signal de-duplication, and retention GC |
| `lib/agent-prompt-resolver.js` | ~140 | Resolves launch prompt for agent + verb. Slash-invocable agents (cc/cu) pass through `cliConfig.<verb>Prompt`; non-invocable agents (cx/op/km/ag) inline the canonical template body directly. Membership is derived from `capabilities.resolvesSlashCommands` in `templates/agents/<id>.json` — never hardcode |
| `lib/agent-launch.js` | ~130 | `resolveLaunchTriplet` + `buildAgentLaunchInvocation`. **Every** spawn path must route through this helper so per-feature `{model, effort}` overrides captured on `feature.started` survive every respawn |
| `lib/agent-sessions/` | large | AgentSession domain model, sidecar-compatible store, event helpers, and injectable service contract for long-lived interactive agent runtime records. Normalizes `.aigon/sessions/{sessionName}.json`; models agent-less `auto` + set (`'S'`) sessions (F554). Domain files import no worktree/workflow-core/dashboard/command modules. **`names.js`** owns session naming/parsing; **`enriched-sessions.js`** (F632) owns dashboard read-model helpers (`getEnrichedSessions`, orphan classification, sidecar index); **`entity-sessions.js`** (F632) owns `ensureAgentSessions` / `gracefullyCloseEntitySessions`; **`console.js`** holds console-snapshot DTOs; **`hosts/tmux-exec.js`** (F632) is the only module that spawns the `tmux` binary; **`hosts/tmux.js`** is the `TmuxSessionHost`; **`hosts/index.js`** is the host registry. The service is the only module that knows both store and host |
| `lib/stats-aggregate.js` | ~270 | Rolled-up stats cache (`.aigon/cache/stats-aggregate.json`); rebuilt lazily; includes `perTriplet` rollup keyed on `agent\|model\|effort` |
| `lib/migration.js` | ~300 | Versioned state migrations with backup/restore/validate lifecycle |
| `lib/global-config-migration.js` | ~150 | Machine-wide `~/.aigon/config.json` migrations: versioned registry, backup/write-once runner, terminal settings rename (`terminal`/`tmuxApp` → `terminalApp`) |
| `lib/pro.js` | ~25 | Pro gate: lazy-require `@aigon/pro`. Only `lib/pro-bridge.js` calls it |
| `lib/pro-bridge.js` | ~180 | Pro extension point: `initialize({ helpers })` + in-process route registry |
| `lib/remote-gate-github.js` | ~170 | GitHub PR-aware close helper: `feature-close` gate based on `gh pr list` |
| `lib/proxy.js` | ~660 | Caddy management, port allocation, dev server utilities |
| `lib/commands/recurring.js` | ~40 | Pro-delegating stub for `aigon recurring-run|recurring-list`; engine moved to @aigon/pro (feature 236) |
| `lib/commands/schedule.js` | ~30 | Pro-delegating stub for `aigon schedule add|list|cancel`; engine moved to @aigon/pro (feature 236) |
| `lib/commands/agent-launch.js` | ~30 | Pro-delegating stub for `aigon agent-launch`; internal scheduler primitive moved to @aigon/pro (feature 236) |
| `lib/feature-autonomous-payload.js` | ~117 | Shared validator + argv builder for `feature-autonomous-start` payloads. Keeps dashboard `POST /api/features/:id/run`, scheduled kickoffs (F367), and the CLI in lockstep |
| `lib/pty-session-handler.js` | ~120 | F356 in-dashboard terminal helper: short-lived single-use PTY tokens (30 s TTL) gating WebSocket attach, plus loopback-only origin check |
| `lib/session-sidecar.js` | ~271 | F357 background capture: post-launch resolves the agent's transcript file (Claude UUID / Codex stem / Gemini sessionId), then writes `agentSessionId` + `agentSessionPath` onto `.aigon/sessions/{name}.json`. Used by `feature-do --resume` to deterministically reattach a dead tmux session |
| `lib/state-render-meta.js` | ~39 | Server-owned render metadata table for every `currentSpecState` (icon, label, css class, optional badge). Dashboard API attaches `stateRenderMeta` per row so the frontend renders status with zero per-state branching |
| `lib/templates.js` | ~550 | Template loading, scaffolding, COMMAND_REGISTRY |
| `lib/git.js` | ~700 | Branch, worktree, status, commit helpers, attribution |
| `lib/security.js` | ~131 | Merge gate scanning (gitleaks + semgrep) |
| `lib/workflow-heartbeat.js` | ~160 | Display-only liveness computation (alive/stale/dead); never changes engine state |
| `lib/budget-poller.js` | medium | F322 budget scrape primitives (tmux/app-server parsers) consumed by `lib/agent-quota-poller.js` only — no standalone poller or cache writes (F636) |
| `lib/agent-quota-read.js` / `lib/agent-quota-poller.js` | medium / medium | **F616 unified agent-quota state:** single cache `.aigon/state/agent-quota.json` (`schemaVersion: 1`), one background poller, `GET/POST /api/agent-quota`. Merges F322 budget windows, F444 probe verdicts, and F615 provider wallets. `aigon doctor --fix` migrates legacy `budget-cache.json` + `quota.json` |
| `lib/quota-probe.js` | medium | F444 probe classification + `scripts/probe-agent.js` integration; reads/writes delegate to `agent-quota-read.js` |
| `lib/supervisor.js` | ~430 | Server monitoring: liveness, idle/awaiting-input notifications, and token-exhaustion detection (F308) that may append workflow events, pause a feature, or auto-switch a slot per `agentFailover` policy |
| `lib/supervisor-service.js` | ~175 | Server auto-restart (launchd/systemd) for `aigon server start --persistent` |
| `lib/terminal-adapters.js` | ~200 | Detect/launch/split per terminal. **Registry API (F350)**: each adapter carries `id`, `displayName`, `pickerLabel`, `platforms`, `aliases`, `hiddenFromPicker` — all consumer surfaces (dashboard enum, onboarding picker, canonicaliser, help text) derive from this single source. Adding a new terminal requires only one adapter object here. Exports: `getTerminalIds`, `getPickerOptions`, `getDashboardOptions`, `getDisplayName`, `canonicalize`, `isValidId` |

Thin facades (re-exports only): `lib/constants.js`, `lib/utils.js`, `lib/telemetry.js`.

## State Architecture
Feature and research lifecycle state are managed by the **workflow-core engine** (`lib/workflow-core/`):

- **Event log** (`.aigon/workflows/features/{id}/events.jsonl`) — append-only, immutable
- **Snapshot** (`.aigon/workflows/features/{id}/snapshot.json`) — derived from events
- **XState machine** — validates lifecycle transitions; `snapshot.can()` for action derivation
- **Effect lifecycle** — durable, resumable side effects (requested → claimed → succeeded/failed)
- **Exclusive file locking** — prevents concurrent modification
- **Create-time bootstrap (F667)** — `feature-create` / `research-create` reserve an **immutable numeric identity** (`aigon_id: F42`), write the numbered spec file, and seed the workflow snapshot at that numeric id in the same write path — under both `specLayout` values. Prioritise is a **lifecycle-only** transition; it no longer re-keys slug → numeric. Slug-keyed engine ids and `migrateEntityWorkflowIdSync` survive only as the `legacySlugPrioritise` compatibility path for pre-F667 unnumbered inbox specs. See `docs/specstore-architecture.md` § *Spec layout: canonical `00-specs`* and `docs/architecture.md` § *Spec Frontmatter: aigon_id*.

Supporting state:
- **Canonical spec files** (`docs/specs/{features,research-topics}/00-specs/` under `specLayout: stable`) — the one durable, committed home for each spec's markdown for its whole lifetime; numbered from creation (F667/F668). Owned by `lib/workflow-core/paths.js` (`getCanonicalSpecDirForEntity`).
- **Lifecycle stage folders** (`docs/specs/features/0N-*/`) — under **legacy** layout these are the committed ground truth and lifecycle commands `git mv` specs between them. Under **stable** layout they are a **generated symlink view** (F669, `lib/spec-view.js`) of workflow state — disposable, git-ignored, refreshed on every transition; `move_spec` is suppressed (F670). Never treat folder position as authority when an engine snapshot exists. **Stable is opt-in** via `aigon spec-layout migrate --stable`; unmigrated repos (including this one) stay legacy.
- **Recurring templates** (Pro): the weekly/quarterly feature templates and the recurring-features engine moved to @aigon/pro with feature 236 (replacing F320). OSS no longer auto-creates batches; `aigon security-scan` remains in OSS as an on-demand CLI for the manual one-shot.
- **Agent status files** (`.aigon/state/feature-{id}-{agent}.json`) — managed by `lib/agent-status.js`
- **Per-agent overrides** (`snapshot.agents[id].modelOverride` / `effortOverride`) — optional `{model, effort}` captured on `feature.started` and honoured by every respawn path via `lib/agent-launch.js:buildAgentLaunchInvocation`. Precedence: event override > workflow stage triplet > `aigon config models` > agent JSON default > null. Never read `cliConfig.models[...]` directly in a new spawn site
- **Shell trap signals**: `buildAgentCommand()` wraps agent commands with a bash `trap EXIT` that fires `agent-status implementation-complete` / `review-complete` / `error`. A heartbeat sidecar touches `.aigon/state/heartbeat-{featureId}-{agentId}` every 30s. Controlled by `signals` in `templates/agents/*.json`.
- **Agent launch env vars**: agent launch paths such as `buildAgentCommand()` in `lib/agent-launch-command.js` and `launchPromptCommand()` in `lib/commands/entity-commands.js` export `AIGON_ENTITY_TYPE` (`feature`|`research`), `AIGON_ENTITY_ID`, `AIGON_AGENT_ID`, and `AIGON_PROJECT_PATH` for spawned agent processes. Agent-side commands read these directly for entity context; `aigon agent-context` only recovers the agent id when `AIGON_AGENT_ID` is absent.
- **Code review (F342)**: engine states `code_review_*` / `code_revision_*` are authoritative; AutoConductor polls `currentSpecState === 'code_revision_complete'`. Legacy `review-state.json` sidecars are replayed by `aigon doctor --fix` (migration 2.58.0) — no runtime writers remain.
- **AutoConductor** (`feature-autonomous-start __run-loop`): detached tmux session. Solo: polls allReady → review session (if `--review-agent`) → waits for `review-complete` → `feature-close`. Fleet: polls allReady → eval session → polls eval file for `**Winner:**` → `feature-close <winner>`. Kills its own tmux session on completion.
- **SetConductor** (`set-autonomous-start __run-loop`): detached tmux session `<repo>-s<slug>-auto` that runs set members sequentially in topological order, delegates each member to `feature-autonomous-start`, and persists durable set state at `.aigon/state/set-<slug>-auto.json` (lock-protected writes).
- **Heartbeat is display-only**: liveness tracking in memory only; never triggers engine transitions. Users manually mark agents as lost/failed — the system never does this automatically.
- **Idle detection is display-only**: supervisor derives `idleState` from workflow progress gaps while a matching tmux session is still alive. It may badge and notify, but never kills, restarts, or auto-approves agents for idle alone.
- **Token exhaustion (F308) is the exception**: when a positive detector fires, the supervisor may append `agent.token_exhausted`, pause the feature, notify, and (policy `switch`) kill that slot's tmux session and spawn the next agent in the failover chain via `buildAgentCommand` / `buildAgentLaunchInvocation`.
- Log files are **pure narrative markdown** — no frontmatter, no machine state

Research lifecycle also uses workflow-core (`.aigon/workflows/research/{id}/`). Feedback stays outside the engine; its frontmatter `status` is the authority and folder position is a reconciled projection.

### Adding a `currentSpecState`
A new lifecycle state is a coordinated change across the engine, projector, machine, dashboard read paths, and tmux conventions. Touch every site or risk a half-state. Audit derived from F432.

1. `lib/workflow-core/types.js` — add the value to `LifecycleState`.
2. `lib/workflow-core/paths.js` — map the lifecycle to its `0N-*/` directory in `LIFECYCLE_TO_FEATURE_DIR` (and `LIFECYCLE_TO_RESEARCH_DIR` if applicable). A missing entry throws "unknown-lifecycle" at write time.
3. `lib/feature-workflow-rules.js` (and/or `lib/research-workflow-rules.js`) — add the state node to `FEATURE_ENGINE_STATES` with explicit `on:` transitions both into and out of it; include a guard in `FEATURE_ENGINE_GUARDS`; thread the state through every `FEATURE_ACTION_CANDIDATES` guard that should keep working there (Reset, Pause, Close…). If the state is transient, register it in `FEATURE_TRANSIENT_STATES`.
4. `lib/workflow-core/machine.js` — add the matching guard in `setup({ guards })` and order the `hydrating` transition list deliberately (place the new guard before any default fallback).
5. `lib/workflow-core/projector.js` — handle each new event type, set `lifecycle = '<new_state>'` and any context blob (e.g. `closeRecovery`); ensure the post-loop default block initialises the field so old snapshots replay cleanly.
6. `lib/workflow-core/engine.js` — add an `applyTransition` switch case (so incremental apply matches projector), an exported `record*` helper, expose the context field on `snapshotFromContext`, and (if relevant) suppress the `move_spec` effect when state changes do not change folders.
7. `lib/state-render-meta.js` — add the icon/label/css; the integration test enforces coverage. Run `Skill(frontend-design)` before finalising copy.
8. `lib/workflow-snapshot-adapter.js` — narrow or extend any state-keyed CTA swaps; do not key the read model only on `lastCloseFailure`.
9. `lib/dashboard-status-helpers.js` and `lib/dashboard-status-collector.js` — surface any role-specific tmux session, attach commands, and per-feature snapshot fields; expose `recoveryTmuxSession`-style helpers rather than overloading `do`-role semantics.
10. `lib/worktree.js` — extend `VALID_TMUX_ROLES` and the `parseTmuxSessionName` role alternation if a new tmux role is needed; add a round-trip regression test.
11. Tests — at minimum: a projector regression for the event sequence, an integration round-trip end-to-end (failed → recovery → retry → done), an adapter swap test, and a tmux name parse test.
12. Docs — `docs/architecture.md` lifecycle table and any module map line; `CHANGELOG.md`; this `AGENTS.md` "State Architecture" section if behaviour shifts.

### Dashboard read-only rule
The dashboard may not mutate engine state directly and may not parse engine-state/spec/log files directly from `dashboard-server.js` or frontend code. File-format ownership stays with read-side owner modules (`state-queries.js`, `workflow-snapshot-adapter.js`, `action-command-mapper.js`, `spec-reconciliation.js`, `agent-status.js`, `feature-spec-resolver.js`, `dashboard-status-collector.js`). **Close authority for feature cards:** `closeReadiness` on each feature row (from `buildCloseReadiness` in the collector) — the frontend gates ready indicators, headline precedence, and primary close actions on that DTO only.

### Write-Path Contract
Every write path (CLI command, autonomous-loop injection, hook-triggered transition) must produce the engine state its matching read path assumes exists — snapshot, event, or skill-file-pointer prompt for non-slash-command agents. Writes seed engine state; reads derive from it — never the reverse.

Recent incidents — every one of these is a case of a read path paving over a missing producer instead of failing loudly:
- **F270 → `1c2766bc`** — prioritise assumed a snapshot existed; when it didn't, the read path silently fell through. Fix: fail loud and point at `aigon doctor --fix`.
- **F272 → `cbe3aeba` + `98ed172b`** — the reconciler moved spec files across repos on every dashboard refresh. Fix: detect-only on read paths; `AIGON_AUTO_RECONCILE=1` opt-in for mutations.
- **AutoConductor → `b9c39a26`** — cx injection arrived as a phantom because the read path assumed a skill-file-pointer prompt it never got. Fix: respect `capabilities.resolvesSlashCommands`.
- **F283 → spec-review scanner deletion** — the dashboard scanned git log for `spec-review:` commits to derive badges, paving over the fact that the engine snapshot already carried `pendingCount`/`pendingAgents`. Fix: read-model copies verbatim from the snapshot.
- **F271 → `legacyStatusFile` fallback** — research rows silently fell through to `feature-<id>-<agent>.json` when the canonical path was missing. Fix: canonical path only; missing file = no status.
- **F285 → F293 → F294** — three features in a row on the same bug class. Snapshotless features first got a silent read-only `LEGACY_MISSING_WORKFLOW` degrade, then kept producing follow-on gaps. The final cut (F294) collapses both `COMPAT_INBOX` and `LEGACY_MISSING_WORKFLOW` into one `MISSING_SNAPSHOT` read-model tag (`readModelSource`) — no legacy half-state. The **dashboard** still loads full grids: for **inbox** and **backlog** folder positions, `buildMissingSnapshotState` synthesizes **pre-engine** actions (e.g. Prioritise / Start) from folder stage so seed repos stay usable; snapshotless rows in later folders keep empty `validActions`. **CLI** paths that require engine state still exit non-zero and cite `aigon doctor --fix`.
- **F294 + `b1db12d3` → F296** — deleting `COMPAT_INBOX` was correct, but create still produced slug-keyed inbox specs with no snapshot, so `b1db12d3` had to re-derive inbox actions from folder stage. F296 closes the producer gap: create bootstraps inbox snapshots immediately and prioritise re-keys slug → numeric under one shared workflow helper.
- **jvbot duplicate-match (2026-04-20)** — `listVisibleSpecMatches` accepted any `/^\d+-/` folder, so a stale pre-rename `04-done/` sibling caused the resolver to return two spec copies. Fix: tight allow-list (`CANONICAL_STAGE_DIRS` in `lib/workflow-core/paths.js`).
- **F397 (2026-04-27)** — multiple sites checked spec folder position *before or instead of* the engine snapshot, producing the wrong lifecycle answer when the two disagreed: dependencies stuck unmet against engine-done deps; set-conductor stalling on engine-done members; analytics undercounting completions. Fix: extracted `isEntityDone(repoPath, entityType, id, folderFallback)` in `lib/workflow-core/entity-lifecycle.js` and applied the precedence rule everywhere — **engine snapshot first; folder fallback only when no engine dir exists** (true pre-start or pre-engine legacy). `buildMissingSnapshotState` now exposes `engineDirExists` so the dashboard can distinguish drift (engine dir, no snapshot — inert, no synthesised actions) from genuine pre-start (no engine dir — keep Prioritise/Start). Drift correction in `entityCloseFinalize` now emits a `spec.drift_corrected` event into `events.jsonl` so the underlying producer bug is observable, not silently masked.

**Rule:** When adding a new read path, grep for every parallel write path that produces the state it now assumes, and pin the invariant with a test. When a read path can't find the state it needs, **fail loudly and cite the repair command** (`aigon doctor --fix`) — do not add a silent fallback or a half-state.

## Install Architecture
`aigon install-agent` writes **only aigon-owned files** — it does not write or modify `AGENTS.md`, `CLAUDE.md`, or `README.md`. These are user-owned. Discovery happens via per-agent skill descriptions and always-loaded rule files installed under `.claude/`, `.cursor/`, etc. At the end of a successful install, aigon prints a one-line snippet the user MAY paste into their `AGENTS.md` if they want a top-level pointer — but aigon does not edit it.

**Per-agent outputs:**
- **cc**: `.claude/commands/aigon/*.md`, `.claude/settings.json` (permissions + hooks), `.claude/skills/aigon/SKILL.md`
- **ag**: `.agents/skills/aigon-*/SKILL.md` (project-local), Antigravity trust under `~/.gemini/antigravity-cli/`
- **gg** (deactivated — records only): retained in `templates/agents/gg.json` for historic telemetry display; not installable or launchable
- **cx**: `.agents/skills/aigon-*/SKILL.md` (project-local), `.codex/config.toml`. Codex also needs exact-path trust entries in `~/.codex/config.toml` for each worktree; trusting only `~/.aigon/worktrees/<repo>` is not enough for child worktrees to inherit the repo `.codex/config.toml`.
- **cu**: `.cursor/commands/aigon-*.md`, `.cursor/cli.json`, `.cursor/hooks.json`, `.cursor/rules/aigon.mdc`
- **op**: `.agents/skills/aigon-*/SKILL.md` (project-local). OpenCode is a router/harness; Aigon does not own its config or hardcode a default model — model/provider selection stays in the user's OpenCode config. Aigon-spawned sessions use `opencode run "<inline prompt body>"` via the shared non-slash launch path (see `lib/agent-prompt-resolver.js`).

**Shared:** `.aigon/docs/agents/{agent}.md` (marker blocks), `.aigon/docs/development_workflow.md` (full overwrite), and any other `templates/docs/*.md` files vendored to `.aigon/docs/` (F421). The consumer's own `docs/` folder is never touched. `AGENTS.md` is **not** managed by aigon (F420). Existing aigon marker blocks are stripped on `aigon doctor --fix`; legacy `docs/development_workflow.md` and `docs/agents/` are migrated to `.aigon/docs/` on `aigon doctor --fix`.

**Context delivery** (no root file injection):
- CC: SessionStart hook `aigon project-context` prints doc pointers to stdout → agent ingests as conversation context
- CU: `.cursor/rules/aigon.mdc` with `alwaysApply: true`
- CX: `.codex/prompt.md` with marker blocks; aigon-spawned Codex sessions inline template bodies directly

**Install manifest** (F422): every file written by `install-agent` is recorded in `.aigon/install-manifest.json` with `{path, sha256, version, installedAt, templateSha?, templatePath?}`. On re-install, files whose sha256 differs from the manifest are warned about (prompt in interactive mode; `AIGON_NONINTERACTIVE=1` or `--force` skips). `aigon remove [--dry-run] [--force] [--purge]` reads the manifest and deletes every tracked file; without `--purge` it never touches `.aigon/workflows/`, `.aigon/state/`, `.aigon/sessions/`, or `.aigon/config.json`; with `--purge` it removes `.aigon/` entirely. `aigon remove` also deregisters the repo from the global registry. Migration 2.61.0 (`migrate_initialize_install_manifest`) synthesizes the manifest for legacy repos. `aigon doctor` reports missing/modified/untracked files; `aigon doctor --fix` triggers the migration.

### Agent install / template sync (F502)
Templates in `templates/generic/commands/` are the source of truth; installed copies are produced by `aigon install-agent` and only refresh when that command runs. F502 adds three guard layers so installed copies never fall behind silently:

1. **Layer 1 — startup drift warning.** Every `aigon` invocation does a fast template-vs-manifest check (mtime fingerprint cache at `.aigon/state/template-drift-cache.json`; cold-cache cost <50ms). When a template's sha256 differs from the `templateSha` recorded in the manifest entry, the CLI prints one line per affected agent: `⚠️  cc: 3 templates updated since install (...). Run aigon install-agent --all`. Suppress with `.aigon/config.json` `{"installDriftWarnings": false}` or env `AIGON_SKIP_TEMPLATE_DRIFT=1`.

2. **Layer 2 — version-bump auto-reinstall.** When `package.json` `version` ≠ `manifest.aigonVersion`, `aigon` silently re-runs `install-agent` for every agent in `manifest.agents`. Hand-edited files (manifest sha != on-disk sha) are snapshotted before the reinstall and restored afterward — never silently overwritten. Reports `✓ aigon upgraded X → Y — refreshed N agents` plus a per-skipped-file list. Suppress with `AIGON_NO_AUTO_REINSTALL=1` or `.aigon/config.json` `{"autoReinstallOnVersionChange": false}`.

3. **Layer 3 — CI lockstep test.** `tests/integration/install-manifest-lockstep.test.js` re-runs `install-agent --all` in a tmpdir and fails if the resulting manifest's `(path, sha256)` set diverges from the committed manifest. Catches the "edited a template, forgot to commit the regenerated install" case. Runs as part of `npm run test:core`.

4. **Release-time guard.** `package.json` `prepublishOnly` chains `scripts/check-install-manifest-clean.js` before `check-pack.js`: re-runs `install-agent --all` and fails the publish if it produces a non-empty git diff (excluding `installedAt` timestamp ticks).

**`aigon doctor --fix-templates`** lists every tracked file as `OK` / `STALE_TEMPLATE` / `HAND_EDITED`. Adding `--fix` refreshes stale files automatically (delete + re-install) and prompts `[r]efresh / [k]eep / [d]iff` per hand-edited file in interactive mode. Non-interactive runs (`--yes`, piped stdin) skip hand-edited files with a summary.

**Safety contract — never silent overwrite.** Layers 2 and 3 both lean on the manifest's recorded `sha256`: a file is only considered safe to refresh when its on-disk sha matches the install-time sha. If the user edited the file, all auto-paths leave it alone. The only way an installed file gets overwritten without a prompt is when it matches the manifest exactly — i.e. the user has not touched it.

**SessionStart version check (F493)**: Hooks call `aigon check-version`. It prints drift vs `.aigon/version`, optional origin/npm notices, and tells you to run `aigon apply` when you want to sync — it does **not** auto-run `aigon apply`, reinstall agents, run repo migrations, or auto-commit project files.

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
- **New command** → `lib/commands/{domain}.js` (feature, research, feedback, infra, setup, agent-signals, ops, insights)
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

**Git (agents):** Put **implemented** changes for an active numbered feature/research entity on **that entity’s integration branch/worktree**, not unsolicited bulk commits onto `main` when isolation is intended. **New inbox specs only** (`aigon feature-create` / `research-create` → `docs/specs/features/01-inbox/` or research/feedback equivalents) are **normally committed on `main`** (default branch)—that is workflow-scaffolding, not "feature implementation".

1. **Run args verbatim** — pass exactly the args the user gave; never add agents/flags from context
2. **Filter `.env.local`** — never let it block `feature-close` or `aigon agent-status implementation-complete`
3. **Screenshot dashboard changes** — take a Playwright screenshot after any `templates/dashboard/index.html` edit. Save all screenshots to `./tmp/` — never write PNG/JPG to the repo root (`.gitignore` covers `/*.png` but `tmp/` is the designated scratch space). **Worktree UI verification:** run `aigon preview <feature-id>` and capture the preview URL (`<agent>-<id>.aigon.localhost`), not the primary `aigon.localhost`. **Automated regression** uses `tests/dashboard-e2e/bootstrap.js` / `npm run test:browser`; **interactive verification** uses `aigon preview <id>`.
4. **Restart after backend edits** — after changing any `lib/*.js`, run `aigon server restart`
5. **Don't move spec files manually** — always use `aigon` CLI commands to transition state
6. **Update docs when you change architecture** — new modules/patterns/repo structure → update `AGENTS.md` (and `docs/architecture.md`) in the same PR. Import-edge changes must keep `scripts/module-graph-baseline.json` accurate — `scripts/check-module-graph.js` runs in `test:core` and ratchets cycles/boundary violations. **The baseline only shrinks**: `--write-baseline` refuses to record more cycles/violations than the committed baseline; if growth is genuinely unavoidable, pass `--allow-growth "<reason>"` — the reason is stored in the baseline's `growthLog` and must survive review. Never absorb your own regression this way when a real fix is possible (F633 did, twice-shipped cycles took a follow-up feature to undo). Remaining violations each carry an entry in `violationJustifications`.
7. **Templates are user-facing, never aigon-internal.** Anything under `templates/{generic,docs,specs,prompts,skill-pointers}/` gets installed into the user's repo. Do not reference aigon's own source paths there — no `lib/<name>.js`, no `lib/workflow-core/`, no `docs/architecture.md`, no `scripts/<name>`, no `templates/...` self-references. Use user-repo concepts only (`.aigon/state/`, `.aigon/workflows/`, `.aigon/docs/`, `docs/specs/` are fine — those exist in user repos). Enforced by `scripts/check-template-leaks.js`, which runs in `test:core` and `prepublishOnly`.
8. **Use the `frontend-design` skill for ALL visual work** — see below
9. **Never add action buttons or eligibility logic in dashboard frontend files** — all actions (workflow AND infra) must be defined in the central action registry (`lib/feature-workflow-rules.js` / `lib/research-workflow-rules.js`). The frontend renders actions from the `validActions` API response only.
10. **Fix the class, not the instance.** When a bug surfaces on feature / entity N, the question is *"what mechanism produced this state, and how do I delete that mechanism so N+1 doesn't hit the same bug"* — not *"how do I unblock N right now."* Apply a one-off fix only when you've also fixed (or explicitly filed a feature for) the root cause in the same response. **Never leave "worth a follow-up feature" as prose in chat** — that's how the same bug hits a different entity a day later (F285 → F293 on 2026-04-21: identical legacy-missing-snapshot state, same unfiled follow-up, predictable recurrence). Choose one: fix the producer now, OR file the feature now. Don't do neither.
11. **Check `## Pre-authorised` before stopping on a policy gate.** Before pausing to ask about a test-budget ceiling, security warning, or ambiguous criterion, read the spec's `## Pre-authorised` section. If the gate matches a listed line, proceed and include `Pre-authorised-by: <slug>` in the commit footer. If no line matches, stop and ask as normal. Slugs are validated against the spec at close.
12. **`cli.modelOptions` is a closed curated registry.** OSS keeps the user-facing model metadata in `templates/agents/<id>.json` (including optional per-model `summary` — headline, `bestFor`/`avoidFor` — per `docs/model-inclusion-policy.md` §5); maintainer-only discovery, benchmarking, and registry mutation live in Pro/internal tooling. Do not add benchmark/model-refresh command surfaces back to OSS. Full contract: **`docs/model-inclusion-policy.md`**.

## Testing Discipline (non-negotiable)

### T1 — two distinct gates: iterate vs. pre-push
The test suite runs at two tiers; do not collapse them into one.

**Deploy gate** (before `git push` / `aigon agent-status implementation-complete` / `feature-close`):
```bash
npm run test:deploy
```
Equivalent to `npm run test:core && npm run test:browser:smoke && bash scripts/check-test-budget.sh`. Blocking checks must pass. Heavyweight release checks live behind `npm run test:release`; do not run them unless the operator explicitly asks. Do NOT push with a failing suite. Do NOT skip hooks with `--no-verify`.

**Iterate-loop gate** (per autopilot iteration; `aigon feature-do <ID> --iterate`):
```bash
npm run test:iterate
```
Scoped: lint on changed `lib/` files, integration/workflow tests whose filename matches keywords from `git diff`, plus a 5-test smoke fallback. **No Playwright. No budget check.** When dashboard files are in the diff, the gate automatically runs `test:browser:smoke` (Playwright @smoke subset) instead of the full 2-minute browser suite. The `DASHBOARD_PATH_RE` trigger (in `lib/test-loop/scoped.js`) matches not just `templates/dashboard/` and `lib/dashboard*`/`lib/server*` but also the state-projection and workflow-rules modules (`lib/state-render-meta.js`, `lib/workflow-snapshot-adapter.js`, `lib/{feature,research}-workflow-rules.js`, `lib/workflow-core/**`) — a refactor there can silently change which dashboard actions are available, which only a browser test catches (F556). Implementation lives in `lib/test-loop/scoped.js` and `scripts/iterate-validate.js`. Wall-time target <30s.

**Agents must NOT manually run `test:browser`, `test:deploy`, `test:ui`, `test:release`, or the full Playwright suite mid-iteration.** The scoped runner invokes the smoke browser subset automatically when dashboard paths are in the diff. The `## Pre-authorised` template default authorises skipping the full browser suite mid-iteration.

**Failed-test rerun rule:** if a gate fails in one test file, run that exact file after the fix (`node tests/integration/foo.test.js`, or the single Playwright spec). Do not restart `npm test`, `test:deploy`, or `test:release` after a single-file failure unless the operator explicitly asks for a full gate.

**Test stage reference:**
- `npm run test:quick` / `test:iterate` — iterate gate (alias)
- `npm run test:core` — lint + diagrams + fast integration + workflow (no browser); lint now covers `templates/dashboard/js/**` (ESLint `no-undef` catches undeclared dashboard globals — the F556 `AUTONOMOUS_AGENT_IDS` class). Cross-file dashboard globals are allowlisted in `eslint.config.js`; do not add a name there without confirming it is genuinely defined somewhere.
- `npm run test:core:full` — core plus heavyweight unit/integration files; release triage only
- `npm run test:browser` — browser smoke alias
- `npm run test:browser:full` — full Playwright E2E suite (MOCK_DELAY=fast); release triage only
- `npm run test:browser:smoke` — Playwright @smoke subset (fast, auto-run in iterate gate)
- `npm run test:deploy` — core + browser smoke + budget (the deploy gate)
- `npm run test:release` — heavyweight unit/integration + dependency/security + full browser + budget
- `npm run test:all` — alias for `test:release`

### T2 — new code ships with a test
New modules, new exported functions with non-trivial logic, and bug fixes ship with a test in the same commit. Exceptions: pure config, pure docs, pure template edits, system-integration code (launchd, signals, sockets) — and state the exception in the commit message. Every new test includes a one-line comment naming the specific regression it prevents (`// REGRESSION: ...`).

### T3 — test suite hard ceiling
Total LOC in `tests/` must stay at or below the ceiling set in `scripts/check-test-budget.sh` (currently **10,550** — check the script for the live value). Enforced by `scripts/check-test-budget.sh`. Before adding a test, first check whether an older one can be deleted (integration test subsumes unit; code rewritten; duplicated coverage). Forbidden patterns: snapshot tests, mock-heavy tests where mock setup > assertion count, trivial-getter tests, private-implementation tests. Escape valve: if you hit the ceiling and genuinely need to add, ask the user for a one-time bump — never raise the ceiling silently; raising the default requires deleting at least one test file in the same commit (enforced by the budget script).

## Frontend & Visual Design Rules

**Dashboard frontend architecture (dash-arch, F620–F628)** — full write-up in `docs/architecture.md` § Dashboard Frontend. The rules that bite:
- `templates/dashboard/js/` is **native ES modules** with a single entry `js/main.js` (import order = old script order). Server bootstrap is one `window.__AIGON_BOOTSTRAP__` object read by `js/injected.js`. Transitional: modules still publish `globalThis` shims (F623 wave 1) — don't add NEW bare-global dependencies.
- **`js/store.js` owns data**: `replaceData(next)` is the only way data enters; optimistic UI = `addOptimistic({key, patch, settled, ttlMs})` overlays, never hand-mutation of `state.data`; renderers subscribe via `subscribeDataChange`. localStorage goes through the `PERSISTENCE` map, not ad-hoc `localStorage.setItem`.
- **Views register in `js/view-registry.js`** (`{id, elementId, mount, update, unmount}`) — there is no `render()` ladder to extend; don't toggle view `style.display` from elsewhere.
- **Kanban is keyed reconciliation** (`js/pipeline.js`, F625) — no `innerHTML=''` column rebuilds, no array-identity bumps.
- **CSS**: sheets live in `templates/dashboard/styles/`, served concatenated at `/styles.css`; a new sheet MUST be added to `styles/manifest.json` (unlisted = not served, listed-but-missing = throw).
- **No CDN**: third-party JS is vendored under `js/vendor/` (versions in `js/vendor/VERSIONS.md`).
- **Live updates**: fs-watch → server fingerprint/`statusVersion` → SSE ping → client conditional GET (304). New collector fields that should repaint cards must be added to `computeStatusFingerprint` in `lib/dashboard-status-version.js`.
- **Debug**: `?debug=perf` for client poll/render timings; `AIGON_DASH_TIMING=1` for server collection timings.

**MANDATORY: Always invoke `Skill(frontend-design)` before editing any visual component** — page layouts, CSS, component styling, colors, typography, spacing, borders, shadows.

Process: invoke the skill → use shadcn/ui components where available → verify with a Playwright screenshot → compare side-by-side against the reference design if one exists. Never hand-write CSS or guess at Tailwind classes.

**Pipeline card reference design**: `docs/card-design-wireframe.html` (visual reference) and **`docs/dashboard-card-design.md`** (F650 hierarchy, color, action rules — read before editing renderers). Before touching card layout, card headline, agent-row, or status-row code, open both. The wireframe defines vocabulary and layout; the design doc defines one-dominant-state precedence, timeline vs headline, and action priority. Server helpers: `lib/card-headline.js`, `lib/card-presentation.js`. Client render: `templates/dashboard/js/card-presentation.js`, `pipeline.js`, `monitor.js`. Serve the wireframe with `python3 -m http.server 7654 --directory docs` and open `http://localhost:7654/card-design-wireframe.html`.

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
1. `AGENTS.md` (this file) — orientation
2. `docs/README.md` — catalog of all other docs
3. `docs/seeds.md` — **read this if you are working with brewboard or any seed repo**; covers the two-repo architecture and the rule that pushes must go to both `brewboard.git` and `brewboard-seed.git`
