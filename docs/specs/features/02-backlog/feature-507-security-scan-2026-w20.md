---
recurring_slug: security-scan-weekly
complexity: low
cron: 0 6 * * 1
recurring_week: 2026-W20
recurring_template: security-scan-weekly.md
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-10T20:59:13.963Z", actor: "recurring/feature-prioritise" }
---

# security-scan-2026-W20

## Summary

Run the weekly security scan against the aigon repo.
Orchestrates gitleaks, osv-scanner, semgrep, npm audit, and the Claude /security-review skill.
HIGH survivors auto-create feedback items.

## Acceptance Criteria

- [ ] Run `aigon security-scan` and confirm exit 0
- [ ] Review digest at `.scan/reports/<date>.md`
- [ ] Triage any new HIGH-severity feedback items created
- [ ] Commit updated `.scan/state.json`
