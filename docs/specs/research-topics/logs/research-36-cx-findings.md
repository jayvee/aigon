# Research Findings: weekly background maintenance tasks

**Agent:** Codex (cx)
**Research ID:** 36
**Date:** 2026-04-22

---

## Key Findings

### 1. Use Claude Code Routines, not session-scoped `CronCreate`, for unattended weekly work

- Repo fact: Aigon has no built-in weekly scheduler today. The closest native automation primitive is AutoConductor (`aigon feature-autonomous-start`), which is a detached tmux loop that sequences existing workflow actions; it is not a durable scheduler. Evidence: `lib/commands/feature.js`, `docs/architecture.md`, `templates/help.txt`.
- External fact: Claude Code now has three scheduling modes.
  - `/loop` + `CronCreate` is session-scoped, requires an open session, and recurring tasks expire after 7 days.
  - Desktop scheduled tasks survive restarts but still require the local machine and app to be awake/open.
  - Cloud routines created via `/schedule` run on Anthropic-managed infrastructure, do not require the laptop to be on, and do not prompt for approvals during a run.
- Conclusion: for true weekly maintenance, the right primitive is a cloud routine (`/schedule`), not `CronCreate`.

### 2. A routine can write autonomously, but the repo should not grant broad unattended write authority in v1

- External fact: routines run as full cloud Claude Code sessions with no approval prompts, can run shell commands, use committed skills, and can create branches / PRs in fresh clones. They start from the repo default branch unless unrestricted pushes are enabled.
- Inference from that behavior: a routine can, technically, run `aigon feature-create`, write a spec, commit it, and open a PR with no human in the loop.
- Repo-specific recommendation: do **not** default to autonomous spec creation or doc commits for this repo’s weekly maintenance MVP. Aigon’s write-path rules are strict, and several recent incidents were caused by producer/read-model drift. The safe default is read-only reporting plus optional nudges. If spec creation is ever enabled later, make it an explicit opt-in per repo and only for tightly-scoped tasks with dedupe guards.

### 3. The strongest repo-local maintenance signals already exist

- Security:
  - Aigon already has `gitleaks` + `semgrep` merge-gate scanning in `lib/security.js`.
  - `research-close`, `feature-close`, and `agent-status submitted` already run security gates.
  - `docs/security.md` documents GitHub-side complements: secret scanning, CodeQL, Dependabot.
- Telemetry / cost:
  - Normalized per-session telemetry already lands in `.aigon/telemetry/*.json` via `lib/telemetry.js`.
  - Weekly/monthly aggregates plus `perAgent` and `perTriplet` rollups already exist in `.aigon/cache/stats-aggregate.json` via `lib/stats-aggregate.js`.
- Workflow integrity:
  - The codebase explicitly treats missing workflow snapshots as a producer bug and points operators at `aigon doctor --fix`.
  - `aigon doctor --fix` is already the repair path for snapshot bootstrap and related integrity issues.
- Docs ownership:
  - The authoritative agent/context docs are `docs/aigon-project.md` -> scaffolded `AGENTS.md`, plus committed `docs/architecture.md` and `docs/development_workflow.md`.

### 4. Docs-gap detection should use git baselines, not file mtimes

- Best signal for “what changed since docs were last updated” is:
  1. Find the last commit touching the authoritative doc set for the topic.
  2. Diff `lib/`, `templates/`, and selected `docs/` paths from that commit to `HEAD`.
  3. Map changed code paths to doc owners and emit a report.
- Why this beats mtimes:
  - mtimes are noisy across rebases, copies, and generated files;
  - git commit baselines reflect actual reviewed changes;
  - the repo already uses git history as the durable record for workflow and doc drift.
- Concrete repo signal:
  - `docs/architecture.md` was updated in commit `c8f44545` on 2026-04-22.
  - `git diff --name-only c8f44545..HEAD -- lib templates docs` already gives the exact changed surface since that docs update.
