---
complexity: high
---

# Feature: parallelize-fleet-startup

## Summary

Spinning up a 4-agent fleet currently takes ~50s end-to-end (last measured: brewboard f09, `~/Downloads/slow_fleet_startup.gif`). The dashboard's optimistic UI flips the card to "in progress" instantly, then the user stares at a static card for ~50s. This feature parallelises the per-agent worktree work, parallelises tmux session creation, removes redundant git commits from the critical path, and adds greppable phase-timing markers so the next regression is obvious. Target: ≤15s wall-clock for a 4-agent brewboard fleet start.

## Problem

Trace of `lib/feature-start.js` and `lib/worktree.js` shows the bottleneck is a single synchronous `agentIds.forEach(...)` loop at `lib/feature-start.js:570` doing four heavy I/O steps per agent, sequentially:

| Step | Location | Time × 4 agents |
|---|---|---|
| `git worktree add` | `feature-start.js:607` | ~5s × 4 = 20s |
| spec copy + `git add` + `git commit` in worktree | `feature-start.js:622-628` | ~1s × 4 = 4s |
| `setupWorktreeEnvironment` (env.local write, trust, commit) | `worktree.js:1958-2077` | ~2-3s × 4 = 10s |
| first tmux session creation (AppleScript on macOS) | `feature-start.js:686`, `worktree.js:2102` | ~1-2s × 4 = 6s |

Plus a sequential tmux loop in `ensureAgentSessions` (`feature-start.js:710-744`) and 8 redundant git commits on the critical path (one per worktree from spec-sync, one per worktree from `setupWorktreeEnvironment`).

The slowness hurts:
- **Demo videos** — long dead air after the card moves to "in progress".
- **Real user experience** — the optimistic card flip makes the lag feel worse, not better, because there is no visible progress.

## User Stories

- [ ] As a user kicking off a 4-agent fleet, I see worktrees and tmux sessions appear in ≤15s instead of ~50s.
- [ ] As someone recording a demo, the gap between "click start" and "agents are typing" is short enough that I don't need to cut the video.
- [ ] As an Aigon maintainer, I can grep `[fleet-start] phase=` in the live log and see per-phase timings so the next regression is obvious.

## Acceptance Criteria

- [ ] `lib/feature-start.js:570` per-agent worktree loop runs via `await Promise.all(agentIds.map(async id => …))` instead of synchronous `forEach`. Inner steps (`git worktree add`, spec sync, `setupWorktreeEnvironment`, first tmux session) execute concurrently across agents.
- [ ] `ensureAgentSessions` (`feature-start.js:710-744`) and the loop wrapping `createDetachedTmuxSession` in `worktree.js:2079-2117` use `Promise.all` over agents.
- [ ] Per-worktree `git commit` calls during setup are eliminated from the critical path — either deferred to the agent's first commit, or skipped entirely for per-machine files (`.env.local`, trust markers). The end state on disk must match what feature-start produces today.
- [ ] Phase-timing markers are emitted to stdout (and therefore live log) in the format `[fleet-start] phase=<name> agent=<id?> ms=<n>` covering: `engine-init`, `spec-commit`, `worktree-add`, `spec-sync`, `env-setup`, `first-tmux`, `tmux-sessions`, `permissions`.
- [ ] A 4-agent brewboard fleet start completes in ≤15s wall-clock on John's mac (measured from CLI invocation to feature-start exit). Capture a new GIF for comparison against `~/Downloads/slow_fleet_startup.gif`.
- [ ] Drive mode (single agent) is not regressed — wall-clock unchanged or faster, no functional changes.
- [ ] `aigon doctor` clean after a fleet start.
- [ ] Unit test asserting the worktree-creation loop returns in less than `N × per-agent-cost` (mock-clock check; serial would take N×, parallel should take ~1×).

## Validation

```bash
npm run test:core
```

## Technical Approach

