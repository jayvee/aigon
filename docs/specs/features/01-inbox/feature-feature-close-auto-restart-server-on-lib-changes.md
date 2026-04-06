# Feature: feature-close-auto-restart-server-on-lib-changes

## Summary
When `aigon feature-close` merges a feature branch whose diff touches any `lib/*.js` or `lib/**/*.js` file, automatically call `aigon server restart` as the final phase of the close. This removes a recurring paper cut where a feature ships correctly, the server keeps running on stale code, and the user sees "bug" behavior that is actually just "backend not reloaded." Already codified in CLAUDE.md rule 4 as a manual step — this feature makes the step automatic so no one (agent or human) has to remember it.

## Motivation

On 2026-04-06, feature 225 shipped a working Agent Log tab. The user checked every done feature and saw "No agent log written yet" on all of them. I traced it to the backend — the collector was correct, the API was correct, but the **running server process predated the merge** and was still serving the old code without the `agentLogs` field. Restart fixed it instantly.

This is not the first time. It's the kind of thing that's trivially automatable but keeps biting because it lives in human/agent memory instead of code.

## User Stories
- [ ] As a user closing a feature that touched backend code, I never have to remember to restart the server — `feature-close` handles it
- [ ] As a user closing a feature that touched only docs / templates / frontend, I don't get a pointless restart that disrupts attached clients
- [ ] As an agent completing a feature, I don't need to remember CLAUDE.md rule 4 — the close command enforces it
- [ ] As a user, if the auto-restart fails (server not running, permission issue), the close still succeeds — the restart is a best-effort convenience, not a blocking step

## Acceptance Criteria

- [ ] **AC1** — After `feature-close` successfully merges and completes the workflow effects, a new phase runs: detect whether any `lib/**/*.js` files were touched in the merged commits (`git diff --name-only <merge-base>..HEAD -- 'lib/**/*.js'`). If the set is non-empty, call `aigon server restart` as the final phase.
- [ ] **AC2** — If no `lib/*.js` files were touched, **skip the restart entirely**. Pure docs, template, or frontend changes do not trigger it. This is important because the dashboard auto-polls and reloads templates, and restart would disrupt attached terminal sessions unnecessarily.
- [ ] **AC3** — The restart phase is **best-effort, never fatal**. If the restart fails (server not running, missing launchd service, permission issue) the close still reports success. The failure is logged as a warning: `⚠️  Server restart failed: <reason>. Restart manually with 'aigon server restart'.`
- [ ] **AC4** — Phase ordering: the restart runs **after** all workflow engine effects have committed (spec move, closeout note, worktree cleanup). It is the last thing `feature-close` does before returning.
- [ ] **AC5** — The phase prints a clear status line: `🔄 Restarting aigon server (X lib/*.js files changed)...` followed by the standard restart output.
- [ ] **AC6** — The phase is **idempotent**. Re-running `feature-close` on an already-closed feature does not re-restart (the close bail-out happens before the restart phase).
- [ ] **AC7** — If the server isn't running at all, skip silently (no warning, no error). There's nothing to restart.
- [ ] **AC8** — Configurable via a config flag: `{ featureClose: { autoRestartServer: false } }` in `.aigon/config.json` disables the phase for users who want manual control. Default is **on**.
- [ ] **AC9** — No behavior change to `feature-submit` or `feature-review-check` or any other command. Only `feature-close` gets this.
- [ ] **AC10** — Unit test covers the diff detection: mock a merge with and without `lib/*.js` touches, assert the restart phase fires only when expected. Test does NOT invoke the real `aigon server restart` — the restart function is mocked via the ctx pattern.

## Validation

```bash
# Syntax
node -c aigon-cli.js
node -c lib/feature-close.js

# Test suite
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh

# Manual smoke — in a scratch repo:
# 1. Start + close a feature that touches only docs → no restart
# 2. Start + close a feature that touches lib/*.js → server restarts
# 3. Start + close with aigon server stopped → close succeeds with no warning
# 4. Flip featureClose.autoRestartServer=false → close touches lib/*.js but no restart
```

## Technical Approach

### Where it lives
- `lib/feature-close.js` (~740 lines) — the feature-close phase orchestrator. This is the single call site.
- The existing phases are: target resolution → merge → telemetry → engine close → cleanup. The new phase slots in after cleanup.

