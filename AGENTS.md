# Aigon — Codebase Orientation

## Quick Facts
- **Entry point**: `aigon-cli.js` — dispatch only, no business logic
- **Commands**: 6 domain files in `lib/commands/` (feature, research, feedback, infra, setup, misc)
- **Shared logic**: `lib/*.js` — 17 modules; see Module Map below
- **Template source of truth**: `templates/generic/commands/` — sync via `aigon install-agent cc`
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
- **Research / feedback lifecycle authority**: spec folder location plus command logic
- **Preferred feature read path**: `lib/workflow-snapshot-adapter.js` (actions/lifecycle) via `lib/workflow-read-model.js` (shared feature dashboard state)
- **Fallback / non-feature read path**: `lib/workflow-read-model.js` + `lib/state-queries.js`

Important: after feature 171, features no longer use the old coordinator manifest system as the lifecycle source of truth. Folder position is the visible outcome; the engine is the authority that moves the spec.

## Module Map
Key modules (run `wc -l lib/*.js lib/commands/*.js` for live counts):

| Module | ~Lines | Owns |
|--------|--------|------|
| `lib/commands/feature.js` | 2403 | All `feature-*` handlers, `sessions-close` |
| `lib/commands/infra.js` | 1893 | `aigon server` command, board, config, proxy-setup, dev-server |
| `lib/dashboard-server.js` | ~2660 | AIGON server HTTP module: serves dashboard UI, API, WebSocket relay, polling |
| `lib/dashboard-status-collector.js` | ~830 | Repo/entity read-side assembly for the AIGON server: feature, research, feedback, summary, and compatibility reads |
| `lib/utils.js` | 1464 | YAML parsers, spec CRUD, hooks, version, analytics |
| `lib/worktree.js` | 1510 | Worktree creation, tmux sessions, terminal launch, agent git-attribution setup |
| `lib/commands/setup.js` | 959 | init, install-agent, check-version, update, doctor |
| `lib/config.js` | 951 | Global/project config, profiles, agent CLI config |
| `lib/validation.js` | 1045 | Ralph/autonomous loop, acceptance-criteria parsing |
| `lib/workflow-core/` | ~2500 | **Workflow engine**: event-sourced state, XState machine, effects, locking — sole authority for feature lifecycle |
| `lib/workflow-snapshot-adapter.js` | ~310 | Read adapter: maps engine snapshots to dashboard/board formats |
| `lib/feature-spec-resolver.js` | ~140 | Canonical feature spec lookup; shields consumers from folder guessing and placeholder specs |
| `lib/state-queries.js` | ~200 | Pure read-side query helpers used by research/feedback and feature fallback paths |
| `lib/action-command-mapper.js` | ~75 | Shared dashboard/board command formatting for workflow and snapshot read paths |
| `lib/dashboard-status-helpers.js` | ~200 | Shared dashboard status helpers: tmux/session detection, worktree lookup, status normalization, stale-session heuristics |
| `lib/server-runtime.js` | ~90 | Shared AIGON server lifecycle helpers for start/restart/stop orchestration |
| `lib/agent-status.js` | ~130 | Per-agent status file I/O (`.aigon/state/feature-{id}-{agent}.json`) |
| `lib/templates.js` | 550 | Template loading, scaffolding, COMMAND_REGISTRY |
| `lib/git.js` | 899 | Branch/worktree/status helpers, feature git signals, AI attribution classification |
| `lib/proxy.js` | 711 | Caddy management, port allocation, proxy registry |

Thin facades (re-exports only): `lib/constants.js`, `lib/dashboard.js`, `lib/devserver.js`.

