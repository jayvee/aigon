---
complexity: medium
set: architecture-simplify-2026-05
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-12T00:34:43.486Z", actor: "cli/feature-prioritise" }
---

# Feature: simplify-split-setup-commands

## Summary

`lib/commands/setup.js` is **4,514 lines in a single closure** exporting 16 unrelated command handlers (`init`, `install-agent`, `apply`, `update`, `doctor`, `seed-reset`, `install-seed`, `uninstall`, `remove`, `setup`, `global-setup`, `check-prerequisites`, `check-version`, `installed-notice`, `project-context`, `trust-worktree`). Every handler closes over the same `ctx.utils` bag of ~60 names plus inline helpers like `gatherInventory`/`printPlan`/`nukePhase`/`clonePhase`/`provisionPhase` that span ~800 lines and are private to `seed-reset`. The `lib/commands/setup/` subdir already exists for split helpers — the precedent and the seam are in place; the work is unfinished.

## User Stories

- [ ] As an agent fixing a bug in `install-agent`, I load ~300 lines of focused code, not 4,514 lines of unrelated handlers.
- [ ] As a maintainer adding a new setup subcommand, I create a new file under `lib/commands/setup/` instead of bolting another handler onto the closure.
- [ ] As an agent auditing dependencies, I see explicit `require()` statements for each handler instead of a shared 60-name `ctx.utils` closure.

## Acceptance Criteria

- [ ] Each command handler lives in its own file under `lib/commands/setup/<name>.js`: `init.js`, `install-agent.js`, `apply.js`, `update.js`, `doctor.js`, `uninstall.js`, `remove.js`, `setup.js`, `global-setup.js`, `check-prerequisites.js`, `check-version.js`, `installed-notice.js`, `project-context.js`, `trust-worktree.js`. (`seed-reset` and `install-seed` already partially split — finish the migration.)
- [ ] `lib/commands/setup.js` becomes a ≤200-line dispatcher that requires each handler module and assembles the command map.
- [ ] No handler accesses helpers via the shared closure — each requires explicitly what it needs.
- [ ] Each handler file is ≤600 LOC. Larger handlers (`install-agent`, `doctor`, `apply`) may be further split into sibling helpers under `lib/commands/setup/<name>/`.
- [ ] `npm run test:core` passes. Existing `_test` export surface continues to work.
- [ ] `createSetupCommands(overrides)` (backward-compat wrapper at `setup.js:4464`) still works for the tests that use it.

## Validation

```bash
# After: setup.js itself should be small
wc -l lib/commands/setup.js                # expect: < 250
# Each split file should be reasonably sized
find lib/commands/setup -name "*.js" -exec wc -l {} \; | sort -rn | head
```

## Technical Approach

- Migrate one handler at a time, smallest first (`trust-worktree`, `installed-notice`, `project-context`), so the dispatcher pattern is proven before tackling `install-agent`/`doctor`/`apply`.
- For each handler, identify the subset of `ctx.utils` it actually uses (most use 5–10 names, not 60) and convert to explicit `require()` at the top of the file.
- `install-agent` (~800 LOC) and `doctor` (~1,800 LOC) may need further internal splitting — defer that to follow-up if the file is still >600 LOC after extraction.
- Preserve the `ctx`-injection pattern at the dispatcher level so command tests can still inject mocks via `createSetupCommands(overrides)`.

## Dependencies

- None. Independent of other architecture-simplify features. Best done after `simplify-centralise-paths-and-json-io` lands so handlers can use the centralised helpers as they migrate, but not required.

## Out of Scope

- Changing any handler's behaviour. This is a pure structural refactor.
- Renaming command keys (`install-agent` etc. stay as-is).
- Replacing the `ctx` injection pattern with direct imports at the call site — that's a larger consistency question for [[feature-294]]/[[feature-296]] work.

## Open Questions

- Should each handler file export `module.exports = (ctx) => async (args) => { ... }`, or skip the `ctx` indirection and require deps directly? Pick the cheaper one in the dispatcher.

## Related

- Set: architecture-simplify-2026-05
