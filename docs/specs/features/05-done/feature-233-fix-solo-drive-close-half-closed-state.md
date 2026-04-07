# Feature: fix-solo-drive-close-half-closed-state

## Summary
Solo Drive mode (`feature-start <id>` with no agent) currently writes a `feature.started` event with `agents: []`, so the workflow-core engine has zero registered agents. The `agent-status submitted` lifecycle signal arrives as `signal.agent_ready` for `agentId: 'solo'`, which the projector silently drops because `'solo'` is not in `context.agents`. When the user later runs `feature-close <id>`, the `soloAllReady` guard fails (length === 1 check on an empty map), the XState machine refuses the `feature.close` event, and the engine throws `Feature N cannot be closed from <state>`. Critically, this throw happens **after** `autoCommitAndPush` and `mergeFeatureBranch` have already run, leaving the repo half-closed: branch merged + pushed, spec still in `03-in-progress`, snapshot still `implementing`, no clean recovery path. A latent compounding bug in `getMainRepoPath` (returns the wrong directory when aigon is invoked from a subdirectory of the main repo) makes the failure mode even more confusing because the very first close attempt errors with `Could not resolve visible spec` before the engine bug even fires. This feature fixes both bugs, adds atomicity around the close phases, and provides a recovery path for features already stuck in this state.

Reproduced live in `farline-ai-forge` feature 34 — see `.aigon/workflows/features/34/events.jsonl` (in that repo) for the canonical broken event log.

## User Stories
- [ ] As a solo Drive mode user, when I run `feature-close <id>`, the feature transitions cleanly to `done` without any "cannot be closed from implementing" errors.
- [ ] As a user invoking `aigon` from a subdirectory of my main repo, every command (including `feature-close`) resolves the spec correctly instead of failing with "Could not resolve visible spec".
- [ ] As a user whose `feature-close` failed midway (merge done, engine close failed), I can re-run `feature-close <id>` and it recovers the half-closed state instead of getting stuck forever.
- [ ] As a user with an already-broken feature 34 in farline-ai-forge (or any other repo affected by this bug before the fix shipped), I have a documented recovery procedure or `aigon doctor` recipe that closes the workflow snapshot cleanly.

