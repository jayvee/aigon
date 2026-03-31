# Feature: Simplify Feature-Close to Under 1000 Lines

## Summary

`feature-close` in `lib/commands/feature.js` is 715 lines (lines 1721–2435) of deeply nested, sequential logic handling drive mode, fleet mode, adoption, stash/merge/pop, telemetry, engine close, spec moves, worktree cleanup, and branch deletion. It has caused every merge conflict, orphaned spec, and close failure in the last week. This feature extracts the close flow into focused helper functions so the main handler is a readable orchestration of ~200 lines, with helpers totalling under 800 lines combined. The entire `lib/commands/feature.js` file must end up under 3,000 lines (currently 3,516).

## User Stories

- [ ] As a developer, I want to read the feature-close flow in one screen and understand what happens in what order
- [ ] As a developer debugging a close failure, I want to identify which step failed without reading 715 lines of nesting
- [ ] As a user, I want feature-close to work reliably without manual intervention

## Acceptance Criteria

### Structure
- [ ] The `feature-close` handler in `feature.js` is under 250 lines — it orchestrates, it doesn't implement
- [ ] Helper functions are extracted to a new `lib/feature-close.js` module (under 800 lines)
- [ ] Each phase of close is a separate function with a clear name: `resolveCloseTarget()`, `mergeFeatureBranch()`, `closeEngineState()`, `moveSpecToDone()`, `cleanupWorktree()`
- [ ] No function is longer than 100 lines
- [ ] Total `lib/commands/feature.js` is under 3,000 lines

### Reliability
- [ ] Feature-close works regardless of what branch the main repo is on — auto-checkouts main as first step, never fails because a reviewer left the repo on a stale branch (e.g. `review-fixes`). This applies to all repos, not just aigon.
- [ ] All dashboard actions that dispatch CLI commands handle the repo being on any branch — the action-scope pre-check auto-recovers instead of blocking
- [ ] Settings file reset happens before stash (existing fix preserved)
- [ ] Spec move recovery happens if commit fails (existing fix preserved)
- [ ] Engine close with agent-ready signal is handled in one place
- [ ] Merge conflicts are resolved automatically (checkout --theirs for non-code files)
- [ ] Each phase returns a result object so the orchestrator can decide whether to continue or bail

### No behaviour changes
- [ ] Drive mode close works identically
- [ ] Fleet mode close works identically
- [ ] Adoption flow works identically
- [ ] All existing flags (--keep-branch, --reclaim, --adopt) still work
- [ ] Telemetry recording still works

## Validation

```bash
node -c aigon-cli.js
node -c lib/commands/feature.js
node -c lib/feature-close.js

# feature-close handler is under 250 lines
start=$(grep -n "'feature-close': async" lib/commands/feature.js | head -1 | cut -d: -f1)
end=$(grep -n "'feature-cleanup':" lib/commands/feature.js | head -1 | cut -d: -f1)
lines=$((end - start))
echo "feature-close handler: $lines lines (target: < 250)"
if [ "$lines" -gt 250 ]; then echo "FAIL"; exit 1; fi

# feature.js total under 3000
total=$(wc -l < lib/commands/feature.js)
echo "feature.js total: $total lines (target: < 3000)"
if [ "$total" -gt 3000 ]; then echo "FAIL"; exit 1; fi

# No function over 100 lines in feature-close.js
echo "Check: no function over 100 lines in lib/feature-close.js"
```

## Technical Approach

### Extract phases into `lib/feature-close.js`

The current 715 lines break into these phases:

1. **Resolve target** (~50 lines) — find spec, detect mode (drive/fleet/worktree), resolve agent, validate
2. **Pre-merge** (~40 lines) — auto-commit on feature branch, push to origin, switch to main
3. **Merge** (~60 lines) — reset settings files, stash, merge --no-ff, stash pop, resolve conflicts
4. **Telemetry** (~100 lines) — git signals, token telemetry for each agent
5. **Engine close** (~80 lines) — migration check, signal ready, select winner, close with effects
6. **Commit spec move** (~60 lines) — git add specs, resolve unmerged, commit, recovery if fails
7. **Cleanup** (~50 lines) — remove worktree, delete branch, close tmux sessions

Each becomes a function in `lib/feature-close.js`. The handler in `feature.js` calls them in sequence:

```js
'feature-close': async (args) => {
    const target = resolveCloseTarget(args, PATHS, ctx);
    if (!target.ok) return console.error(target.error);

    if (!runPreHook('feature-close', target.hookContext)) return;

    const merged = await mergeFeatureBranch(target);
    if (!merged.ok) return console.error(merged.error);

    recordTelemetry(target, merged);

    const closed = await closeEngineState(target);
    if (!closed.ok) console.warn(closed.error);

    await commitSpecMove(target);
    await cleanupWorktree(target);

    runPostHook('feature-close', target.hookContext);
}
```

### What NOT to do
- Don't change any behaviour — pure extraction
- Don't add new features or flags
- Don't add error handling that doesn't exist today
- Don't write tests — this is structural, validated by the line count checks

## Dependencies

- depends_on: engine-cleanup-remove-legacy-bypasses (182, done)

## Out of Scope

- Changing close behaviour or adding new capabilities
- Fleet adoption rewrite (keep as-is, just extract)
- Reducing other commands in feature.js

## Related

- Every close failure from features 178–187 traces back to this code
