# Research Findings: pr option

**Agent:** Codex (cx)
**Research ID:** 29
**Date:** 2026-04-12

---

## Key Findings

### 1. PR creation should happen at submit time, not close time

Recommended default: create or update the PR when an implementation reaches `submitted`, not during `feature-close`.

Why:
- `feature-close` is currently the merge step. Waiting until close to create the PR defeats human review, branch protection, CI gating, and automated reviewer workflows.
- Aigon already pushes the feature branch during `feature-close` in [lib/feature-close.js](/Users/jviner/src/aigon/lib/feature-close.js), so the branch mechanics already exist; the missing piece is shifting push/PR creation earlier in the lifecycle.
- GitHub's `gh pr create` supports explicit base/head selection, draft PRs, reviewer assignment, templates, and body-file input, which maps cleanly to Aigon's spec-driven flow.

Options considered:
- `feature-close` creates PR: rejected. Too late for teams; reviewers and CI only see the PR right before merge.
- Separate `feature-pr` command: viable as an escape hatch, but weaker as the primary UX because teams will forget to run it and state drifts.
- Submit-time creation: best fit. Submission is the point where the agent says "ready for review".

Recommended model:
- `feature-submit` in PR mode:
  - commits/log updates as today
  - pushes branch if needed
  - creates PR if none exists
  - updates existing PR if one already exists
  - optionally creates it as `draft` until local review/eval completes
- `feature-close` in PR mode:
  - verifies the PR is merged or mergeable
  - syncs local state after merge
  - performs local cleanup

### 2. PR content should be generated from the existing Aigon artifacts, but selectively

The PR body should not dump the entire spec/log verbatim. It should be a generated summary with stable sections:

- Summary
  - 2-6 bullet points synthesized from the spec and implementation log
- Spec link / path
  - path to the active feature spec
- Acceptance criteria
  - checklist copied or normalized from the spec
- Testing / validation
  - local validation commands and outcomes if available
- Aigon metadata
  - feature ID, mode (`drive` / `fleet`), agent, worktree branch, evaluation link if applicable

What to avoid:
- Full logs in the PR body. They are noisy and will go stale.
- Embedding local-only paths without a stable explanation.

Best fit with current codebase:
- Specs already exist as the canonical task description.
- Logs already contain implementation narrative.
- Dashboard already reads logs and status as separate concerns, so PR metadata should be additive, not a replacement for local artifacts.

### 3. `feature-review` should stay local-first; PR comments should be additive

Current `feature-review` is a local/worktree review entry point, not a GitHub-integrated review pipeline. That is still useful even with PRs.

Recommended behavior:
- Keep local review logs/eval files as the Aigon-native audit trail.
- Add an optional PR publishing step:
  - summary comment on the PR
  - or a submitted PR review (`COMMENT`, `APPROVE`, `REQUEST_CHANGES`) when the host supports it

Why not make PR comments the only source of truth:
- Local logs work across offline/local-only flows.
- Fleet evaluation compares multiple implementations locally before a winner exists; that does not map 1:1 to a host PR review model.
- GitHub PR review APIs require repo write permissions and token setup, increasing failure modes.

Recommended split:
- OSS keeps local review/eval artifacts authoritative.
- Pro optionally mirrors outcomes to the PR for team visibility.

### 4. `feature-close` and "merge PR" should be distinct lifecycle concepts

Do not collapse them into one opaque step.

Recommended rule:
- If `usePRs` is enabled, `feature-close` should refuse to merge the branch locally when an open PR exists and is not merged yet.
- After the PR is merged on the host, `feature-close` becomes the cleanup/finalization step.

Reasoning:
- GitHub/GitLab/Bitbucket already own approval rules, status checks, merge queues, and auto-merge.
- `gh pr merge --auto` exists specifically to defer the merge until requirements are met.
- Letting Aigon locally merge before the host merge would fight branch protection and create two sources of truth.

Practical UX:
- `feature-submit` can print:
  - `PR created: <url>`
  - `Next: wait for approvals/checks, then merge PR`
- `feature-close` can print:
  - `PR #123 is still open; merge it first, then re-run aigon feature-close 29`

### 5. Worktree -> branch -> PR flow should be one branch per implementation

Aigon already creates distinct branches in Fleet mode (`feature-<id>-<agent>-<desc>`). Keep that model.

Recommended mapping:
- Drive: one feature branch -> one PR
- Fleet:
  - each implementation branch may become its own draft PR if the team wants external review per agent
  - but the default should remain local Fleet evaluation first, then only the winning branch gets the canonical team PR

