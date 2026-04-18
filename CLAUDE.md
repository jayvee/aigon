# Aigon — Codebase Orientation

## Quick Facts
- **Entry point**: `aigon-cli.js` — dispatch only, no business logic
- **Commands**: 6 domain files in `lib/commands/` (feature, research, feedback, infra, setup, misc)
- **Shared logic**: `lib/*.js` — 16 modules; see Module Map below
- **Template source of truth**: `templates/generic/commands/` — sync via `aigon install-agent cc`
- **Working copies** (gitignored): `.claude/commands/`, `.cursor/commands/`, etc.
- **AIGON server**: `aigon server start` serves the dashboard UI and API; restart it after any `lib/*.js` edit
- **Tests**: `npm test` · syntax: `node -c aigon-cli.js` · `node -c lib/utils.js`
- **Version bumps**: after every commit — `npm version patch|minor|major && git push --tags`
- **Seed reset**: `aigon seed-reset ~/src/<repo> --force` — resets seed repos (brewboard, trailhead) to initial state. Use `--dry-run` to preview. Handles tmux, worktrees, branches, state, git history.

## The ctx Pattern
Commands receive dependencies via a `ctx` object — enables test overrides without mocking globals:

```js
// lib/commands/shared.js — buildCtx() wires every module
function buildCtx(overrides = {}) {
    return {
        utils:      { ...utils, ...overrides },   // lib/utils.js
        git:        { ...git, ...overrides },      // lib/git.js
        board:      { ...board, ...overrides },    // lib/board.js
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
Key modules (run `wc -l lib/*.js lib/commands/*.js` for live counts):

| Module | ~Lines | Owns |
|--------|--------|------|
| `lib/agent-registry.js` | ~280 | **Agent registry**: scans `templates/agents/*.json`, provides lookup maps (display names, port offsets, provider families, trust, worktree env, capabilities). All agent-specific data is data-driven — zero hardcoded agent logic in `lib/` |
| `lib/commands/feature.js` | ~2860 | All `feature-*` handlers, `sessions-close`, `feature-autonomous-start` (AutoConductor launcher + `__run-loop`) |
| `lib/feature-close.js` | ~740 | Feature-close phases: target resolution, merge, telemetry, engine close, cleanup |
| `lib/feature-review-state.js` | ~220 | Review lifecycle state per feature: `review-state.json` (current + history), `markReviewingSync`, `completeReviewSync`, `reconcileReviewState`. Written by `agent-status` commands; read by AutoConductor `__run-loop` to confirm review completion. |
| `lib/dashboard-server.js` | ~2660 | AIGON server HTTP/UI module: dashboard UI, API, WebSocket relay, polling, HTTP action dispatch. Never mutates engine state directly. |
| `lib/dashboard-status-collector.js` | ~830 | AIGON server read-side collector: assembles repo, feature, research, feedback, summary, and compatibility status payloads |
| `lib/commands/infra.js` | ~1460 | `aigon server` command, board, config, proxy-setup, dev-server |
| `lib/utils.js` | 1474 | Spec CRUD, hooks, version, analytics |
| `lib/commands/setup.js` | 1212 | init, install-agent, check-version, update, doctor + state reconciliation |
| `lib/terminal-adapters.js` | ~200 | Terminal adapter table: detect/launch/split per terminal (Warp, iTerm2, kitty, gnome-terminal, xterm, Terminal.app), tiling, Warp window close |
| `lib/worktree.js` | 1300 | Worktree creation, tmux sessions, shell trap signal wrapper (terminal dispatch delegated to terminal-adapters.js) |
| `lib/validation.js` | 1045 | Iterate (Autopilot) loop, acceptance-criteria parsing |
| `lib/config.js` | ~950 | Global/project config, agent CLI config (profiles delegated to profile-placeholders.js) |
| `lib/profile-placeholders.js` | ~500 | Profile presets (from `templates/profiles.json`), detection, instruction directive resolvers, `getProfilePlaceholders()` |
| `lib/state-queries.js` | ~250 | Read-only UI helpers: feedback action/transition derivation — pure, no I/O. Feature/research constants retained for diagrams only |
| `lib/feature-spec-resolver.js` | ~140 | Canonical feature spec lookup for active features; avoids consumer-specific folder guessing |
| `lib/feature-status.js` | ~230 | Deep feature status collector: `collectFeatureDeepStatus()` — session, progress, cost, spec data on demand |
| `lib/action-command-mapper.js` | ~75 | Shared dashboard/board command formatting used by workflow read paths |
| `lib/dashboard-status-helpers.js` | ~200 | Shared dashboard status helpers: tmux/session detection, worktree lookup, status normalization, stale-session heuristics |
| `lib/server-runtime.js` | ~90 | Shared AIGON server lifecycle helpers for start/restart/stop orchestration |
| `lib/agent-status.js` | ~130 | Per-agent status file I/O (`.aigon/state/{prefix}-{id}-{agent}.json`), atomic writes |
| `lib/stats-aggregate.js` | ~270 | **Stats aggregate**: scans `.aigon/workflows/{features,research}/<id>/stats.json`, rolls up totals + per-agent + weekly/monthly buckets, caches to `.aigon/cache/stats-aggregate.json` with `CACHE_VERSION`. Rebuilt lazily when any `stats.json` mtime exceeds the cache. Powers `aigon stats`, `aigon doctor --rebuild-stats`, and the `/api/stats-aggregate` endpoint. |
| `lib/migration.js` | ~300 | **Migration framework**: versioned state migrations with backup/restore/validate lifecycle. `registerMigration(version, fn)` + `runPendingMigrations()` called from `check-version`. Backup via tar, idempotent (manifest check), auto-rollback on failure. |
| `lib/agent-prompt-resolver.js` | ~140 | Resolves the launch prompt for an agent + verb. Default path passes through `cliConfig.<verb>Prompt` (cc/gg/cu slash commands). cx path inlines the canonical `templates/generic/commands/feature-<verb>.md` body (frontmatter stripped, `$ARGUMENTS`/`$1` substituted) so codex launches never depend on skill / prompt discovery. |
| `lib/pro.js` | ~25 | **Pro gate**: lazy-require `@aigon/pro` with `AIGON_FORCE_PRO` env override (`false`/`0` simulates free tier; never read project config). `isProAvailable()` / `getPro()`. Only `lib/pro-bridge.js` calls these — never add new call sites. |
| `lib/pro-bridge.js` | ~180 | **Pro extension point**: in-process route registry. `initialize({ helpers })` invites `@aigon/pro` to `register(api)` at startup; `dispatchProRoute(method, path, req, res)` routes incoming requests. Plugin route registration is the current shape (Option B); future event bus / anti-corruption layers will live here too. |
| `lib/remote-gate-github.js` | ~170 | **GitHub PR-aware close helper**: `checkGitHubGate()` queries `gh pr list` for the feature branch and chooses one of three outcomes for `feature-close`: local close (no PR or no GitHub capability), block (open PR), or remote-finalize (merged PR). |
| `lib/proxy.js` | 711 | Caddy management, port allocation, proxy registry |
| `lib/templates.js` | 550 | Template loading, scaffolding, COMMAND_REGISTRY |
| `lib/git.js` | 700+ | Branch, worktree, status, commit helpers, commit analytics, git attribution |
| `lib/telemetry.js` | ~1100 | Normalized session telemetry, cross-agent cost reporting. Parsers for CC (JSONL transcripts), GG (`~/.gemini/tmp/` session JSON), CX (`~/.codex/sessions/` JSONL matched by cwd). CU marked as no-telemetry. Pricing table covers Claude, Gemini, and GPT-5 models |
| `lib/security.js` | 131+ | Merge gate scanning (gitleaks + semgrep), severity thresholds, diff-aware |
| `lib/workflow-core/` | ~1500 | **Workflow engine**: event-sourced state with XState machine, action derivation (workflow + infra), effect lifecycle for features + research |
| `lib/workflow-snapshot-adapter.js` | ~310 | **Shared read adapter**: maps workflow-core snapshots (feature + research) to dashboard/board data formats; event log reading; side-effect free |
| `lib/workflow-heartbeat.js` | ~160 | **Heartbeat**: display-only liveness computation (alive/stale/dead), heartbeat file reading, configurable thresholds. Never changes engine state. |
| `lib/supervisor.js` | ~330 | **Server monitoring module**: observe-only — computes agent liveness (tmux + heartbeat files), stores in-memory for dashboard display, sends desktop notifications. Never emits engine signals or changes state. |
| `lib/supervisor-service.js` | ~175 | **Server auto-restart**: launchd (macOS) / systemd (Linux) for `aigon server start --persistent` |
| `lib/shell-trap.test.js` | ~190 | Tests for shell trap signal infrastructure |

Thin facades (re-exports only): `lib/constants.js`, `lib/dashboard.js`, `lib/devserver.js`.

## State Architecture
Feature and research lifecycle state are managed by the **workflow-core engine** (`lib/workflow-core/`):

- **Event log** (`.aigon/workflows/features/{id}/events.jsonl`) — append-only, immutable
- **Snapshot** (`.aigon/workflows/features/{id}/snapshot.json`) — derived from events
- **XState machine** — validates lifecycle transitions; `snapshot.can()` for action derivation
- **Effect lifecycle** — durable, resumable side effects (requested → claimed → succeeded/failed)
- **Exclusive file locking** — prevents concurrent modification

Supporting state:
- **Folders** (`docs/specs/features/0N-*/`) — shared ground truth, committed to git
- **Agent status files** (`.aigon/state/feature-{id}-{agent}.json`) — per-agent metadata, managed by `lib/agent-status.js`
- **Shell trap signals**: `buildAgentCommand()` wraps all agent commands with a bash `trap EXIT` handler that fires `agent-status submitted` (exit 0, implementation sessions) or `agent-status review-complete` (exit 0, review sessions) or `agent-status error` (non-zero). Task type is passed to `buildAgentCommand` as `'do'`, `'review'`, or `'evaluate'`; the trap selects the correct signal. A heartbeat sidecar touches `.aigon/state/heartbeat-{featureId}-{agentId}` every 30s. Controlled by `signals` block in `templates/agents/*.json`.
- **Review state**: `lib/feature-review-state.js` — per-feature `review-state.json` at `.aigon/workflows/features/{id}/review-state.json`. Tracks `current` (in-progress review) and `history[]` (completed reviews). Written by `agent-status reviewing` and `agent-status review-complete` via `lib/commands/misc.js`. AutoConductor reads this to confirm review completion before triggering `feature-close`.
- **AutoConductor** (`feature-autonomous-start __run-loop`): detached tmux session named `<repo>-f<id>-auto`. Solo mode: polls for allReady → spawns review session (if `--review-agent`) → waits for `review-complete` signal → calls `feature-close`. Fleet mode: polls for allReady → spawns eval session → polls eval file for `**Winner:**` → calls `feature-close <winner>`. Kills own tmux session on completion so the dashboard badge clears.
- **Heartbeat is display-only**: heartbeat files exist for agent liveness tracking but card status uses tmux session checks directly. Heartbeat data NEVER triggers engine state transitions. The supervisor computes liveness and stores it in memory; the dashboard reads it via `getAgentLiveness()`. Users manually mark agents as lost/failed — the system never does this automatically.
- Log files are **pure narrative markdown** — no YAML frontmatter, no machine state

The dashboard UI uses `lib/state-queries.js` for feedback action/transition derivation (pure functions, no I/O), `lib/workflow-snapshot-adapter.js` to read engine snapshots through the AIGON server, `lib/action-command-mapper.js` to keep dashboard/board command formatting consistent across read paths, and `lib/dashboard-status-collector.js` to keep repo/entity status assembly out of the HTTP server module.

Research lifecycle is also managed by the workflow-core engine (`.aigon/workflows/research/{id}/`). Feedback entities still use simpler filesystem-based transitions (spec folder moves) without the workflow engine.

## Install Architecture
`aigon install-agent` writes **only aigon-owned files** — it never touches `CLAUDE.md` or `AGENTS.md` (after initial scaffold).

**Per-agent outputs:**
- **cc**: `.claude/commands/aigon/*.md`, `.claude/settings.json` (permissions + hooks), `.claude/skills/aigon/SKILL.md`
- **gg**: `.gemini/commands/aigon/*.toml`, `.gemini/settings.json` (hooks), `.gemini/policies/aigon.toml`
- **cx**: `.agents/skills/aigon-*/SKILL.md` (project-local), `.codex/config.toml`
- **cu**: `.cursor/commands/aigon-*.md`, `.cursor/cli.json`, `.cursor/hooks.json`, `.cursor/rules/aigon.mdc`

**Shared:** `AGENTS.md` (scaffolded on first install only, never overwritten), `docs/agents/{agent}.md` (marker blocks), `docs/development_workflow.md` (full overwrite)

**Context delivery** (no root file injection):
- CC/GG: SessionStart hook `aigon project-context` prints doc pointers to stdout → agent ingests as conversation context
- CU: `.cursor/rules/aigon.mdc` with `alwaysApply: true`
- CX: `.codex/prompt.md` with marker blocks

**Auto-update**: SessionStart hook `aigon check-version` detects version mismatch → runs `aigon update` → re-runs `install-agent` for all detected agents

## Aigon Pro (`@aigon/pro`)
- **Private repo**: `~/src/aigon-pro` (github.com/jayvee/aigon-pro)
- **Two integration files only**: `lib/pro.js` (lazy-require gate) and `lib/pro-bridge.js` (extension point). New Pro features extend the bridge — never add `getPro()` calls in unrelated modules.
- **Bridge contract**: `proBridge.initialize({ helpers })` at server start invites Pro to `register(api)`. `api.registerRoute(method, path, handler)` is the current shape (Option B — plugin route registration). Future shapes (event bus, anti-corruption read layer) live in the same file.
- **What's there**: insights engine, amplification dashboard, AI coaching — all commercial features
- **Dev setup**: `cd ~/src/aigon-pro && npm link`, then `cd ~/src/aigon && npm link @aigon/pro`
- See `docs/architecture.md` § "Aigon Pro" for full details

### Where Pro feature specs live (post-2026-04-07 split)
Pro feature specs live in **aigon-pro**, not here. `aigon feature-create`
inside aigon-pro writes there automatically. The historical Pro features
that were moved out are listed in `docs/specs/features/MOVED-TO-AIGON-PRO.md`
— check that file if you see a gap in aigon's feature numbering.

### Cross-repo features (specs in aigon-pro that touch aigon code)
A feature whose primary purpose is Pro behavior, but that needs to edit
OSS aigon code (e.g. `lib/pro-bridge.js`) — the spec lives in aigon-pro.
In the aigon commit, add this footer to the message:

```
Cross-repo: aigon-pro feature N
```

This tells anyone reading public aigon history that the commit was
Pro-driven, without revealing the spec contents. The full mechanism
(paired worktrees, branch naming, `## Cross-repo touch` spec marker) is
documented in aigon-pro's `feature-cross-repo-feature-support` spec.

