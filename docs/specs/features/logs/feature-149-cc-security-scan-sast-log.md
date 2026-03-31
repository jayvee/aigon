---
commit_count: 5
lines_added: 352
lines_removed: 7
lines_changed: 359
files_touched: 5
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: true
---
# Implementation Log: Feature 149 - security-scan-sast
Agent: cc

## Plan

Extend the existing pluggable scanner architecture (from feature 120) to support Semgrep as a SAST scanner. The approach:
1. Add semgrep scanner definition to DEFAULT_SECURITY_CONFIG with JSON output format
2. Implement structured JSON parsing for semgrep output with severity-aware logic
3. Extend runSecurityScan to handle the new outputFormat field in scanner defs
4. Add eslint-plugin-security recommendation to aigon init for web/api profiles
5. Write comprehensive tests

## Progress

- [x] Added semgrep to DEFAULT_SECURITY_CONFIG scannerDefs and mergeGateStages
- [x] Implemented parseSemgrepOutput() — parses JSON, classifies by severity threshold
- [x] Implemented formatSemgrepFindings() — terminal display with severity icons and BLOCK/warn labels
- [x] Extended runSecurityScan to handle semgrep-json outputFormat in both success and error paths
- [x] Added eslint-plugin-security recommendation in init for web/api profiles with ESLint config detection
- [x] Graceful degradation verified (existing isBinaryAvailable pattern works for semgrep)
- [x] 16 new tests added, all 37 tests passing

## Decisions

- **Semgrep on featureClose + featureSubmit, not researchClose**: Research specs don't contain code, so SAST scanning is unnecessary there.
- **Severity threshold default is 'high'**: Only ERROR-level findings block the merge gate by default. WARNING findings are displayed but don't block. Users can tighten to 'medium' via config override.
- **JSON output format**: Using `--json` flag for machine-parseable output rather than human-readable text. This enables structured severity filtering and clean terminal formatting.
- **120s timeout for semgrep**: Semgrep can take longer than gitleaks (especially on first run with rule downloads), so increased timeout from 60s to 120s.
- **outputFormat field in scannerDefs**: Introduced a general pattern for scanner-specific output handling, not hardcoded to semgrep. Future scanners can define their own outputFormat.
- **eslint-plugin-security as recommendation only**: Just a tip during init, not auto-installed, since it's an ESLint plugin the user must configure in their own config.

## Code Review

**Reviewed by**: gemini
**Date**: 2026-03-26

### Findings
- Found a potential terminal formatting issue where newlines in semgrep messages would break the indentation and readability of the output.
- Other parts of the implementation (JSON parsing, severity handling, config integration) are solid and well-tested.

### Fixes Applied
- fix(review): clean newlines in semgrep messages for terminal display (35fb3dd0)

### Notes
- The implementation is robust and follows the pluggable scanner pattern correctly.
- Recommend merging once the fix is verified by the user.
