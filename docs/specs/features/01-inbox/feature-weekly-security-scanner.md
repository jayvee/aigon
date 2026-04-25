---
complexity: high
agent: cc
---

# Feature: weekly-security-scanner

## Summary

A weekly, layered security scan of the Aigon repo that combines deterministic SAST/secret/dependency tools with a deep LLM review of code changed since the previous successful scan. Findings flow through a fingerprint-based dedup/suppression layer, and HIGH-severity survivors auto-create Aigon `feedback` items via `afbc`. The scan is invokable on demand (`aigon security-scan`) and registered as a recurring routine via the existing `lib/commands/recurring.js` infrastructure so it runs every Monday morning unattended. Scope for v1 is the `aigon` repo only; `aigon-pro` is explicitly out of scope.

## User Stories
- [ ] As the maintainer, every Monday I get a curated digest of new security findings introduced by the previous week's commits, with no more than 10 items, each containing a concrete exploit scenario and a file:line taint chain.
- [ ] As the maintainer, I can run `aigon security-scan` on demand against the current branch to preview the report I'd get on Monday.
- [ ] As the maintainer, I can mark a finding as a false positive once and never see it again — the suppression is committed to the repo and shared with future scans.
- [ ] As a future contributor, I can read `docs/security-scanner.md` and understand exactly which tools run, which prompt is used, and how to triage findings.

## Acceptance Criteria
- [ ] `aigon security-scan [--since <ref>] [--dry-run] [--no-llm] [--no-feedback]` exits 0 with a JSON report at `.scan/reports/<ISO-date>.json` and a human-readable digest at `.scan/reports/<ISO-date>.md`.
- [ ] Default `--since` is the SHA recorded in `.scan/state.json` from the last successful scan; on first run it falls back to `HEAD~50` and writes the new SHA on completion.
- [ ] The deterministic layer runs and aggregates output from: `gitleaks detect`, `osv-scanner scan source`, `semgrep --config=p/javascript --config=p/owasp-top-ten --config=p/nodejsscan`, and `npm audit --omit=dev --audit-level=high --json`. Each tool's raw output is stashed under `.scan/raw/<tool>.<ext>` for forensic review. Missing tools are skipped with a clear warning, not a hard failure.
- [ ] The LLM layer runs the prompt defined in `templates/security-scanner/prompt.md` against the diff `<since>..HEAD` filtered to `*.{js,ts,jsx,tsx,mjs,cjs}` excluding `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`, `**/__mocks__/**`, `node_modules/**`, `.scan/**`, and emits structured JSON findings with `fingerprint`, `category`, `severity`, `confidence`, `file`, `line`, `taint_chain`, `exploit_scenario`, `recommendation`, `sibling_pattern`.
- [ ] A two-stage Anthropic-style pipeline is used: a generator pass (confidence floor 0.7) followed by a per-finding critic pass that must keep confidence ≥0.8 to survive.
- [ ] Fingerprints are computed deterministically as `sha256(category | file | normalize(line_snippet))` where `normalize()` strips whitespace, replaces variable identifiers with `_v_`, and replaces string literals with `"_s_"`. Implementation lives in `lib/security-scan/fingerprint.js` with unit tests covering identifier and string normalization.
- [ ] `.scan/suppressions.json` is honored: any finding whose fingerprint appears with `status: "fp"` or `status: "accepted_risk"` is dropped before the digest is built. Unknown statuses are treated as `open` (i.e., kept).
- [ ] The digest caps at 10 findings ranked by severity then confidence; overflow is summarized as a single line `N additional findings — see .scan/reports/<date>.json`.
- [ ] HIGH-severity survivors auto-create `aigon feedback` items via the existing `lib/commands/feedback.js` programmatic API (not by shelling out to `afbc`), with body containing the finding's fingerprint so re-runs do not create duplicates.
- [ ] The scan is registered with `lib/commands/recurring.js` as `security-scan-weekly`, cron `0 6 * * 1` (Monday 06:00 local), and visible in `aigon recurring list`.
- [ ] `docs/security-scanner.md` documents: prompt source-of-truth path, exclusion list, suppression workflow, "how to add a new SAST tool", and "how to disable the LLM layer for cost reasons".
- [ ] `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh` passes.

## Validation
```bash
node --check aigon-cli.js
node -e "require('./lib/security-scan/fingerprint.js')"
aigon security-scan --dry-run --no-llm --no-feedback
```

## Pre-authorised
- May raise `scripts/check-test-budget.sh` CEILING by up to +60 LOC if new fingerprint/triage unit tests require it.
- May add `gitleaks`, `osv-scanner`, `semgrep` as optional system-level dependencies documented in `docs/security-scanner.md` (no `package.json` changes required — these are CLI tools).
- May commit a starter `.scan/suppressions.json` with `[]` and a starter `.scan/state.json` so the first run is well-defined.

## Technical Approach