## Where To Add Code
- **New command** → edit `lib/commands/{domain}.js` (pick the matching domain)
- **Shared logic (2+ commands)** → `lib/{domain}.js` (most specific owner)
- **Constants / command metadata** → `lib/constants.js`
- **Agent prompts or install content** → `templates/`; run `aigon install-agent cc` after
- **Workflow state changes** → update command module AND affected templates together

## Resetting / Cancelling A Feature
**To start a feature over (different agent, fresh slate, abandon work) — there is ONE command:**

```
aigon feature-reset <ID>
```

This is the canonical full-reset path. It runs the entire sequence in order:
1. `sessions-close` — kill agent processes, tmux sessions, preview dashboards, Warp tabs
2. Remove worktrees (+ permissions/trust)
3. Delete feature branches
4. Clear `.aigon/state/feature-<id>-*` files
5. Move spec back to `02-backlog/`
6. Clear workflow-core engine state (`.aigon/workflows/features/<id>/`)
7. GC dev-proxy entries

**Do not stitch this together manually** with `feature-cleanup` + `git mv` + `rm -rf .aigon/workflows/...`. That path is fragile, leaks autonomous sessions, and predates `feature-reset`. If you find yourself reaching for those raw commands, stop and use `feature-reset` instead.

`feature-cleanup <ID>` is a strict subset (worktrees + branches only). Use it when you only want to garbage-collect Fleet branches after a `feature-close`, not to abandon work.

