# Research: Weekly Background Maintenance Tasks

## Context

As Aigon matures, several categories of maintenance work accumulate silently between active development sessions: docs drift behind shipped features, code complexity grows via incremental additions, architecture docs go stale, and security posture erodes. These are all predictable, recurring concerns — but they require a human (or agent) to notice and act on them.

The goal is to automate these as weekly background tasks: scheduled agents that run without manual triggering, produce actionable output (features, PRs, reports), and don't require the user to babysit them.

Four specific tasks are in scope:
1. **Docs gap scan** — compare what shipped since docs were last updated; surface missing pages/screenshots
2. **Simplification opportunities** — identify top 3 areas of code complexity or duplication worth a refactor feature
3. **Architecture docs refresh** — update `docs/architecture.md` and related docs to reflect structural changes
4. **Security scan** — look for new vulnerabilities, insecure patterns, or dependency issues introduced since last scan

The research should evaluate how to implement these using Aigon's own scheduling and automation primitives (remote triggers, cron, autopilot) versus external tools, and recommend the best setup for this specific codebase.

## Questions to Answer

- [ ] Does Aigon's existing `/schedule` skill (RemoteTrigger/CronCreate) support fully unattended weekly runs, or does it require a user session to be active?
- [ ] What is the difference between a scheduled RemoteTrigger and a CronCreate job in the current Aigon harness — which is more appropriate for a weekly maintenance agent?
- [ ] Can a scheduled agent open its own feature spec, do research, and call `aigon feature-create` autonomously, or does it need a human to approve the output before specs are written?
- [ ] For the **docs gap scan**: what is the best way for an agent to determine what changed in `lib/` and `templates/` since the last docs update — git log diffing, comparing commit timestamps against last-modified dates in `site/content/`, or some other method?
- [ ] For the **simplification scan**: what heuristics or tools (eslint complexity rules, code-duplication detectors, LOC per file, cyclomatic complexity) are already available in this repo or trivially addable that an agent could run and interpret?
- [ ] For the **architecture docs refresh**: which files in `docs/` are the authoritative architecture sources, and what is the most reliable signal that they are stale (git diff of `lib/` since last commit touching those files)?
- [ ] For the **security scan**: what tools are appropriate for a Node.js CLI codebase (`npm audit`, `semgrep`, `snyk`, custom grep patterns)? Which can run fully offline/unattended?
- [ ] Should all four tasks run as a single scheduled agent job, or as four independent jobs — what are the tradeoffs (failure isolation, parallelism, cost, noise)?
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
- [ ] Feature: weekly-docs-gap-scan (scheduled agent)
- [ ] Feature: weekly-simplification-scan (scheduled agent)
- [ ] Feature: weekly-architecture-docs-refresh (scheduled agent)
- [ ] Feature: weekly-security-scan (scheduled agent)
- [ ] Feature: scheduled-maintenance-runner (orchestrator, if single-job approach recommended)
