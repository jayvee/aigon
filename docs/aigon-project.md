# Aigon — Codebase Orientation

## Quick Facts
- **Entry point**: `aigon-cli.js` — dispatch only, no business logic
- **Commands**: 6 domain files in `lib/commands/` (feature, research, feedback, infra, setup, misc)
- **Shared logic**: `lib/*.js` — 16 modules; see Module Map below
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
        stateMachine,
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
| `lib/commands/feature.js` | 2403 | All `feature-*` handlers, `sessions-close` |
| `lib/commands/infra.js` | 1893 | server, dashboard compatibility commands, board, config, proxy-setup, dev-server |
| `lib/dashboard-server.js` | ~2660 | AIGON server HTTP/UI module: dashboard UI, API, WebSocket relay, polling, action dispatch |
| `lib/dashboard-status-collector.js` | ~830 | AIGON server read-side collector: repo/entity status assembly for features, research, feedback, and summary data |
| `lib/utils.js` | 1464 | YAML parsers, spec CRUD, hooks, version, analytics |
| `lib/worktree.js` | 1111 | Worktree creation, tmux sessions, terminal launch |
| `lib/commands/setup.js` | 959 | init, install-agent, check-version, update, doctor |
| `lib/config.js` | 951 | Global/project config, profiles, agent CLI config |
| `lib/validation.js` | 1045 | Iterate (Autopilot) loop, acceptance-criteria parsing |
| `lib/state-machine.js` | 602 | Spec state transitions (inbox → done) |
| `lib/action-command-mapper.js` | ~75 | Shared dashboard/board command formatting for workflow read paths |
| `lib/dashboard-status-helpers.js` | ~200 | Shared dashboard status helpers: tmux/session detection, worktree lookup, status normalization, stale-session heuristics |
| `lib/server-runtime.js` | ~90 | Shared AIGON server lifecycle helpers for start/restart/stop orchestration |
| `lib/templates.js` | 550 | Template loading, scaffolding, COMMAND_REGISTRY |
| `lib/git.js` | 383 | Branch, worktree, status, commit helpers |
| `lib/proxy.js` | 711 | Caddy management, port allocation, proxy registry |

Thin facades (re-exports only): `lib/constants.js`, `lib/dashboard.js`, `lib/devserver.js`.

## Install Architecture
`aigon install-agent` writes **only aigon-owned files** — it never touches `CLAUDE.md` or `AGENTS.md` (after initial scaffold).

**Per-agent outputs:**
- **cc**: `.claude/commands/aigon/*.md`, `.claude/settings.json` (permissions + hooks), `.claude/skills/aigon/SKILL.md`
- **gg**: `.gemini/commands/aigon/*.toml`, `.gemini/settings.json` (hooks), `~/.gemini/policies/aigon.toml`
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

## Five Rules Before Editing
1. **Run args verbatim** — pass exactly the args the user gave; never add agents/flags from context
2. **Filter `.env.local`** — never let it block `feature-close` or `aigon agent-status submitted`; ignore in git checks
3. **Screenshot dashboard changes** — take a Playwright screenshot after any `templates/dashboard/index.html` edit
4. **Restart after backend edits** — after changing any `lib/*.js`, restart `aigon server restart`
5. **Don't move spec files manually** — always use `aigon` CLI commands to transition state

## Common Agent Mistakes
- **Inventing args**: adding `cc` or `--iterate` to a plain command → causes wrong mode (Drive vs Fleet)
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