`sessions-close <ID>` is also a strict subset (just kills processes/sessions/tabs). `feature-reset` calls it internally — you should rarely need to invoke it directly.

## Rules Before Editing
1. **Run args verbatim** — pass exactly the args the user gave; never add agents/flags from context
2. **Filter `.env.local`** — never let it block `feature-close` or `aigon agent-status submitted`; ignore in git checks
3. **Screenshot dashboard changes** — take a Playwright screenshot after any `templates/dashboard/index.html` edit
4. **Restart after backend edits** — after changing any `lib/*.js`, restart `aigon server restart`
5. **Don't move spec files manually** — always use `aigon` CLI commands to transition state
6. **Update docs when you change architecture** — if your changes add modules, change repo structure, introduce new patterns, or affect how agents should work, update `CLAUDE.md`, `docs/architecture.md`, and/or `AGENTS.md` in the same PR. Documentation is not a follow-up task — it ships with the code.
7. **Use the frontend-design skill for ALL visual work** — see below.
8. **Never add action buttons or eligibility logic in dashboard frontend files** — all actions (workflow AND infra) must be defined in the central action registry (`lib/feature-workflow-rules.js` / `lib/research-workflow-rules.js`). The frontend renders actions from the `validActions` API response only.

## Testing Discipline (non-negotiable)

