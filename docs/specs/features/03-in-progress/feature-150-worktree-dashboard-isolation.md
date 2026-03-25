# Feature: worktree-dashboard-isolation

## Summary

Allow the dashboard (and future daemons) to run from any worktree, not just the main repo on the `main` branch. Replace the current scattered branch-gate checks with a scoped action model where each action declares its execution scope (`main-only`, `feature-local`, `any`), and a single gatekeeper enforces it. Actions that require `main` can delegate to the main repo rather than refusing.

## Motivation

Today, agents working in worktrees sometimes start the dashboard from their worktree context (e.g., to test dashboard changes). This fails because:
1. Many dashboard actions enforce "Must be on main branch"
2. The dashboard port (4100) is hardcoded — conflicts with the main dashboard
3. State is read from the main repo's `.aigon/state/` which worktrees don't own
4. The proxy routes only to the singleton dashboard

The dev-server already solves this for app servers (per-worktree ports via `.env.local`). The dashboard needs the same isolation model, plus a smarter way to gate actions than branch checks scattered through handlers.

## User Stories
- [ ] As an agent in a worktree, I want to start a dashboard instance to test my dashboard changes without breaking the main dashboard
- [ ] As a developer, I want the main dashboard to work even when my repo is on a feature branch (e.g., after an agent accidentally checked out the wrong branch)
- [ ] As a developer adding new dashboard actions, I want to declare the action's scope in one place rather than threading branch-check logic through the handler

## Acceptance Criteria
- [ ] Action scope model: every CLI command and dashboard action declares a scope (`main-only`, `feature-local`, `any`)
- [ ] Single gatekeeper function `assertActionAllowed(action, context)` replaces all existing branch-gate checks
- [ ] Dashboard runs with `scope: 'any'` — can start from any directory/branch
- [ ] `main-only` actions triggered from a worktree dashboard delegate to the main repo (via `git -C` or subprocess) rather than refusing
- [ ] `feature-local` actions validate they're running in the correct feature's worktree
- [ ] Worktree dashboards get isolated ports (e.g., `DASHBOARD_PORT` in `.env.local`, defaulting to 4101+)
- [ ] Worktree dashboards read state from the main repo's `.aigon/state/` (where agents write status)
- [ ] No regressions: main-repo dashboard continues to work exactly as before

## Technical Approach

### Action scope model

Replace scattered branch checks with a declarative scope map:

```js
const ACTION_SCOPES = {
    // Mutate shared state — merge, move specs, close features
    'feature-close':      { scope: 'main-only' },
    'feature-prioritise': { scope: 'main-only' },
    'feature-start':      { scope: 'main-only' },
    'research-close':     { scope: 'main-only' },

    // Only affect the current feature's worktree
    'feature-do':         { scope: 'feature-local' },
    'feature-submit':     { scope: 'feature-local' },
    'feature-review':     { scope: 'feature-local' },

    // Read-only or display — safe anywhere
    'board':              { scope: 'any' },
    'dashboard':          { scope: 'any' },
    'metrics':            { scope: 'any' },
    'doctor':             { scope: 'any' },
};
```

Single gatekeeper:

```js
function assertActionAllowed(action, context) {
    const def = ACTION_SCOPES[action] || { scope: 'main-only' }; // safe default
    if (def.scope === 'any') return;
    if (def.scope === 'main-only' && !context.isMainBranch) {
        if (context.mainRepoPath) {
            return { delegate: context.mainRepoPath }; // signal to delegate
        }
        throw new Error(`Must be on 'main' branch for ${action}`);
    }
    if (def.scope === 'feature-local' && context.featureId !== def.expectedFeatureId) {
        throw new Error(`Action ${action} must run in feature ${def.expectedFeatureId} worktree`);
    }
}
```

### Context detection

```js
function buildActionContext() {
    const branch = git.getCurrentBranch();
    const isMainBranch = branch === 'main' || branch === 'master';
    const superproject = git.getSuperprojectPath(); // git rev-parse --show-superproject-working-tree
    const isWorktree = !!superproject;
    const mainRepoPath = isWorktree ? superproject : process.cwd();
    const featureId = parseFeatureIdFromBranch(branch);
    return { branch, isMainBranch, isWorktree, mainRepoPath, featureId };
}
```

### Delegation for main-only actions from worktrees

When a `main-only` action is triggered from a worktree dashboard, instead of failing:

```js
// In the dashboard action handler:
const result = assertActionAllowed(action, context);
if (result?.delegate) {
    // Run the action in the main repo context
    execSync(`cd ${result.delegate} && node aigon-cli.js ${action} ${args}`, ...);
}
```

### Port isolation

- `feature-start` already writes `.env.local` with `PORT=300X` for dev servers
- Add `DASHBOARD_PORT=410X` to the same `.env.local` (X = worktree index)
- Dashboard reads `process.env.DASHBOARD_PORT || 4100`
- Main dashboard stays on 4100; worktree dashboards get 4101, 4102, etc.

### State access

- Worktree dashboards discover the main repo via `git rev-parse --show-superproject-working-tree`
- Read `.aigon/state/` from the main repo path, not `process.cwd()`
- This already works for `writeAgentStatusAt()` — extend the read side to match

## Migration

- Audit all existing `Must be on 'main'` checks → replace with `assertActionAllowed()` calls
- Classify each action into `main-only`, `feature-local`, or `any`
- Default unclassified actions to `main-only` (safe default)
- Existing behavior preserved: main-repo users see no change

## Dependencies
- None (self-contained refactor + new capability)

## Out of Scope
- Proxy routing for worktree dashboards (e.g., `aigon-f144.localhost`) — future enhancement
- Multi-dashboard coordination (one dashboard watching another's state)
- General daemon management framework — this is dashboard-specific first

## Open Questions
- Should worktree dashboards show only their feature, or the full board scoped to read-only for other features?
- Should the scope map live in a separate config file or inline in the code?
- Should `feature-local` actions in the dashboard auto-detect the worktree's feature ID from the branch name, or require it to be passed explicitly?

## Related
- Research: none
- Depends-on: none
- Enables: future daemon isolation, worktree-scoped testing
