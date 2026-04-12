# Research: PR Option for Team Workflows

**Created:** 2026-04-12

## Context

Aigon currently operates without pull requests — features go through worktree → submit → review → close entirely within the local repo and branch model. For solo developers this is fine, but teams adopting Aigon will need PRs as part of their workflow for:

- **Human code review** — colleagues need to review and approve changes before merge
- **Automated agent reviews** — tools like Vercel Agent, CodeRabbit, or custom reviewers that run on PR creation
- **Gating and compliance** — branch protection rules, required approvals, CI checks that only run on PRs
- **Visibility** — PRs are how teams track what's changing and why

This research should explore what a `usePRs` config option would look like, how it would change Aigon's existing workflow lifecycle, and what implementation changes would be required.

## Questions to Answer

- [ ] Where in the feature lifecycle should PRs be created? At `feature-submit`? At `feature-close`? As a separate `feature-pr` command?
- [ ] What should the PR contain? How do we map Aigon's spec, logs, and acceptance criteria into a PR description?
- [ ] How does `feature-review` change when PRs exist? Does the review agent post comments on the PR instead of (or in addition to) writing to the local log?
- [ ] Should `feature-close` be blocked until the PR is merged? Or should close and merge be independent?
- [ ] How does the worktree → branch → PR flow work? Aigon worktrees already create branches — do we push those branches and open PRs from them?
- [ ] What config shape makes sense? e.g. `usePRs: true`, `prReviewers: ["@team"]`, `prTemplate: "..."`, `requireApproval: true`
- [ ] How do we handle the `gh` CLI dependency? Is it required, or should we also support other git hosts (GitLab, Bitbucket)?
- [ ] What happens in Fleet mode with multiple agents? Does each agent get its own PR, or do they all contribute to one?
- [ ] How do automated agent reviews (CodeRabbit, Vercel Agent, etc.) fit in? Should Aigon wait for their results?
- [ ] What changes are needed in `lib/commands/feature.js` (submit, close, review) and `lib/worktree.js` (branch push)?
- [ ] How does this interact with `feature-eval`? Should eval results be posted as PR comments?
- [ ] What's the UX for the dashboard? Should PR status/links appear on the board?

## Scope

### In Scope
- Config design for enabling/disabling PR workflow
- Lifecycle changes to feature commands (submit, review, close, eval)
- PR creation, description generation, and reviewer assignment
- Integration points for automated reviewers
- Dashboard visibility of PR state
- `gh` CLI usage patterns

### Out of Scope
- Building a full GitHub/GitLab API abstraction layer
- Replacing Aigon's review system entirely with PR reviews
- Multi-repo PR workflows
- PR-based research workflows (features only for now)

## Aigon Pro Positioning

This feature is a natural fit for **Aigon Pro** and the **"for Teams"** tier. The research should specifically explore:

### Why this is a Pro feature
- Solo developers using Aigon don't need PRs — the local review → close loop is sufficient. PRs become essential when **other humans** need to see, approve, and gate changes.
- The entire PR workflow (creation, reviewer assignment, CI gating, merge blocking) is team infrastructure — it has no value for a single developer working alone.
- This cleanly delineates free vs Pro: free Aigon gives you the full spec-driven loop locally; Pro adds the collaboration layer that teams require.

### Marketing angle: "Aigon for Teams"
- [ ] How does "PR workflow" fit into a broader "Teams" package alongside other Pro features (insights, coaching, amplification)?
- [ ] What's the elevator pitch? e.g. "Your agents already write the code — now your team can review it the way they review everything else: pull requests."
- [ ] Does enabling PRs unlock a natural upsell path? (Solo user tries Aigon free → joins a team → team requires PRs → needs Pro)
- [ ] How do competitors position this? (Cursor Teams, Copilot Enterprise, Windsurf Teams — do they gate PR/collaboration features behind paid tiers?)
- [ ] Should PR workflow be the anchor feature of a "Teams" launch, or one of several?

### Implementation boundary: OSS vs Pro
- [ ] What lives in `aigon` (OSS)? Likely: the `lib/pro-bridge.js` extension points, basic branch push mechanics
- [ ] What lives in `@aigon/pro`? Likely: PR creation, description generation from specs/logs, reviewer assignment, PR status polling, dashboard PR widgets
- [ ] Does the config (`usePRs`, `prReviewers`, etc.) go in project config and get gated by `lib/pro.js`, or does it live entirely in the Pro module?
- [ ] How does this follow the existing cross-repo pattern? (spec in aigon-pro, bridge touch in aigon with `Cross-repo: aigon-pro feature N` footer)

## Inspiration
- `gh pr create` / `gh pr merge` CLI patterns
- How Cursor/Copilot Workspace handle PR creation from agent work
- Branch protection rules and required status checks as a model for gating