## Acceptance Criteria
- [ ] `lib/commands/feature.js` solo-Drive launch path passes `['solo']` (not `[]`) to `wf.startFeature` when `agentIds.length === 0`. Both call sites at `feature.js:776` and `feature.js:800` are updated identically.
- [ ] `lib/git.js` `getMainRepoPath()` correctly resolves the repo root when called from any subdirectory of a non-worktree main repo. When `git rev-parse --git-common-dir` returns a relative path (e.g. `.git`, `../.git`), it is resolved against `cwd` and then `dirname`'d. Verified manually by running an aigon command from a deep subdirectory of a test repo.
- [ ] `feature-close` for a fresh solo-Drive feature succeeds end-to-end: spec moves to `05-done`, branch merged + deleted, workflow snapshot transitions through `closing` to `done`, no errors printed.
- [ ] `feature-close` validates the engine transition **before** any git side-effects run (auto-commit, push, merge). If the engine would reject the transition, the user sees the error before any branch is pushed or merge commit is created. Implementation: a dry-run check that runs the same `soloAllReady`-style guard logic on the current snapshot without persisting events; if it fails, abort early with a clear error.
- [ ] Recovery path: if the engine snapshot has `agents: []` (corruption from the old bug), `closeEngineState` auto-injects an `agent.marked_ready` event for `'solo'` (or detects and bootstraps the missing agent in another principled way) before attempting the transition. This unblocks any feature already broken by the prior bug without requiring manual events.jsonl editing.
- [ ] Existing broken feature 34 in `~/src/farline-ai-forge` can be closed cleanly by running `aigon feature-close 34` against the patched CLI (or via a `aigon doctor --reconcile-feature 34` recovery command — implementer's choice).
- [ ] New regression test: spinning up a solo-Drive feature in a temp git repo, emitting `agent-status submitted`, and running `feature-close` end-to-end. Test asserts the workflow snapshot lands at `done` and the spec ends up in `05-done`. Comment names this regression: "feature 34 / farline-ai-forge: solo Drive emitted feature.started with agents:[]".
- [ ] New regression test: `getMainRepoPath()` called from a subdirectory of a temp git repo returns the repo root (not the subdir). Comment names the regression.
- [ ] Test suite stays under the 2,000 LOC ceiling. Delete any older test that this regression test subsumes; if nothing can be deleted, justify in the commit.
- [ ] `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh` all pass before push.

## Validation
```bash
node -c aigon-cli.js
node -c lib/commands/feature.js
node -c lib/git.js
node -c lib/feature-close.js
node -c lib/workflow-core/engine.js
npm test
```

## Technical Approach

### Bug 1 — empty `agents` array on solo Drive launch (root cause)

**Where**: `lib/commands/feature.js:776` (fresh start) and `lib/commands/feature.js:800` (the second `resolveFeatureMode` call site).

**Fix**: when `agentIds.length === 0`, pass `['solo']` to the engine. Centralising this inside `lib/workflow-core/engine.js startFeature()` is more invasive (it'd need every caller to opt in), so the simpler one-line fix at the call site is preferred.

```js
const engineMode = resolveFeatureMode(agentIds);
const engineAgents = agentIds.length === 0 ? ['solo'] : agentIds;
await wf.startFeature(repoPath, featureId, engineMode, engineAgents);
```

This makes the projector recognise `signal.agent_ready` for `'solo'` and lets `soloAllReady` actually gate properly. The agent name `'solo'` is already canonical — `lib/commands/misc.js:84-85` (agent-status branch parser) and `lib/feature-close.js:498` already use it.

### Bug 2 — `getMainRepoPath` broken from subdirectories

**Where**: `lib/git.js:405-413`.

**Symptoms**: every aigon command run from a subdirectory of a non-worktree main repo silently misroutes its `mainRepoPath` to the subdir, causing spec/snapshot lookups to fail. Confirmed via `git rev-parse --git-common-dir`: returns `.git` from repo root, `../.git` from a subdir — both relative, never absolute. The current implementation only handles absolute (worktree) paths.

**Fix**:

```js
function getMainRepoPath(cwd) {
    const commonDir = getCommonDir(cwd);
    if (!commonDir) return cwd || process.cwd();
    const absCommonDir = path.isAbsolute(commonDir)
        ? commonDir
        : path.resolve(cwd || process.cwd(), commonDir);
    return path.dirname(absCommonDir);
}
```

Alternatively, use `git rev-parse --show-toplevel` for the non-worktree case (always absolute). Either is fine.

### Bug 3 — half-closed state when engine throws after merge

**Where**: `lib/commands/feature.js:1880-1926`. Phases run in order: auto-commit (4), push, merge (5), telemetry (6), engine close (7). The engine throw at phase 7 leaves a merged branch with no clean rollback.

**Fix (two-part)**:

1. **Pre-validate** the engine transition before any git side-effects. Add a new helper in `lib/workflow-core/engine.js` (e.g. `canCloseFeature(repoPath, featureId)`) that loads the snapshot, hydrates a fresh actor in the current state, and returns `snapshot.can({ type: 'feature.close', at: now() })` without persisting anything. Call it from `feature-close.js` *before* `autoCommitAndPush`. On failure, print a clear error: `Feature N is not ready to close (state=<x>, agents=<y>). Run \`aigon agent-status submitted\` first.`

2. **Auto-recover** `agents: []` corruption in `closeEngineState`. Before invoking `tryCloseFeatureWithEffects`, inspect the snapshot. If `Object.keys(snapshot.agents).length === 0` and the entity was launched in `solo_branch` mode, persist a synthetic `feature.bootstrapped` or `agent.marked_ready` event that registers `'solo'` as a ready agent, then retry. This unblocks features already broken by the prior bug without manual editing.

The combination ensures: (a) freshly-started solo features close cleanly via Bug 1's fix, (b) old broken features are auto-healed by the recovery path in Bug 3.2, (c) no future bug in this area can leave a half-closed state because Bug 3.1 catches it before any git operations.

### Recovery for the existing broken feature 34 in farline-ai-forge

After implementing the fixes, `aigon feature-close 34` from `~/src/farline-ai-forge` should auto-heal via the Bug 3.2 path: detect empty agents, inject `solo`, transition to `closing`, run the (already-completed) move_spec_to_done effect, write `feature.closed`. Verify by checking that the snapshot ends at `done`. Note: the spec was already moved manually by the user's session, so `move_spec_to_done` may be a no-op — make sure the effect handler is idempotent (or detects the spec is already in `05-done` and marks the effect succeeded).

### Tests

- `tests/feature-close-solo.test.js` (or extend existing close test): spin up a temp git repo with a backlog feature, run `feature-start` (solo, no agent), emit `agent-status submitted`, run `feature-close`, assert snapshot is `done` and spec is in `05-done`.
- `tests/git-main-repo-path.test.js`: create temp repo with subdir, chdir into subdir, call `getMainRepoPath()`, assert it returns the repo root.
- `tests/feature-close-recovery.test.js`: hand-craft an `events.jsonl` with `feature.started` agents:[], run `feature-close`, assert it auto-heals and lands in `done`.

Each test gets a `// REGRESSION:` comment naming the bug. Check the 2,000-line budget before adding — delete any older test this subsumes.

## Dependencies
-

## Out of Scope
- Refactoring `feature-close.js` phase ordering beyond inserting the pre-validation check (the existing phase split is fine).
- Generalising the agent-injection recovery to research workflows (research has different lifecycle assumptions; revisit if a similar bug surfaces).
- Adding `--force` to `feature-close` to bypass guards entirely (the auto-recovery path is preferred over a footgun).
- Touching the `signal.agent_submitted` projector branch (already handled correctly for `agent.marked_ready` family).

## Open Questions
- Should the pre-validation in Bug 3.1 also run during `feature-close --reclaim`? Probably yes — `--reclaim` is for stuck *effects*, not stuck *state*.
- Where should the canonical `'solo'` agent ID constant live? Currently it's a string literal in 3+ places. Consider extracting to `lib/workflow-core/types.js` (`AGENT_SOLO = 'solo'`) — small but makes the implicit contract explicit.
- Is there a `lib/workflow-core/migration.js` path that already handles bootstrapping legacy features? If so, the auto-recovery in Bug 3.2 might fit there instead of in `closeEngineState`.

## Related
- Research:
- Original bug session: solo Drive mode `feature-close 34` in farline-ai-forge, 2026-04-07
- Affected files: `lib/commands/feature.js`, `lib/git.js`, `lib/workflow-core/engine.js`, `lib/workflow-core/projector.js`, `lib/feature-close.js`
- Canonical broken event log: `~/src/farline-ai-forge/.aigon/workflows/features/34/events.jsonl`
