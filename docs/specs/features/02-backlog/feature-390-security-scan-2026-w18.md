---
recurring_slug: security-scan-weekly
complexity: low
cron: 0 6 * * 1
recurring_week: 2026-W18
recurring_template: security-scan-weekly.md
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-26T14:13:21.875Z", actor: "recurring/feature-prioritise" }
---

# security-scan-2026-W18

## Summary

Run the weekly security scan against the aigon repo.
Orchestrates gitleaks, osv-scanner, semgrep, npm audit, and the Claude /security-review skill.
HIGH survivors auto-create feedback items.

## Acceptance Criteria

- [ ] Run `aigon security-scan` and confirm exit 0
- [ ] Review digest at `.scan/reports/<date>.md`
- [ ] Triage any new HIGH-severity feedback items created
- [ ] Commit updated `.scan/state.json`
