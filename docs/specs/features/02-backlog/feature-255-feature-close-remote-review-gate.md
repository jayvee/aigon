# Feature: feature-close-remote-review-gate

## Summary
Add a small optional GitHub PR gate to `feature-close`, plus an explicit `feature-push` command for publishing feature branches to `origin`. The goal is to support teams that use GitHub PR review and CI without repeating the failed architecture from the earlier PR-sync attempt: Aigon must not create PRs, must not merge remotely, must not persist PR metadata, and must not commit workflow/runtime state to the product repo. When the gate is enabled, `feature-close` remains a local close flow; it simply checks whether GitHub reports the branch's PR is in an acceptable pre-close state before continuing. Publishing the branch stays an explicit user action via `feature-push`, not a side effect of `agent-status submitted`.

## User Stories
- [ ] As a solo developer who occasionally uses GitHub PRs for review, I want to push my branch manually when I decide it is ready for remote review, without Aigon automatically publishing every submitted branch.
- [ ] As a team using GitHub for review and CI, I want `feature-close` to block until the feature branch's PR has passed the agreed remote gate, so I cannot accidentally bypass that process locally.
- [ ] As a user relying on GitHub review before close, I want the docs and command errors to make it clear that v1 is a pre-close gate only and that I should not merge the PR remotely before running `feature-close`.
- [ ] As a maintainer, I want this feature to stay small and reversible: no workflow-engine changes, no shared-state design, and no second merge path inside `feature-close`.
- [ ] As a future maintainer, I want GitHub-specific logic isolated enough that later GitLab or Bitbucket support can be added without rewriting `feature-close`.

## Acceptance Criteria
- [ ] A new command `aigon feature-push <ID> [agent]` pushes the resolved feature branch to `origin` with upstream tracking, using the same branch-resolution rules as `feature-close` for Drive vs Fleet mode.
- [ ] `feature-push` prints a clear success message with the branch name it pushed.
- [ ] `feature-push` fails with a clear actionable message when there is no matching branch/worktree, when `origin` is missing, or when the push itself fails.
- [ ] `feature-push` does not alter workflow state, does not move specs, does not merge anything, and does not call `agent-status`.
- [ ] No automatic push is added to `agent-status submitted`, `feature-start`, `feature-do`, or `feature-close`.
- [ ] A new project config flag enables the remote gate for close. Name: `honourRemoteBranchGate`.
- [ ] When `honourRemoteBranchGate` is not set or is `false`, `feature-close` behaves exactly as it does today.
- [ ] When `honourRemoteBranchGate` is `true`, `feature-close` performs one remote preflight check before Phase 4 (`autoCommitAndPush`) and before any merge side-effects occur.
- [ ] The remote preflight is GitHub-only in v1 and uses the `gh` CLI. No new npm dependency is added.
- [ ] If GitHub reports exactly one PR for the branch against the local repo's default branch and that PR is open and mergeable according to the chosen v1 policy, `feature-close` continues through the existing local close path unchanged.
- [ ] If GitHub reports a matching PR that is already merged remotely, `feature-close` exits before any side-effects with a clear message that remote-merged PRs are not supported by this v1 gate and that the user must sync their local branch state manually before cleanup.
- [ ] If no matching PR is found, `feature-close` exits before any push, merge, spec move, or cleanup work and tells the user to run `aigon feature-push <ID> [agent]`, create the PR, and re-run close.
- [ ] If multiple matching PRs are found, `feature-close` first narrows candidates to open-or-merged PRs for the same head branch and default base branch; it exits as ambiguous only if more than one such active candidate remains.
- [ ] If a matching PR exists but is closed without being merged, `feature-close` exits before any side-effects with a clear message that the PR is closed and unmerged.
- [ ] If a matching PR exists but is open and not yet acceptable for close, `feature-close` exits before any side-effects with a clear message explaining whether it is blocked by draft state, non-mergeable state, or another GitHub-reported gate failure.
- [ ] If `gh` is not installed, not authenticated, or cannot query the repository, `feature-close` exits before any side-effects with a clear setup/retry message. The gate is fail-closed when enabled.
- [ ] The existing phases after the preflight gate remain unchanged: local merge path, telemetry, workflow transition, spec move, cleanup, and server restart all continue to work through the current code.
- [ ] The existing push inside `feature-close` Phase 4 remains unchanged in v1. The new gate only decides whether the close flow is allowed to enter that existing phase.
- [ ] No PR metadata is written to `.aigon/`, workflow-core state, spec frontmatter, or git commits.
- [ ] No remote merge execution is added to `feature-close`.
- [ ] No fetch + fast-forward path is added to `feature-close`.
- [ ] No workflow-core files are modified for this feature unless required by tests only.
- [ ] CLI help and workflow docs are updated to cover every new or changed command related to this feature, including `feature-push`, the remote close gate config, and any related slash-command or skill surfaces that tell users how to publish a branch for PR review.
- [ ] Agent-facing docs/templates are updated anywhere this feature changes the recommended command flow, so agents do not keep suggesting outdated behavior around submit, push, or close.
- [ ] The landing page and any comparable marketing/product copy updated in this repo include a concise statement that Aigon can support GitHub PR review workflows via manual branch push plus optional close gating, without claiming full PR lifecycle automation.

