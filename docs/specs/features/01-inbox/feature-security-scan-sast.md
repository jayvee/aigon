# Feature: security-scan-sast

## Summary

Integrate Semgrep as the default SAST scanner at the merge gate, with configurable severity threshold. Optionally recommend `eslint-plugin-security` during `aigon init` for ESLint-based projects. Extends the merge gate from feature 2 with static analysis for OWASP Top 10 patterns in JavaScript/Node.js code.

## Acceptance Criteria

- [ ] Semgrep runs at `feature-close` merge gate alongside gitleaks
- [ ] Configurable severity threshold: block on high, warn on medium
- [ ] Semgrep scans only changed files (diff-aware, not full repo)
- [ ] JSON output parsed and presented clearly in terminal
- [ ] `aigon init` for web/api profiles recommends `eslint-plugin-security`
- [ ] Graceful degradation if semgrep not installed

## Dependencies

- Feature: security-scan-merge-gate (scanner runner infrastructure)
- External: semgrep (`brew install semgrep`)

## Related

- Research: #16 security-scanning
