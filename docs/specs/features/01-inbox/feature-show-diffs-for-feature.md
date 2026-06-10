---
complexity: medium
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
- [ ] Expanding a file fetches (or reveals) the unified diff for that file at that commit and renders it colour-coded: removed lines red, added lines green, context neutral, hunk headers (`@@`) styled distinctly.
- [ ] Old/new line numbers are shown in a gutter for each diff line.
- [ ] The existing GitHub commit-hash link and the per-file `+N / -N` stats remain unchanged and functional.
- [ ] Works for both `source: 'worktree'` (active feature) and `source: 'merged'` (closed feature) commit payloads.
- [ ] Binary files / files with no textual diff show a clear "no textual diff" or "binary file" placeholder rather than erroring.
- [ ] Empty/large-diff handling: very large diffs are either lazily loaded on expand or truncated with a "view on GitHub" fallback (decide in Technical Approach), never freezing the drawer.
- [ ] `aigon server restart` after the lib change; dashboard verified via Playwright snapshot showing a real coloured diff.

## Validation
```bash
```

## Technical Approach

**Surface (read-path target):** `templates/dashboard/js/detail-tabs.js` →
`renderCodeChanges()` (currently ~lines 390-425) and its `fetchCommits()` helper
(~lines 361-372). The tab is feature-only and already iterates commits → files.

**Data source — extend the commits API rather than the frontend computing diffs.**
The git diff must be produced server-side where the worktree/repo path is known:
`lib/dashboard-routes/commits.js`, route `/^\/api\/features?\/([^/]+)\/commits$/`
(`handleCommits`, ~lines 167-202). Today `attachFiles()` runs `git` to get per-file
add/remove counts. Two viable shapes — pick one:

1. **Eager**: have `attachFiles`/`gitLog` also include the unified diff text per file
   (`git diff <parent>..<hash> -- <path>` or parse `git show --format= --patch`).
   Simpler frontend, larger payload.
2. **Lazy (preferred for large features)**: add a sibling endpoint, e.g.
   `GET /api/feature/:id/commits/:hash/diff?path=<file>&repoPath=<...>`, returning the
   unified diff for one file. Frontend fetches on first expand and caches in the row.
   Keeps the initial Code Changes payload small.

Reuse the existing helpers in `commits.js`: `safeGit`, worktree resolution
(`collectFromWorktree`, `detectDefaultBranch`, the `feature-{id}-...` worktree scan)
and the merged-commit lookup. Diffs for merged features come from `git show <hash>`
in the main repo; for worktree features from the worktree path. `isInternalPlumbingCommit`
filtering already excludes plumbing commits — keep that.

**Rendering — no heavy library unless justified.** The dashboard pre-loads no diff/
highlight library today (only marked, chart, xterm, Alpine). Prefer a small hand-rolled
unified-diff renderer (split lines, classify by leading `+`/`-`/` `/`@@`, build a two-
column gutter) over pulling in `diff2html`. Syntax highlighting of code *content* is
out of scope for v1 — colour the diff lines, not the language tokens. Use existing
`escHtml()` for safety. Follow `Skill(frontend-design)` before writing CSS; match the
existing `.commit-*` class vocabulary in `styles.css` (`.commit-file-add`,
`.commit-file-del`, etc.) and add `.diff-line-add` / `.diff-line-del` / `.diff-line-ctx`
/ `.diff-hunk` styling consistent with the dark dashboard theme.

**Constraints:**
- Read-only: the dashboard never mutates state — this only reads git. (memory: dashboard-read-only)
- After any `lib/*.js` edit run `aigon server restart`; after `index.html`/JS/CSS changes take an MCP `browser_snapshot`.
- Keep the iterate gate green; this is non-browser logic (API) + a dashboard change, so the smoke subset runs on dashboard-file changes.

## Dependencies
- None (extends existing `/api/feature/:id/commits` infrastructure).

## Out of Scope
- Language-aware syntax highlighting of code tokens inside diffs (colour-coding is by diff line type only for v1).
- Editing, commenting on, or staging diffs from the dashboard (read-only).
- Side-by-side (split) diff view — v1 is unified inline.
- Research entities (Code Changes is feature-only).
- Changing the GitHub commit link behaviour.

## Open Questions
- Eager vs. lazy diff loading (see Technical Approach) — lazy preferred; confirm at implementation time based on payload size.
- Truncation threshold for very large per-file diffs before falling back to the GitHub link.

## Related
- Research: <!-- none -->
- Set: <!-- standalone -->