- Recommendation:
  - For general docs gap scan, compare against the last commit touching `docs/architecture.md`, `docs/development_workflow.md`, `docs/aigon-project.md`, and `site/content/` when public docs are in scope.
  - Output a report of “changed code paths with no matching doc touch” rather than auto-editing docs.

### 5. Simplification scanning is viable, but mostly with lightweight heuristics in v1

- Repo fact: there is no ESLint config or duplication detector installed in `package.json`. Current dependencies are minimal (`xstate`, Playwright).
- Trivially addable tools:
  - ESLint `complexity` rule for cyclomatic complexity thresholds.
  - `jscpd` for duplication detection.
- Repo-native heuristics available immediately without adding tooling:
  - largest files in `lib/commands/` and `lib/`;
  - repeated branches / strings via `rg`;
  - hotspots by recent churn (`git log --stat`, `git diff --name-only`);
  - files repeatedly called out in docs/specs as “too large” or “god objects” (`lib/utils.js`, `lib/commands/feature.js`, `dashboard-server.js` all appear in historical docs/specs).
- Recommendation:
  - v1 simplification scan should be advisory only: produce a “top 3 refactor candidates” report with evidence.
  - Do not let it auto-create features in v1; complexity signals are high-noise and require judgment.

### 6. “Architecture docs refresh” should not be a weekly auto-edit in the MVP

- Repo fact: architecture drift is real, but the authoritative docs are curated documents, not generated artifacts.
- Repo fact: recent work already uses git-backed docs-gap features such as `feature-305-docs-gaps-post-feature-300-304`.
- Recommendation:
  - weekly job should detect stale architecture docs and propose edits;
  - actual doc-writing should remain human-reviewed, ideally through a normal feature or PR flow.
- Reason:
  - architecture prose needs synthesis, not just enumeration;
  - bad autonomous edits would create exactly the kind of “read path paved over missing producer” confusion this repo is trying to eliminate.

### 7. Security scanning should split into two categories

- Category A: existing repo-local code/security scanning
  - `gitleaks` + `semgrep` are already the right baseline for code and secret issues in this Node CLI.
  - These can run unattended locally if the binaries and rules are present.
  - Semgrep can also run with local YAML rules, which is the best unattended/offline mode.
- Category B: dependency/vulnerability scanning
  - `npm audit` and `npm outdated` are good weekly signals for a Node CLI.
  - These require registry/network access, so they are not offline.
  - GitHub advisory / Dependabot / CodeQL are complements, not replacements.
- Recommendation:
  - keep the existing per-submit merge gate for secrets/code issues;
  - add a separate weekly dependency/vulnerability report instead of duplicating the merge gate.

### 8. Some candidate tasks are stronger than the original four

- Strong recommend now:
  - `weekly-docs-gap-scan`
  - `weekly-dependency-vulnerability-sweep`
  - `weekly-workflow-state-integrity`
  - `weekly-cost-trend-report`
- Recommend, but lower priority / later:
  - `weekly-simplification-scan`
  - `weekly-stale-entity-sweep`
- Do as fast lint, not weekly:
  - `claude-md-agents-md-drift-lint`
- Defer:
  - `weekly-architecture-docs-refresh` as auto-writer
  - `weekly-test-suite-hygiene`
  - `weekly-branch-worktree-hygiene`
  - `weekly-memory-hygiene`
  - `weekly-feature-lifecycle-metrics`

### 9. Test hygiene lacks the instrumentation the research brief asked for

- Repo fact: `scripts/check-test-budget.sh` explicitly mentions “tests that haven’t caught a regression in months” as a deletion criterion.
- Repo fact: there is no current instrumentation that records which tests caught regressions, no mutation-testing pipeline, and no historical coverage trend store.
- Conclusion:
  - a real “hasn’t caught a regression in months” detector does **not** exist today;
  - weekly test-hygiene should be deferred until there is measurement, or reduced to much simpler signals (LOC, duplicate coverage suspicion, mock-heavy shape).

### 10. Cost reporting is already close to weekly-report-ready

