---
schedule: weekly
name_pattern: security-scan-{{YYYY-WW}}
recurring_slug: security-scan-weekly
complexity: low
cron: 0 6 * * 1
---

# security-scan-{{YYYY-WW}}

## Summary

Run the weekly security scan against the aigon repo.
Orchestrates gitleaks, osv-scanner, semgrep, npm audit, and the Claude /security-review skill.
HIGH survivors auto-create feedback items.

## Acceptance Criteria

- [ ] Run `aigon security-scan` and confirm exit 0
- [ ] Review digest at `.scan/reports/<date>.md`
- [ ] Triage any new HIGH-severity feedback items created
- [ ] Commit updated `.scan/state.json`