### Layout
- `lib/commands/security-scan.js` — dispatch entry point wired into `aigon-cli.js`.
- `lib/security-scan/runners/{gitleaks,osv,semgrep,npm-audit}.js` — one runner per tool, each exporting `async run(opts) → { findings: [...], raw: <buffer> }`. Runners detect tool availability (`which <tool>`) and return `{ skipped: true, reason }` if missing.
- `lib/security-scan/llm.js` — invokes Claude (via the existing agent wiring) with the prompt template, parses JSON, runs the critic pass.
- `lib/security-scan/fingerprint.js` — deterministic normalization + SHA256.
- `lib/security-scan/triage.js` — applies suppressions, per-CWE confidence priors, severity sort, top-10 cap.
- `lib/security-scan/report.js` — writes `.scan/reports/<date>.{json,md}` and updates `.scan/state.json`.
- `templates/security-scanner/prompt.md` — the LLM prompt (full text below in the **Prompt template** sub-section).
- `docs/security-scanner.md` — operator docs.

### Prompt template (paste-ready, lives at `templates/security-scanner/prompt.md`)

The prompt is the synthesis of Anthropic's published `/security-review` skill exclusion list, Vulnhuntr's per-CWE focus areas, and Node-specific sinks. Key elements: role-priming as a senior AppSec engineer, three-phase methodology (context → comparative → per-file taint), 13-line hard exclusion list (DoS/ReDoS, client-side framework code, path-only SSRF, etc.), strict JSON output schema, confidence floor 0.8, and a final two-stage orchestration block (generator → per-finding critic). Categories explicitly enumerated: injection (SQL/NoSQL/template/proto-pollution/command), AuthN/AuthZ (JWT alg=none, IDOR via sibling-route comparison), SSRF (host/protocol-controlled only), deserialization gadgets, crypto misuse (weak algos, predictable IVs, `Math.random()` for tokens, missing constant-time compare), secrets new-in-diff that gitleaks missed, file-handling (zip-slip, path traversal). Full text drafted during research and committed alongside the implementation.

### Per-CWE confidence priors (in `triage.js`)
- React/JSX XSS without `dangerouslySetInnerHTML`: ×0.5
- Path-only SSRF: ×0.0 (drop)
- Prototype pollution without demonstrated gadget: ×0.3
- SQLi via parameterised ORM: ×0.2
- Authz missing on endpoint adjacent to authz-checked sibling: ×1.2

### State files
- `.scan/state.json` — `{ "lastScanSha": "<sha>", "lastScanIso": "<date>", "version": 1 }`. Committed.
- `.scan/suppressions.json` — array of `{ fingerprint, status, note, expires? }`. Committed.
- `.scan/reports/` — gitignored; ephemeral.
- `.scan/raw/` — gitignored; ephemeral.

### Scheduling
Uses the existing `lib/commands/recurring.js` machinery. Registration happens via `aigon security-scan --install-recurring` (idempotent). Cron `0 6 * * 1`. State stored in `.aigon/recurring-state.json` per existing convention.

### Cost / model selection
Defaults to Claude Sonnet for the generator pass and Sonnet for the critic — Opus is overkill for a recurring scan. Operator can override via `aigon security-scan --model opus`. Token budget capped at ~50K input per generator call; if the diff exceeds that, the diff is split per-file and runners fan out (preserves the single-file taint analysis Vulnhuntr-style).

### Why this is `complexity: high`
- New top-level CLI command + new subdirectory under `lib/`.
- Touches `aigon-cli.js` dispatch, `lib/commands/recurring.js` registration, and `lib/commands/feedback.js` programmatic create — three engine modules.
- Introduces a state contract (`.scan/state.json`, `.scan/suppressions.json`) the read-path (digest builder) assumes — must follow the **Write-path contract** rule from `CLAUDE.md`.
- Prompt engineering needs care; getting the exclusion list wrong creates fatigue and the feature will be ignored within a month.

## Dependencies
- Existing `lib/commands/recurring.js` (cron registration).
- Existing `lib/commands/feedback.js` (programmatic `feedback-create` API).
- System tools (optional, runners gracefully skip if missing): `gitleaks`, `osv-scanner`, `semgrep`. Documented as "install via brew" in `docs/security-scanner.md`.
- No new npm packages.

## Out of Scope
- **`aigon-pro` repo coverage.** v1 is `aigon` only. A separate feature can extend after v1 lands.
- **DAST / runtime testing.** No ZAP, no nuclei, no live HTTP probing of the dashboard. Static analysis + LLM review only.
- **Auto-fixing findings.** The scanner reports; humans fix.
- **Multi-model voting** (running both Claude and another LLM for agreement). Single-model two-stage pipeline only for v1.
- **Custom semgrep rules.** Use registry packs only.
- **PR-time scans.** This is a *weekly* digest; per-PR review is a separate feature.
- **GitHub Actions integration.** Runs locally / via aigon recurring only — CI integration deferred.
- **Slack / email delivery.** Digest lives in `.scan/reports/` and the dashboard only.

## Open Questions
- Does the dashboard need a new view to surface the latest digest, or is "digest as feedback items" sufficient for v1? (Lean toward feedback-only for v1; dashboard view is a follow-up.)
- Should suppressions expire by default (e.g., 90 days) to force re-review? Or only expire when the operator sets `expires`?
- For the LLM call, should we route through the same agent-launching path features use (so it appears in the dashboard) or call the Anthropic SDK directly (lower overhead, but invisible to the agent UI)? Lean toward direct SDK call wrapped in a small adapter — recurring background work doesn't belong in the agent surface.

## Related
- Research: none (drafted from ad-hoc deep web research on LLM security review prompts, April 2026 — see commit message for source list).
- Set: standalone.
- Prior features in set: none.
