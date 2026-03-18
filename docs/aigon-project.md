# Aigon — Codebase Orientation

## Quick Facts
- **Entry point**: `aigon-cli.js` — dispatch only, no business logic
- **Commands**: 6 domain files in `lib/commands/` (feature, research, feedback, infra, setup, misc)
- **Shared logic**: `lib/*.js` — 12 modules; see Module Map below
- **Template source of truth**: `templates/generic/commands/` — sync via `aigon install-agent cc`
- **Working copies** (gitignored): `.claude/commands/`, `.cursor/commands/`, etc.
- **Dashboard**: foreground server — `node aigon-cli.js dashboard`; restart after any `lib/*.js` edit
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
| `lib/commands/infra.js` | 1893 | dashboard, board, config, proxy-setup, dev-server |
| `lib/dashboard-server.js` | 1785 | HTTP server, WebSocket relay, polling, action dispatch |
| `lib/utils.js` | 1464 | YAML parsers, spec CRUD, hooks, version, analytics |
| `lib/worktree.js` | 1111 | Worktree creation, tmux sessions, terminal launch |
| `lib/commands/setup.js` | 959 | init, install-agent, check-version, update, doctor |
| `lib/config.js` | 951 | Global/project config, profiles, agent CLI config |
| `lib/validation.js` | 1045 | Ralph/autonomous loop, acceptance-criteria parsing |
| `lib/state-machine.js` | 602 | Spec state transitions (inbox → done) |
| `lib/templates.js` | 550 | Template loading, scaffolding, COMMAND_REGISTRY |
| `lib/git.js` | 383 | Branch, worktree, status, commit helpers |
| `lib/proxy.js` | 711 | Caddy management, port allocation, proxy registry |

Thin facades (re-exports only): `lib/constants.js`, `lib/dashboard.js`, `lib/devserver.js`.

## Where To Add Code
- **New command** → edit `lib/commands/{domain}.js` (pick the matching domain)
- **Shared logic (2+ commands)** → `lib/{domain}.js` (most specific owner)
- **Constants / command metadata** → `lib/constants.js`
- **Agent prompts or install content** → `templates/`; run `aigon install-agent cc` after
- **Workflow state changes** → update command module AND affected templates together

## Five Rules Before Editing
1. **Run args verbatim** — pass exactly the args the user gave; never add agents/flags from context
2. **Filter `.env.local`** — never let it block `feature-close` or `feature-submit`; ignore in git checks
3. **Screenshot dashboard changes** — take a Playwright screenshot after any `templates/dashboard/index.html` edit
4. **Restart after backend edits** — after changing any `lib/*.js`, restart `node aigon-cli.js dashboard`
5. **Don't move spec files manually** — always use `aigon` CLI commands to transition state

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
