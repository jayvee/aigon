# Feature: manifest-and-branch-safety

## Summary

The manifest system and branch handling have multiple architectural flaws that cause cascading failures. This feature addresses three root causes that produced repeated breakages in a single session: wrong-branch commits, stale manifest bootstrapping, and dashboard-CLI state races. This is a stability feature — no new capabilities, just making existing ones reliable.

## Incident Log (2026-03-20/21 session)

1. **8 commits on wrong branch** — Commands silently committed to `feature-114-aade-insights` instead of `main`. No branch guard. Features 119/120 created on wrong branch, invisible to dashboard.
2. **Manifests bootstrapped as `done`** — `readManifest` lazy-bootstrapped manifests for features 119/120 by scanning folders. Folders were on wrong branch → `deriveFromFolder` returned null → doctor set stage to `done`. Features stuck.
3. **Agents not registered in manifests** — Dashboard started features 114/118 via CLI, but auto-reconcile had already moved manifests to `in-progress`, so `feature-start` guard returned early without writing agents. Features showed as "Drive" instead of Fleet.
4. **Dashboard agent picker not working for feature-start** — Feature 119 wouldn't allow multiple agent selection from the dashboard, started in Drive mode.
5. **Auto-reconcile removed mid-session** — Removed to fix issue 3, but this exposed issue 2 (bootstrap now permanent, no self-correction). Fix created the next bug.

## Root Causes

### RC1: No branch guard
Commands that commit to main (`feature-create`, `feature-prioritise`, `research-close`, `feature-close` spec moves) don't verify they're on the default branch. One stray checkout and all subsequent commands silently commit to the wrong branch.

### RC2: readManifest has write side effects
`readManifest()` lazy-bootstraps: if no manifest file exists, it derives one from folder scanning and **persists it**. This means:
- A dashboard poll (read) can **create** a manifest (write)
- Bootstrap guesses from filesystem state, which may be wrong (wrong branch, mid-transition, race condition)
- Once persisted, the garbage data is trusted forever

### RC3: Too many manifest writers, no single owner
Manifests can be written by: `requestTransition`, `bootstrapManifest`, `doctor --fix`, `writeManifest` directly, and the now-removed auto-reconcile. No single code path owns creation vs update. Race conditions between dashboard polling and CLI commands produce inconsistent state.

### RC4: Dashboard-to-CLI dispatch loses context
The dashboard calls `requestAction('feature-start', [id, ...agents])` which spawns a CLI process. If the CLI hits the "already running" guard, agents are silently dropped. The dashboard has no way to know the start partially failed.

## Acceptance Criteria

### Branch Safety
- [ ] All commands that commit to main verify `git branch --show-current === defaultBranch` before committing
- [ ] If on wrong branch, command aborts with: `"ERROR: Must be on main branch. Currently on: feature-114-aade-insights"`
- [ ] Commands that intentionally run on feature branches (feature-do, feature-submit, feature-review) are exempt
- [ ] `getDefaultBranch()` utility checks `main` or `master` once and caches

### Manifest Lifecycle
- [ ] `readManifest()` is a pure read — returns stored manifest or a transient derived object (not persisted)
- [ ] Manifests are only created by explicit commands: `feature-create` (or `feature-prioritise` for pre-manifest features)
- [ ] `feature-start` always writes agents to manifest, even if feature is already in-progress
- [ ] Dashboard can display features without manifests (derived from folders) but doesn't persist state
- [ ] `doctor --fix` is the only repair/reconciliation path

### Dashboard-CLI Reliability
- [ ] Dashboard `feature-start` dispatch verifies agents were registered (checks manifest after CLI returns)
- [ ] If start partially fails, dashboard shows an error — not silent success
- [ ] Dashboard agent picker works correctly for `feature-start` on backlog items

### Testing
- [ ] Tests for branch guard (mock `getCurrentBranch`, verify abort)
- [ ] Tests for `readManifest` returning transient object when no manifest exists
- [ ] Tests for `feature-start` writing agents in all scenarios (fresh, already-running, replay)
- [ ] Tests for dashboard action dispatch with agent arguments

## Validation

```bash
node -c lib/manifest.js
node -c lib/commands/feature.js
node -c lib/commands/research.js
node -c lib/commands/setup.js
node -c lib/git.js
npm test
```

## Technical Approach

### 1. Branch Guard (lib/git.js)

Add `assertOnDefaultBranch()`:
```js
function assertOnDefaultBranch() {
    const current = getCurrentBranch();
    const defaultBranch = getDefaultBranch(); // 'main' or 'master'
    if (current !== defaultBranch) {
        throw new Error(`Must be on ${defaultBranch} branch. Currently on: ${current}`);
    }
}
```

Call at the top of: `feature-create`, `feature-prioritise`, `feature-start`, `feature-close`, `feature-eval`, `research-create`, `research-prioritise`, `research-start`, `research-close`, `research-synthesize`, `feedback-create`, `feedback-triage`.

Do NOT call in: `feature-do`, `feature-submit`, `feature-review`, `feature-open` (these intentionally run on feature branches or in worktrees).

### 2. Manifest Read/Write Separation (lib/manifest.js)

Split `readManifest` into two functions:
- `readManifest(id)` — reads stored manifest. Returns `null` if no file exists. No bootstrapping.
- `deriveManifest(id)` — derives a transient manifest from folders/logs/worktrees. Does NOT persist. Used by dashboard for display.
- `ensureManifest(id)` — reads stored, falls back to derive + persist. Called by commands that need to create a manifest.

### 3. Explicit Manifest Creation

- `feature-create` → calls `ensureManifest` (creates with stage=inbox)
- `feature-prioritise` → calls `requestTransition` (updates stage=backlog)
- `feature-start` → calls `requestTransition` (updates stage=in-progress, writes agents)
- Dashboard polling → calls `readManifest` (returns null) or `deriveManifest` (transient, for display)

### 4. Dashboard Dispatch Fix

After calling `requestAction('feature-start', ...)`, dashboard reads the manifest and verifies agents were written. If not, shows error toast.

## Dependencies

- None. This is foundational stability work.

## Out of Scope

- Renaming feature-setup to feature-start (separate feature #117)
- Security scanning integration
- New features or capabilities — this is purely reliability

## Open Questions

- Should `readManifest` return `null` or an empty default object for missing manifests? (Null is more explicit but requires null checks everywhere.)
- Should the branch guard be a pre-hook rather than inline code? (Hook is more consistent but adds latency.)

## Related

- Feature #117: rename-setup-to-start (touches same code paths)
- Removed auto-reconcile: commit `55b95cc`
- Agent backfill fix: commit `8afca1d`
