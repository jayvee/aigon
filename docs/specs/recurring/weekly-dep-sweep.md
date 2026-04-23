---
schedule: weekly
name_pattern: dep-sweep-{{YYYY-WW}}
recurring_slug: weekly-dep-sweep
complexity: low
---

# dep-sweep-{{YYYY-WW}}

## Summary

Run `npm audit` and `npm outdated` and write the findings to `docs/reports/dep-sweep-{{YYYY-WW}}.md`. Close without evaluation when complete.

## Acceptance Criteria

- [ ] Run `npm audit --json` and capture the output
- [ ] Run `npm outdated` and capture the output
- [ ] Write findings to `docs/reports/dep-sweep-{{YYYY-WW}}.md` with sections for audit results and outdated packages
- [ ] Commit the report file
- [ ] Close the feature (no eval step needed)

## Technical Approach

1. Run `npm audit --json 2>/dev/null || true` and parse the JSON
2. Run `npm outdated 2>/dev/null || true` and capture the text output
3. Write `docs/reports/dep-sweep-{{YYYY-WW}}.md` with:
   - Summary: total vulnerabilities by severity
   - Full `npm audit` output
   - Full `npm outdated` output
4. `git add docs/reports/ && git commit -m "chore: dep-sweep report {{YYYY-WW}}"`
5. `aigon feature-close <ID>`

## Pre-authorised

- Skip eval step: this is a reporting task with no code changes requiring review