### Rule T1 — run the test suite before pushing

Before any `git push` of a feature branch to `origin`, run:

```bash
npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh
```

All three must pass. If any fail:
- If the failure is a real bug, fix the code.
- If the failure is test rot from an unrelated change, fix the test in the same push and note it in the commit message.
- Do NOT push with a failing suite. Do NOT skip hooks with `--no-verify`.
- If you genuinely cannot get the suite green, stop and ask the user.

This applies to `aigon agent-status submitted`, `feature-close`, and any direct `git push`. Running the suite ONLY when the user asks is not sufficient — test rot compounds silently otherwise.

### Rule T2 — new code ships with a test

If a feature adds a new module, a new exported function with non-trivial logic, or fixes a bug — a test for that code ships in the same commit. Exceptions: pure config, pure docs, pure template edits, system-integration code (launchd, signals, sockets) that is impractical to unit-test. If you think something is an exception, say so in the commit message.

Every new test must include a one-line comment naming the specific regression it prevents:

```js
// REGRESSION: prevents the cx /prompts: bug where custom prompts stopped
// being discovered after codex 0.117 (see feature 218)
```

Tests without this comment do not pull their weight.

### Rule T3 — test suite hard ceiling

Total LOC in `tests/` must stay ≤ **2,000**. Enforced by `scripts/check-test-budget.sh`. Pre-push will block if the suite exceeds the ceiling.

