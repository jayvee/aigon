# Feature: Modularize CLI into lib/ modules

## Summary

Split `aigon-cli.js` into focused modules under a `lib/` directory, reducing the main entry point to a thin ~200-line dispatcher. This is Phase 3 of the CLI modularization effort. After Phase 1 (data extraction, ~1,500–2,000 lines removed) and Phase 2 (DRY refactoring, ~1,000–1,500 lines removed), the remaining ~8,000 lines of logic are split by domain into independently comprehensible modules. The CLI's external behavior is unchanged.

## User Stories

- [ ] As a developer, I can open `lib/worktree.js` and understand all worktree logic without wading through 8,000 lines of unrelated code
- [ ] As a developer, I can modify the feedback system without risking accidental changes to the dashboard or validation logic
- [ ] As an AI agent working on this codebase, I can read a single ~300-line module instead of needing the full file in context
- [ ] As a developer, I can run `wc -l aigon-cli.js` and see ~200 lines instead of ~8,000
- [ ] As a user, the CLI behaves identically before and after

## Acceptance Criteria

### Module structure
- [ ] `aigon-cli.js` is the entry point (~200 lines): imports, argument parsing, command dispatch, error handling
- [ ] `lib/config.js` — configuration system: profile presets, global/project config, nested value manipulation (~400 lines)
- [ ] `lib/devserver.js` — port allocation, Caddy proxy, dev server spawn/registration (~560 lines)
- [ ] `lib/dashboard.js` — status collection, HTML builder, screenshot capture (~400 lines)
- [ ] `lib/worktree.js` — worktree ops, tmux/Warp/Terminal.app launching, trust management (~500 lines)
- [ ] `lib/hooks.js` — hook parsing and execution (~180 lines)
- [ ] `lib/templates.js` — template loading, placeholder substitution, agent config (~280 lines)
- [ ] `lib/board.js` — Kanban/list rendering, item collection (~490 lines)
- [ ] `lib/validation.js` — Ralph progress tracking, smart validation, acceptance criteria (~1,150 lines)
- [ ] `lib/feedback.js` — feedback CRUD, similarity matching, triage (~330 lines)
- [ ] `lib/utils.js` — YAML parsing, CLI option parsing, git helpers, string utilities (~540 lines)
- [ ] `lib/constants.js` — `PATHS`, shared constants, command registry (from Phase 2) (~200 lines)
- [ ] `lib/commands/feature.js` — all feature command handlers (~2,000 lines)
- [ ] `lib/commands/research.js` — all research command handlers (~750 lines)
- [ ] `lib/commands/feedback.js` — feedback command handlers (~300 lines)
- [ ] `lib/commands/setup.js` — init, install-agent, update, config, profile, doctor, proxy-setup (~1,200 lines)
- [ ] `lib/commands/misc.js` — board, dashboard, worktree-open, sessions-close, deploy, help, next, conductor (~1,500 lines)

### Correctness
- [ ] `node -c aigon-cli.js` passes (syntax check)
- [ ] `node -c lib/*.js lib/commands/*.js` passes for all modules
- [ ] All commands produce identical output and behavior
- [ ] No circular dependencies between modules
- [ ] `aigon help`, `aigon board`, `aigon doctor`, `aigon feature-create test`, `aigon install-agent cc` all work correctly

### Code quality
- [ ] Each module exports a clear public API (named exports, no default exports)
- [ ] No module exceeds ~2,000 lines
- [ ] `aigon-cli.js` contains zero business logic — only imports, dispatch, and top-level error handling
- [ ] All `require()` paths use relative imports from `lib/` (no path tricks)

## Validation

```bash
node -c aigon-cli.js && for f in lib/*.js lib/commands/*.js; do node -c "$f"; done
```

## Technical Approach

### Module extraction order

Extract in dependency order (leaf modules first, then modules that depend on them):

