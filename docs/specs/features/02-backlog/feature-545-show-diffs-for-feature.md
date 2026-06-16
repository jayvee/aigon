---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-10T12:40:21.627Z", actor: "cli/feature-prioritise" }
---

# Feature: show-diffs-for-feature

## Summary

The dashboard's **Code Changes** tab (feature drawer) currently lists each commit
with a GitHub link and per-file add/remove line counts, but it never shows the
actual code. This feature adds an inline, colour-coded diff viewer: each file row
gets an **expand/collapse** control that reveals the real diff hunks (red removals,
green additions, grey context) rendered directly in the dashboard, so the operator
can read what changed without leaving for GitHub. The GitHub commit link stays as-is
for the canonical/external view.

## User Stories
- [ ] As an operator reviewing a feature, I want to click a file in the Code Changes tab and see its colour-coded diff inline, so I can read what changed without opening GitHub.
- [ ] As an operator, I want to expand/collapse each file's diff independently, so a feature touching many files stays scannable.
- [ ] As an operator, I want additions, removals, and context lines visually distinct (green / red / neutral) with line numbers, so I can read the change quickly.

## Acceptance Criteria
- [ ] In the Code Changes tab, each file row under a commit has an expand/collapse affordance (caret/button). Collapsed by default.
- [ ] Expanding a file lazily fetches the unified diff for that file at that commit and renders it colour-coded: removed lines red, added lines green, context neutral, hunk headers (`@@`) styled distinctly. Re-expanding the same file reuses the cached response rather than issuing another request.
- [ ] Old/new line numbers are shown in a gutter for each diff line.
- [ ] The existing GitHub commit-hash link and the per-file `+N / -N` stats remain unchanged and functional.
- [ ] Works for both `source: 'worktree'` (active feature) and `source: 'merged'` (closed feature) commit payloads.
- [ ] Binary files, deleted files with no textual patch, or files with no diff body show a clear "No textual diff available" or "Binary file" placeholder rather than erroring.
- [ ] Large per-file diffs are capped server-side and returned with `truncated: true`; the UI shows the visible prefix plus a "View full diff on GitHub" fallback when `repoUrl` is available.
- [ ] Diff fetch failures leave the file row expanded with an inline error and a retry affordance; they do not blank the Code Changes tab.
- [ ] `aigon server restart` after the `lib/*.js` change; dashboard verified via browser snapshot showing a real coloured diff.

## Validation
```bash
npm run test:unit
npm run test:browser:smoke
node -c lib/dashboard-routes/commits.js
node -c aigon-cli.js
aigon server restart
```

## Technical Approach

**Surface (read-path target):** `templates/dashboard/js/detail-tabs.js` →
`renderCodeChanges()` (currently ~lines 390-425) and its `fetchCommits()` helper
(~lines 361-372). The tab is feature-only and already iterates commits → files.

**Data source — extend the commits API rather than the frontend computing diffs.**
The git diff must be produced server-side where the worktree/repo path is known:
`lib/dashboard-routes/commits.js`, route `/^\/api\/features?\/([^/]+)\/commits$/`
(`handleCommits`, ~lines 167-202). Today `attachFiles()` runs `git` to get per-file
add/remove counts.

Add a lazy sibling endpoint:
`GET /api/feature/:id/commits/:hash/diff?path=<file>&repoPath=<...>`.
Accept both singular/plural feature route forms if that keeps route naming consistent
with the existing commits endpoint. The endpoint returns JSON for one file, for example:

```json
{
  "source": "worktree",
  "hash": "abc123...",
  "path": "templates/dashboard/js/detail-tabs.js",
  "diff": "@@ -1,2 +1,2 @@\n-old\n+new\n",
  "binary": false,
  "truncated": false,
  "repoUrl": "https://github.com/owner/repo"
}
```

Use `git show --format= --patch --find-renames --find-copies <hash> -- <path>` for the
per-file patch, with `--` before the path. Cap the response body at a fixed server-side
threshold (choose the constant in `commits.js`, e.g. 200 KB) and set `truncated: true`
when the patch is cut. Detect binary/no-textual cases from git's patch output (`Binary
files ... differ`, no hunk headers, or numstat `-`) and return `binary: true` or an
empty `diff` instead of a 500.

Reuse the existing helpers in `commits.js`: `safeGit`, worktree resolution
(`collectFromWorktree`, `detectDefaultBranch`, the `feature-{id}-...` worktree scan)
and the merged-commit lookup. Diffs for merged features come from `git show <hash>`
in the main repo; for worktree features from the worktree path. `isInternalPlumbingCommit`
filtering already excludes plumbing commits — keep that. Invalid feature ids, invalid
repo paths, missing `path`, and unknown commits return 4xx JSON errors via the existing
route helper pattern; git failures should not leak stack traces.

**Rendering — no heavy library unless justified.** The dashboard pre-loads no diff/
highlight library today (only marked, chart, xterm, Alpine). Prefer a small hand-rolled
unified-diff renderer (split lines, classify by leading `+`/`-`/` `/`@@`, build a two-
column gutter) over pulling in `diff2html`. Preserve escaped leading spaces and tabs
inside diff content so indentation remains readable. Syntax highlighting of code
*content* is out of scope for v1 — colour the diff lines, not the language tokens. Use
existing `escHtml()` for safety. Match the
existing `.commit-*` class vocabulary in `styles.css` (`.commit-file-add`,
`.commit-file-del`, etc.) and add `.diff-line-add` / `.diff-line-del` / `.diff-line-ctx`
/ `.diff-hunk` styling consistent with the dark dashboard theme.

Frontend state lives in `templates/dashboard/js/detail-tabs.js` only: each file row owns
`collapsed | loading | loaded | error` render states, caches loaded diff JSON by
`fullHash + "\0" + path`, and keeps expand/collapse independent per file. Do not add
frontend-only eligibility logic for whether Code Changes is available; the tab remains
feature-only through the existing drawer parsing and API response.

**Constraints:**
- Read-only: the dashboard never mutates state — this only reads git. (memory: dashboard-read-only)
- After any `lib/*.js` edit run `aigon server restart`; after dashboard JS/CSS changes take a browser snapshot.
- Keep the iterate gate green; this is non-browser logic (API) + a dashboard change, so add or update unit tests around `commits.js` internals and manually verify the rendered drawer.

## Dependencies
- None (extends existing `/api/feature/:id/commits` infrastructure).

## Out of Scope
- Language-aware syntax highlighting of code tokens inside diffs (colour-coding is by diff line type only for v1).
- Editing, commenting on, or staging diffs from the dashboard (read-only).
- Side-by-side (split) diff view — v1 is unified inline.
- Research entities (Code Changes is feature-only).
- Changing the GitHub commit link behaviour.

## Open Questions
- Exact truncation threshold; the implementation should define one named constant in `commits.js` and cover it in tests.

## Related
- Research: <!-- none -->
- Set: <!-- standalone -->