## Validation
```bash
node -c aigon-cli.js
node -c lib/commands/feature.js
node -c lib/feature-close.js
node -c lib/config.js
npm test
```

## Technical Approach

### Core design

This feature deliberately stops short of PR lifecycle automation.

Aigon remains responsible for:

- local feature workflow
- local branch/worktree handling
- the existing local `feature-close` merge path

GitHub remains responsible for:

- branch publication destination
- PR creation
- review status
- CI/check status
- mergeability verdict

The boundary is simple:

- `feature-push` publishes a branch when the user chooses
- `feature-close` optionally asks GitHub whether the branch's PR has satisfied the pre-close gate
- if yes, the existing local close flow runs
- if no, close stops before any side-effects

### Why this design

This feature must preserve the key lesson from the previous PR-sync failure:

- no workflow/runtime state committed into product git history
- no `feature-close` logic that needs to reconcile local `main` and `origin/main`
- no remote merge path that changes cleanup, ancestry, or post-close behavior

That means the implementation must avoid:

- `gh pr merge`
- `git fetch` + `git merge --ff-only` as an alternate close path
- auto-push on submit
- storing PR numbers, URLs, or state in workflow snapshots

### Command surface

#### 1. `feature-push`

Add a new command:

```bash
aigon feature-push <ID> [agent]
```

Behavior:

- Resolve the feature target using the same branch/worktree resolution rules already used by `feature-close`
- Determine the feature branch name
- Run `git push -u origin <branch>`
- Print a clear success or failure message

Notes:

- This is intentionally manual and explicit
- It is the supported path for making a branch available for PR creation
- It does not modify workflow state

Implementation location:

- add the command in `lib/commands/feature.js`
- reuse `resolveCloseTarget()` from `lib/feature-close.js` rather than duplicating branch lookup logic
- if `resolveCloseTarget()` is shared as-is, update the action-scope logic so `feature-push` uses the correct action name instead of inheriting `feature-close` delegation semantics by accident

#### 2. `feature-close` preflight gate

When `honourRemoteBranchGate` is enabled in `.aigon/config.json`, add one new preflight phase before the existing Phase 4/5 close phases.

Proposed flow:

1. Resolve feature target as today
2. Run the existing workflow close pre-check (`wf.canCloseFeature`)
3. If remote gate disabled: continue unchanged
4. If remote gate enabled: run GitHub gate check
5. If gate passes: continue into existing close path
6. If gate fails: print reason and exit with no git side-effects

Important behavioral note for v1:

- this gate is a pre-close GitHub checkpoint, not a remote-merge integration
- users must not merge the PR remotely before running `feature-close`
- a remotely merged PR is treated as an unsupported state for this v1 design because accepting it would require the fetch/fast-forward or remote-merge reconciliation paths that this feature is explicitly avoiding

This placement matters. The remote gate must happen before:

- auto-commit/push
- merge to default branch
- telemetry capture tied to merge output
- cleanup of worktrees/branches

### GitHub gate semantics for v1

The v1 implementation should be explicit and narrow.

Input:

- current repo
- resolved feature branch name
- local default branch from `ctx.git.getDefaultBranch()`

