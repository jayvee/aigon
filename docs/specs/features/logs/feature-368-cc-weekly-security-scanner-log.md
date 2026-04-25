# Implementation Log: Feature 368 - weekly-security-scanner
Agent: cc

## Status
Submitted. All acceptance criteria met. Tests pass. Test budget within ceiling.

## New API Surface
- `aigon security-scan [--since <ref>] [--dry-run] [--no-llm] [--no-feedback] [--install-recurring]`
- `lib/security-scan/fingerprint.js` — `fingerprint(category, file, snippet)`, `normalize(snippet)`
- `lib/security-scan/triage.js` — `triage(findings, suppressions)`, CWE priors table
- `lib/security-scan/report.js` — `writeReport()`, `readState()`, `writeState()`, `readSuppressions()`
- `lib/security-scan/llm.js` — headless `claude --print /security-review` wrapper
- `lib/security-scan/runners/{gitleaks,osv,semgrep,npm-audit}.js` — one runner each, all gracefully skip if tool absent
- `lib/commands/security-scan.js` — dispatch + feedback creation

## Key Decisions
- **Identifier-before-string ordering in `normalize()`**: replacing identifiers first prevents the `_s_` placeholder from being re-matched by the identifier regex. Tests validate this contract.
- **Feedback deduplication by fingerprint**: before creating a feedback item, scan all feedback folders for an existing item containing the fingerprint string; skip if found.
- **Recurring registration via template file**, not programmatic state mutation — consistent with existing recurring infrastructure.

## Gotchas / Known Issues
- The `claude --print --output-format json "/security-review"` output format depends on the installed claude CLI version. `llm.js` handles both `Array` and `{ findings: Array }` shapes.
- `.scan/reports/` and `.scan/raw/` are gitignored (ephemeral); `.scan/state.json` and `.scan/suppressions.json` are committed.

## Explicitly Deferred
- aigon-pro coverage (out of scope for v1)
- Dashboard view for latest digest (feedback-only for v1)
- Semgrep custom rules (using registry packs only)

## For the Next Feature in This Set
None — standalone feature.

## Test Coverage
11 unit tests in `tests/commands/security-scan-fingerprint.test.js` covering `normalize()` and `fingerprint()` behaviour including the identifier-before-string normalization order. Test budget ceiling raised +40 LOC (pre-authorised).
