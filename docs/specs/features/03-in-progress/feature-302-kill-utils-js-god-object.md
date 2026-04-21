# Feature: kill-utils-js-god-object

## Summary
`lib/utils.js` is **1,910 lines** and still owns hooks, analytics (~720 lines), version management, CLI option parsing, YAML / frontmatter helpers, spec CRUD, path resolution, and a pile of other domain logic that should live in focused modules. The earlier attempt at this extraction created `lib/hooks.js` as an **11-line re-export shim** that still routes through utils.js — worst of both worlds, because it pretends the extraction happened without actually moving any code. This feature rewrites that attempt as a series of small, individually shippable extractions that each produce real LOC reduction in utils.js and delete the shim layer. Goal is not "delete utils.js in one commit" — it's "make each extraction a tiny, reversible, independently-reviewable commit."

## Safety principle (non-negotiable)

**This refactor must not break any existing behavior.** utils.js is imported by almost every module in `lib/`. Every extraction is additive (new module) + mechanical (update call sites) + deletive (remove from utils.js). Each extraction is one commit, one domain, and passes the pre-push check (`npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`) before moving to the next. If any extraction fails tests or introduces a regression, it's reverted, not patched.

## User Stories
- [ ] As a maintainer, I can find hook logic in `lib/hooks.js`, analytics logic in `lib/analytics.js`, and version logic in `lib/version.js` — not in a 1,900-line utils.js
- [ ] As a contributor, my imports tell me where logic lives instead of routing through an opaque barrel file
- [ ] As a tester, I can exercise analytics in isolation without pulling in hooks, git, or template code
- [ ] As a future agent reading the codebase, I can navigate by domain, not by scrolling through utils.js

## Ground truth — current state (2026-04-06)

Measured with `wc -l`:

- `lib/utils.js` — **1,910 lines** (grew +122 since the original spec was written at 1,788)
- `lib/hooks.js` — **11 lines** (a re-export shim pointing at utils.js; not a real module)
- `lib/analytics.js` — does not exist
- `lib/version.js` — does not exist

Call sites still using `require('./utils')`:
- `lib/board.js`, `lib/constants.js`, `lib/dashboard-server.js` (×2), `lib/dashboard.js`, `lib/devserver.js`, `lib/feedback.js`, `lib/hooks.js` (!), `lib/validation.js`, `lib/worktree.js` (×3)
- `lib/commands/feedback.js`, `lib/commands/feature.js`, `lib/commands/misc.js`, `lib/commands/research.js`, `lib/commands/infra.js`, `lib/commands/setup.js`, `lib/commands/shared.js`

`buildCtx()` in `lib/commands/shared.js` injects `ctx.utils` into every command handler, so many call sites reference it indirectly as `ctx.utils.X`.

## Acceptance Criteria

### Principle ACs

- [ ] **AC1** — Every extraction is an independent commit that passes `node --check aigon-cli.js && npm test && MOCK_DELAY=fast npm run test:ui` on its own. No multi-commit "flag day" where half the repo is broken mid-sequence.
- [ ] **AC2** — Each extraction moves code **verbatim** — no logic changes during a move. Logic refactors come in separate commits after the move.
- [ ] **AC3** — Every `require('./utils')` call site that imported the moved symbol is updated to import from the new module in the **same commit** as the extraction. No transitional shims.
- [ ] **AC4** — `lib/hooks.js` as a re-export shim is deleted at the end of the first extraction (hooks); the file becomes the real hooks module or is replaced by it.
- [ ] **AC5** — The `ctx` pattern is preserved. `buildCtx()` in `lib/commands/shared.js` wires each new module so command handlers can override in tests via `ctx.hooks`, `ctx.analytics`, etc.
- [ ] **AC6** — No new barrel files, no new re-export layers. Every module owns its domain and is imported directly.
- [ ] **AC7** — Each extraction commit reduces `lib/utils.js` LOC by at least the number of lines it moves (no growth, no stubs left behind).

### Concrete extractions (each is one shippable commit)

#### Extraction 1 — hooks → `lib/hooks.js` (real module)

- [ ] **E1.1** — Move `parseHooksFile`, `getDefinedHooks`, `executeHook`, `runPreHook`, `runPostHook` from `utils.js` into `lib/hooks.js`
- [ ] **E1.2** — Delete the existing 11-line re-export shim and replace with the actual implementation
- [ ] **E1.3** — Update every call site that references these functions via `require('./utils')` to use `require('./hooks')` instead
- [ ] **E1.4** — Update `buildCtx()` to inject `ctx.hooks` as a first-class dependency
- [ ] **E1.5** — `lib/hooks.js` is < 100 LOC, owns its domain, no longer requires `./utils`
- [ ] **E1.6** — `lib/utils.js` shrinks by the full size of the moved block (~60-80 lines)

