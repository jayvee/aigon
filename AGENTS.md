# Aigon — Codebase Orientation

## Quick Facts
- **Entry point**: `aigon-cli.js` — dispatch only, no business logic
- **Commands**: 6 domain files in `lib/commands/` (feature, research, feedback, infra, setup, misc)
- **Shared logic**: `lib/*.js` — 20 modules; see Module Map below
- **Template source of truth**: `templates/generic/commands/` — sync via `aigon install-agent cx` (or any agent)
- **Working copies** (gitignored): `.claude/commands/`, `.cursor/commands/`, etc.
- **AIGON server**: `aigon server start` serves the dashboard UI and API; restart it after any `lib/*.js` edit
- **Tests**: `npm test` · syntax: `node -c aigon-cli.js` · `node -c lib/utils.js`
- **Version bumps**: after every commit — `npm version patch|minor|major && git push --tags`

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

## Workflow State At A Glance

- **Feature lifecycle authority**: `lib/workflow-core/` and `.aigon/workflows/features/{id}/`
- **Feature runtime / agent status files**: `.aigon/state/feature-{id}-{agent}.json`
- **Feature autonomous conductor state**: `.aigon/state/feature-{id}-auto.json`
- **Research lifecycle authority**: `lib/workflow-core/` and `.aigon/workflows/research/{id}/`
- **Feedback lifecycle authority**: frontmatter `status` in `docs/specs/feedback/`; folder position is a derived projection
- **Preferred read path (feature + research)**: `lib/workflow-snapshot-adapter.js` via `lib/workflow-read-model.js`, with `lib/spec-reconciliation.js` self-healing visible spec drift from engine state
- **Feedback read path**: `lib/feedback.js` metadata parsing plus `lib/spec-reconciliation.js` folder reconciliation, consumed by `feedback-list` and `lib/dashboard-status-collector.js`
- **Fallback read path (legacy feature/research items)**: `lib/workflow-read-model.js` + `lib/state-queries.js`

Important: after feature 171, features no longer use the old coordinator manifest system as the lifecycle source of truth. Folder position is the visible outcome; the engine is the authority that moves the spec.

## Module Map
Key modules (run `wc -l lib/*.js lib/commands/*.js` for live counts):

| Module | ~Lines | Owns |
|--------|--------|------|
| `lib/commands/feature.js` | 2403 | All `feature-*` handlers, `sessions-close` |
| `lib/commands/infra.js` | 1893 | `aigon server` command, board, config, proxy-setup, dev-server, `sync` |
| `lib/dashboard-server.js` | ~2660 | AIGON server HTTP module: serves dashboard UI, API, WebSocket relay, polling |
| `lib/dashboard-status-collector.js` | ~830 | Repo/entity read-side assembly for the AIGON server: feature/research workflow reads plus feedback metadata-driven status collection and reconciliation |
| `lib/utils.js` | 1464 | YAML parsers, spec CRUD, hooks, version, analytics |
| `lib/worktree.js` | 1510 | Worktree creation, tmux sessions, terminal launch, agent git-attribution metadata setup |
| `lib/commands/setup.js` | 959 | init, install-agent, check-version, update, doctor |
| `lib/config.js` | 951 | Global/project config, profiles, agent CLI config |
| `lib/validation.js` | 1045 | Iterate (Autopilot) loop, acceptance-criteria parsing |
| `lib/workflow-core/` | ~2500 | **Workflow engine**: event-sourced state, XState machine, effects, locking — sole authority for feature + research lifecycle |
| `lib/workflow-core/migration.js` | ~120 | Explicit migration helpers for pre-cutover feature/research lifecycle backfill |
| `lib/workflow-snapshot-adapter.js` | ~310 | Shared read adapter: maps feature/research engine snapshots to dashboard/board formats |
| `lib/feature-spec-resolver.js` | ~200 | Canonical feature/research visible spec lookup; shields consumers from folder guessing and placeholder specs |
| `lib/spec-reconciliation.js` | ~130 | Shared self-healing spec projection helper: engine->folder for feature/research, metadata-status->folder for feedback; reused by read paths and `aigon repair` |
| `lib/state-queries.js` | ~200 | Pure read-side query helpers used by research/feedback and feature fallback paths |
| `lib/action-command-mapper.js` | ~75 | Shared dashboard/board command formatting for workflow and snapshot read paths |
| `lib/dashboard-status-helpers.js` | ~200 | Shared dashboard status helpers: tmux/session detection, worktree lookup, status normalization, stale-session heuristics |
| `lib/auto-session-state.js` | ~50 | Durable AutoConductor run state for features so autonomous status survives tmux/session exit |
| `lib/server-runtime.js` | ~90 | Shared AIGON server lifecycle helpers for start/restart/stop orchestration |
| `lib/agent-status.js` | ~130 | Per-agent status file I/O (`.aigon/state/feature-{id}-{agent}.json`) |
| `lib/agent-prompt-resolver.js` | ~140 | Shared feature prompt resolution for agent launches. Default path preserves configured slash commands; cx reads the canonical `templates/generic/commands/feature-*.md` prompt body, strips metadata, and substitutes feature args inline so Codex no longer depends on deprecated `/prompts:` discovery or local skill discovery. |
| `lib/templates.js` | 550 | Template loading, scaffolding, COMMAND_REGISTRY |
| `lib/git.js` | 899 | Branch/worktree/status helpers, feature git signals, AI attribution classification |
| `lib/proxy.js` | 711 | Caddy management, port allocation, proxy registry |
| `lib/sync.js` | ~800 | Solo laptop sync orchestration: init/register/export/bootstrap-merge/push/pull/status, metadata, preflight/version checks |
| `lib/sync-merge.js` | ~300 | Bootstrap merge engine for portable state types (workflow events, telemetry, state manifests, derived-file invalidation) |

