# Research Findings: weekly background maintenance tasks

**Agent:** Claude (cc)
**Research ID:** 36
**Date:** 2026-04-22

---

## Key Findings

### 1. Scheduling primitives — harness, not aigon

`CronCreate`, `RemoteTrigger`, and the `/schedule` skill are Claude Code harness
primitives (deferred tools). Nothing in `lib/`, `docs/`, `templates/`, `AGENTS.md`,
or `CLAUDE.md` implements or documents them as aigon-native. The `/schedule` skill
description explicitly says it is for "scheduled remote agents (routines) on a cron
schedule or once at a specific time" — i.e. hosted, independent of a local session.
`/loop` is the in-session variant and is **not** suitable for unattended weekly
maintenance because it requires the current conversation to remain open.

Implication: aigon does not need to build a scheduler; the harness already ships
one. The aigon-side work is everything the scheduled agent will *run* once it fires.

### 2. Only aigon-native "orchestrator" is AutoConductor, and it is feature-bound

`lib/commands/feature.js` `feature-autonomous-start __run-loop` (~L2820+) is a
detached-tmux orchestrator for a single feature's implement → review/eval → close
pipeline. It assumes a feature id, depends on agent status files in
`.aigon/state/feature-<id>-*.json`, and kills its own tmux session on completion.
**Not a fit** for weekly maintenance: no feature context, no tmux dependency wanted
in an unattended run, wrong state-file keying. A maintenance runner should be a
new thin orchestrator, not an AutoConductor adaptation.

### 3. Telemetry is rich enough for a cost trend report today

- `lib/telemetry.js` normalises cc JSONL, gg `~/.gemini/tmp/`, cx
  `~/.codex/sessions/` into a common `{agent, model, tokens, cost, turns, duration}`
  shape and holds a hand-maintained `PRICING` table (cache read 10%, write 125%).
- `lib/stats-aggregate.js` builds `.aigon/cache/stats-aggregate.json` with a
  `perTriplet` rollup keyed on `agent|model|effort` (AGENTS.md L80).
- `lib/analytics.js` builds completion series and weekly autonomy trend.

What is **missing** is a "cost per shipped feature, ranked, with
downgrade-candidate heuristic" view. This is aggregation on top of existing data,
not new instrumentation — a weekly agent can do it by reading the cache and
writing a markdown report to `docs/reports/cost-trend-YYYY-WW.md`.

### 4. Security already has merge-gate scanning; weekly work is only the gaps

`lib/security.js` + `lib/config.js` wire gitleaks and semgrep into
`feature-close`, `feature-submit`, `research-close`. Those run *every* close; a
weekly duplicate adds nothing. The genuine weekly gaps are:

- `npm audit` — not wired; ideal for a weekly scheduled agent (severity report).
- `npm outdated` — not wired; same pattern.
- Transitive-dependent counts and severity ranking — aggregate on top.

So "security scan" (user task 4) is better framed as **weekly dependency &
vulnerability sweep** (candidate 7) — the dedup win is clear.

### 5. `aigon doctor --fix` is the stale-state workhorse

`lib/commands/setup.js` `doctor --fix` (~L1952+) already reconciles
snapshotless inbox entities, slug→numeric mismatches, orphaned worktrees, missing
hooks. It is non-interactive and safe to run unattended. A scheduled agent should
invoke it (dry-run first, `--fix` second) rather than reimplementing the checks.
That covers **workflow-state-integrity** (candidate 12) and
**branch/worktree hygiene** (candidate 10) in a single existing command.

### 6. Stale entity detection — no existing logic, but signals are cheap

`workflow-heartbeat.js` and `supervisor.js` only compute *live agent* liveness
(display-only; AGENTS.md L114–115). There is no existing "spec sitting in
`02-backlog/` for N weeks" check. Signals available:

- `fs.statSync` on `docs/specs/features/0N-*/feature-*.md` for file mtime.
- `.aigon/workflows/features/<id>/events.jsonl` for workflow-level transition
  timestamps (more accurate than file mtime).
- `git log --since=<date> -- <path>` for commit activity.

Cheap to build as a small analytics function in `lib/analytics.js`; no new
instrumentation needed.

### 7. CLAUDE.md / AGENTS.md drift should be per-PR, not weekly

Drift is a short-running string-level check (grep referenced paths/commands, verify
they still exist). It is cheap to run on every PR and expensive-to-debug when stale
for a week. Belongs in a `pre-push` or CI lint, not the weekly orchestrator.

Same logic applies to **test suite hygiene**: `check-test-budget.sh` is already the
per-push ceiling; deletion-candidate heuristics (coverage trend, duplicated
coverage) want per-PR feedback, not a Friday digest.

### 8. Docs gap scan is the weakest of the four user tasks

The ask is "compare what shipped since docs were last updated; surface missing
pages/screenshots." The signal (git log of `lib/` and `templates/` vs. last commit
to `docs/` or `site/content/`) is easy; the judgement (is this lib change
user-visible? does it need a screenshot?) is not. Empirically most `lib/*.js`
commits in recent history are internal refactors. Output quality would be low:
long list of "suspect" commits, mostly false positives. **Recommend defer until
we have a repository convention tagging commits as user-visible.**

Similarly, **architecture docs refresh**: the module map in `AGENTS.md` and
`docs/architecture.md` drifts slowly and the value of autonomous edits here is
low. Keep this as a manual periodic pass.

### 9. Unattended write authority — default to read-only reports

For the first rollout:

- **Reports only** (markdown in `docs/reports/` or nudges to the dashboard) for
  anything judgement-heavy (docs gaps, simplification candidates, cost trends).