- Repo fact:
  - raw per-session telemetry exists in `.aigon/telemetry/`;
  - aggregated `perAgent` and `perTriplet` cost/counter rollups already exist in `lib/stats-aggregate.js`;
  - research close also snapshots cost summaries from telemetry in `lib/commands/research.js`.
- Gap:
  - there is no scheduled report that ranks “expensive model/agent combinations per shipped work”.
- Recommendation:
  - add a weekly report over existing aggregates before building any new telemetry collection.

### 11. Group jobs into 2 buckets, not one giant runner and not 1 job per task

- One giant weekly job:
  - pro: simplest mental model;
  - con: one failure blocks everything, noisy output, longer runtime, harder retries.
- One job per task:
  - pro: isolation;
  - con: too much scheduling/config surface for this repo, more token overhead, more operator noise.
- Best fit for aigon:
  - 2 grouped jobs.
  - `weekly-repo-health`: docs gap, workflow integrity, stale entities, cost trend, simplification shortlist.
  - `weekly-dependency-security`: `npm audit`, `npm outdated`, optional semgrep/gitleaks report refresh.
- Implementation shape:
  - a small `scheduled-maintenance-runner` command or skill can own task selection and artifact formatting, while Claude Code Routines own the actual schedule.

### 12. Recommended output formats

- Docs gap: markdown report + optional nudge; no auto-edit in MVP.
- Simplification: markdown shortlist of top 3 candidates with evidence; no auto feature creation in MVP.
- Architecture refresh: report only, with suggested doc sections to update.
- Dependency/vulnerability sweep: markdown report ranked by severity; optional spec creation only after repo opt-in.
- Workflow integrity: markdown report plus “run `aigon doctor --fix`” guidance; no automatic repair from the routine unless explicitly opted in.
- Stale entities: nudge + markdown report, not specs.
- Cost trend: markdown report with top expensive triplets.

## Sources

### Repo-local

- `lib/commands/feature.js` — AutoConductor / detached tmux implementation
- `lib/security.js` — existing `gitleaks` + `semgrep` merge gate
- `docs/security.md` — security posture and GitHub complements
- `lib/telemetry.js` — normalized per-session telemetry under `.aigon/telemetry/`
- `lib/stats-aggregate.js` — weekly/monthly + `perAgent` / `perTriplet` cost rollups
- `lib/commands/research.js` — `research-close` cost snapshotting from telemetry
- `docs/architecture.md` — state architecture, `MISSING_SNAPSHOT`, doc ownership
- `scripts/check-test-budget.sh` — current test-budget policy and lack of instrumentation
- `package.json` — confirms no existing ESLint / duplication-detector dependency
- `git log -- docs/architecture.md docs/development_workflow.md docs/aigon-project.md`
- `git diff --name-only <last-doc-commit>..HEAD -- lib templates docs`

### External

- Claude Code Routines: https://code.claude.com/docs/en/web-scheduled-tasks
- Claude Code Desktop scheduled tasks: https://code.claude.com/docs/en/desktop-scheduled-tasks
- Claude Code session-scoped scheduling (`/loop`, `CronCreate`): https://code.claude.com/docs/en/scheduled-tasks
- npm audit: https://docs.npmjs.com/cli/v11/commands/npm-audit/
- npm outdated: https://docs.npmjs.com/cli/v11/commands/npm-outdated/
- ESLint complexity rule: https://eslint.org/docs/latest/rules/complexity
- Semgrep local CLI scans: https://semgrep.dev/docs/getting-started/cli
- Semgrep local rules: https://semgrep.dev/docs/running-rules
- jscpd docs: https://kucherenko.github.io/jscpd/modules/jscpd.html

## Recommendation

### Scheduling model

- Use Claude Code cloud routines (`/schedule`) for weekly unattended runs.
- Do **not** use `CronCreate` / `/loop` for weekly maintenance. It is session-scoped and expires after 7 days.
- Do **not** put scheduling inside Aigon itself for MVP. Let the routine own the cadence; let Aigon own the checks/report commands.

### Safe authority boundary

- MVP authority: read-only report generation plus nudges.
- No autonomous doc commits, no autonomous PR creation, and no autonomous `aigon feature-create` by default.
- If autonomous spec creation is added later, gate it behind explicit repo config and dedupe checks.