Candidate PR selection:

- query GitHub for PRs whose head branch matches the resolved feature branch
- filter to PRs whose base branch matches the local default branch

Gate result rules:

1. If zero matching PRs exist: fail closed
2. Narrow matches to open-or-merged PRs for the same head branch and default base branch
3. If more than one active candidate remains after narrowing: fail closed as ambiguous
4. If exactly one matching PR exists and it is open:
   - pass if it satisfies the chosen GitHub mergeability policy
   - otherwise fail closed with the most specific reason available
5. If exactly one matching PR exists and it is merged: fail closed with an explicit "remote merged not supported in v1" message
6. If exactly one matching PR exists and it is closed but not merged: fail closed

### GitHub data to inspect

The implementation should fetch only what it needs. A single `gh pr list --json ...` or `gh pr view --json ...` call is sufficient if it includes the relevant fields.

Candidate useful fields:

- `number`
- `url`
- `state`
- `isDraft`
- `baseRefName`
- `headRefName`
- `mergeStateStatus`
- `mergedAt`

The code must not blindly treat one GitHub field as universal truth without documenting the policy. The chosen v1 policy should be described in the implementation and docs.

### Proposed v1 gate policy

For v1, use the simplest practical GitHub policy:

- open PR passes if:
  - not draft
  - `mergeStateStatus` is one of GitHub's acceptable mergeable states for local close

This spec intentionally leaves room for the exact accepted values to be finalized during implementation after checking real `gh` output in tests. The important product behavior is:

- draft PR must block
- clearly non-mergeable/conflicted PR must block
- remotely merged PRs must block with an explicit unsupported-state message
- ambiguous/missing PRs must block

If implementation shows that `reviewDecision` is needed to make the gate match real-world expectations, it may be included, but the code and docs must then describe that explicitly. Do not quietly add approval semantics without documenting them.

Policy note:

- v1 honours the remote branch gate GitHub is actually enforcing
- if the repository's GitHub settings and branch protection rules do not require approvals, then an open non-draft PR in an acceptable mergeable state may pass the gate with zero reviews
- that is intentional for v1; Aigon is deferring to the repository's configured GitHub gate rather than inventing a stricter local approval policy

### File changes

Minimum expected files:

- `lib/commands/feature.js`
  - add `feature-push`
  - invoke the optional remote gate in `feature-close`
- `lib/feature-close.js`
  - add a helper to check the remote gate and return a normalized result shape

Optional extraction if the helper grows materially:

- `lib/remote-gate-github.js`

Do not add provider abstraction files unless the implementation genuinely needs them. GitHub-only in one helper is acceptable for v1 as long as the return shape is clean enough to extract later.

### Suggested helper result shape

Use a provider-neutral return object even if the implementation lives in one file:

```js
{ ok: true, provider: 'github', state: 'open', prNumber: 123, url: '...' }
```

or:

```js
{ ok: false, provider: 'github', code: 'no_pr', message: 'No matching PR found' }
```

Recommended failure codes:

- `gh_missing`
- `gh_auth`
- `no_pr`
- `ambiguous_pr`
- `remote_merged_unsupported`
- `closed_unmerged`
- `draft`
- `not_mergeable`
- `query_failed`

### Documentation updates

Implementation should update docs in the same PR because this changes the feature workflow surface:

- `AGENTS.md`
  - mention `feature-push`
  - mention the optional close gate and that it is fail-closed when enabled
- `docs/development_workflow.md`
  - document the manual remote workflow:
    1. implement
    2. `aigon feature-push`
    3. create/update PR
    4. wait for remote gate
    5. `aigon feature-close`
  - explicitly state that for v1 users should not merge the PR remotely before `feature-close`
- command help / usage text for:
  - `feature-push`
  - `feature-close` when the gate is enabled
- agent-command templates / slash-command docs affected by this workflow change
  - update any instructions that currently imply submit is the last step before close
  - ensure any surfaced Codex/Claude/Cursor slash-command guidance includes the explicit push step where relevant
- landing page / product copy in this repo
  - add a short line about supporting GitHub PR workflows
  - position it accurately as manual branch publishing plus optional close gating, not full PR automation
- any command help text surfaced through the CLI for `feature-push`

