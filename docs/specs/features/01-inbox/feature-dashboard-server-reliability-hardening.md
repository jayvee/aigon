# Feature: dashboard server reliability hardening

## Summary

The dashboard server has crashed at least once a day for the past several days. Today's outage was a `ReferenceError: rebaseNeeded is not defined` that took the service down on every request. Investigation surfaced five other recurring runtime errors and three systemic gaps that allow trivially-detectable bugs (undeclared identifiers, duplicate const declarations, missing imports) to reach `main` undetected. This feature treats those specific bugs as symptoms and asks the implementer to **search the codebase end-to-end for every way the server can be made more reliable** — not just patch the known list.

The goal is a server that fails loud at startup if it cannot serve a real status request, and a pre-push gate that catches the entire class of pure-static errors before merge.

## User Stories

- [ ] As an operator, when I run `aigon server restart` the service either comes up green or fails loud immediately — it never enters a state where launchd thinks it is running but every request returns 500.
- [ ] As an agent or developer pushing a change, the pre-push validation gate catches all undeclared identifiers, duplicate declarations, missing imports, and unused-but-referenced symbols before the push completes.
- [ ] As an operator looking at server logs, I see a clear root cause for every error class — no more silent 500s, no more "fatal: not a git repository" messages with no context about which feature triggered them.
- [ ] As an operator, the dashboard's polling loop tolerates per-feature errors gracefully — one bad workflow snapshot doesn't crash status collection for every other feature.

## Acceptance Criteria

- [ ] **Server smoke probe at startup.** `aigon server start` calls `collectDashboardStatusData()` once against the registered repo set before declaring the server "ready". If the call throws, the process exits non-zero and the failure surfaces in `aigon server status` and the launchd plist exit-code visibility.
- [ ] **`eslint --rule no-undef --rule no-unused-vars --rule no-redeclare` passes** on `lib/`, `templates/dashboard/js/`, and is wired into `npm test` (or a new `npm run lint` step that the pre-push gate runs).
- [ ] **No `git add -A` or `git add .` in any aigon-internal commit path** in `lib/` or `templates/`. Every internal commit stages an explicit file list.
- [ ] **Per-feature isolation in `collectFeatures`.** A `try { ... } catch (e) { console.warn(...); return; }` wraps the per-feature loop body so one bad snapshot can't take down the whole status payload. (Partially exists today around `getFeatureDashboardState`; extend to the full body.)
- [ ] **The current six recurring stderr errors are fixed:**
  - `ReferenceError: rebaseNeeded is not defined` (already fixed in `caf3268d` — keep regression test)
  - `ReferenceError: FEATURE_ENGINE_RULES is not defined` (`lib/workflow-rules-report.js:129`)
  - `ReferenceError: log is not defined`
  - `SyntaxError: Identifier 'featureMachine' has already been declared`
  - `Error: Spec path resolution failed: duplicate-matches-snapshot-mismatch` (12 hits — likely needs the snapshot specPath to be re-resolved when the spec moves stages)
  - `TypeError: path argument must be of type string. Received null` (284 hits — most frequent; masked by a non-fatal `console.error` but should be properly handled)
- [ ] **Server stderr log at the end of a clean run is empty** of `ReferenceError`, `TypeError`, `SyntaxError`, and `fatal: not a git repository`.
- [ ] **A "server health" probe** is exposed at `GET /api/health` that returns 200 only if `collectDashboardStatusData` succeeds, and is what `aigon server status` calls to determine "alive vs. crashed".

## Validation

```bash
node -c lib/dashboard-status-collector.js
node -c lib/workflow-rules-report.js
npm run lint 2>&1 | tail -10                       # if a lint script is added
node -e "require('./lib/dashboard-status-collector').collectRepoStatus(process.cwd(), { summary: { implementing: 0, waiting: 0, submitted: 0, error: 0, total: 0 } })" 2>&1 | tail -3
aigon server restart && sleep 2 && curl -s -o /dev/null -w "HTTP %{http_code}" http://localhost:4100/api/status
```

## Pre-authorised

- May raise `scripts/check-test-budget.sh` CEILING by up to +60 LOC if regression tests for the smoke probe and the six fixed errors require it.
- May add a new `npm run lint` script and wire it into `npm test` if doing so is the simplest way to add eslint coverage.
- May add `eslint` and `eslint-config-recommended` to `package.json` devDependencies if not already present.

## Technical Approach

### Background — what happened today

- `lib/dashboard-status-collector.js:491` referenced `rebaseNeeded` which had no declaration in scope. Every status request → 500.
- The variable declaration was deleted by commit `971ccada` ("chore: rename feature ..."), which used `git add -A` and silently bundled 16 unrelated files into a "rename" commit.
- F302 then merged a *new* use of `rebaseNeeded` at line 491, finalising the latent bug.
- F302's tests passed in its worktree because the worktree predated the rename damage.

