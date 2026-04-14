# Research: git-native-team-sync-architecture

## Context

Aigon needs a multi-user team mode where developers on separate machines can see each other's feature/research assignments, prevent double-claiming, and keep board state in sync — all without requiring a central server or platform-specific APIs.

The multiuser feature series (250–253) was designed around committed state files with git push/pull. That approach has been paused because:
- Committed state files create merge conflicts between users
- The branch-switching dance (stash → checkout main → commit state → push → checkout feature → pop) is fragile
- It couples sync to the file format, making future changes expensive

An alternative proposal exists in `docs/aigon-distributed-git-native-task-tracking.md` using git's `refs/aigon/*` namespace and `git notes` for atomic claiming. This avoids file-level conflicts entirely but is unvalidated against real git hosting platforms.

This research should produce a validated architecture for team sync that can replace the paused 250–253 series with a single, well-designed implementation.

## Questions to Answer

- [ ] Do GitHub, GitLab, Bitbucket, and bare git repos all support pushing/fetching custom refs (e.g. `refs/aigon/features/42`)? What restrictions exist?
- [ ] Do GitHub, GitLab, Bitbucket support `git notes` push/fetch? Are there known issues with notes and rebase/squash workflows?
- [ ] What happens to `refs/aigon/*` refs during common git operations: clone, fork, mirror, shallow clone, GitHub "Download ZIP"?
- [ ] Is `refs/aigon/*` visible in `git log` output by default? Can it be hidden cleanly with `log.excludeDecoration`?
- [ ] Could assignee attribution live in spec frontmatter (e.g. `assignee: John <john@example.com>`) instead of refs/notes, using PRs as the sync mechanism? What are the tradeoffs vs. refs/notes?
- [ ] For the atomic claiming/locking use case, is there a simpler alternative to git notes? (e.g. lightweight tags in a custom namespace, or a single refs/aigon/claims branch with one-line JSON files)
- [ ] What's the performance profile of `git fetch origin refs/aigon/*` on a repo with 500+ features? Does it scale?
- [ ] How do existing tools (e.g. git-bug, git-appraise, git-dit) solve the distributed state problem? What can we learn from their approaches and failures?
- [ ] What's the minimal viable schema for a git note claim? (owner, email, timestamp, entity type, status)
- [ ] How should `aigon sync` work in the refs/notes world vs. the current `aigon sync` (which syncs `.aigon/` state via a separate private repo)?

## Scope

### In Scope
- Validating refs/notes feasibility across major git hosts
- Designing the refs namespace schema and note format
- Evaluating hybrid approaches (frontmatter for attribution, refs for locking)
- Defining the sync UX (`aigon sync` commands)
- Answering whether the existing solo `aigon sync` (feature 254) can coexist or should be replaced

### Out of Scope
- Platform-specific integrations (GitHub Actions, webhooks, PR automation) — these are Pro features
- Dashboard/UI design for team views
- Implementation — this research produces a spec, not code
- Cross-repo features (feature 233) — separate concern

## Inspiration
- `docs/aigon-distributed-git-native-task-tracking.md` — the refs/notes proposal
- Paused specs: features 250, 251, 252, 253 in `docs/specs/features/06-paused/`
- Research #30: multi-user-workflow-state-sync (prior research that informed the paused series)
- git-bug (https://github.com/git-bug/git-bug) — distributed bug tracker using git refs
- git-appraise — Google's distributed code review tool using git notes

## Findings
<!-- Document discoveries, options evaluated, pros/cons -->

## Recommendation
<!-- Summary of recommended approach based on findings -->

## Output
<!-- Based on your recommendation, create the necessary feature specs by running the `aigon feature-create "<name>"` command. Link the newly created files below. -->
- [ ] Feature: rewritten team-sync spec (replaces paused 251 + 253)
