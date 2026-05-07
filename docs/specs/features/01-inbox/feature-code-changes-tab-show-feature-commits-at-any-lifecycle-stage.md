---
complexity: high
---

# Feature: Code Changes tab — show feature commits at any lifecycle stage

## Summary

Add a **Code Changes** tab to the feature detail panel in the dashboard, sitting next to Agent Log. The tab surfaces the git commits made during a feature's implementation — working at every lifecycle stage: in-progress (reads from the live worktree branch), and done/merged (locates the merge commit on main and walks back its constituent commits). This gives a concrete, code-level view of what was actually built, complementing the prose reasoning in the implementation log.

## User Stories

- [ ] As a developer reviewing a completed feature, I want to see every commit that was part of that feature — message, author, timestamp, and files changed — so I can understand what actually landed without digging through git log manually.
- [ ] As a developer watching an in-progress feature, I want to see commits as they accumulate in the worktree branch, so I know what the agent has committed so far.
- [ ] As a developer on a feature that has been merged to main, I want Code Changes to still work correctly even though the worktree and branch are gone, so I don't lose visibility post-close.

## Acceptance Criteria

- [ ] "Code Changes" tab button appears in the feature detail panel between Stats and Agent Log.
- [ ] **In-progress** (worktree exists): tab shows all commits on the feature branch since it diverged from main, newest first.
- [ ] **Done/merged** (no worktree): tab finds the merge commit via `git log --grep="Merge feature {id}"` on the main repo and lists the commits it brought in.
- [ ] Each commit row shows: short hash (linked or copyable), commit message, author, relative timestamp.
- [ ] Expanding a commit row shows the list of files changed (path, +lines, -lines) from `git show --stat`.
- [ ] If there are zero commits (e.g. a doc-only or very early feature), the tab shows an empty state: "No commits yet."
- [ ] The tab is not shown for research entities (feature-only).
- [ ] A new API endpoint `GET /api/feature/:id/commits` implements the resolution logic and is called by the tab on demand (lazy-load, not pre-fetched).
- [ ] Public docs updated (see Technical Approach).
- [ ] <!-- TODO: add screenshot showing a feature with 3-5 commits, one row expanded to show file list -->

## Validation

```bash
node -c lib/dashboard-routes/commits.js
npm test
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May add the new route file `lib/dashboard-routes/commits.js` and register it in `lib/dashboard-server.js`.

## Technical Approach

### API endpoint: `GET /api/feature/:id/commits`

New file `lib/dashboard-routes/commits.js`, registered in `lib/dashboard-server.js` alongside existing dashboard routes.

**Resolution logic (two paths):**

1. **In-progress** — worktree exists at `~/.aigon/worktrees/{repoName}/feature-{id}-{agentId}-{desc}`:
   - Run `git log main..HEAD --format=%H|%aI|%an|%s` from the worktree path.
   - This naturally scopes to commits since branch diverged.

2. **Done/merged** — no worktree:
   - On the main repo, run `git log --grep="Merge feature {id}" --format=%H -1` to find the merge commit.
   - Then run `git log {mergeHash}^1..{mergeHash}^2 --format=%H|%aI|%an|%s` to extract the merged commits (parent 1 = main before merge, parent 2 = tip of feature branch).
   - Falls back to single-commit merge (squash) if `^2` doesn't exist.

For file details per commit: `git show --stat --format="" {hash}` parsed for `+/-` lines.

**Response shape:**
```json
{
  "source": "worktree" | "merged",
  "commits": [
    {
      "hash": "abc1234",
      "message": "feat: add dark mode toggle",
      "author": "cc",
      "timestamp": "2026-05-06T14:32:00Z",
      "files": [
        { "path": "lib/foo.js", "added": 12, "removed": 3 }
      ]
    }
  ]
}
```

The `files` array is only populated when the client expands a row (a separate `GET /api/feature/:id/commits/:hash/files` endpoint, or inline in the initial response — implementer to decide based on typical commit size).

### Dashboard tab

- Add tab button to `templates/dashboard/index.html` between Stats and Agent Log.
- Add `'code-changes'` to `TAB_ORDER` in `templates/dashboard/js/detail-tabs.js`.
- Add `renderCodeChanges(payload)` render function: calls `/api/feature/:id/commits`, renders commit list. Commit rows are expandable (click to show file list). Lazy-loaded (only fetches when tab is first activated).
- Tab is suppressed for research entities (check entity type before rendering tab button).

### Docs changes

- Update `docs/architecture.md` — add the new endpoint to the dashboard routes section.
- Update `site/docs/` (public docs site) — add a section under "Dashboard" describing the Code Changes tab, what it shows at each lifecycle stage, and include a TODO placeholder for a screenshot.
  - <!-- TODO: capture screenshot of Code Changes tab with a real feature — show commit list with one row expanded to file list; replace placeholder in docs -->

## Dependencies

- Reads worktree resolution logic from `lib/dashboard-status-helpers.js` (`resolveFeatureWorktreePath`) — no changes needed, just call it.
- Branch naming convention: `feature-{num}-{agentId}-{desc}` (fleet) / `feature-{num}-{desc}` (drive) — must handle both.
- Merge commit message pattern from `lib/feature-close.js:472`: `Merge feature {num}` / `Merge feature {num} from agent {agentId}` — grep must match both variants.

## Out of Scope

- Inline full unified diffs (patch view) — file list with line counts is sufficient for v1.
- Showing commits for research entities.
- Filtering or searching commits.
- Linking commits to an external git host (GitHub/GitLab).

## Open Questions

- Should file details be fetched inline (one request, slightly larger payload) or on demand per commit expansion (second request, more requests)? Implementer to decide based on typical commit file count — inline is probably fine for most features.

## Related

- Research: none
- Set: none
