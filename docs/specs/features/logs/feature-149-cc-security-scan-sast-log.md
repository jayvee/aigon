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