### 1. Parallelize the per-agent worktree work
Convert `agentIds.forEach(...)` at `lib/feature-start.js:570` to `await Promise.all(agentIds.map(async id => …))`. Inside the body:
- `git worktree add` is a separate process per agent and supports concurrent invocation against the same parent repo. Verify under load on a slow disk before declaring done.
- The spec-copy step (`feature-start.js:622-628`) is a `fs.copyFile` + `git add` + `git commit` inside a *different* working directory per agent — no shared mutable state.
- `setupWorktreeEnvironment` (`worktree.js:1958-2077`) is mostly per-worktree file writes (`.env.local`, trust markers). Agent-trust calls (`ensureAgentTrust` at `:1977`/`:1983`) write to the user's `~/.aigon` config — audit for shared file contention; if any contention exists, serialise just that sub-call via a single shared lock while parallelising everything else.

### 2. Parallelize tmux session creation
Wrap the loop in `ensureAgentSessions` (`feature-start.js:710-744`) and the inner `createDetachedTmuxSession` calls (`worktree.js:2079-2117`) with `Promise.all`. AppleScript invocations are independent per session; macOS handles concurrent `osascript` fine.

### 3. Remove redundant git commits from the critical path
The 8 commits during setup (4× spec-sync at `feature-start.js:622-628`, 4× `setupWorktreeEnvironment` at `worktree.js:2069-2076`) are not load-bearing for engine state:
- **Preferred:** drop the `git commit` calls in `setupWorktreeEnvironment` entirely. `.env.local` is already gitignored on most profiles; trust markers are per-machine. The worktree's first real commit will pick up the spec naturally.
- **Fallback:** if any consumer depends on the spec being committed in the worktree at start time, batch the spec-sync into a single commit *after* the parallel worktree loop returns, run once per worktree via `Promise.all` (cheap, no longer 4× sequential).

Audit consumers before deleting: grep for assumptions that the worktree has a clean `git log` immediately post-`feature-start` (likely candidates: `feature-review`, `feature-submit`, dashboard worktree-status reads).

### 4. Phase-timing markers
Add a small helper (inline, ~10 lines) at the top of `lib/feature-start.js`:
```js
const phase = (name, agent) => { const t = Date.now(); return ms => console.log(`[fleet-start] phase=${name}${agent ? ` agent=${agent}` : ''} ms=${Date.now() - t}`); };
```
Wrap each major phase. Inside the per-agent parallel block, use the per-agent variant so the log shows `phase=worktree-add agent=cc ms=4830` etc. Goal: every future change to feature-start can be regression-checked by re-running and grepping `[fleet-start] phase=`.

### Constraints
- Don't break the engine write-path contract (see `AGENTS.md` § Write-Path Contract). The `feature.started` event + `move_spec` / `init_log` effects must remain in their current order; parallelism is only inside the per-worktree work that follows.
- Drive mode must still work — the parallel path should reduce trivially to a single iteration when `agentIds.length === 1`.
- macOS-specific: tmux/AppleScript concurrency should be tested on John's mac (the primary dev machine) before declaring done.

## Dependencies
-

## Out of Scope

- **Worktree pre-warming / worktree pool.** Too risky/complex; defer.
- **Splitting feature-start into a phased async return** so the dashboard unblocks before tmux sessions are ready. Defer until the new wall-clock floor is measured — if 15s is enough, this isn't needed.
- **The card-level "Setting up" status.** Tracked as a separate small change to the dashboard; not part of this feature.

## Open Questions

- Does any downstream consumer (`feature-review`, `feature-submit`, dashboard reads) assume the worktree has a committed spec file immediately after `feature-start` returns? If yes, fallback path 3b (batched single commit) is mandatory; if no, drop the commits entirely.
- Is there file contention in `ensureAgentTrust` on `~/.aigon` shared state when called concurrently from 4 worktree-setup tasks? If yes, narrow the lock; don't serialise the whole loop.
- AppleScript concurrency: does launching 4 `osascript` invocations in parallel reliably create 4 distinct iTerm tabs in the correct window? Verify before merging.

## Related
- Trace gif: `~/Downloads/slow_fleet_startup.gif`
- Reference repo for measurement: brewboard f09