### Testing strategy

Tests should focus on two things:

1. the branch-resolution and push command behavior
2. the remote-gate decision table

Prefer unit-style tests with mocked `gh` output over end-to-end browser/API tests.

#### Automated tests

Add regression coverage for:

- `feature-push` on a Drive branch resolves and pushes `feature-<id>-<desc>`
- `feature-push` on a Fleet feature with agent resolves and pushes `feature-<id>-<agent>-<desc>`
- `feature-close` with gate disabled does not call the remote gate helper
- `feature-close` with gate enabled and open mergeable PR result proceeds into the existing local merge path
- `feature-close` with gate enabled and zero PR result exits before merge side-effects
- `feature-close` with gate enabled and multiple active PR candidates exits before merge side-effects
- `feature-close` with gate enabled and one closed old PR plus one open current PR uses the open current PR and does not fail as ambiguous
- `feature-close` with gate enabled and merged PR result exits before merge side-effects with the explicit unsupported-state message
- `feature-close` with gate enabled and closed-unmerged PR result exits before merge side-effects
- `feature-close` with gate enabled and draft PR result exits before merge side-effects
- `feature-close` with gate enabled and missing `gh` result exits before merge side-effects

For every blocked case, assert that the following did not happen:

- no local merge
- no spec move
- no branch cleanup
- no remote push as part of close

#### Manual test matrix

The implementation PR should include a manual verification section covering at least:

1. Gate disabled
   - create/submit a feature with no remote PR
   - run `aigon feature-close <id>`
   - confirm behavior is unchanged

2. `feature-push`
   - create a feature branch
   - run `aigon feature-push <id>`
   - confirm branch exists on `origin` with upstream tracking

3. Gate enabled, no PR
   - set `"honourRemoteBranchGate": true`
   - run `aigon feature-close <id>`
   - confirm close stops before merge and prints next steps

4. Gate enabled, open draft PR
   - push branch, create draft PR
   - run close
   - confirm it blocks with draft-specific message

5. Gate enabled, open acceptable PR
   - mark PR ready, ensure GitHub shows acceptable mergeable state
   - run close
   - confirm local close succeeds end-to-end

6. Gate enabled, already merged PR
   - merge the PR on GitHub first
   - run `aigon feature-close <id>`
   - confirm close blocks with the explicit unsupported-state message and does not enter merge/cleanup phases

7. Gate enabled, ambiguous PRs
   - create or reopen a second active PR for the same branch and base in a test repo
   - confirm close fails with ambiguity message

8. Missing `gh`
   - run with `gh` absent from `PATH` or in a controlled test shim
   - confirm gate fails closed with setup instructions

### Constraints

- no new npm packages
- no changes to workflow-core lifecycle semantics
- no background polling
- no dashboard dependency
- no pushing branches automatically on submit
- no assumption that every user has GitHub; the feature is opt-in and GitHub-only for v1

## Dependencies
- GitHub CLI (`gh`) installed and authenticated for repositories that enable the gate
- Existing `feature-close` refactor in `lib/feature-close.js`

## Out of Scope
- Automatic push on `agent-status submitted`
- Automatic PR creation
- Automatic PR update/comment/sync behavior
- Remote merge execution via `gh pr merge`
- Fetch + fast-forward sync of local `main`
- GitLab, Bitbucket, or generic forge support in v1
- Dashboard display of PR state
- Persisting PR metadata into `.aigon/` or git history
- Team/shared-state design or any revisit of the failed PR-sync storage model

## Open Questions
- What exact GitHub field/value set should define "acceptable remote state" for an open PR in v1? The implementation should choose and document the policy explicitly rather than rely on an implicit interpretation of `mergeable`.
- Should `feature-push` optionally support `--force-with-lease`, or should v1 stay strictly to a normal push only?
- For manual testing, which repo should be the canonical GitHub test fixture for validating merged/open/draft/ambiguous cases?

## Related
- Research:
- `cx-pr-sync-and-team-mode.md` — prior failed direction and why this feature avoids state sync and remote merge complexity
- Existing close flow: `lib/commands/feature.js`, `lib/feature-close.js`
- Related future idea, explicitly out of scope here: dashboard PR status and additional provider support
