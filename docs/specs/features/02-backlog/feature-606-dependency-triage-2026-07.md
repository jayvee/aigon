---
recurring_slug: weekly-dependency-triage
complexity: low
recurring_month: 2026-07
recurring_template: weekly-dependency-triage.md
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-01T01:23:39.960Z", actor: "recurring/feature-prioritise" }
---

# dependency-triage-2026-07

## Summary

Run the weekly dependency and package-supply-chain triage for the Aigon repo. Capture the current dependency-security signals, write a concise report to `.aigon/reports/dependency-triage-2026-W27.md`, and create + prioritise follow-up features only when the findings require code or dependency changes.

This is a triage task, not an auto-upgrade task. Do not update dependencies directly inside this recurring feature unless the spec is explicitly revised to ask for that.

## Acceptance Criteria

- [ ] Run `npm audit --omit=dev --json` and capture the result, even if vulnerabilities are found
- [ ] Run `npm run security:package-config`
- [ ] Run `npm run security:suspicious-deps`
- [ ] Write `.aigon/reports/dependency-triage-2026-W27.md` with a concise summary of actionable findings and raw command outcomes
- [ ] If the scan reveals actionable work, create and prioritise one or more follow-up features and record their IDs in the report
- [ ] If the scan reveals no actionable work, state that clearly in the report and do not create follow-up features
- [ ] Close the feature without a separate eval step

## Actionable Findings Policy

Create and prioritise a follow-up feature when any of the following are true:

- `npm audit` reports a HIGH or CRITICAL vulnerability affecting a production dependency
- `npm audit` reports a fixable MODERATE vulnerability in a direct runtime dependency and the fix looks realistic for Aigon
- `security:package-config` fails
- `security:suspicious-deps` surfaces a dependency or package family that needs investigation, replacement, pinning, or explicit allowlisting
- The combined findings suggest the release gate or dependency policy should change

Do not create follow-up features for pure noise. The report should explain why a finding was ignored, deferred, or escalated.

## Technical Approach

1. Run `npm audit --omit=dev --json 2>/dev/null || true` and summarise:
   - vulnerabilities by severity
   - affected direct runtime dependencies
   - whether `npm audit fix` claims a fix exists
2. Run `npm run security:package-config` and record pass/fail
3. Run `npm run security:suspicious-deps` and review:
   - suspicious package families
   - install-script-bearing dependencies
   - whether any entry is expected or needs investigation
4. Write `.aigon/reports/dependency-triage-2026-W27.md` with:
   - headline summary
   - actionable findings
   - ignored / expected findings
   - follow-up feature IDs created this run, if any
   - raw command outputs or concise excerpts
5. If follow-up work is required:
   - create the feature spec(s)
   - prioritise them immediately so they enter the normal backlog flow
6. `aigon feature-close <ID>` after the report and any follow-up feature creation are complete

## Pre-authorised

- Skip eval step: this is a triage/reporting task
- Create and prioritise follow-up features without asking first when the findings meet the Actionable Findings Policy above