Thin facades (re-exports only): `lib/constants.js`, `lib/dashboard.js`, `lib/devserver.js`.

## Aigon Pro (`@aigon/pro`)
- **Private repo**: `~/src/aigon-pro` (github.com/jayvee/aigon-pro)
- **Integration point**: `lib/pro.js` — `require('@aigon/pro')` with graceful fallback
- **What's there**: insights engine, amplification dashboard, AI coaching — all commercial features
- **Dev setup**: `cd ~/src/aigon-pro && npm link`, then `cd ~/src/aigon && npm link @aigon/pro`
- See `docs/architecture.md` § "Aigon Pro" for full details

### Where Pro feature specs live (post-2026-04-07 split)
Pro feature specs live in **aigon-pro**, not here. `aigon feature-create`
inside aigon-pro writes there automatically. Historical Pro features that
were moved out are listed in `docs/specs/features/MOVED-TO-AIGON-PRO.md`
— check that file if you see a gap in aigon's feature numbering.

### Cross-repo features (specs in aigon-pro that touch aigon code)
A feature whose primary purpose is Pro behavior, but that needs to edit
OSS aigon code (e.g. `lib/pro-bridge.js`) — the spec lives in aigon-pro.
In the aigon commit, add this footer:

```
Cross-repo: aigon-pro feature N
```

This tells anyone reading public aigon history that the commit was
Pro-driven, without revealing the spec contents.

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
- CX: project-local Skills under `.agents/skills/aigon-*/SKILL.md`; aigon-spawned Codex sessions inline the same template bodies directly

**Auto-update**: SessionStart hook `aigon check-version` detects version mismatch → runs `aigon update` → re-runs `install-agent` for all detected agents

## Where To Add Code
- **New command** → edit `lib/commands/{domain}.js` (pick the matching domain)
- **Shared logic (2+ commands)** → `lib/{domain}.js` (most specific owner)
- **Constants / command metadata** → `lib/constants.js`
- **Agent prompts or install content** → `templates/`; run `aigon install-agent cc` after
- **Workflow state changes** → update command module AND affected templates together

## Resetting / Cancelling Work
**To start a feature over (different agent, fresh slate, abandon work) — there is ONE command:**

```
aigon feature-reset <ID>
```

It runs the entire sequence in order: `sessions-close` → remove worktrees → delete branches → clear `.aigon/state/` → move spec back to `02-backlog/` → clear workflow-core engine state → GC dev-proxy entries.

