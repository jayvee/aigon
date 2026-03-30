# Aigon — Codebase Orientation

## Quick Facts
- **Entry point**: `aigon-cli.js` — dispatch only, no business logic
- **Commands**: 6 domain files in `lib/commands/` (feature, research, feedback, infra, setup, misc)
- **Shared logic**: `lib/*.js` — 15 modules; see Module Map below
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
| `lib/commands/feature.js` | 2490 | All `feature-*` handlers, `sessions-close` |
| `lib/dashboard-server.js` | ~1850 | AIGON server HTTP/UI module: dashboard UI, API, WebSocket relay, polling, snapshot reads. Never mutates engine state. |
| `lib/commands/infra.js` | ~1460 | `aigon server` command, board, config, proxy-setup, dev-server |
| `lib/utils.js` | 1474 | Spec CRUD, hooks, version, analytics |
| `lib/commands/setup.js` | 1212 | init, install-agent, check-version, update, doctor + state reconciliation |
| `lib/worktree.js` | 1200+ | Worktree creation, tmux sessions, terminal launch, shell trap signal wrapper |
| `lib/validation.js` | 1045 | Ralph/autonomous loop, acceptance-criteria parsing |
| `lib/config.js` | 951 | Global/project config, profiles, agent CLI config |
| `lib/state-queries.js` | ~250 | Read-only UI helpers: stage definitions, transition/action tables, guard functions — pure, no I/O |
| `lib/action-command-mapper.js` | ~75 | Shared dashboard/board command formatting used by workflow read paths |
| `lib/dashboard-status-helpers.js` | ~200 | Shared dashboard status helpers: tmux/session detection, worktree lookup, status normalization, stale-session heuristics |
| `lib/server-runtime.js` | ~90 | Shared AIGON server lifecycle helpers for start/restart/stop orchestration |
| `lib/agent-status.js` | ~130 | Per-agent status file I/O (`.aigon/state/{prefix}-{id}-{agent}.json`), atomic writes |
| `lib/proxy.js` | 711 | Caddy management, port allocation, proxy registry |
| `lib/templates.js` | 550 | Template loading, scaffolding, COMMAND_REGISTRY |
| `lib/git.js` | 700+ | Branch, worktree, status, commit helpers, commit analytics, git attribution |
| `lib/telemetry.js` | 144 | Normalized session telemetry, cross-agent cost reporting |
| `lib/security.js` | 131+ | Merge gate scanning (gitleaks + semgrep), severity thresholds, diff-aware |
| `lib/workflow-core/` | ~1500 | **Workflow engine**: event-sourced state with XState machine, action derivation, effect lifecycle |
| `lib/workflow-snapshot-adapter.js` | ~310 | **Read adapter**: maps workflow-core snapshots to dashboard/board data formats; event log reading; side-effect free |
| `lib/workflow-heartbeat.js` | ~125 | **Heartbeat**: agent liveness signals, configurable timeout (120s default), expired heartbeat sweep |
| `lib/supervisor.js` | ~276 | **Server monitoring module**: observes agent liveness (tmux + heartbeat), emits signals, sends notifications. Never kills/restarts/moves. |
| `lib/supervisor-service.js` | ~175 | **Server auto-restart**: launchd (macOS) / systemd (Linux) for `aigon server start --persistent` |
| `lib/shell-trap.test.js` | ~190 | Tests for shell trap signal infrastructure |

Thin facades (re-exports only): `lib/constants.js`, `lib/dashboard.js`, `lib/devserver.js`.

## State Architecture
Feature lifecycle state is managed by the **workflow-core engine** (`lib/workflow-core/`):

- **Event log** (`.aigon/workflows/features/{id}/events.jsonl`) — append-only, immutable
- **Snapshot** (`.aigon/workflows/features/{id}/snapshot.json`) — derived from events
- **XState machine** — validates lifecycle transitions; `snapshot.can()` for action derivation
- **Effect lifecycle** — durable, resumable side effects (requested → claimed → succeeded/failed)
- **Exclusive file locking** — prevents concurrent modification

Supporting state:
- **Folders** (`docs/specs/features/0N-*/`) — shared ground truth, committed to git
- **Agent status files** (`.aigon/state/feature-{id}-{agent}.json`) — per-agent metadata, managed by `lib/agent-status.js`
- **Shell trap signals**: `buildAgentCommand()` wraps all agent commands with a bash `trap EXIT` handler that fires `agent-status submitted` (exit 0) or `agent-status error` (non-zero). A heartbeat sidecar touches `.aigon/state/heartbeat-{featureId}-{agentId}` every 30s. Controlled by `signals` block in `templates/agents/*.json`.
- Log files are **pure narrative markdown** — no YAML frontmatter, no machine state

