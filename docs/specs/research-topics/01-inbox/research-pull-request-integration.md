# Research: pull-request-integration

## Context

Aigon currently operates without pull requests — features are implemented on branches, reviewed by agents, and merged locally via `feature-close`. This works well for solo developers but doesn't fit teams that rely on GitHub PR workflows (CI/CD, branch protection, required reviews, status checks).

A small team (3-4 developers) using aigon in a commercial environment needs PRs as a gate before close. The core challenge is: **how do we integrate PR status into aigon's workflow without coupling the dashboard server and action eligibility system to external API calls?**

Today, the dashboard polls `canCloseFeature()` and the workflow rules engine to determine which actions are available. These are fast, local, synchronous checks against filesystem state. Adding `gh pr view` calls to this path would introduce network latency, rate limiting, authentication dependencies, and failure modes that don't exist today. The server should remain a reader of local state — it must not become an orchestrator that calls out to GitHub on every poll cycle.

This research should figure out the right architecture for keeping PR status as locally-cached state that aigon can read cheaply, while ensuring it stays fresh enough to be useful for gating.

## Questions to Answer

### State & caching architecture
- [ ] Where should PR status live? Options: workflow snapshot, agent-status file, dedicated `.aigon/state/pr-{id}.json`, or extending the existing workflow event log
- [ ] How is PR status kept fresh? Options: periodic background poll (sidecar/cron), webhook receiver, refresh-on-demand when user clicks close, or piggyback on existing heartbeat/polling
- [ ] What's the staleness tolerance? Is 30s-old PR status acceptable for the dashboard? What about for the close gate itself?
- [ ] How do we handle GitHub API failures gracefully — should stale-but-cached status allow close, or should unknown status block?

### Workflow integration points
- [ ] When is the PR created? At `feature-start` (draft) vs `feature-submit` (ready)?
- [ ] When does `git push` happen? On every commit, on submit only, or periodically?
- [ ] How does `feature-close` change? Replace local merge with `gh pr merge`, or merge locally and auto-close the PR?
- [ ] How does `canCloseFeature()` incorporate PR status without making it async/network-dependent?
- [ ] Where does the PR number get stored so all subsequent operations can reference it?

### AutoConductor (autonomous mode)
- [ ] How does the AutoConductor wait for CI? New polling step after feedback/submit, or retry-on-close-failure?
- [ ] Should the AutoConductor be the one refreshing PR status cache, since it's already polling?

### Dashboard / action eligibility
- [ ] How do workflow rules expose PR status to the dashboard without the dashboard calling GitHub?
- [ ] Should the Close button show "Waiting for CI" with check details, or just be hidden?
- [ ] Can the dashboard trigger a one-off PR status refresh (user clicks "refresh") without becoming an orchestrator?

### Configuration & compatibility
- [ ] What's the minimum config surface? Just `pullRequests.enabled` or also merge method, required checks list, etc.?
- [ ] How does this interact with the existing security scan gate — complementary or overlapping?
- [ ] Does this work with providers other than GitHub (GitLab, Bitbucket) or is GitHub-only acceptable for v1?

### Edge cases
- [ ] What happens if someone merges or closes the PR outside of aigon?
- [ ] What if the PR has merge conflicts that need manual resolution?
- [ ] What if CI is flaky and checks keep failing — is there a bypass mechanism?

## Scope

### In Scope
- Architecture for PR status as locally-cached state
- Integration points in the existing workflow (start, submit, close)
- Dashboard action eligibility with PR gates
- AutoConductor polling for CI status
- Config design for opting in per-repo
- GitHub as the primary target platform

### Out of Scope
- Actually implementing PR support (that's a feature, post-research)
- GitLab / Bitbucket / Azure DevOps support (note feasibility but don't design for it)
- GitHub Actions workflow authoring (the team brings their own CI)
- Branch protection rule configuration (that's GitHub admin, not aigon)
- PR review comments from the review agent (separate feature, complementary)

## Findings
<!-- Document discoveries, options evaluated, pros/cons -->

## Recommendation
<!-- Summary of recommended approach based on findings -->

## Output
<!-- Based on your recommendation, create the necessary feature specs by running the `aigon feature-create "<name>"` command. Link the newly created files below. -->
- [ ] Feature:
