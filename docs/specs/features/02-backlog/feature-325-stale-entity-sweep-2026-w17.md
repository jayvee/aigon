---
recurring_slug: weekly-stale-entity-sweep
complexity: low
recurring_week: 2026-W17
recurring_template: weekly-stale-entity-sweep.md
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-23T02:23:05.873Z", actor: "recurring/feature-prioritise" }
---

# stale-entity-sweep-2026-W17

## Summary

Scan inbox and backlog specs for features and research topics that have been sitting untouched for more than 3 weeks. Scan in-progress features for those with no commits in the last 7 days. Write a triage report to `docs/reports/stale-entities-{{YYYY-WW}}.md`. Close without evaluation when complete.

## Acceptance Criteria

- [ ] Scan `docs/specs/features/01-inbox/` and `02-backlog/` for specs older than 21 days (by file mtime or first git commit date)
- [ ] Scan `docs/specs/research-topics/01-inbox/` and `02-backlog/` same way
- [ ] Scan `docs/specs/features/03-in-progress/` for features with no commits touching their worktree in 7+ days
- [ ] Write findings to `docs/reports/stale-entities-{{YYYY-WW}}.md` with:
  - Stale inbox/backlog features: name, days since created/last touched, suggested action (prioritise, pause, or delete)
  - Stale in-progress features: feature ID, days since last commit, suggested action (nudge agent, reset, or close)
  - Overall count: "N stale items found" or "all items are active"
- [ ] Commit the report file
- [ ] Close the feature (no eval step needed)

## Technical Approach

1. For each spec file in `01-inbox/` and `02-backlog/`: get creation date via `git log --format=%aI --follow --diff-filter=A -- <file> | tail -1`
2. For in-progress features: check `git log --since="7 days ago" --oneline -- <worktree-path>` for recent commits
3. Classify each entity as active or stale with the age in days
4. Write `docs/reports/stale-entities-{{YYYY-WW}}.md`
5. `git add docs/reports/ && git commit -m "chore: stale entity sweep {{YYYY-WW}}"`
6. `aigon feature-close <ID>`

## Pre-authorised

- Skip eval step: this is a read-only sweep, no specs are modified or deleted