The dashboard UI uses `lib/state-queries.js` for action/transition derivation (pure functions, no I/O), `lib/workflow-snapshot-adapter.js` to read engine snapshots through the AIGON server, and `lib/action-command-mapper.js` to keep dashboard/board command formatting consistent across read paths.

Research and feedback entities use simpler filesystem-based transitions (spec folder moves) without the workflow engine.

## Install Architecture
`aigon install-agent` writes **only aigon-owned files** — it never touches `CLAUDE.md` or `AGENTS.md` (after initial scaffold).

**Per-agent outputs:**
- **cc**: `.claude/commands/aigon/*.md`, `.claude/settings.json` (permissions + hooks), `.claude/skills/aigon/SKILL.md`
- **gg**: `.gemini/commands/aigon/*.toml`, `.gemini/settings.json` (hooks), `.gemini/policies/aigon.toml`
- **cx**: `~/.codex/prompts/aigon-*.md` (global), `.codex/prompt.md`, `.codex/config.toml`
- **cu**: `.cursor/commands/aigon-*.md`, `.cursor/cli.json`, `.cursor/hooks.json`, `.cursor/rules/aigon.mdc`
- **mv**: headless only — no slash commands, settings, or context delivery files. Uses `vibe` CLI with `-p` flag.

**Shared:** `AGENTS.md` (scaffolded on first install only, never overwritten), `docs/agents/{agent}.md` (marker blocks), `docs/development_workflow.md` (full overwrite)

**Context delivery** (no root file injection):
- CC/GG: SessionStart hook `aigon project-context` prints doc pointers to stdout → agent ingests as conversation context
- CU: `.cursor/rules/aigon.mdc` with `alwaysApply: true`
- CX: `.codex/prompt.md` with marker blocks

**Auto-update**: SessionStart hook `aigon check-version` detects version mismatch → runs `aigon update` → re-runs `install-agent` for all detected agents

## Aigon Pro (`@aigon/pro`)
- **Private repo**: `~/src/aigon-pro` (github.com/jayvee/aigon-pro)
- **Integration point**: `lib/pro.js` — `require('@aigon/pro')` with graceful fallback
- **What's there**: insights engine, amplification dashboard, AI coaching — all commercial AADE features
- **Dev setup**: `cd ~/src/aigon-pro && npm link`, then `cd ~/src/aigon && npm link @aigon/pro`
- **Cross-repo features**: specs live in aigon, but note Pro file changes in the spec; commit to both repos separately
- See `docs/architecture.md` § "Aigon Pro" for full details

## Where To Add Code
- **New command** → edit `lib/commands/{domain}.js` (pick the matching domain)
- **Shared logic (2+ commands)** → `lib/{domain}.js` (most specific owner)
- **Constants / command metadata** → `lib/constants.js`
- **Agent prompts or install content** → `templates/`; run `aigon install-agent cc` after
- **Workflow state changes** → update command module AND affected templates together

## Seven Rules Before Editing
1. **Run args verbatim** — pass exactly the args the user gave; never add agents/flags from context
2. **Filter `.env.local`** — never let it block `feature-close` or `feature-submit`; ignore in git checks
3. **Screenshot dashboard changes** — take a Playwright screenshot after any `templates/dashboard/index.html` edit
4. **Restart after backend edits** — after changing any `lib/*.js`, restart `aigon server restart`
5. **Don't move spec files manually** — always use `aigon` CLI commands to transition state
6. **Update docs when you change architecture** — if your changes add modules, change repo structure, introduce new patterns, or affect how agents should work, update `CLAUDE.md`, `docs/architecture.md`, and/or `AGENTS.md` in the same PR. Documentation is not a follow-up task — it ships with the code.
7. **Use the frontend-design skill for ALL visual work** — see below.

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
- **Inventing args**: adding `cc` or `--autonomous` to a plain command → causes wrong mode (Drive vs Fleet)
- **Breaking dashboard visually**: passing syntax check but not verifying the rendered UI → ships broken tabs
- **Complexity for simplicity**: responding to "simplify" with smarter/more code instead of removing code
- **`.env.local` blocking flow**: treating it as uncommitted changes → blocks `feature-close`
- **Editing working copies**: changing `.claude/commands/` instead of `templates/` → lost on next sync

## Reading Order
1. `AGENTS.md` (this file) — quick orientation
2. `docs/architecture.md` — full module docs, ctx details, design rules, naming conventions
3. `docs/development_workflow.md` — feature/research lifecycle
4. Active spec: `docs/specs/features/03-in-progress/feature-NNN-*.md`
5. Agent-specific notes: `docs/agents/{id}.md`
