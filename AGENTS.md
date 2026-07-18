# Aigon — Agent Instructions

> Aigon is a spec-driven multi-agent harness. Keep this always-loaded file concise; read the linked references only when the task touches their area.

## Start Here

- `aigon-cli.js` is dispatch only. Command handlers live in `lib/commands/`; shared behavior lives in focused `lib/` modules.
- Read the active feature/research spec before implementation and follow its scope and validation instructions.
- Read `docs/architecture.md` when changing modules, workflow state, installation, agent sessions, the dashboard, or Pro integration.
- Read `docs/testing.md` before choosing validation commands or adding tests.
- Read `.aigon/docs/development_workflow.md` for the feature/research lifecycle and agent-status protocol.
- Read `docs/seeds.md` before touching a seed repo. The two-repo seed architecture makes an ordinary-looking reset capable of wiping work.

<!-- aigon-root:oss-pro-boundary -->
## OSS / Pro Boundary

This repository is public. OSS CLI source, dashboard code, end-user docs, and generic install tests belong here. Pro source, credential-bearing test infrastructure, beta rosters/keys, release rehearsals, and maintainer-only operations belong in `~/src/aigon-pro`.

- Never write a literal Pro/beta key or credential here. Use placeholders or environment variables.
- Files matching `*published-pro*`, `pro-test-*`, or `*-pro-key*` belong in `aigon-pro`.
- Do not bypass the pre-commit sensitive-content guard. Move misplaced internal material to `aigon-pro` and flag the find.
- For cross-repo changes, keep public stubs/contracts here and Pro implementation/internal tests there. Read `docs/architecture.md` § Aigon Pro first.

<!-- aigon-root:target-zero-opinion -->
## Target Repositories: Zero Opinion

Aigon owns only its feature/research/feedback process, specs, `.aigon/` state, worktrees, branches, and managed sessions. It must not assume a target repo's language, package manager, test framework, build/deploy process, directory layout, or commit conventions.

This is load-bearing for everything under `templates/{generic,docs,specs,prompts,skill-pointers}/`, which is installed into unknown repositories. If template wording would be wrong in a Python monorepo, Rust crate, Go service, or static site, generalise it. Per-worktree setup is operator-declared through `worktreeSetup`; Aigon does not detect a stack or inject install commands.

Run `node scripts/check-template-leaks.js` for template changes.

<!-- aigon-root:template-source -->
## Template Source of Truth

- Slash-command templates: `templates/generic/commands/`
- Cursor rule source: `templates/generic/cursor-rule.mdc`
- Agent definitions: `templates/agents/*.json`
- Installed `.claude/`, `.cursor/`, and similar files are generated working copies. Never treat them as edit targets; regenerate with `aigon install-agent <id>`.
- Consumer `AGENTS.md`, `CLAUDE.md`, and `README.md` are user-owned. `install-agent` must leave them byte-identical or absent.

<!-- aigon-root:lifecycle-authority -->
## Lifecycle and State Authority

- Use Aigon CLI lifecycle commands. Do not manually move spec files, create lifecycle links, or write `.aigon/state/` / workflow files.
- Workflow-core events and snapshots are authoritative for feature/research state. Visible stage folders may be a generated symlink view; never infer authority from folder position when a snapshot exists.
- Read paths derive from canonical state and must not silently repair missing write-path behavior. Add lifecycle states and transitions in the engine/projector first, then update read contracts and UI.
- Dashboard/browser code must not re-derive lifecycle decisions, action eligibility, labels, or session roles. It renders server-owned UI contracts.
- Use `aigon nudge <ID> [agent] "message"` to contact running sessions; never handcraft tmux keystrokes.

Read `docs/architecture.md` § Workflow State and § Write-Path Contract before changing lifecycle behavior.

<!-- aigon-root:ctx-pattern -->
## The `ctx` Pattern

Commands receive dependencies through a `ctx` object so tests can override behavior without mocking globals:

```js
module.exports = function featureCommands(ctx) {
    return {
        'feature-create': (args) => {
            const branch = ctx.git.getCurrentBranch();
            const { PATHS } = ctx.utils;
        },
    };
};
```

Build shared command dependencies in `lib/commands/shared.js`; preserve ctx-based injection in new handlers. Entity-parallel feature/research commands belong in `lib/commands/entity-commands.js`.

<!-- aigon-root:dashboard-gallery -->
## Dashboard Contract and Gallery

For operator-visible feature, research, set, autonomous-run, agent, or session state/action changes:

1. Update the canonical workflow/interaction definition and projector first.
2. Update generated gallery facts in `lib/dashboard-card-gallery.js`; scenarios must not hand-author decisions or actions.
3. Cover every resting state and visible action; mark agent-only signals `metadata.uiVisibility: 'internal'`.
4. Model inspection through session DTOs and expose retained output through `Peek`.
5. Review Cards, Pipeline, and Monitor at desktop and 390px mobile using `npm run gallery`.
6. Run `node tests/unit/dashboard-card-gallery.test.js` and `npm run test:gallery`.

The gallery is a review surface, not production dashboard code. Read `docs/feature-interaction-contract.md` and `docs/architecture.md` § Dashboard Frontend before editing this area.

<!-- aigon-root:server-restart -->
## Server Restart Rule

After any `lib/*.js` edit, restart the Aigon dashboard server. Frontend-only assets under `templates/dashboard/` are read fresh and do not require a restart.

<!-- aigon-root:test-commit-version -->
## Tests, Commits, and Versions

- During implementation, use the scoped gate: `npm run test:iterate`. Do not repeatedly run heavy/full suites.
- Before submission, run the active spec's validation. `feature-close` owns the deploy gate.
- New non-trivial code and bug fixes require focused regression coverage. Every test should explain the behavior it pins with a `// REGRESSION:` comment. Read `docs/testing.md` for exceptions and the test LOC ceiling.
- Preserve unrelated user changes and never delete tests or exports to make validation pass.
- Commit meaningful changes with conventional commit prefixes. After every release commit, the maintainer flow requires `npm version patch|minor|major` and pushing tags; agents must not perform a release unless asked.
- Syntax sanity: `node -c aigon-cli.js`. Repository suite: `npm test`.

## On-Demand Reference Map

| Task area | Read before editing |
|---|---|
| Module placement, CLI layering, install internals | `docs/architecture.md` |
| Workflow events, snapshots, state additions, read models | `docs/architecture.md` § Workflow State |
| Test selection, gates, test authoring | `docs/testing.md` |
| Feature/research execution and status signals | `.aigon/docs/development_workflow.md` |
| Dashboard interaction contracts | `docs/feature-interaction-contract.md` |
| Stable spec storage and lifecycle views | `docs/specstore-architecture.md` |
| Seed repos | `docs/seeds.md` |
| Token windows | `docs/token-maxing.md` |

Keep deep histories, module inventories, and state-by-state implementation notes in those references—not in this always-loaded file.