#### Extraction 2 — analytics → `lib/analytics.js` (new module)

- [ ] **E2.1** — Create `lib/analytics.js`. Move `collectAnalyticsData` and its helpers (the ~720-line block starting around utils.js:796) verbatim into it
- [ ] **E2.2** — The only current consumer of analytics is `lib/dashboard-server.js` — update it to import from `./analytics` directly
- [ ] **E2.3** — `lib/analytics.js` is < 800 LOC (the block is larger than the original spec estimated — still a big module, but it's a coherent domain)
- [ ] **E2.4** — `lib/utils.js` shrinks by ~720 lines
- [ ] **E2.5** — Tests still pass. `dashboard-e2e` suite still green (analytics feeds the stats panels)

#### Extraction 3 — version → `lib/version.js` (new module)

- [ ] **E3.1** — Create `lib/version.js`. Move version check / update / bump logic from utils.js
- [ ] **E3.2** — Update call sites (likely `lib/commands/setup.js` via `aigon update`, and the SessionStart hook path)
- [ ] **E3.3** — `lib/version.js` is < 80 LOC
- [ ] **E3.4** — `lib/utils.js` shrinks further

#### Extraction 4 — spec CRUD → `lib/spec-crud.js` or merge into `lib/feature-spec-resolver.js`

- [ ] **E4.1** — Move `getNextId`, `findFile`, `findUnprioritizedFile`, and related spec-path helpers out of utils.js into either a new `lib/spec-crud.js` or the existing `lib/feature-spec-resolver.js` (pick whichever makes more sense after reading both)
- [ ] **E4.2** — Update all call sites
- [ ] **E4.3** — `lib/utils.js` shrinks by ~200-300 lines

#### Extraction 5 — CLI option parsing + YAML helpers → `lib/cli-parse.js`

- [ ] **E5.1** — Move `parseCliOptions`, `getOptionValue`, `getOptionValues`, `parseNumericArray`, `parseFrontMatter`, `parseYamlScalar`, `serializeYamlScalar`, `extractMarkdownSection`, `stripInlineYamlComment`, `splitInlineYamlArray`, `slugify`, `escapeRegex` into a new `lib/cli-parse.js` (or split further if a coherent sub-domain emerges)
- [ ] **E5.2** — Update all call sites
- [ ] **E5.3** — `lib/utils.js` shrinks by ~150-250 lines

#### Extraction 6 — whatever remains

- [ ] **E6.1** — After extractions 1-5, re-measure `lib/utils.js`. Whatever's left is the residue: a handful of truly cross-cutting helpers, or a misfit pile that deserves its own extraction
- [ ] **E6.2** — Either (a) delete `lib/utils.js` entirely and inline the last few helpers at call sites, or (b) rename it to something specific (e.g. `lib/shared-helpers.js`) and document what belongs there and what doesn't
- [ ] **E6.3** — No module in `lib/` continues to act as a barrel file or general-purpose dumping ground

### Completion criterion

- [ ] **AC8** — At the end of the sequence, `lib/utils.js` is either **deleted** (preferred) or renamed to a specific-purpose module < 200 LOC with a clear charter documented at the top of the file. The word "utils" should not appear in any lib/ filename.
- [ ] **AC9** — Extracted modules total < 1,600 LOC combined (down from 1,910). The savings come from (a) removing the re-export overhead and (b) eliminating dead code discovered during the move.
- [ ] **AC10** — CLAUDE.md Module Map section updated to reflect the new modules.
- [ ] **AC11** — `docs/architecture.md` updated if its "Where To Add Code" section references utils.js.

## Validation

```bash
# After every extraction commit:
node --check aigon-cli.js
node -c lib/<new-module>.js
node -c lib/utils.js        # only until extraction 6 deletes it
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh

# Final state:
test ! -f lib/utils.js || wc -l lib/utils.js   # expect deleted OR < 200 LOC
wc -l lib/hooks.js lib/analytics.js lib/version.js
grep -r "require('./utils')" lib/ || echo "clean"
```

## Technical Approach

### Incremental, not monolithic

The original 193 spec treated this as a single "do the whole extraction in one feature" task, which is why it has been sitting in backlog for weeks. That framing was wrong. **This is six shippable features, not one.** Each extraction is 100-300 LOC of edits across ~10 files, with clear before/after LOC measurements. Each one is independently revertable. Each one is safe to pause after.

### Execution order

1. **Hooks first** — smallest extraction (~70 lines), and the fake `lib/hooks.js` shim makes this the most embarrassing to leave in place. Good "warm up" commit that validates the approach.
2. **Analytics second** — biggest LOC win by a wide margin (~720 lines). Only one consumer (`dashboard-server.js`). Low blast radius for a large payoff.
3. **Version third** — very small (~50 lines), mostly self-contained.
4. **Spec CRUD fourth** — touches more call sites but each change is small.
5. **CLI parse fifth** — lots of small helpers, highest call-site count, most tedious mechanical work.
6. **Residue sixth** — whatever's left. Decision point: delete entirely or rename.

### Mechanical steps per extraction

1. `grep -n "^function <name>\|^async function <name>" lib/utils.js` — find the exact lines to move
2. Read the function(s) + any local helpers they depend on
3. Create or edit the target module. Paste the block verbatim. Wire up exports.
4. `grep -rn "utils.<name>\|utils\['<name>'\]" lib/ lib/commands/` — find every call site
5. Edit each call site: change `require('./utils')` to `require('./<new-module>')`, or add a second require if the file still uses other utils functions
6. Update `buildCtx()` in `lib/commands/shared.js` to inject the new module as a first-class dependency
7. Delete the function(s) from utils.js
8. Run the full pre-push check — syntax, unit tests, e2e, budget
9. If green, commit with a message like `refactor(hooks): extract from utils.js into lib/hooks.js`. If red, revert and diagnose
10. Move to next extraction

### What is NOT changing during this feature

- The `ctx` pattern itself — preserved, just re-wired
- Any function's behavior — pure moves, verbatim, no logic changes
- Test infrastructure — existing tests stay green; new tests only if a move exposes a gap
- External CLI interface — user-facing commands unchanged
- Any consumer of an un-extracted function — untouched until its function is moved
- Command files (`lib/commands/*.js`) — they are updated at the import level per extraction, but the handlers themselves stay the same
- Workflow engine — entirely unrelated to this refactor

## Dependencies

- None. This is a pure internal refactor. Depends only on the pre-push test discipline from CLAUDE.md rule T1 to stay safe.

## Out of Scope

- **Refactoring command handlers** (that's a completely separate concern, now explicitly parked — see killed feature 194)
- **Shrinking `lib/commands/feature.js`, `setup.js`, or `infra.js`** — those files are not touched by this feature except for import-line updates
- **Changing analytics data format, collection logic, or storage** — pure code move
- **Modifying hook behavior, event firing, or hook definitions**
- **Changing how version checks work, when they fire, or their output format**
- **Introducing TypeScript, a module bundler, or any new tooling**
- **Merging modules** — the direction is split, not merge
- **Consolidating `lib/feature-spec-resolver.js` with spec CRUD** — that's a future judgment call after extraction 4 lands
- **Deleting `lib/constants.js`** — it stays as the home for `PATHS` and shared strings

## Open Questions

- **Extraction 4: new module vs merge?** Do spec-CRUD helpers live in a new `lib/spec-crud.js`, or get folded into the existing `lib/feature-spec-resolver.js`? Decision point is after reading both files — whichever produces the more coherent module wins. Default: new module, because feature-spec-resolver is about lookup, not CRUD.
- **Extraction 6 disposition: delete or rename?** If ~100-200 lines of genuinely-shared helpers survive the other extractions, is it worth keeping `lib/utils.js` (renamed) or better to inline at call sites? Default: inline, unless the residue is clearly shared by 3+ modules.
- **Should `buildCtx()` be rewritten to auto-wire new modules?** Currently it explicitly lists each dependency. After adding 4-5 new modules, a loop might be cleaner. But that's a ctx refactor, which is explicitly out of scope. Default: keep the explicit list.

## Related

- Killed feature 194 (`command-config-runner-replace-imperative-handlers`) — used to be the sibling refactor; removed as over-abstracted
- `lib/commands/shared.js` — `buildCtx()` wire-up
- CLAUDE.md "Module Map" table — needs updating at the end
- CLAUDE.md rule T1 (pre-push tests) — enforced at every extraction commit
- CLAUDE.md rule T2 (new code ships with a test) — extractions are pure moves, so new tests aren't required unless the move exposes a gap. Commit message should call this out when skipping.
