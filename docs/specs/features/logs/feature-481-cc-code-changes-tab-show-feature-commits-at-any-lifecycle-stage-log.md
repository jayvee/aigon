# Implementation Log: Feature 481 - code-changes-tab-show-feature-commits-at-any-lifecycle-stage
Agent: cc

Added `GET /api/feature/:id/commits` (lib/dashboard-routes/commits.js) and a Code Changes drawer tab; route resolves from worktree (in-progress) or `Merge feature {id}` commit (done), tab is feature-only, expandable rows show files with +/- counts.

## Code review (completed)

**Outcome:** Approve — matches acceptance criteria; integration tests cover primary paths.

**Strengths**

- Worktree path uses `detectDefaultBranch..HEAD`; merged path uses `^1..^2` with squash/ff fallback.
- Merge grep anchored `^Merge feature {id}( |$)` matches `feature-close` messages without false positives on neighbouring IDs.
- `\x1f`-delimited `git log` format avoids delimiter collisions in subjects.
- Feature-only tab via `data-feature-only` + `fetchCommits` guard; lazy load per tab.
- Dispatcher registration in `lib/dashboard-routes.js`; tests for worktree, merged, empty, bad id, plural path.

**Findings / follow-ups**

1. **Multiple worktrees per feature ID:** `findFeatureWorktree` picks first `readdir` match when several `feature-{id}-*` dirs exist — nondeterministic. Document or prefer snapshot primary agent when available.
2. **Branch naming ambiguity:** Fleet regex can mis-classify some drive-style slugs (inherited pattern; same as `resolveFeatureWorktreePath` scan).
3. **UX:** Click-to-copy on hash inside `<summary>` may toggle `<details>` before delegated handler runs — minor; consider capture phase or separate control.
4. **Performance:** One `git show --numstat` per commit; fine for typical branches.
5. **Spec hygiene:** Tick acceptance checkboxes when closing; pre-auth text says register in `dashboard-server.js` but route is registered via `dashboard-routes.js`; screenshot TODOs remain.

**Validation note:** `npm test` may fail on unrelated `eslint` in `lib/dashboard-status-collector.js` (unused var) if present on base branch — not part of feature 481 diff.

**Agent signal:** `aigon agent-status review-complete` succeeded; workflow recorded reviewer as **cu** (session `AIGON_AGENT_ID`), not branch token `cc`.