1. **`lib/constants.js`** — `PATHS`, command registry structure. No dependencies on other lib modules.
2. **`lib/utils.js`** — Pure utility functions (YAML parsing, slugify, CLI option parsing, git helpers, `safeWrite`, `escapeRegex`). Depends only on Node built-ins.
3. **`lib/hooks.js`** — Hook parsing and execution. Depends on `utils`.
4. **`lib/config.js`** — Config loading, profile system. Depends on `utils`, `constants`.
5. **`lib/templates.js`** — Template loading, `processTemplate`, agent config. Depends on `config`, `utils`, `constants`.
6. **`lib/feedback.js`** — Feedback document management. Depends on `utils`, `constants`.
7. **`lib/board.js`** — Board rendering. Depends on `utils`, `constants`, `config`.
8. **`lib/worktree.js`** — Worktree and terminal management. Depends on `utils`, `config`.
9. **`lib/devserver.js`** — Port and dev server management. Depends on `utils`, `config`.
10. **`lib/dashboard.js`** — Dashboard HTML and status. Depends on `config`, `utils`.
11. **`lib/validation.js`** — Ralph and smart validation. Depends on `config`, `utils`, `constants`.
12. **Command modules** — Each imports from the lib modules above.
13. **`aigon-cli.js`** — Final cleanup: becomes the thin entry point.

### Extraction technique

For each module:

1. Create the target file (e.g., `lib/utils.js`)
2. Move functions into it, adding `module.exports = { ... }` at the bottom
3. In `aigon-cli.js`, replace the moved functions with `const { fn1, fn2 } = require('./lib/utils')`
4. Run `node -c aigon-cli.js` after each move
5. Run a manual smoke test of affected commands

### Import style

```javascript
// lib/utils.js
const fs = require('fs');
const path = require('path');

function slugify(text) { /* ... */ }
function parseFrontMatter(content) { /* ... */ }
// ...

module.exports = { slugify, parseFrontMatter, /* ... */ };
```

```javascript
// aigon-cli.js (or lib/commands/feature.js)
const { slugify, parseFrontMatter } = require('./lib/utils');
```

### Avoiding circular dependencies

The dependency graph is strictly layered:
- **Layer 0**: `constants.js` (no lib imports)
- **Layer 1**: `utils.js` (no lib imports)
- **Layer 2**: `config.js`, `hooks.js`, `feedback.js` (import from Layer 0-1)
- **Layer 3**: `templates.js`, `board.js`, `worktree.js`, `devserver.js`, `dashboard.js`, `validation.js` (import from Layer 0-2)
- **Layer 4**: `commands/*.js` (import from any layer)
- **Layer 5**: `aigon-cli.js` (imports commands, dispatches)

If a circular dependency is discovered during extraction, it indicates shared state that should be moved to `constants.js` or `utils.js`.

### Commit strategy

One commit per module extraction. This makes it easy to bisect if something breaks:
- `refactor: extract lib/utils.js`
- `refactor: extract lib/config.js`
- `refactor: extract lib/worktree.js`
- etc.

## Dependencies

- Phase 1 (Extract inline data) — must land first
- Phase 2 (DRY refactoring) — must land first; the shared helpers and command registry from Phase 2 make extraction cleaner since there's less duplicated code to untangle

## Out of Scope

- Adding a build step, bundler, or TypeScript compilation
- Changing the public API or CLI behavior
- Adding a test suite (valuable but separate effort)
- Converting to ES modules (`import`/`export`) — staying with CommonJS `require()` for zero-config compatibility
- Restructuring the `templates/` directory
- Performance optimization (the `require()` calls add negligible startup time)

## Open Questions

- Should `lib/commands/` use one file per command family (feature, research, feedback, setup, misc) or one file per command? (Recommendation: per-family — one-per-command would create ~39 tiny files)
- Should modules expose their internals for testing even if not used externally? (Recommendation: export everything that has a name; unexported = truly private helper closures)
- Should we add an `index.js` in `lib/` that re-exports everything, or keep imports explicit? (Recommendation: explicit imports — clearer dependency tracking)

## Related

- Phase 1: "Extract inline data and templates from CLI monolith"
- Phase 2: "DRY refactoring of CLI helpers and command patterns"
- Current file: `aigon-cli.js` (will be ~8,000 lines after Phases 1-2)
