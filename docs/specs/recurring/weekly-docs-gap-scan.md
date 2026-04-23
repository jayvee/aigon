---
schedule: weekly
name_pattern: docs-gap-scan-{{YYYY-WW}}
recurring_slug: weekly-docs-gap-scan
complexity: low
---

# docs-gap-scan-{{YYYY-WW}}

## Summary

Diff `lib/` and `templates/` changes since the last commit that touched the authoritative docs (`AGENTS.md`, `docs/architecture.md`, `docs/development_workflow.md`). Write a gap report to `docs/reports/docs-gap-{{YYYY-WW}}.md` listing any undocumented modules, functions, or patterns. Close without evaluation when complete.

## Acceptance Criteria

- [ ] Find the most recent commit that modified `AGENTS.md`, `docs/architecture.md`, or `docs/development_workflow.md`
- [ ] Diff `lib/` and `templates/` changes since that commit
- [ ] Write findings to `docs/reports/docs-gap-{{YYYY-WW}}.md` with:
  - Files changed in `lib/` or `templates/` since last doc commit
  - Any new modules, functions, or patterns not mentioned in the authoritative docs
  - Recommended documentation updates
- [ ] Commit the report file
- [ ] Close the feature (no eval step needed)

## Technical Approach

1. Find last doc commit: `git log --format=%H -1 -- AGENTS.md docs/architecture.md docs/development_workflow.md`
2. List changed files: `git diff --name-only <commit>..HEAD -- lib/ templates/`
3. For each changed file, check if it is referenced in any of the three authoritative docs
4. Write `docs/reports/docs-gap-{{YYYY-WW}}.md` with findings
5. `git add docs/reports/ && git commit -m "chore: docs-gap report {{YYYY-WW}}"`
6. `aigon feature-close <ID>`

## Pre-authorised

- Skip eval step: this is a reporting task with no code changes requiring review
