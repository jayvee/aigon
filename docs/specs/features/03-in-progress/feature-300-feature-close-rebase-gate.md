# Feature: feature-close-rebase-gate

## Summary

When a feature branch has diverged from main (i.e., main has commits the branch does not), `feature-close` currently discovers this only at merge time — after the user clicks Close — and responds with a raw CLI recipe. The card gave no prior warning.

This feature adds two things: (1) a proactive `rebaseNeeded` flag on each in-progress feature row, computed by a lightweight `git merge-base` check, and (2) a warning indicator on the dashboard card when that flag is true, so the user sees "Rebase needed before close" before they attempt to close. The close gate error message is also tightened to match.

No "run rebase" button. Rebase can produce merge conflicts that require manual resolution — the dashboard stays read-only and the fix stays in the CLI.

## User Stories

- [ ] As a user with an in-progress feature, I can see on the dashboard card that a rebase is needed before I attempt to close, so I don't waste a failed close attempt discovering it.
- [ ] As a user whose `feature-close` failed due to a merge conflict, I get a clear, concise error message that names the conflicting files and gives the exact commands to fix it — not a generic merge failure.

## Acceptance Criteria

- [ ] `lib/dashboard-status-collector.js` emits a `rebaseNeeded: boolean` field on each in-progress feature row. `true` when main has commits the feature branch does not (detected via `git rev-list --count HEAD..{defaultBranch}`). `false` or absent for branches that are up to date or when the check cannot run (e.g., no remote, not a worktree branch).
- [ ] The rebase check is skipped (returns `false`) for features in `done`, `inbox`, or `backlog` stage, and for Drive-branch features with no worktree (to avoid redundant checks on the solo agent's own branch).
- [ ] The dashboard card shows a `⚠ Rebase needed before close` warning strip (styled consistently with the existing `kcard-ready-indicator`, but using the warning amber color `#fbbf24`) when `rebaseNeeded: true` and stage is `in-progress`.
- [ ] The warning strip appears between the review section (if present) and the transitions/Close area — the same position as `kcard-ready-indicator`.
- [ ] The Close button gets the same advisory-warning style already used by `shouldWarnCloseByPrStatus` in `pipeline.js` (amber border, no tooltip change needed) when `rebaseNeeded: true`.
- [ ] When `feature-close` fails due to a merge conflict, the error output names the exact conflicting files and prints the full rebase-and-retry recipe, exactly as it does today — no regression to the existing message.
- [ ] The `rebaseNeeded` check adds no more than one `git` subprocess per feature row per poll cycle. It must not block the dashboard response for more than ~200ms total across all features.
- [ ] A unit test covers the `rebaseNeeded` computation helper: returns `true` when behind, `false` when up to date, `false` when the git command fails (graceful degradation).

## Validation

```bash
node -c aigon-cli.js
npm test
```

## Technical Approach

**Server side — `lib/dashboard-status-collector.js`:**

Extract a helper `computeRebaseNeeded(repoPath, branchName, defaultBranch)` that runs:
```bash
git rev-list --count HEAD..{defaultBranch}
```
from the worktree path. Returns `true` if count > 0, `false` otherwise. Wrap in try/catch and return `false` on any error (missing remote, detached HEAD, etc.).

Call this helper for each `in-progress` feature with a non-solo agent branch (i.e., a real worktree branch, not `main`). Attach the boolean to the feature row as `rebaseNeeded`.

The `defaultBranch` is already resolved in the status collector context (used by existing PR checks). Reuse it.

**Dashboard — `templates/dashboard/js/pipeline.js`:**

Add `buildRebaseWarningHtml(feature)` alongside `buildReadyToCloseHtml`. Returns the warning strip when `feature.rebaseNeeded === true` and `feature.stage === 'in-progress'`. Call it in both the fleet/worktree path and the solo-drive path at the same insertion point as `buildReadyToCloseHtml`.

In `shouldWarnCloseByPrStatus` (or a sibling check), also return `true` when `feature.rebaseNeeded` — this adds the existing amber advisory style to the Close button with zero extra code.

**CSS — `templates/dashboard/styles.css`:**

One new rule reusing the `kcard-ready-indicator` layout with amber instead of green:
```css
.kcard-rebase-warning { /* same layout as kcard-ready-indicator, color: #fbbf24, border-left: #fbbf24 */ }
```

## Dependencies

- None. The `git rev-list` call is self-contained. The dashboard action wiring is already in place.

## Out of Scope

- A "Rebase" action button on the card — conflict resolution is interactive and belongs in the CLI.
- Auto-rebase in `feature-close` before attempting the merge.
- Detecting ahead/behind for research worktrees (feature only for now).
- Surfacing the specific files that would conflict (would require `git merge --no-commit --no-ff` dry-run, too expensive per poll).

## Related

- `lib/feature-close.js` — `mergeFeatureBranch()` at line ~356 is where the reactive detection lives today.
- `lib/dashboard-status-collector.js` — feature row assembly.
- `templates/dashboard/js/pipeline.js` — `buildReadyToCloseHtml`, `shouldWarnCloseByPrStatus` (the two closest analogues).
- `lib/dashboard-status-helpers.js` line ~204 — existing `git rev-list --count` pattern for commits-ahead; mirror this for commits-behind.
