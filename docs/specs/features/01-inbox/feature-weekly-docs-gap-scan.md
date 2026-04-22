# Feature: weekly-docs-gap-scan

## Summary
Weekly check that uses git baselines (not file mtimes) to surface code and template changes that have shipped without a matching update to the authoritative docs set (`AGENTS.md`, `docs/architecture.md`, `docs/development_workflow.md`, `docs/aigon-project.md`, `site/content/`). Produces a markdown report section of "changed code paths with no matching doc touch" — does not auto-edit docs. Mitigates cc's noise concern by reporting only, and cx's method (git-diff since last authoritative doc commit) gives sharp, reproducible output.

## User Stories
- [ ] As a maintainer, I see a weekly list of `lib/` and `templates/` changes since the last authoritative docs commit, so I know what the docs are lagging on.
- [ ] As a maintainer, I can configure which docs are considered authoritative (so the scan works identically in aigon-pro or a downstream).
- [ ] As a maintainer, I get a "no gaps" section on weeks when docs and code are in sync.

## Acceptance Criteria
- [ ] New check file `lib/maintenance/checks/docs-gap-scan.js` registers with the runner.
- [ ] Default authoritative-doc set: `AGENTS.md`, `docs/architecture.md`, `docs/development_workflow.md`, `docs/aigon-project.md`, `site/content/` (glob).
- [ ] Overridable via `.aigon/config.json` `maintenance.docsGapScan.authoritativeDocs: string[]`.
- [ ] Baseline commit = `git log -n1 --format=%H -- <each authoritative path>` — earliest of those is the conservative baseline.
- [ ] Diff: `git diff --name-only <baseline>..HEAD -- lib templates` → report section groups by top-level directory.
- [ ] Includes commit count per changed path (`git log --oneline <baseline>..HEAD -- <path>` count).
- [ ] Excludes files matching `maintenance.docsGapScan.ignore: string[]` (default empty).
- [ ] Explicit "no gaps" message when diff is empty.
- [ ] No auto-edit of docs, no `feature-create`, no commits.
- [ ] Test: use a seeded git repo fixture; assert baseline resolution and diff output shape.

## Validation
```bash
node -c aigon-cli.js
npm test
```

## Pre-authorised

## Technical Approach
- Pure function `run(ctx)` that shells out to `git` via `ctx.git` helpers.
- Baseline algorithm: collect the last-commit SHA touching each authoritative doc path; pick the oldest (most conservative) as the baseline so nothing is missed.
- Report shape:
  ```
  ## Docs Gap Scan

  Baseline: <sha> (<date>)
  Authoritative docs: <list>

  ### lib/ (N files, M commits)
  - lib/foo.js — 3 commits
  - ...

  ### templates/ (...)
  ```
- Future extension (out of scope v1): LLM-assisted "does this change look user-visible?" filter to reduce noise. v1 stays deliberately dumb — list everything, let the human judge.

## Dependencies
- depends_on: scheduled-maintenance-runner

## Out of Scope
- Auto-editing docs (explicitly deferred per research synthesis).
- LLM-based user-visibility classification.
- Screenshot freshness detection.
- Cross-repo scans (aigon-pro is a separate repo; its own scan would live there).
- Detecting stale code examples inside docs (separate feature).

## Open Questions
- Is `AGENTS.md` the single canonical baseline, or should each doc's last commit count independently? **v1**: take the oldest of all authoritative-doc last-commits as the baseline (conservative).
- Should `docs/specs/` be excluded from the scan? Yes — specs document features, not architecture; include via `ignore` list.

## Related
- Research: `docs/specs/research-topics/04-in-evaluation/research-36-weekly-background-maintenance-tasks.md`
- Depends on: `scheduled-maintenance-runner`
- Contrast: `claude-md-agents-md-drift-lint` (deferred candidate, per-PR not weekly)
