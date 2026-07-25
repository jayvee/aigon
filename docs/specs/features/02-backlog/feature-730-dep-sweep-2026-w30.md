---
recurring_slug: weekly-dep-sweep
complexity: low
recurring_week: 2026-W30
recurring_template: weekly-dep-sweep.md
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-25T13:13:42.728Z", actor: "recurring/feature-prioritise" }
---

# dep-sweep-2026-W30

## Summary

Run `npm audit` and `npm outdated` and write the findings to `.aigon/reports/dep-sweep-2026-W30.md`. Close without evaluation when complete.

## Acceptance Criteria

- [ ] Run `npm audit --json` and capture the output
- [ ] Run `npm outdated` and capture the output
- [ ] Write findings to `.aigon/reports/dep-sweep-2026-W30.md` with sections for audit results and outdated packages
- [ ] Close the feature (no eval step needed)

## Technical Approach

1. Run `npm audit --json 2>/dev/null || true` and parse the JSON
2. Run `npm outdated 2>/dev/null || true` and capture the text output
3. Write `.aigon/reports/dep-sweep-2026-W30.md` with:
   - Summary: total vulnerabilities by severity
   - Full `npm audit` output
   - Full `npm outdated` output
4. `aigon feature-close <ID>` — report is gitignored, no separate commit needed

## Pre-authorised

- Skip eval step: this is a reporting task with no code changes requiring review
