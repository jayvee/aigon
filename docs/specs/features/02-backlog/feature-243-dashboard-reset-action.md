# Feature: dashboard-reset-action

## Summary

Add a **Reset** action to dashboard feature cards that wraps `aigon feature-reset <id>`. Destructive action with a confirmation dialog — kills any tmux sessions, removes the worktree and branches, clears all state files, and moves the spec back to `02-backlog/`. Available on any non-done feature (in-progress, in-evaluation, paused, even backlog features with stale state). Routes through the central action registry in `lib/feature-workflow-rules.js` so the frontend stays rules-driven. **Depends on `feature-fix-feature-reset-engine-state-cleanup` landing first** — without that fix, the dashboard action would leave features in a half-reset state that's worse than not having the button at all.

## Context — why this is needed

Discovered 2026-04-08 during the feature-241 restart flow. User was rewriting the create-with-agent spec mid-implementation and needed to restart the feature with the new design. The dashboard only offered a "Pause" action on the in-progress card, which was the wrong operation (pause preserves the worktree and just moves the spec to 06-paused). The user had to drop to the CLI to kill tmux sessions, remove worktrees, nuke engine state, and move the spec — none of which the dashboard currently exposes.

This is a real UX gap, not a one-off. Anyone running features from the dashboard will eventually hit a scenario where they need to abandon an in-progress feature and start over — spec drift, wrong agent choice, corrupted worktree, interrupted session, whatever. Having to drop to the CLI every time is a friction point that undermines the dashboard's "single surface for everything" positioning.

## User Stories

- [ ] As a user with an in-progress feature whose spec I just rewrote, I can click a Reset button on the dashboard card and have aigon cleanly kill the worktree, remove the branch, clear state, and move the spec back to backlog — without dropping to the CLI.
- [ ] As a user who started a feature with the wrong agent, I can reset and restart with the right agent without touching the terminal.
- [ ] As a user whose tmux session or worktree got into a weird state (e.g. crashed, network died mid-session, disk full), I can reset the feature from the dashboard and try again.
- [ ] As a cautious user, I see a clear confirmation dialog that names the destructive operations before I commit — "This will kill tmux sessions, delete the worktree and branch, and move the spec back to backlog. Continue?"
- [ ] As a user resetting a feature that has unmerged work on its branch, I see an explicit warning that the branch and its commits will be deleted, with the option to cancel.

## Acceptance Criteria