Why:
- Multiple agent PRs would spam reviewers and CI.
- Fleet mode today is primarily an internal comparison workflow, not a multi-PR collaboration workflow.
- The existing `feature-eval` / `feature-close <winner-agent>` flow already assumes a single winning branch.

Recommendation:
- Default Fleet PR policy: `winner-only`
- Optional advanced mode later: `per-agent-draft`

### 6. GitHub-first is the right v1; host abstraction should come later

For v1, support GitHub via `gh` only.

Why:
- The best-documented CLI automation path is GitHub CLI.
- `gh pr create` and `gh pr merge` already support the needed core operations.
- GitLab and Bitbucket differ enough that a generic abstraction will slow delivery:
  - GitLab can create merge requests with `git push -o merge_request.create ...`
  - Bitbucket centers PR behavior around web/API flows and branch restrictions/merge checks

Recommendation:
- Config shape should separate `enabled` from `provider`
- v1 providers:
  - `github` only
- v2 later:
  - `gitlab`
  - `bitbucket`

### 7. Suggested config shape

Recommended config:

```json
{
  "pro": {
    "prWorkflow": {
      "enabled": true,
      "provider": "github",
      "mode": "submit",
      "draft": true,
      "baseBranch": "main",
      "reviewers": ["myorg/platform-team"],
      "labels": ["aigon", "agent-generated"],
      "requireMergedBeforeClose": true,
      "fleetPolicy": "winner-only",
      "publishEvalSummary": true,
      "publishReviewSummary": true,
      "autoMerge": false
    }
  }
}
```

Notes:
- Put the config in project config, but gate behavior through Pro capability checks.
- Avoid a bare top-level `usePRs: true`; it is too shallow for real workflows.
- `mode: "submit"` leaves room for future alternatives without changing the overall shape.

### 8. OSS vs Pro boundary

Best boundary:

OSS (`aigon`)
- detect current branch / default branch / pushed state
- expose extension points / bridge calls
- persist PR metadata in workflow/dashboard read models
- add status/action placeholders in the dashboard
- basic branch push support in submit flow

Pro (`@aigon/pro`)
- `gh` integration and auth checks
- PR creation/update body generation
- reviewer assignment / labels
- PR status polling
- auto-merge / mergeability checks
- PR comment/review publishing
- dashboard PR widgets with host-specific links and statuses

This matches the existing [lib/pro.js](/Users/jviner/src/aigon/lib/pro.js) pattern and the documented modularity recommendation to keep OSS as the bridge, not the implementation of commercial behavior.

### 9. Command changes needed in Aigon

`lib/commands/feature.js`
- `feature-submit`
  - add Pro hook after successful submit signal/log write
  - ensure branch is pushed here, not only in `feature-close`
  - persist returned PR metadata
- `feature-review`
  - no host dependency required for v1
  - optional Pro hook to publish a PR summary/review
- `feature-eval`
  - optional Pro hook to post the winning recommendation or evaluation summary to the PR
- `feature-close`
  - if PR mode enabled, verify merged state before local finalization
  - stop treating local merge as the review gate in team workflows

`lib/worktree.js`
- likely little direct PR logic
- may need helper(s) for earlier push or branch remote checks, but PR creation itself belongs outside worktree provisioning

Dashboard / read side
- add PR URL, PR number, host, draft/open/merged state, approval/check summary to dashboard status payload
- render PR link and state on cards/board

### 10. Automated reviewers fit naturally as PR-triggered, asynchronous signals

Recommended stance:
- Aigon should not hardcode CodeRabbit / Vercel Agent / Copilot behavior.
- Aigon should expose config and UI/status fields that let teams opt into waiting on those signals.

Why:
- GitHub Copilot code review can automatically review PRs depending on repository/org settings.
- Vercel Agent can automatically review PRs and can also be invoked via `@vercel` comments.
- These tools are host/app-specific and should be treated as external required checks or reviewer signals, not as part of Aigon's local state machine semantics.

Recommended v1 behavior:
- Aigon creates/updates the PR.
- External reviewers run because the PR exists.
- Aigon surfaces host status only if available.
- Human merge policy remains on the host.

Recommended later behavior:
- Optional `waitForChecks` / `requiredChecks` support in Pro, but not as part of the initial cut.

### 11. `feature-eval` should post summaries, not become the merge authority

For Fleet, eval still decides the local winner. That should remain an Aigon concern.

If a winning PR exists:
- post a concise PR comment with the local evaluation result
- or update the PR body with an "Aigon evaluation" section

If no PR exists yet:
- for `winner-only`, create the PR after eval/submit of the winning branch

