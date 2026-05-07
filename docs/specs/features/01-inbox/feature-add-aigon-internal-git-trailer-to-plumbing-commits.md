---
complexity: medium
---

# Feature: Add Aigon-Internal Git Trailer to Plumbing Commits

## Summary

Every Aigon worktree starts with one or more plumbing commits (worktree setup, spec sync, spec-review, spec-revise, review notes) that are Aigon machinery, not user code. The dashboard Code Changes tab currently filters these by fragile message-prefix patterns. This feature adds an `Aigon-Internal: true` git trailer to every plumbing commit at the point of creation, then replaces the pattern-matching filter in the commits API with a clean trailer check.

## User Stories

- [ ] As a developer reviewing Code Changes, I only see commits that represent real code work — Aigon setup/review machinery is hidden.
- [ ] As a future developer adding a new plumbing commit type, I mark it `Aigon-Internal: true` and it is automatically filtered without touching the filter logic.

## Acceptance Criteria

- [ ] `chore: worktree setup for <agent>` commits include `Aigon-Internal: true` trailer (`lib/worktree.js`).
- [ ] `chore: sync feature N spec to worktree` commits include `Aigon-Internal: true` trailer (`lib/feature-start.js`).
- [ ] `docs(review): add review notes to implementation log` commits include `Aigon-Internal: true` trailer (`templates/generic/commands/feature-code-review.md`).
- [ ] `spec-review: feature/research N — ...` commits include `Aigon-Internal: true` trailer (templates `feature-spec-review.md`, `research-spec-review.md`).
- [ ] `spec-revise: feature/research N — ...` commits include `Aigon-Internal: true` trailer (templates `feature-spec-revise.md`, `research-spec-revise.md`).
- [ ] `docs: research findings for <agent>` commits include `Aigon-Internal: true` trailer (`templates/generic/commands/research-do.md`).
- [ ] `docs: research evaluation for N` commits include `Aigon-Internal: true` trailer (`templates/generic/commands/research-eval.md`).
- [ ] `lib/dashboard-routes/commits.js` `parseLogLines` reads the trailer field and sets `aigonInternal: true` on matching commits.
- [ ] `collectFromWorktree` and `collectFromMerged` filter out commits where `aigonInternal === true`.
- [ ] The `PLUMBING_PATTERNS` array and `isPlumbingCommit` helper are removed from `commits.js` (no longer needed).
- [ ] `npm test` passes.

## Validation

```bash
node -c lib/dashboard-routes/commits.js
node -c lib/worktree.js
node -c lib/feature-start.js
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

### Write sites — add `-m "Aigon-Internal: true"` as a second `-m` (git treats it as a trailer paragraph)

Git appends a trailer block when the last paragraph of the commit body is in `key: value` form. The standard way via CLI is to pass a second `-m`:

```
git commit -m "chore: worktree setup for cc" -m "Aigon-Internal: true"
```

Or via `--trailer`:

```
git commit -m "chore: worktree setup for cc" --trailer "Aigon-Internal: true"
```

Use `--trailer "Aigon-Internal: true"` — it is the most explicit and portable form.

**Programmatic write sites (Node.js):**

- `lib/worktree.js:2043` — `execSync('git commit -m "chore: worktree setup for ${agentId}"', ...)` → add `--trailer "Aigon-Internal: true"`.
- `lib/feature-start.js:626` — `runGit('git -C ... commit -m "chore: sync feature N spec to worktree" ...')` → add `--trailer "Aigon-Internal: true"`.

**Template write sites (agent shell commands):**

Add `--trailer "Aigon-Internal: true"` to the `git commit` lines in:
- `templates/generic/commands/feature-code-review.md` — `docs(review): add review notes...`
- `templates/generic/commands/feature-spec-review.md` — `spec-review: feature N — ...`
- `templates/generic/commands/research-spec-review.md` — `spec-review: research N — ...`
- `templates/generic/commands/feature-spec-revise.md` — `spec-revise: feature N — ...`
- `templates/generic/commands/research-spec-revise.md` — `spec-revise: research N — ...`
- `templates/generic/commands/research-do.md` — `docs: research findings for...`
- `templates/generic/commands/research-eval.md` — `docs: research evaluation for...`

### Read site — `lib/dashboard-routes/commits.js`

Switch the git log format from `%s` (subject only) to `%s%x1f%(trailers:key=Aigon-Internal,valueonly,separator=%x1f)` so the trailer value is available in the parsed record. Update `parseLogLines` to set `aigonInternal: true` when the trailer value is `true`. Filter on `aigonInternal` instead of `isPlumbingCommit`. Remove `PLUMBING_PATTERNS` and `isPlumbingCommit`.

Note: `%(trailers:...)` requires git ≥ 2.18 (released 2018). That is a safe assumption.

### After template edits

Run `aigon install-agent` for all active agent IDs so the updated templates are deployed. The implementing agent should note which agents need re-installation in the implementation log. (Or the operator can run `aigon install-agent cc gg cx cu` as a post-merge step — either is fine.)

## Dependencies

- None.

## Out of Scope

- Backfilling the trailer onto existing commits in git history.
- Exposing `Aigon-Internal` commits as a toggle in the dashboard UI.

## Open Questions

- None.

## Related

- Set: standalone
