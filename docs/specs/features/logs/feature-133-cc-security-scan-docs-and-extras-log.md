---
commit_count: 5
lines_added: 409
lines_removed: 2
lines_changed: 411
files_touched: 7
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
---
# Implementation Log: Feature 133 - security-scan-docs-and-extras
Agent: cc

## Plan

1. Add PostCommit hook to CC settings template (cc.json)
2. Implement `security-scan-commit` command in misc.js
3. Ensure install-agent hook merging handles PostCommit generically
4. Write comprehensive security documentation (docs/security.md)
5. Add `aigon doctor` check for GitHub secret scanning via gh CLI
6. Add tests for all new functionality

## Progress

- All 6 acceptance criteria implemented
- 21/21 security tests pass (5 new tests added)
- No test regressions (15 pre-existing failures unchanged)

## Decisions

- **PostCommit vs PreCommit for CC hook**: Used PostCommit because Claude Code's PostCommit event fires after the commit is made. This means it warns rather than blocks, but crucially it runs outside git's mechanism — `--no-verify` cannot bypass it. The warning includes remediation steps (amend commit, rotate credential).

- **Single security doc vs separate files**: Combined all GitHub setup guides (push protection, CodeQL, Dependabot) into a single `docs/security.md` that documents the full four-layer defense approach. This gives users one place to understand the complete security posture.

- **Gitleaks commit scan command**: Used `gitleaks git --log-opts="-1"` for PostCommit scanning (scans the git log of the last commit) rather than the snapshot-based approach used by the merge gate. This is more appropriate for per-commit scanning — the merge gate scans the full diff vs default branch.

- **Doctor check is non-fixable**: GitHub secret scanning requires admin access and cannot be auto-fixed by `aigon doctor --fix`. The check reports status and provides a direct link to the settings page.

- **Configurable commit scan command**: Added `scannerDefs.gitleaks.commitCommand` as a separate config key from the merge-gate `command`, since they use different gitleaks modes (git log vs file scan).

## Code Review

**Reviewed by**: cx
**Date**: 2026-03-22

### Findings
- `mergeSecurityConfig()` only merged `scannerDefs` one level deep, so setting `security.scannerDefs.gitleaks.commitCommand` removed the default `gitleaks.command` used by the merge gate.
- `security-scan-commit` hard-coded its binary availability check to `gitleaks`, which made the new configurable `commitCommand` ineffective for alternate wrappers or binary names.

### Fixes Applied
- Preserved nested scanner definition fields when merging `scannerDefs`, so `commitCommand` can be added without breaking merge-gate scanning.
- Updated `security-scan-commit` to derive the binary check from the configured command and added a regression test covering the `commitCommand` merge case.

### Notes
- Focused validation passed with `node lib/security.test.js`.
- The full repository test suite still has unrelated pre-existing failures, matching the implementation log.