When adding a new test, first check whether an older test can be deleted:
- Does an integration test now cover what this unit test covered?
- Has the code this test exercises been deleted or rewritten?
- Does another test duplicate this one's regression coverage?

If any answer is yes, delete the older test in the same commit.

**Forbidden patterns** (auto-reject in review):
- Snapshot tests
- Tests where mock setup > assertion count
- Tests for trivial getters, identity functions, or pass-through wrappers
- Tests that assert on private implementation details instead of behavior

**Escape valve**: if you hit the 2,000 ceiling, genuinely need to add a new test, and can't find anything to delete — stop and ask the user to grant a one-time bump. Do not raise the ceiling silently.

Prior history (for context): the test suite has been carpet-bombed twice from 14,026 → 2,423 → 1,231 lines because tests accumulated without a deletion discipline. The hard ceiling exists to prevent a third time.

## Frontend & Visual Design Rules
**MANDATORY: Always invoke `Skill(frontend-design)` before editing any visual component.**

This applies to:
- Page layouts (landing page, docs pages, any `.tsx` that renders UI)
- CSS files (global.css, Tailwind config, any styling)
- Component styling (cards, buttons, terminals, galleries)
- Color changes, typography, spacing, borders, shadows

The process for any visual change:
1. **Invoke `Skill(frontend-design)`** — get design guidance before writing code
2. **Use shadcn/ui components** where available instead of raw Tailwind classes
3. **Verify with Playwright** — take a screenshot after every visual change
4. **Compare against reference** — if there's an existing design (e.g., aigon.build), compare side-by-side

Never hand-write CSS or guess at Tailwind classes for visual design. The frontend-design skill produces production-grade interfaces; hand-written CSS produces inconsistent, broken results.

## Common Agent Mistakes
- **Inventing args**: adding `cc` or `--iterate` to a plain command → causes wrong mode (Drive vs Fleet)
- **Breaking dashboard visually**: passing syntax check but not verifying the rendered UI → ships broken tabs
- **Complexity for simplicity**: responding to "simplify" with smarter/more code instead of removing code
- **`.env.local` blocking flow**: treating it as uncommitted changes → blocks `feature-close`
- **Editing working copies**: changing `.claude/commands/` instead of `templates/` → lost on next sync
- **Manual feature reset**: stitching `feature-cleanup` + `git mv` + `rm -rf .aigon/workflows/...` to start a feature over → use `aigon feature-reset <ID>` instead. It does the full sequence including `sessions-close` (which the manual path always forgets)

## Reading Order
1. `AGENTS.md` (this file) — quick orientation
2. `docs/architecture.md` — full module docs, ctx details, design rules, naming conventions
3. `docs/development_workflow.md` — feature/research lifecycle
4. Active feature spec: `aigon feature-spec <ID>`
5. Agent-specific notes: `docs/agents/{id}.md`