- [ ] **AC1** — Dashboard feature cards in `03-in-progress/`, `04-in-evaluation/`, and `06-paused/` columns show a **Reset** action in the card's action menu.
- [ ] **AC2** — Clicking Reset opens a confirmation dialog listing the destructive operations: "Reset feature #241 'create with agent'? This will kill any running tmux sessions, remove the worktree and branch (including any uncommitted work on the branch), clear engine state, and move the spec back to Backlog. This cannot be undone."
- [ ] **AC3** — Confirming the dialog sends a POST to a new API endpoint (e.g. `/api/feature/<id>/reset`) which invokes `aigon feature-reset <id>` server-side.
- [ ] **AC4** — The dashboard updates to reflect the new state within one poll cycle: the feature card disappears from the in-progress column and reappears in backlog with a Start action.
- [ ] **AC5** — If the reset fails (e.g. filesystem error, lock held by another process), the dialog shows the error from the CLI and the feature stays where it was.
- [ ] **AC6** — The Reset action is NOT available on features in `02-backlog/`, `01-inbox/`, or `05-done/`. Backlog features have nothing to reset, inbox features haven't been started, done features are a different concern (see Out of Scope).
- [ ] **AC7** — The Reset action candidate is declared in `lib/feature-workflow-rules.js` as a new `FEATURE_ACTION_CANDIDATE` or `FEATURE_INFRA_CANDIDATE`, with the eligibility guard expressed in the standard rules format. Frontend reads it from the action registry — **no action buttons hardcoded in the frontend files** (per CLAUDE.md rule 8).
- [ ] **AC8** — The destructive nature is visually distinct: the Reset button is styled as a warning/danger action (red border, warning icon) so users can't confuse it with Start/Pause at a glance.
- [ ] **AC9** — Keyboard accessibility: the confirmation dialog can be dismissed with Escape and confirmed with Enter (focus on Cancel by default, not Confirm — so a stray Enter doesn't accidentally destroy work).
- [ ] **AC10** — Playwright e2e regression test: simulates an in-progress feature, clicks Reset, confirms dialog, asserts the feature moves to backlog and the engine state is empty.

## Validation

```bash
# Source-level checks
node --check lib/feature-workflow-rules.js
node --check lib/dashboard-server.js
grep -q "FEATURE_RESET\\|feature-reset" lib/feature-workflow-rules.js

# Full suite
npm test && MOCK_DELAY=fast npm run test:ui

# Manual e2e:
# 1. Start a throwaway feature in the dashboard
# 2. Click Reset on the in-progress card
# 3. Confirm the dialog
# 4. Verify the card moves to backlog within ~2s
# 5. Verify the worktree is gone: git worktree list
# 6. Verify the engine state is gone: ls .aigon/workflows/features/<id>/ (should not exist)
# 7. Click Start — should launch a new worktree cleanly
```

## Technical Approach

### 1. Action registry entry

Add to `FEATURE_INFRA_CANDIDATES` in `lib/feature-workflow-rules.js`:

```js
{
    kind: ManualActionKind.FEATURE_RESET,
    label: 'Reset',
    eventType: null,                                    // Bypasses XState — destructive, not a state transition
    recommendedOrder: 120,                              // Low priority (after Pause, Close, etc.)
    bypassMachine: true,
    category: ActionCategory.INFRA,
    scope: 'per-feature',
    guard: ({ context }) => {
        // Available on any non-terminal state except backlog/inbox
        return ['implementing', 'reviewing', 'evaluating', 'paused'].includes(context.currentSpecState);
    },
    metadata: {
        apiEndpoint: 'feature/reset',
        destructive: true,          // New flag; frontend reads this and applies danger styling
        confirmationMessage: 'Kill tmux sessions, remove worktree and branch, clear engine state, and move the spec back to Backlog. Cannot be undone.',
    },
},
```

Add `FEATURE_RESET` to `ManualActionKind` in `lib/workflow-core/types.js`.

### 2. Server endpoint

Add a route to `lib/dashboard-server.js` (or wherever POST handlers live):

```js
// POST /api/feature/:id/reset
async function handleFeatureReset(req, res, ctx) {
    const featureId = extractIdFromPath(ctx.url);
    if (!featureId) return sendJson(res, 400, { error: 'Missing feature id' });

    try {
        // Shell out to the CLI — reuses all existing reset logic
        const { execSync } = require('child_process');
        const output = execSync(`aigon feature-reset ${featureId}`, {
            cwd: resolveRequestedRepoPath(...).repoPath,
            encoding: 'utf8',
        });
        sendJson(res, 200, { ok: true, output });
    } catch (err) {
        sendJson(res, 500, { ok: false, error: err.stderr || err.message });
    }
}
```

Alternatively, import the feature-reset function directly instead of shelling out — cleaner but requires the reset logic to be refactored into an exportable function. Shell-out is fine for v1.

### 3. Frontend action rendering

The dashboard already renders actions from the API's `validActions` list (per CLAUDE.md rule 8: "never add action buttons in dashboard frontend files"). So adding the action in the registry should cause it to appear automatically — provided the frontend knows how to:
- Render the `destructive: true` metadata flag as a red/warning style
- Show the `confirmationMessage` in a modal before firing the request
- Default-focus Cancel in the modal

If the frontend doesn't currently handle `destructive`/`confirmationMessage` metadata, extend the action-rendering component in `templates/dashboard/js/` to support it — one small edit, reusable for any future destructive actions.

### 4. Confirmation modal

A reusable modal component or (simpler) a browser-native `window.confirm()` for v1. Native confirm is ugly but works and requires no new JS. Upgrade to a styled modal in a follow-up if needed.

### 5. Dashboard update after reset

The dashboard already polls the API every 10s (hot-polling for active features). After a reset, the next poll will see the feature in `02-backlog/` with updated `validActions`, and the kanban view will re-render with the card in the backlog column. No explicit state push needed — the existing poll mechanism handles it.

If the feel is sluggish (10s is too long to wait for a reset), the confirmation modal can trigger a manual refresh request after the API call returns, so the user sees the updated state immediately without waiting for the next poll.

### 6. Test coverage

- **Source-level regression**: `lib/feature-workflow-rules.js` must contain the `FEATURE_RESET` action kind with the correct eligibility guard
- **Playwright e2e** (AC10): a full lifecycle test that starts a feature, clicks Reset, confirms, and asserts the feature returns to backlog cleanly

## Dependencies

- **Blocked by**: `feature-fix-feature-reset-engine-state-cleanup` — the CLI `feature-reset` command must fully clean up `.aigon/workflows/features/<id>/` before this dashboard action is wired up. Shipping this feature on top of a broken CLI reset would give users a button that half-works, which is worse than no button.
- Relies on existing action registry infrastructure in `lib/feature-workflow-rules.js`
- Relies on existing dashboard polling / action rendering in `templates/dashboard/`

## Out of Scope

- **Resetting done features** — a done feature is historical; "resetting" it would require undoing the merge, which is a separate concern (maybe `feature-reopen`). Not in scope for v1.
- **Resetting inbox features** — inbox features have nothing to reset (no engine state, no worktree, no branch). The existing drag-to-delete / manual file delete is enough.
- **Partial reset** — you can't reset "just the worktree" or "just the engine state" from the dashboard. That kind of surgical recovery is for the CLI.
- **Undo for the Reset action** — once confirmed, the reset is done. The backup for destructive actions is git (the spec file and its history live in git; the worktree's uncommitted work genuinely does go away).
- **Bulk reset** — one feature at a time.
- **Reset across repositories** — the dashboard's multi-repo mode shows one repo at a time; the Reset action targets the currently-selected repo. No cross-repo reset.

## Open Questions

- Should the confirmation dialog be the browser's native `window.confirm()` (ugly but works today) or a styled modal component (prettier but requires UI work)? Recommend native for v1, styled in a follow-up if needed.
- Should the action label change based on state? e.g. "Reset from in-progress" vs "Reset from paused"? Probably no — the base action is the same, and the confirmation dialog explains exactly what will happen.
- Should there be a dashboard-level log of recently-reset features? Probably no — the audit trail lives in the git log and the telemetry.
- Does this interact with the AutoConductor run loop? Yes — if AutoConductor is running on a feature that gets reset, the auto loop should detect the reset and exit cleanly. Handled by the existing heartbeat / tmux-session-check in AutoConductor, but worth verifying during implementation.

## Related

- `feature-fix-feature-reset-engine-state-cleanup` — the blocking dependency
- `lib/commands/feature.js:feature-reset` — the CLI command being wrapped
- `lib/feature-workflow-rules.js` — where the new action candidate goes
- `lib/workflow-core/types.js` — where `ManualActionKind.FEATURE_RESET` is added
- `lib/dashboard-server.js` — where the new API endpoint lives
- `templates/dashboard/js/*` — frontend action rendering (needs `destructive` metadata handling)
- CLAUDE.md rule 8 — "Never add action buttons in dashboard frontend files"
- 2026-04-08 feature 241 restart incident — the UX gap that prompted this spec