Avoid:
- opening PRs for all candidates by default
- trying to translate the full evaluation matrix into line comments

### 12. Pro positioning is strong and defensible

This fits Pro cleanly because PR workflow is only valuable when a team or external gate exists.

Strong positioning:
- free OSS Aigon: local spec -> implement -> evaluate/review -> close
- Pro Aigon: branch-to-PR collaboration layer for teams, approvals, checks, and reviewer routing

The competitor evidence is directionally supportive:
- GitHub positions Copilot code review as a premium feature
- Vercel Agent PR review is available on Pro and Enterprise plans and usage-billed

Inference: team-facing review orchestration is commonly monetized, so PR workflow is a credible anchor feature for an "Aigon for Teams" package.

## Sources

- GitHub CLI `gh pr create`: https://cli.github.com/manual/gh_pr_create
- GitHub CLI `gh pr merge`: https://cli.github.com/manual/gh_pr_merge
- GitHub Docs, about pull request reviews: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/about-pull-request-reviews
- GitHub Docs, requesting pull request review: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/requesting-a-pull-request-review
- GitHub REST API, pull request reviews: https://docs.github.com/en/rest/pulls/reviews
- GitHub Docs, Copilot code review: https://docs.github.com/en/copilot/concepts/agents/code-review
- GitHub Docs, configuring automatic Copilot review: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/configure-automatic-review
- GitLab Docs, merge request approvals: https://docs.gitlab.com/user/project/merge_requests/approvals/
- GitLab Docs, push options: https://docs.gitlab.com/topics/git/commit/
- Bitbucket Cloud Docs, use pull requests for code review: https://support.atlassian.com/bitbucket-cloud/docs/use-pull-requests-for-code-review/
- Bitbucket Cloud Docs, require checks before merge: https://support.atlassian.com/bitbucket-cloud/docs/suggest-or-require-checks-before-a-merge/
- Vercel Agent PR review docs: https://vercel.com/docs/agent/pr-review
- Vercel Agent pricing: https://vercel.com/docs/agent/pricing
- Vercel Agent product page: https://vercel.com/agent/
- Aigon codebase: [lib/commands/feature.js](/Users/jviner/src/aigon/lib/commands/feature.js), [lib/feature-close.js](/Users/jviner/src/aigon/lib/feature-close.js), [lib/worktree.js](/Users/jviner/src/aigon/lib/worktree.js), [lib/pro.js](/Users/jviner/src/aigon/lib/pro.js), [lib/dashboard-status-collector.js](/Users/jviner/src/aigon/lib/dashboard-status-collector.js), [docs/architecture.md](/Users/jviner/src/aigon/docs/architecture.md)

## Recommendation

Implement PR workflow as a GitHub-first, Pro-gated submit-time integration.

Concrete recommendation:
- Create/update the PR at `feature-submit`, defaulting to draft PRs.
- Keep `feature-close` separate and require the PR to be merged before close finalizes local cleanup.
- Keep local review/eval artifacts authoritative; mirror summaries to PRs as an optional Pro behavior.
- In Fleet mode, create PRs only for the winning branch by default.
- Put only the bridge/state plumbing in OSS `aigon`; keep `gh` orchestration, body generation, reviewer assignment, polling, and PR widgets in `@aigon/pro`.

This gives teams the workflow they need without distorting Aigon's existing local-first architecture.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| pro-pr-workflow-bridge | Add OSS workflow hooks and persisted PR metadata so Pro can attach PR behavior without owning feature lifecycle state. | high | none |
| pro-github-pr-submit | Create or update a GitHub PR from `feature-submit`, including generated body, draft/open mode, and reviewer assignment. | high | pro-pr-workflow-bridge |
| pro-feature-close-require-merged-pr | Block `feature-close` until the linked PR is merged, then finalize local cleanup and workflow closure. | high | pro-github-pr-submit |
| pro-dashboard-pr-status | Show PR link, number, draft/open/merged state, and approval/check summaries on the dashboard and board. | medium | pro-pr-workflow-bridge |
| pro-pr-review-publish | Publish Aigon review/eval summaries to the PR as comments or formal reviews while keeping local artifacts authoritative. | medium | pro-github-pr-submit |
| pro-fleet-winner-pr-policy | Support Fleet `winner-only` PR behavior so only the selected implementation becomes the canonical team PR. | medium | pro-github-pr-submit |
| pro-required-checks-sync | Poll or read host mergeability/check state so Aigon can surface when a PR is still blocked by approvals or checks. | low | pro-github-pr-submit |
