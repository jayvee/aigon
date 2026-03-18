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
| `lib/commands/feature.js` | 2490 | All `feature-*` handlers, `sessions-close` |
| `lib/dashboard-server.js` | 1913 | HTTP server, WebSocket relay, polling, reads manifests for state |
| `lib/commands/infra.js` | 1858 | dashboard, board, config, proxy-setup, dev-server |
| `lib/utils.js` | 1474 | Spec CRUD, hooks, version, analytics |
| `lib/commands/setup.js` | 1212 | init, install-agent, check-version, update, doctor + state reconciliation |
| `lib/worktree.js` | 1122 | Worktree creation, tmux sessions, terminal launch |
| `lib/validation.js` | 1045 | Ralph/autonomous loop, acceptance-criteria parsing |
| `lib/config.js` | 951 | Global/project config, profiles, agent CLI config |
| `lib/state-machine.js` | 764 | Spec state transitions, `requestTransition()` gatekeeper, outbox |
| `lib/proxy.js` | 711 | Caddy management, port allocation, proxy registry |
| `lib/templates.js` | 550 | Template loading, scaffolding, COMMAND_REGISTRY |
| `lib/manifest.js` | 413 | **State source of truth**: per-feature JSON manifests, agent status, locking, lazy bootstrap |
| `lib/git.js` | 386 | Branch, worktree, status, commit helpers |

Thin facades (re-exports only): `lib/constants.js`, `lib/dashboard.js`, `lib/devserver.js`.

## State Architecture
Feature/research state lives in **two layers**:
1. **Folders** (`docs/specs/features/0N-*/`) — shared ground truth, committed to git
2. **Manifests** (`.aigon/state/feature-{id}.json`) — local reliability layer, gitignored, crash-safe

- Agents write status to `.aigon/state/feature-{id}-{agent}.json` in main repo, not inside worktrees
- Log files are **pure narrative markdown** — no YAML frontmatter, no machine state
- All transitions go through `requestTransition()` — no bypassing the state machine
- Run `aigon doctor --fix` to detect and repair desyncs

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
4. **Restart after backend edits** — after changing any `lib/*.js`, restart `node aigon-cli.js dashboard`
5. **Don't move spec files manually** — always use `aigon` CLI commands to transition state
6. **Run the right tests** — read `docs/architecture.md § Testing` before running tests. Use `npm test` for core + dashboard UI. Use `npm run test:e2e:mock-solo` or `mock-fleet` after lifecycle changes. Use `npm run test:dashboard` after dashboard HTML/JS edits. Never skip tests before submitting.

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
<!-- AIGON_START -->
## Aigon

This project uses the Aigon development workflow.

- Shared project instructions: `AGENTS.md`
- Claude-specific notes: `docs/agents/claude.md`
- Development workflow: `docs/development_workflow.md`

<!-- AIGON_END -->
