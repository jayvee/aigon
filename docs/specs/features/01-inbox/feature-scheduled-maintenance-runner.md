# Feature: scheduled-maintenance-runner

## Summary
Thin dispatcher/report-formatter that runs a configured set of weekly maintenance checks and writes a single markdown digest to `docs/reports/maintenance-YYYY-WW.md`. Designed to be triggered by a Claude Code cloud routine (`/schedule`), not by any aigon-internal scheduler. Each enabled check is a small pure function that returns a report section; runner catches per-check errors so one broken check produces a "⚠ failed" subsection while others still run. No autonomous spec creation, commits, or PRs in v1.

## User Stories
- [ ] As a maintainer, I can enable/disable individual maintenance checks in `.aigon/config.json` without editing code.
- [ ] As a maintainer, I get one weekly digest file I can skim, rather than N scattered notifications.
- [ ] As a maintainer, I can run any individual check ad-hoc from the CLI for debugging (`aigon maintenance-run --check dependency-sweep`).

## Acceptance Criteria
- [ ] New command `aigon maintenance-run` runs all checks enabled in config; `--check <name>` runs one; `--dry-run` prints the digest without writing.
- [ ] Each check registers via a small interface: `{ name, run(ctx) -> { section: markdown, errors?: [] } }`.
- [ ] Per-check try/catch ensures one failure does not abort the run; failed checks render "⚠ <name>: <error>" in the digest.
- [ ] Output written to `docs/reports/maintenance-YYYY-WW.md` (ISO week). Overwrites same-week file on re-run.
- [ ] Config shape: `.aigon/config.json` `maintenance: { enabled: [check names], reportPath?: string }`. Default enabled list is empty (opt-in per-check).
- [ ] Optional dashboard nudge after run completes (behind `maintenance.nudge: true`).
- [ ] No git commits, no spec creation, no PR creation from this runner in v1.
- [ ] Documented `/schedule` routine example in `docs/development_workflow.md` showing how to wire a weekly cloud routine to `aigon maintenance-run`.

## Validation
```bash
node -c aigon-cli.js
npm test
```

## Pre-authorised

## Technical Approach
- New module `lib/maintenance.js` owns the runner, check registry, and digest formatter.
- New command in `lib/commands/infra.js` (or a new `lib/commands/maintenance.js` if the surface grows) — thin shim into `lib/maintenance.js`.
- Check registry is a plain object keyed on check name; individual check implementations live in `lib/maintenance/checks/<name>.js` so each feature can ship its own file without touching the runner.
- Runner pulls fresh `git pull --ff-only` *only if* invoked with `--pull` (routines manage their own clone state; local runs often sit on a branch).
- Digest file uses ISO week numbering (`YYYY-WW`) so back-to-back runs in the same week overwrite rather than accumulate.
- No scheduling logic lives in aigon — cloud routine is the trigger; aigon owns the check commands.

## Dependencies
- none (this is the orchestrator; check features depend on it)

## Out of Scope
- Implementing any of the individual checks (shipped as separate features).
- Scheduling / cron primitives — delegated to Claude Code cloud routines.
- Autonomous writes beyond the digest file (no `feature-create`, no commits, no PRs).
- Cross-repo fan-out (aigon only for v1).

## Open Questions
- Should the digest file be committed automatically, or left uncommitted for the user to review and commit? **Lean uncommitted** for v1 to preserve read-only posture.
- Should dashboard nudge link to the digest file, or embed a summary? Start with file link.

## Related
- Research: `docs/specs/research-topics/04-in-evaluation/research-36-weekly-background-maintenance-tasks.md`
- Dependent features: `weekly-dependency-vulnerability-sweep`, `weekly-docs-gap-scan`