## Aigon Pro (`@aigon/pro`)
- **Private repo**: `~/src/aigon-pro` (github.com/jayvee/aigon-pro)
- **Integration point**: `lib/pro.js` — `require('@aigon/pro')` with graceful fallback
- **What's there**: insights engine, amplification dashboard, AI coaching — all commercial AADE features
- **Dev setup**: `cd ~/src/aigon-pro && npm link`, then `cd ~/src/aigon && npm link @aigon/pro`
- **Cross-repo features**: specs live in aigon, but note Pro file changes in the spec; commit to both repos separately
- See `docs/architecture.md` § "Aigon Pro" for full details

## Install Architecture
`aigon install-agent` writes **only aigon-owned files** — it never touches `CLAUDE.md` or `AGENTS.md` (after initial scaffold).

**Per-agent outputs:**
- **cc**: `.claude/commands/aigon/*.md`, `.claude/settings.json` (permissions + hooks), `.claude/skills/aigon/SKILL.md`
- **gg**: `.gemini/commands/aigon/*.toml`, `.gemini/settings.json` (hooks), `.gemini/policies/aigon.toml`
- **cx**: `~/.codex/prompts/aigon-*.md` (global), `.codex/prompt.md`, `.codex/config.toml`
- **cu**: `.cursor/commands/aigon-*.md`, `.cursor/cli.json`, `.cursor/hooks.json`, `.cursor/rules/aigon.mdc`

**Shared:** `AGENTS.md` (scaffolded on first install only, never overwritten), `docs/agents/{agent}.md` (marker blocks), `docs/development_workflow.md` (full overwrite)

**Context delivery** (no root file injection):
- CC/GG: SessionStart hook `aigon project-context` prints doc pointers to stdout → agent ingests as conversation context
- CU: `.cursor/rules/aigon.mdc` with `alwaysApply: true`
- CX: `.codex/prompt.md` with marker blocks

**Auto-update**: SessionStart hook `aigon check-version` detects version mismatch → runs `aigon update` → re-runs `install-agent` for all detected agents

## Where To Add Code
- **New command** → edit `lib/commands/{domain}.js` (pick the matching domain)
- **Shared logic (2+ commands)** → `lib/{domain}.js` (most specific owner)
- **Constants / command metadata** → `lib/constants.js`
- **Agent prompts or install content** → `templates/`; run `aigon install-agent cc` after
- **Workflow state changes** → update command module AND affected templates together

## Six Rules Before Editing
1. **Run args verbatim** — pass exactly the args the user gave; never add agents/flags from context
2. **Filter `.env.local`** — never let it block `feature-close` or `feature-submit`; ignore in git checks
3. **Screenshot dashboard changes** — take a Playwright screenshot after any `templates/dashboard/index.html` edit
4. **Restart after backend edits** — after changing any `lib/*.js`, restart `aigon server restart`
5. **Don't move spec files manually** — always use `aigon` CLI commands to transition state
6. **Update docs when you change architecture** — if your changes add modules, change repo structure, introduce new patterns, or affect how agents should work, update `AGENTS.md`, `docs/architecture.md`, and/or `CLAUDE.md` in the same PR. Documentation is not a follow-up task — it ships with the code.

## Common Agent Mistakes
- **Inventing args**: adding `cc` or `--autonomous` to a plain command → causes wrong mode (Drive vs Fleet)
- **Breaking dashboard visually**: passing syntax check but not verifying the rendered UI → ships broken tabs
- **Complexity for simplicity**: responding to "simplify" with smarter/more code instead of removing code
- **`.env.local` blocking flow**: treating it as uncommitted changes → blocks `feature-close`
- **Editing working copies**: changing `.claude/commands/` instead of `templates/` → lost on next sync
- **Shipping architecture changes without docs**: adding modules, repos, or patterns without updating `AGENTS.md` or `docs/architecture.md` → next agent has no awareness of the change

## Reading Order
1. `AGENTS.md` (this file) — quick orientation
2. `docs/architecture.md` — full module docs, ctx details, design rules, naming conventions
3. `docs/development_workflow.md` — feature/research lifecycle
4. Active feature spec: `aigon feature-spec <ID>`
5. Agent-specific notes: `docs/agents/{id}.md`
