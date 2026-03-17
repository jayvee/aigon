# Feature: restructure-command-system

## Summary
Replace the 249-item scope destructuring and 6,187-line monolithic `shared.js` with a clean command system where each domain has its own command file and commands access dependencies via module objects (`ctx.git.X`) instead of flat destructured names. This eliminates the maintenance bottleneck where adding any function requires editing a 5,080-character line, and makes commands independently testable.

## User Stories
- [ ] As a developer, I want to add a new git helper without editing a 5,080-character destructuring line
- [ ] As a developer, I want to read a feature command without loading 6,000 lines of unrelated code
- [ ] As a developer, I want to test a single command domain without requiring all modules

## Acceptance Criteria
- [ ] `createAllCommands` scope destructuring eliminated — replaced with `ctx` object pattern
- [ ] `ctx` object provides module namespaces: `ctx.git`, `ctx.proxy`, `ctx.config`, `ctx.utils`, etc.
- [ ] Commands use `ctx.git.getCurrentBranch()` instead of bare `getCurrentBranch()`
- [ ] `lib/commands/feature.js` contains all 16 feature-* command handlers (~2,500 lines)
- [ ] `lib/commands/research.js` contains all 11 research-* command handlers (~800 lines)
- [ ] `lib/commands/infra.js` contains dashboard, conductor, dev-server, proxy-setup, config commands (~1,500 lines)
- [ ] `lib/commands/feedback.js` contains feedback-create, feedback-list, feedback-triage (~400 lines)
- [ ] `lib/commands/setup.js` contains init, install-agent, update, doctor (~800 lines)
- [ ] `lib/commands/shared.js` reduced to under 200 lines — just the `createAllCommands` factory that composes command files
- [ ] Deprecated command wrappers (`feature-implement`, `feature-done`, `research-conduct`, `research-done`) removed along with their template files
- [ ] `feature-submit` orphaned registry entry cleaned up (either implement or remove)
- [ ] `overrides` parameter still works for test dependency injection via `ctx`
- [ ] All existing 155+ tests pass
- [ ] Tests updated to use `ctx.module.function()` pattern
- [ ] README.md updated: new architecture section showing module→command structure
- [ ] GUIDE.md updated: "contributing" section explains how to add a new command
- [ ] `docs/architecture.md` created: module dependency diagram, command system overview, state ownership map
- [ ] `CLAUDE.md` updated: reflect new file structure in "Key Functions" and "Architecture" sections

## Validation
```bash
node -c lib/commands/shared.js
node -c lib/commands/feature.js
node -c lib/commands/research.js
node -c lib/commands/infra.js
node -c lib/commands/feedback.js
node -c lib/commands/setup.js
node --test aigon-cli.test.js
# Verify shared.js is under 200 lines
test $(wc -l < lib/commands/shared.js) -lt 200
# Verify no deprecated command templates remain
test ! -f templates/generic/commands/feature-implement.md
test ! -f templates/generic/commands/feature-done.md
test ! -f templates/generic/commands/research-conduct.md
test ! -f templates/generic/commands/research-done.md
```

## Technical Approach

### The ctx pattern
```js
// lib/commands/shared.js (new — ~150 lines)
function createAllCommands(overrides = {}) {
    const ctx = {
        git: { ...require('../git'), ...overrides },
        proxy: { ...require('../proxy'), ...overrides },
        config: { ...require('../config'), ...overrides },
        utils: { ...require('../utils'), ...overrides },
        validation: { ...require('../validation'), ...overrides },
        board: { ...require('../board'), ...overrides },
        feedback: { ...require('../feedback'), ...overrides },
        stateMachine: require('../state-machine'),
        PATHS: require('../utils').PATHS,
        // ... other constants
    };
    return {
        ...require('./feature')(ctx),
        ...require('./research')(ctx),
        ...require('./infra')(ctx),
        ...require('./feedback-cmds')(ctx),
        ...require('./setup')(ctx),
    };
}
```

### Command file pattern
```js
// lib/commands/feature.js (new)
module.exports = function featureCommands(ctx) {
    return {
        'feature-create': (args) => {
            const branch = ctx.git.getCurrentBranch();
            // ...
        },
        'feature-do': (args) => { ... },
        // ...
    };
};
```

### Migration strategy (keep tests green at every step)
1. Create the `ctx` object alongside the existing destructuring
2. Migrate one command domain at a time (start with feedback — smallest)
3. Each migration: move handlers to domain file, update to use `ctx.X`, remove from shared.js
4. After all domains moved, delete the destructuring line
5. Remove deprecated commands and templates last

### Override compatibility
Test overrides work by merging into the ctx modules:
```js
const commands = createAllCommands({ getCurrentBranch: () => 'mock-branch' });
// ctx.git.getCurrentBranch will use the override because ...overrides spreads last
```

## Dependencies
- Feature A (error-handling-and-state-validation) — should be done first
- Feature B (extract-utils-into-domain-modules) — MUST be done first. The ctx pattern references `require('../proxy')`, `require('../config')`, etc. which don't exist until Feature B creates them.

## Out of Scope
- Changing how the CLI entry point dispatches commands (aigon-cli.js stays as-is)
- Adding new commands
- Async refactoring
- Changing the template/slash-command system

## Open Questions
- Should `ctx` be frozen (`Object.freeze`) to prevent commands from mutating shared state?
- Should each command file export a list of its command names for auto-registration?

## Related
- Feature 82: consolidate-git-helpers (completed — lib/git.js is the first domain module)
- Feature A: error-handling-and-state-validation
- Feature B: extract-utils-into-domain-modules (prerequisite)
