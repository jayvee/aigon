---
recurring_slug: weekly-workflow-state-integrity
complexity: low
recurring_week: 2026-W31
recurring_template: weekly-workflow-state-integrity.md
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-26T23:21:37.217Z", actor: "recurring/feature-prioritise" }
---

# workflow-state-integrity-2026-W31

## Summary

Run `aigon doctor` across all registered repos and write a state-health report to `.aigon/reports/workflow-state-2026-W31.md`. Surface snapshotless inbox entities, slug/numeric mismatches, and port conflicts without applying fixes. Close without evaluation when complete.

## Acceptance Criteria

- [ ] Run `aigon doctor` for the aigon repo and capture output
- [ ] Run `aigon doctor` for all repos listed in `~/.aigon/config.json` `repos` array
- [ ] Write findings to `.aigon/reports/workflow-state-2026-W31.md` with:
  - Per-repo: count of anomalies found (or "clean")
  - List of any snapshotless inbox/backlog specs
  - List of any slug/numeric ID mismatches
  - Port conflicts if any
  - Recommended action: "nothing to fix" or "run `aigon doctor --fix` on <repo>"
- [ ] Close the feature (no eval step needed)

## Technical Approach

1. Read `~/.aigon/config.json` to get the list of registered repos
2. For each repo: run `aigon doctor` and capture stdout
3. Parse output for anomaly counts and specific issues
4. Write `.aigon/reports/workflow-state-2026-W31.md`
5. `aigon feature-close <ID>` — report is gitignored, no separate commit needed

## Pre-authorised

- Skip eval step: this is a read-only diagnostic report, no state is modified
