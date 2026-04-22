# Research: Weekly Background Maintenance Tasks

## Context

As Aigon matures, several categories of maintenance work accumulate silently between active development sessions: docs drift behind shipped features, code complexity grows via incremental additions, architecture docs go stale, and security posture erodes. These are all predictable, recurring concerns — but they require a human (or agent) to notice and act on them.

The goal is to automate these as weekly background tasks: scheduled agents that run without manual triggering, produce actionable output (features, PRs, reports), and don't require the user to babysit them.

### Tasks (user-suggested)

1. **Docs gap scan** — compare what shipped since docs were last updated; surface missing pages/screenshots
2. **Simplification opportunities** — identify top 3 areas of code complexity or duplication worth a refactor feature
3. **Architecture docs refresh** — update `docs/architecture.md` and related docs to reflect structural changes
4. **Security scan** — look for new vulnerabilities, insecure patterns, or dependency issues introduced since last scan

### Tasks (additional candidates to evaluate)

5. **Stale entity sweep** — features sitting in `01-inbox` or `02-backlog` for more than N weeks; flag for the user to prioritise, pause, or delete. Also: features stuck in `03-in-progress` with no commits for X days.
6. **Test suite hygiene** — flaky tests, tests that haven't caught a regression in months (per `check-test-budget.sh` deletion criteria), tests duplicating coverage of the same module. Surface deletion candidates so the budget can be brought back under the ceiling.
7. **Dependency & vulnerability sweep** — `npm outdated`, `npm audit`, GitHub advisory database scan; produce a single weekly report ranked by severity + how many transitive dependents.
8. **Cost & token trend report** — using existing telemetry (per-turn token telemetry from F288), identify which agents/models burn the most cost per shipped feature, surface candidates for model downgrade (e.g. routine work moved from Opus to Sonnet).
9. **CLAUDE.md / AGENTS.md drift** — rules that reference files, commands, or scripts that no longer exist (renamed, moved, or deleted). Same for `templates/` source-of-truth references.
10. **Branch & worktree hygiene** — abandoned feature branches with no parent feature in any spec stage; orphaned worktrees in `~/.aigon/worktrees/<repo>/` whose branches were merged or deleted.
11. **Spec quality audit** — features that shipped without filled-in acceptance criteria, pre-auths that were defined but never cited in commit footers (suggesting they could be removed), specs missing the technical approach section.
12. **Workflow state integrity sweep** — `aigon doctor --fix` as a regular cadence rather than a manual ritual; surface anomalies (snapshotless inbox entities, slug/numeric mismatches).
13. **Project memory hygiene** — review `~/.claude/projects/.../memory/` for duplicate, outdated, or contradictory entries; suggest consolidation.
14. **Feature lifecycle metrics** — time spent in each stage; surface bottlenecks (e.g. specs sitting in review for >N days, in-progress features with low commit velocity).

The research should evaluate how to implement these using Aigon's own scheduling and automation primitives (remote triggers, cron, autopilot) versus external tools, and recommend the best setup for this specific codebase. The agent doing the research should also feel free to propose **further** tasks not in this list if they emerge naturally from the investigation.

## Questions to Answer

- [ ] Does Aigon's existing `/schedule` skill (RemoteTrigger/CronCreate) support fully unattended weekly runs, or does it require a user session to be active?
- [ ] What is the difference between a scheduled RemoteTrigger and a CronCreate job in the current Aigon harness — which is more appropriate for a weekly maintenance agent?
- [ ] Can a scheduled agent open its own feature spec, do research, and call `aigon feature-create` autonomously, or does it need a human to approve the output before specs are written?
- [ ] For the **docs gap scan**: what is the best way for an agent to determine what changed in `lib/` and `templates/` since the last docs update — git log diffing, comparing commit timestamps against last-modified dates in `site/content/`, or some other method?
- [ ] For the **simplification scan**: what heuristics or tools (eslint complexity rules, code-duplication detectors, LOC per file, cyclomatic complexity) are already available in this repo or trivially addable that an agent could run and interpret?
- [ ] For the **architecture docs refresh**: which files in `docs/` are the authoritative architecture sources, and what is the most reliable signal that they are stale (git diff of `lib/` since last commit touching those files)?
- [ ] For the **security scan**: what tools are appropriate for a Node.js CLI codebase (`npm audit`, `semgrep`, `snyk`, custom grep patterns)? Which can run fully offline/unattended?
- [ ] For the **stale entity sweep**: what is a sensible default age threshold for inbox/backlog/in-progress entities, and should it be configurable per-repo?
- [ ] For the **test hygiene** task: is there an existing way to detect "tests that haven't caught a regression in months" (e.g. mutation testing, coverage trend over time) or does this require building new instrumentation?
- [ ] For the **cost trend report**: what telemetry already exists from F288/F290 that an agent could read, and what aggregation is missing?
- [ ] For **CLAUDE.md / AGENTS.md drift**: should this run as a fast lint (each commit) instead of weekly, since drift is cheap to detect on PRs?
- [ ] Should all tasks run as a single scheduled agent job, as one job per task, or grouped into 2–3 buckets (e.g. "code health", "docs health", "ops health")? What are the tradeoffs (failure isolation, parallelism, cost, noise)?
- [ ] What is the right output format for each task — a nudge, a new feature spec, a PR, a report written to `docs/`, or a dashboard notification?
- [ ] Are there Aigon-native examples of self-scheduling agents in the codebase already (e.g. autopilot conductor patterns) that could be reused or adapted?
- [ ] What cadence is realistic — true weekly cron, or triggered after N commits to main since last run?

## Scope

### In Scope
- Aigon's own scheduling primitives: RemoteTrigger, CronCreate, autopilot conductor
- The four task categories listed above for the aigon codebase specifically
- How the agent authenticates and accesses the repo when running unattended
- What human approval steps (if any) are needed before the agent takes write actions (creating specs, committing docs)
- Recommended output format and routing for each task type

### Out of Scope
- General CI/CD pipeline configuration (GitHub Actions, etc.) — this is about agent-based automation, not build automation
- Tasks beyond the four categories above
- Cross-repo scheduling (aigon-pro, brewboard) — focus on the aigon repo first
- Implementing the tasks themselves — the output of this research is feature specs, not working code

## Findings
<!-- Document discoveries, options evaluated, pros/cons -->

## Recommendation
<!-- Summary of recommended approach based on findings -->

## Output
<!-- Based on your recommendation, create the necessary feature specs by running the `aigon feature-create "<name>"` command. Link the newly created files below. -->
User-suggested tasks:
- [ ] Feature: weekly-docs-gap-scan (scheduled agent)
- [ ] Feature: weekly-simplification-scan (scheduled agent)
- [ ] Feature: weekly-architecture-docs-refresh (scheduled agent)
- [ ] Feature: weekly-security-scan (scheduled agent)

Additional candidates (subject to the recommendation):
- [ ] Feature: weekly-stale-entity-sweep
- [ ] Feature: weekly-test-suite-hygiene
- [ ] Feature: weekly-dependency-vulnerability-sweep
- [ ] Feature: weekly-cost-trend-report
- [ ] Feature: claude-md-agents-md-drift-lint (may be per-PR rather than weekly)
- [ ] Feature: weekly-branch-worktree-hygiene
- [ ] Feature: weekly-spec-quality-audit
- [ ] Feature: weekly-workflow-state-integrity
- [ ] Feature: weekly-memory-hygiene
- [ ] Feature: weekly-feature-lifecycle-metrics

Orchestrator (only if research recommends grouping):
- [ ] Feature: scheduled-maintenance-runner