The deeper issue is not the specific bug — it is that `node -c` and a basic eslint `no-undef` check would have caught `rebaseNeeded`, `FEATURE_ENGINE_RULES`, `log`, and the duplicate `featureMachine` declaration in milliseconds. None of these required runtime test coverage.

### Implementation guidance — broad reliability sweep

The implementer should treat the specific six errors as a starting point, not the goal. **Read the codebase end-to-end** looking for these failure modes:

1. **Boot-time validation.** Anywhere `aigon server start` does work that could throw, ensure the throw kills the process visibly rather than letting launchd believe the service is up. Search for `try { ... } catch (e) { console.error(...) }` patterns in `lib/dashboard-server.js`, `lib/server-runtime.js`, and `lib/commands/infra.js`.

2. **Static analysis gaps.** Beyond `no-undef`, also evaluate:
   - `no-unused-vars` — surfaces dead imports that often indicate half-finished refactors
   - `no-redeclare` — would catch the `featureMachine` already-declared error
   - `no-undef-init`, `no-implicit-globals`
   - Whether `node --check lib/*.js` should run on every file in `lib/` as a pre-push gate (cheap, comprehensive)

3. **Dangerous git patterns.** Grep for `git add -A`, `git add .`, `git commit -am`, `git push --force` in `lib/` and `templates/`. Each is a candidate to replace with explicit file lists or remove.

4. **Per-loop crash isolation.** Anywhere the dashboard iterates a list (features, research, repos, agents, sessions), one item's failure should not break the whole list. Look for `forEach`/`map`/`for ... of` blocks that don't have try/catch wrappers and might throw.

5. **Snapshot/spec consistency.** The `duplicate-matches-snapshot-mismatch` error suggests `snapshot.specPath` can become stale when a spec moves. Find the producers of `specPath` and ensure they're updated on every move (`feature-prioritise`, `feature-start`, `feature-close`, `feature-rename`, `doctor --fix`).

6. **Background process health.** The supervisor, the dev-proxy GC, the dashboard polling loop — each is a long-running process that can wedge silently. Investigate whether each has a heartbeat / liveness signal the operator can see.

7. **Log noise vs. log signal.** 284 hits of "path must be of type string. Received null" suggests we're catching errors in a way that spams logs without surfacing the underlying issue. Audit log levels: errors that aren't fatal should still be classified (warn vs. error), and recurring errors should be deduplicated or aggregated.

8. **Memory/file-handle leaks.** Long server uptimes are where leaks become visible. Spot-check process memory after running for 24h; look for unbounded caches in `_tierCache`, agent status caches, etc.

9. **Race conditions.** When multiple `aigon` CLI commands fire at once (e.g. autopilot triggering close while user clicks Refresh), what state can be corrupted? Lock contention, partial writes to `.aigon/workflows/`, etc.

10. **Recovery story.** When the server does crash, what does recovery look like? Should launchd auto-restart? Should there be a "the last state I saw was X" recovery hint?

The implementer should **add findings to this spec** as they investigate — converting "Implementation guidance" bullets into specific acceptance criteria as the scope tightens.

### Specific fixes for the known six

- **`rebaseNeeded`** — already fixed in `caf3268d`. Add a regression test that calls `collectRepoStatus` against a fixture with an in-progress feature and asserts no throw.
- **`FEATURE_ENGINE_RULES is not defined`** — read `lib/workflow-rules-report.js:129` and add the missing import or definition.
- **`log is not defined`** — find the file and add the missing import (likely `const { log } = require('./logger')` or similar).
- **`featureMachine` already declared** — find the duplicate `const featureMachine` and remove one.
- **`duplicate-matches-snapshot-mismatch`** — investigate `feature-spec-resolver.js`; ensure `snapshot.specPath` is rewritten when the spec moves stage. Likely needs a write-path fix in `feature-prioritise` / `feature-start` / `feature-close`.
- **`path argument null`** — trace the call site. Likely a `git rev-list` call against a worktree that doesn't exist anymore (deleted feature with stale workflow state). Either guard against null, or clean up the orphaned state.

## Dependencies

- None (this is a hardening pass; no new product features required)

## Out of Scope

- Migrating to a new server framework or runtime — this is about hardening the existing Node HTTP server.
- Performance optimisation beyond removing crash-loop log spam.
- Formal SLO definition or external monitoring (Pingdom etc.) — local-process reliability only.
- Cross-repo failure isolation between dashboard server and individual agent processes (separate concern).

## Open Questions

- Should the smoke probe at startup test all registered repos, or just the first one? (Cost vs. fidelity tradeoff.)
- For the `npm run lint` integration, do we want eslint with a config file, or `node --check` over a list of files (cheaper, less comprehensive)?
- Should the `path argument null` 284 hits be a hard error or a one-line warning rate-limited to once per minute? Investigate first, decide based on root cause.

## Related

- F300: feature-close-rebase-gate (introduced the `rebaseNeeded` plumbing)
- F302: kill-utils-js-god-object (the refactor whose merge triggered the crash)
- Today's `feature-rename` work (`git add -A` was the proximate cause; fixed in `caf3268d`)
