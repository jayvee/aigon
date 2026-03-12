# Feature: Complete CLI modularization

## Summary

Move actual logic from the two mega-files (`lib/utils.js` at ~6,000 lines and `lib/commands/shared.js` at ~6,200 lines) into the domain modules and command-family modules established in Phase 3. After this, every module contains its own logic rather than re-exporting from a central file, and no module exceeds ~2,000 lines. This is Phase 3b — finishing what feature 49 started.

## User Stories

- [ ] As a developer, I can open `lib/config.js` and find the actual config functions (~400 lines), not 25 lines of re-exports
- [ ] As a developer, I can modify feedback triage logic in `lib/commands/feedback.js` (~300 lines) without scrolling through 6,200 lines of unrelated command handlers
- [ ] As an AI agent, I can read a single focused module instead of needing a 6,000-line file in context
- [ ] As a user, the CLI behaves identically before and after

## Acceptance Criteria

### Move logic into domain modules
- [ ] `lib/utils.js` contains only genuine shared utilities (slugify, parseFrontMatter, safeWrite, CLI option parsing, git helpers, string utilities) — target ~500 lines
- [ ] `lib/config.js` contains config loading, profile system, nested value manipulation — target ~400 lines
- [ ] `lib/devserver.js` contains port allocation, Caddy proxy, dev server spawn/registration — target ~560 lines
- [ ] `lib/dashboard.js` contains status collection, HTML builder, screenshot capture — target ~400 lines
- [ ] `lib/worktree.js` contains worktree ops, tmux/Warp/Terminal.app launching, trust management — target ~500 lines
- [ ] `lib/hooks.js` contains hook parsing and execution — target ~180 lines
- [ ] `lib/templates.js` contains template loading, placeholder substitution, agent config — target ~280 lines
- [ ] `lib/board.js` contains Kanban/list rendering, item collection — target ~490 lines
- [ ] `lib/validation.js` contains Ralph progress tracking, smart validation, acceptance criteria — target ~1,150 lines
- [ ] `lib/feedback.js` contains feedback CRUD, similarity matching, triage — target ~330 lines
- [ ] `lib/constants.js` contains PATHS, shared constants, command registry — target ~200 lines

### Move logic into command-family modules
- [ ] `lib/commands/shared.js` is deleted or reduced to a thin factory that wires command families together
- [ ] `lib/commands/feature.js` contains all feature command handlers — target ~2,000 lines
- [ ] `lib/commands/research.js` contains all research command handlers — target ~750 lines
- [ ] `lib/commands/feedback.js` contains feedback command handlers — target ~300 lines
- [ ] `lib/commands/setup.js` contains init, install-agent, update, config, profile, doctor, proxy-setup — target ~1,200 lines
- [ ] `lib/commands/misc.js` contains board, dashboard, worktree-open, sessions-close, deploy, help, next, conductor, radar — target ~1,500 lines

### Correctness
- [ ] `node -c aigon-cli.js` passes
- [ ] `node -c lib/*.js lib/commands/*.js` passes for all modules
- [ ] `npm test` passes (all 25 tests)
- [ ] No circular dependencies between modules
- [ ] No module exceeds 2,000 lines
- [ ] `aigon help`, `aigon board`, `aigon doctor` all work correctly

### Cleanup
- [ ] `scripts/extract-cli-modules.js` removed (extraction tool no longer needed)
- [ ] No re-export wrapper pattern remains — each module owns its logic

## Validation

```bash
node -c aigon-cli.js && for f in lib/*.js lib/commands/*.js; do node -c "$f"; done
npm test
# Verify no module exceeds 2000 lines
for f in lib/*.js lib/commands/*.js; do lines=$(wc -l < "$f"); if [ "$lines" -gt 2000 ]; then echo "FAIL: $f ($lines lines)"; fi; done
```

## Technical Approach

### Strategy: incremental move, module by module

The import paths already exist. The work is mechanical:

1. Pick a domain module (e.g., `lib/config.js`)
2. Identify all functions in `lib/utils.js` that belong to it (config loading, profile system, etc.)
3. Move the functions into `lib/config.js`, adding necessary `require()` imports
4. In `lib/utils.js`, replace the moved functions with `const { fn } = require('./config')` re-exports (for backward compat during migration)
5. Run `node -c` on both files
6. Repeat for all domain modules
7. Once all logic is moved out, clean up `lib/utils.js` to only contain genuine utilities
8. Apply the same pattern to `lib/commands/shared.js` → individual command-family modules
9. Remove the re-export stubs from `lib/utils.js` once all consumers import from the correct module

### Extraction order (same dependency layering as Phase 3 spec)

1. `lib/constants.js` — move PATHS, COMMAND_REGISTRY, AGENT_CONFIGS from utils.js
2. `lib/hooks.js` — move hook parsing/execution from utils.js
3. `lib/config.js` — move config and profile functions from utils.js
4. `lib/templates.js` — move template loading and agent config from utils.js
5. `lib/feedback.js` — move feedback CRUD and similarity from utils.js
6. `lib/board.js` — move board rendering from utils.js
7. `lib/worktree.js` — move worktree/tmux/terminal from utils.js
8. `lib/devserver.js` — move port/proxy/dev-server from utils.js
9. `lib/dashboard.js` — move dashboard/radar from utils.js
10. `lib/validation.js` — move Ralph and smart validation from utils.js
11. `lib/commands/feature.js` — move feature handlers from shared.js
12. `lib/commands/research.js` — move research handlers from shared.js
13. `lib/commands/feedback.js` — move feedback handlers from shared.js
14. `lib/commands/setup.js` — move setup handlers from shared.js
15. `lib/commands/misc.js` — move misc handlers from shared.js
16. Delete `lib/commands/shared.js` and `scripts/extract-cli-modules.js`

### Handling the closure pattern in shared.js

The current `createAllCommands()` uses a massive destructuring to make all utils available as local variables within command handlers. When splitting into family modules, each family module should:

```javascript
// lib/commands/feature.js
const { findFile, moveFile, printNextSteps, ... } = require('../utils');
const { getEffectiveConfig, ... } = require('../config');

const commands = {
    'feature-create': (args) => { ... },
    // ...
};

module.exports = commands;
```

The command handlers reference these via module-level `const` instead of closure variables.

## Dependencies

- Feature 49 (Phase 3 — modularize CLI) must be merged first

## Out of Scope

- Adding new tests (valuable but separate effort)
- Converting to ES modules
- Adding TypeScript or JSDoc types
- Changing any CLI behavior or output
- Restructuring `templates/` directory

## Open Questions

- Should `lib/utils.js` continue to re-export everything from domain modules for backward compatibility with external consumers, or should we break those paths? (Recommendation: no external consumers exist, so clean break is fine)

## Related

- Phase 1: Feature 48 — Extract inline data and templates (done)
- Phase 2: Feature 47 — DRY refactoring of CLI helpers (done)
- Phase 3: Feature 49 — Modularize CLI into lib/ modules (done — this feature completes it)