- **Spec creation** only for tasks with sharp, unambiguous triggers
  (`npm audit` finds a CRITICAL; `aigon doctor --fix` reports a reproducible
  anomaly). Gate behind a config flag (`.aigon/config.json` `autoSpecCreation: true`)
  so repo owners opt in.
- **No autonomous commits or PRs** in v1. That upgrade only after we have a
  scheduled-run telemetry record proving low false-positive rates.

### 10. One orchestrator, not one cron per task

Arguments for grouping:
- Cost: one scheduled agent cold-start amortises across all checks.
- Single weekly digest is easier for the human to triage than N separate
  notifications.
- Shared repo state (freshly pulled `main`) and shared authentication.

Argument against: failure isolation. Mitigated by making each check a pure
function that returns a section and catches its own errors — one broken check
produces "⚠ failed" in the digest, others still run.

**Recommended shape:** one `scheduled-maintenance-runner` feature that runs the
enabled checks in sequence and writes a single
`docs/reports/maintenance-YYYY-WW.md` plus optional dashboard nudge. Each
individual check is a small exported function so they can also be run ad-hoc
from the CLI.

## Sources

- `AGENTS.md` (module map, state architecture, AutoConductor, write-path contract)
- `lib/commands/feature.js` `feature-autonomous-start` (~L2820+)
- `lib/commands/setup.js` `doctor --fix` (~L1952+)
- `lib/telemetry.js` (normalised telemetry + `PRICING`)
- `lib/stats-aggregate.js` (`perTriplet` rollup, cache shape)
- `lib/analytics.js` (completion series, autonomy trend)
- `lib/security.js` + `lib/config.js:246–260` (gitleaks/semgrep merge gate)
- `lib/workflow-heartbeat.js`, `lib/supervisor.js` (display-only liveness)
- `scripts/check-test-budget.sh` (test ceiling)
- Skill descriptions for `/schedule` and `/loop` (harness-level scheduling)
- Research topic itself for the candidate task list

## Recommendation

**Ship a single orchestrator feature first, with four checks enabled, reports only.**

1. `scheduled-maintenance-runner` (orchestrator) — one `/schedule` cron, weekly,
   fans out to the checks below, writes one digest to
   `docs/reports/maintenance-YYYY-WW.md`, nudges the dashboard. Per-check enable
   flags in `.aigon/config.json`. No autonomous spec creation in v1.

2. Bundled checks (in priority order):
   1. `weekly-dependency-vulnerability-sweep` — `npm audit` + `npm outdated` +
      severity ranking. Highest signal, lowest false-positive rate, subsumes
      user task 4 ("security scan").
   2. `weekly-workflow-state-integrity` — `aigon doctor` dry-run; flag anomalies.
      Reuses existing code; near zero new LOC.
   3. `weekly-stale-entity-sweep` — inbox/backlog/in-progress staleness using
      event-log timestamps. Small addition to `lib/analytics.js`.
   4. `weekly-cost-trend-report` — read `stats-aggregate.json` `perTriplet`,
      rank cost-per-feature, surface Opus→Sonnet downgrade candidates.

3. Per-PR lint (not weekly): `claude-md-agents-md-drift-lint` — cheap, belongs
   in a pre-push hook; a week of drift is too slow.

4. Defer explicitly: `weekly-docs-gap-scan`,
   `weekly-architecture-docs-refresh`, `weekly-simplification-scan`,
   `weekly-test-suite-hygiene`, `weekly-spec-quality-audit`,
   `weekly-memory-hygiene`, `weekly-feature-lifecycle-metrics`,
   `weekly-branch-worktree-hygiene` (subsumed by `doctor`).

**Autonomous write authority:** Reports only. Spec creation gated behind an
opt-in config flag and only permitted for the dependency sweep (sharp trigger:
CRITICAL/HIGH advisory). No autonomous commits or PRs.

**Scheduling:** One harness-level `CronCreate` targeting the
`scheduled-maintenance-runner` slash command, weekly. The `/loop` skill is
explicitly not the mechanism — it needs an open session.

**Why one orchestrator beats one-job-per-task here:** cost amortisation, single
digest for triage, shared pulled-`main` context, failure isolation preserved by
per-check try/catch. Four separate crons would quadruple cold-start cost and
scatter notifications with no benefit at this scale.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| scheduled-maintenance-runner | Weekly orchestrator that runs enabled maintenance checks, writes a single digest to `docs/reports/maintenance-YYYY-WW.md`, nudges dashboard; no autonomous spec creation by default | high | none |
| weekly-dependency-vulnerability-sweep | `npm audit` + `npm outdated` severity-ranked report; spec creation allowed for CRITICAL/HIGH behind opt-in config flag | high | scheduled-maintenance-runner |
| weekly-workflow-state-integrity | Wraps `aigon doctor` dry-run as a scheduled check; flags anomalies in the weekly digest | high | scheduled-maintenance-runner |
| weekly-stale-entity-sweep | Reads `.aigon/workflows/.../events.jsonl` timestamps; flags inbox/backlog/in-progress entities older than configurable threshold | medium | scheduled-maintenance-runner |
| weekly-cost-trend-report | Reads `stats-aggregate.json` `perTriplet` rollup; ranks cost-per-feature, surfaces Opus→Sonnet downgrade candidates | medium | scheduled-maintenance-runner |
| claude-md-agents-md-drift-lint | Per-PR pre-push lint verifying referenced files/commands/scripts still exist; NOT weekly | medium | none |