### MVP rollout order

1. `scheduled-maintenance-runner`
   - thin dispatcher/report formatter for grouped maintenance tasks
2. `weekly-docs-gap-scan`
   - strongest signal-to-noise ratio, directly useful, low write risk
3. `weekly-dependency-vulnerability-sweep`
   - complements existing merge-gate security without duplicating it
4. `weekly-workflow-state-integrity`
   - directly aligned with Aigon’s write-path discipline and existing `doctor --fix`
5. `weekly-cost-trend-report`
   - uses telemetry already collected; cheap to ship
6. `weekly-simplification-scan`
   - useful, but should stay advisory-only until heuristics prove reliable

### Execution-mode split

- Weekly scheduled job:
  - `weekly-docs-gap-scan`
  - `weekly-dependency-vulnerability-sweep`
  - `weekly-workflow-state-integrity`
  - `weekly-cost-trend-report`
  - `weekly-stale-entity-sweep` (phase 2)
  - `weekly-simplification-scan` (phase 2)
- Per-PR / per-commit lint:
  - `claude-md-agents-md-drift-lint`
- Manual-only:
  - `weekly-architecture-docs-refresh` as an auto-writer
- Deferred:
  - `weekly-test-suite-hygiene`
  - `weekly-branch-worktree-hygiene`
  - `weekly-memory-hygiene`
  - `weekly-feature-lifecycle-metrics`

### Call on the original four user-suggested tasks

1. **Docs gap scan**: yes, implement first.
2. **Security scan**: yes, but scope it to dependency/vulnerability reporting, because code/secret scanning already exists at merge gates.
3. **Simplification opportunities**: yes, but report-only and later than docs/security/integrity.
4. **Architecture docs refresh**: do not implement as an unattended writer in MVP; turn it into a docs-gap report that points humans at sections to update.

### Grouping choice

- Recommend **2 grouped jobs**, coordinated by `scheduled-maintenance-runner`:
  - `weekly-repo-health`
  - `weekly-dependency-security`
- This is the best trade-off for Aigon specifically:
  - lower operator noise than one-task-per-routine
  - better failure isolation than one giant weekly blob
  - less token overhead than many small routines

### Explicit call on autonomous spec creation

- Technically possible in Claude Code routines: yes.
- Recommended for this repo’s weekly maintenance MVP: **no**.
- Recommended future policy: only allow autonomous spec creation for severe, well-bounded machine-detectable findings, behind explicit opt-in config.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| scheduled-maintenance-runner | Add a small dispatcher/reporting surface that runs grouped maintenance checks and formats a single weekly artifact for routines. | high | none |
| weekly-docs-gap-scan | Compare code/template churn since the last authoritative docs commits and emit a markdown report of missing or stale docs updates. | high | scheduled-maintenance-runner |
| weekly-dependency-vulnerability-sweep | Run `npm audit` and `npm outdated`, rank findings by severity and upgrade pressure, and emit a weekly dependency/security report. | high | scheduled-maintenance-runner |
| weekly-workflow-state-integrity | Run workflow-integrity checks around snapshots and repair hints, surfacing anomalies with explicit `aigon doctor --fix` guidance. | high | scheduled-maintenance-runner |
| weekly-cost-trend-report | Summarize weekly cost and token usage from existing telemetry and stats aggregates, highlighting the most expensive agent/model/effort triplets. | medium | scheduled-maintenance-runner |
| weekly-simplification-scan | Produce an evidence-backed shortlist of the top refactor opportunities using file size, churn, and optional complexity/duplication tooling. | medium | scheduled-maintenance-runner |
| weekly-stale-entity-sweep | Flag inbox/backlog items older than a threshold and in-progress entities with no recent movement, producing a triage report or nudge. | medium | scheduled-maintenance-runner |
| claude-md-agents-md-drift-lint | Add a fast lint that checks instruction files for references to missing commands, files, or templates on every PR rather than weekly. | medium | none |
