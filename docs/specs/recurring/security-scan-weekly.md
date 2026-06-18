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
HIGH survivors auto-create feedback items. When the scan or digest recommends a concrete security remediation, create and prioritise a follow-up feature so the fix enters the normal backlog.

## Acceptance Criteria

- [ ] Run `aigon security-scan` and confirm exit 0
- [ ] Review digest at `.scan/reports/<date>.md`
- [ ] Triage any new HIGH-severity feedback items created
- [ ] If the scan reveals recommended security updates or other actionable remediation work, create and prioritise one or more follow-up features and record their IDs in the digest or implementation log
- [ ] If the scan reveals no actionable remediation work, state that clearly in the digest or implementation log
- [ ] Commit updated `.scan/state.json`

## Actionable Remediation Policy

Create and prioritise a follow-up feature when any of the following are true:

- `npm audit` or the final digest identifies a fixable HIGH or CRITICAL vulnerability
- The scan recommends a concrete dependency upgrade, pin, replacement, or removal
- The scan recommends a code or configuration hardening change
- The combined findings suggest the security gate, suppression set, or repository policy should change

Do not create follow-up features for false positives, accepted risk, or pure noise. The digest or implementation log should explain why a finding was ignored, deferred, or escalated.

## Technical Approach

1. Run `aigon security-scan` and confirm it completed successfully
2. Review `.scan/reports/<date>.md` for:
   - HIGH/CRITICAL survivors
   - dependency or package-security remediation recommendations
   - code/config hardening recommendations
3. Triage any newly created HIGH-severity feedback items
4. If follow-up work is required:
   - create the feature spec(s)
   - prioritise them immediately so they enter the normal backlog flow
   - record the created feature ID(s) in the digest or implementation log
5. If no follow-up work is required, state that explicitly in the digest or implementation log
6. Commit the updated scan state

## Pre-authorised

- Create and prioritise follow-up features without asking first when the findings meet the Actionable Remediation Policy above