**Do not stitch this together manually** with `feature-cleanup` + `git mv` + `rm -rf .aigon/workflows/...`. That path leaks autonomous tmux sessions and predates `feature-reset`. If you reach for those raw commands, stop and use `feature-reset` instead.

`feature-cleanup <ID>` is a strict subset (worktrees + branches only) — use it to GC Fleet branches after `feature-close`, not to abandon work. `sessions-close <ID>` is also a strict subset; `feature-reset` already calls it internally.

**To start a research topic over (wrong scope/agents, fresh backlog state) — use:**

```
aigon research-reset <ID>
```

It runs research-specific cleanup: `sessions-close` → remove findings files (`docs/specs/research-topics/logs/research-<id>-*-findings.md`) → clear research state files in `.aigon/state/` → move the topic spec back to `02-backlog/` → clear workflow-core engine state in `.aigon/workflows/research/<id>/`.

## Publishing Branches & Remote Review Gate

### `feature-push`
`aigon feature-push [ID] [agent]` pushes the resolved feature branch to `origin` with upstream tracking. In a feature worktree, no arguments are needed. It does not alter workflow state, move specs, or merge anything. Use it when you want to create a GitHub PR for review before closing.

### GitHub PR-aware close
When `origin` is GitHub and `gh` is available, `feature-close` does a best-effort PR check for the feature branch:

- No PR found: `feature-close` behaves like a normal local close
- Open PR found: `feature-close` blocks so Aigon does not bypass the remote review flow
- Merged PR found: `feature-close` syncs `main` from `origin/main`, writes the final done-state spec/log commit, pushes that close-state commit, and cleans up the branch/worktree

**Constraints:**
- GitHub-only (uses `gh` CLI)
- No PR metadata is stored in `.aigon/`, workflow state, or git history
- If `gh` is missing or auth fails, Aigon falls back to normal local close

**Workflow:**
1. Implement the feature
2. `aigon feature-push` — publish the current feature branch
3. Create PR on GitHub and let GitHub own review/merge
4. While the PR is open, `aigon feature-close <ID>` blocks
5. After the PR is merged, `aigon feature-close <ID>` finalizes locally

## Six Rules Before Editing
1. **Run args verbatim** — pass exactly the args the user gave; never add agents/flags from context
2. **Filter `.env.local`** — never let it block `feature-close` or `aigon agent-status submitted`; ignore in git checks
3. **Screenshot dashboard changes** — take a Playwright screenshot after any `templates/dashboard/index.html` edit
4. **Restart after backend edits** — after changing any `lib/*.js`, restart `aigon server restart`
5. **Don't move spec files manually** — always use `aigon` CLI commands to transition state
6. **Update docs when you change architecture** — if your changes add modules, change repo structure, introduce new patterns, or affect how agents should work, update `AGENTS.md`, `docs/architecture.md`, and/or `CLAUDE.md` in the same PR. Documentation is not a follow-up task — it ships with the code.

## Common Agent Mistakes
- **Inventing args**: adding `cc` or `--iterate` to a plain command → causes wrong mode (Drive vs Fleet)
- **Breaking dashboard visually**: passing syntax check but not verifying the rendered UI → ships broken tabs
- **Complexity for simplicity**: responding to "simplify" with smarter/more code instead of removing code
- **`.env.local` blocking flow**: treating it as uncommitted changes → blocks `feature-close`
- **Editing working copies**: changing `.claude/commands/` instead of `templates/` → lost on next sync
- **Shipping architecture changes without docs**: adding modules, repos, or patterns without updating `AGENTS.md` or `docs/architecture.md` → next agent has no awareness of the change
- **Manual reset choreography**: stitching raw cleanup commands to start work over → use `aigon feature-reset <ID>` for features and `aigon research-reset <ID>` for research. These run the full reset sequences and prevent stale sessions/state.

## Reading Order
1. `AGENTS.md` (this file) — quick orientation
2. `docs/architecture.md` — full module docs, ctx details, design rules, naming conventions
3. `docs/development_workflow.md` — feature/research lifecycle
4. Active feature spec: `aigon feature-spec <ID>`
5. Agent-specific notes: `docs/agents/{id}.md`
