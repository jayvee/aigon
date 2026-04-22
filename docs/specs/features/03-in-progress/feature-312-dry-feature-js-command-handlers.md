# Feature: DRY lib/commands/feature.js — extract fat handlers and delegation guard

## Summary

`lib/commands/feature.js` is 3986 lines and acts as a command dispatcher, but three handlers were never extracted into the established `lib/feature-*.js` module pattern that already exists for close, status, review-state, spec-resolver, etc. `feature-autonomous-start` (~771 lines), `feature-start` (~475 lines), and `feature-eval` (~419 lines) contain real business logic that should live in `lib/`. Additionally, a 9-line delegation-guard block is copy-pasted across 4 command handlers unchanged. This feature extracts the three fat handlers into dedicated modules and replaces the delegation guard copies with a single helper, bringing feature.js under ~2000 lines with no handler over 200 lines.

## User Stories

- [x] As an agent working on autonomous mode, I can load `lib/feature-autonomous.js` in isolation without reading 3986 lines of unrelated command dispatch
- [x] As an agent adding a new feature command, I can see what a handler looks like — it's a thin wrapper over a lib module, not a 700-line function
- [x] As a developer reading `feature-start`, I see a short entry point that delegates to `lib/feature-start.js`, not 475 lines of inline logic

## Acceptance Criteria

- [x] `lib/feature-autonomous.js` contains the logic extracted from the `feature-autonomous-start` handler; the handler in feature.js calls it and is ≤ 30 lines
- [x] `lib/feature-start.js` contains the logic extracted from the `feature-start` handler; the handler in feature.js calls it and is ≤ 30 lines
- [x] `lib/feature-eval.js` contains the logic extracted from the `feature-eval` handler; the handler in feature.js calls it and is ≤ 30 lines
- [x] `lib/action-scope.js` exports `withActionDelegate(commandName, args, ctx, fn)` — wraps `buildActionContext → assertActionAllowed → runDelegatedAigonCommand → catch` in one call
- [x] The 4 delegation-guard blocks in feature.js (feature-now, feature-start, feature-eval, feature-cleanup) are replaced with `withActionDelegate(...)` calls
- [x] `lib/commands/feature.js` is ≤ 2200 lines after extraction
- [x] No handler in `lib/commands/feature.js` is longer than 200 lines
- [x] All existing tests pass: `npm test`
- [x] `node -c lib/commands/feature.js lib/feature-autonomous.js lib/feature-start.js lib/feature-eval.js lib/feature-do.js lib/action-scope.js` passes

## Validation

```bash
node -c lib/commands/feature.js
node -c lib/feature-autonomous.js
node -c lib/feature-start.js
node -c lib/feature-eval.js
node -c lib/feature-do.js
node -c lib/action-scope.js
npm test
wc -l lib/commands/feature.js | awk '{if ($1 > 2200) { print "FAIL: feature.js still too large: " $1 " lines"; exit 1 } else print "OK: " $1 " lines"}'
```

## Pre-authorised

- May raise `scripts/check-test-budget.sh` CEILING by up to +20 LOC to cover new unit tests for `withActionDelegate`.

## Technical Approach

### Extraction pattern (already established in codebase)

Each fat handler becomes a thin entry point. Use `withActionDelegate` only where the handler previously had a delegation guard (`feature-now`, `feature-start`, `feature-eval`, `feature-cleanup`). `feature-autonomous-start` never had that guard historically — it stays a short `require` + `featureAutonomous.run(args, handlerDeps)` like today.

```js
// lib/commands/feature.js — after extraction (representative)
'feature-start': async (args) => withActionDelegate('feature-start', args, ctx, async () => {
    const featureStart = require('../feature-start');
    await featureStart.run(args, handlerDeps);
}),
```

The extracted module receives `args` plus a `handlerDeps` bundle (ctx, shared closures from the dispatcher — same idea as `lib/feature-close.js`).

### `withActionDelegate` helper

Add to `lib/action-scope.js`:

```js
function withActionDelegate(commandName, args, ctx, fn) {
    const actionCtx = buildActionContext(ctx.git);
    try {
        const result = assertActionAllowed(commandName, actionCtx);
        if (result && result.delegate) {
            console.log(`📡 Delegating '${commandName}' to main repo...`);
            runDelegatedAigonCommand(result.delegate, commandName, args);
            return;
        }
    } catch (e) { process.exitCode = 1; return console.error(`❌ ${e.message}`); }
    return fn();
}
```

Replace the four copy-pasted delegation guards (previously on `feature-now`, `feature-start`, `feature-eval`, `feature-cleanup`) with calls to this helper.

### Extraction targets (in order of size)

| Handler | Current lines | Extract to | Expected module size |
|---|---|---|---|
| `feature-autonomous-start` | ~771 | `lib/feature-autonomous.js` | ~750 lines |
| `feature-start` | ~475 | `lib/feature-start.js` | ~450 lines |
| `feature-eval` | ~419 | `lib/feature-eval.js` | ~400 lines |

### Key files to read before implementing

- `lib/feature-close.js` — reference for how an extracted handler module is structured
- `lib/action-scope.js` — where `withActionDelegate` will be added
- `lib/commands/feature.js` lines 2805–3576 (`feature-autonomous-start`), 823–1298 (`feature-start`), 1676–2095 (`feature-eval`)

### What does NOT move

- Thin handlers (< 100 lines): feature-create, feature-pause, feature-resume, feature-review, feature-close (already delegates to lib/feature-close.js), etc. — leave in place
- The `ctx` object construction and command dispatch table — stays in feature.js
- Internal helper functions used by only one handler — move with the handler that owns them

## Dependencies

- None

## Out of Scope

- Extracting other handlers (< 100 lines each — not worth the overhead)
- Changing the behaviour of any command
- Updating templates or agent configs
- Splitting feature.js into multiple command files (each handler stays in the same dispatch table)
- Extracting common arg-validation patterns (the usage strings are all different; a helper saves ≤ 5 LOC per site and adds indirection)

## Open Questions

- None — the extraction target is clear and the reference pattern (`lib/feature-close.js`) is established

## Related

- Research: none
- Feature 302: kill utils.js god object (parallel refactor, no dependency)
- Feature 303: split entity.js (parallel refactor, no dependency)