### Implementation sketch (~20 lines)

```js
// lib/feature-close.js — new phase function

async function maybeRestartServerAfterClose(mergeBaseRef, ctx) {
    const cfg = ctx.config && ctx.config.loadProjectConfig ? ctx.config.loadProjectConfig() : {};
    if (cfg.featureClose && cfg.featureClose.autoRestartServer === false) {
        return; // opt-out
    }

    let changed;
    try {
        const out = ctx.git.runGit(['diff', '--name-only', `${mergeBaseRef}..HEAD`, '--', 'lib/**/*.js'], {
            encoding: 'utf8',
        });
        changed = out.trim().split('\n').filter(Boolean);
    } catch (_) {
        return; // diff failed — skip silently
    }

    if (changed.length === 0) return;

    // Skip if server isn't running
    try {
        const { getServerPid } = require('./server-runtime');
        if (!getServerPid()) return;
    } catch (_) {
        return;
    }

    console.log(`🔄 Restarting aigon server (${changed.length} lib/*.js file(s) changed)...`);
    try {
        const { restartServer } = require('./server-runtime');
        await restartServer();
    } catch (e) {
        console.warn(`⚠️  Server restart failed: ${e.message}. Restart manually with 'aigon server restart'.`);
    }
}
```

Then call `maybeRestartServerAfterClose(mergeBaseRef, ctx)` as the last line of the main close flow.

### Ctx pattern

The restart is injected via `ctx` so tests can mock it. Add a small seam in `buildCtx()` wiring (`lib/commands/shared.js`) that exposes `serverRuntime` as a first-class dependency. Tests override `ctx.serverRuntime.restartServer` with a spy.

### What is NOT changing

- `lib/server-runtime.js` — unchanged. We just consume its existing `restartServer()` export.
- `lib/commands/feature.js:feature-close` entry point — unchanged. This lives entirely inside `lib/feature-close.js`.
- Any other close phase — unchanged. The new phase is additive, runs last.
- `feature-submit`, `feature-review-check`, `research-close`, etc. — unchanged. Scope is limited to `feature-close` per AC9.
- The workflow engine — unchanged.
- The supervisor — unchanged.

### Edge cases
- **Server not running**: skip silently (AC7). User closed the feature from the CLI without starting the server.
- **`aigon server restart` errors**: warning, not fatal (AC3). Close is already successful at this point.
- **Close is a re-run** (idempotent close on already-done feature): close bails out before the restart phase (AC6).
- **No `lib/*.js` changes**: skip (AC2). Avoids pointless disruption.
- **Merge commit itself touches `lib/*.js`**: counts — diff includes the merge commit's effective changes.
- **User has `autoRestartServer: false`**: skip (AC8). Power-user escape hatch.

## Dependencies
- None. `lib/server-runtime.js:restartServer()` already exists (shipped with feature 220).

## Out of Scope
- Auto-restart after `feature-submit` — submit is a signal to the engine, not a code-change event
- Auto-restart after editing files in a worktree while a feature is in-progress — too noisy; user is still iterating
- Detecting template changes and telling the dashboard to hot-reload — dashboard already auto-polls
- Warning the user when a manual edit to `lib/*.js` is detected while the server is running — different feature, different command
- Restarting the dashboard server ports (proxy, dev-server) — out of scope; only aigon server restart is called
- Cross-repo restart — only the current repo's aigon server, not any others
- Graceful connection drain / waiting for in-flight requests — the existing `restartServer()` handles this

## Open Questions
None. All design decisions made inline.

## Related
- **CLAUDE.md rule 4**: "Restart after backend edits — after changing any `lib/*.js`, restart `aigon server restart`". This feature enforces that rule at `feature-close` time.
- **Feature 220** (`server-reliability-hardening`) — shipped the `lib/server-runtime.js:restartServer()` and `waitForServerHealthy()` helpers that this feature consumes.
- **The 2026-04-06 incident**: feature 225 shipped a working Agent Log tab. User saw "No agent log written yet" on every done feature because the running server was stale. Restart fixed it instantly. This feature prevents a recurrence.
- **CLAUDE.md rule T1** (pre-push tests) and **T2** (new code ships with a test) — both apply to the implementation.
