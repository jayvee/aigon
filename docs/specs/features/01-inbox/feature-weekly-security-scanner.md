---
complexity: medium
agent: cc
---

# Feature: weekly-security-scanner

## Summary

A weekly security scan of the Aigon repo that orchestrates Claude Code's native `/security-review` skill (the LLM layer) alongside deterministic SAST/secret/dependency tools (gitleaks, osv-scanner, semgrep, npm audit). Findings flow through a fingerprint-based dedup/suppression layer, and HIGH-severity survivors auto-create Aigon `feedback` items. The scan is invokable on demand (`aigon security-scan`) and registered as a recurring routine via the existing `lib/commands/recurring.js` infrastructure so it runs every Monday morning unattended. Scope for v1 is the `aigon` repo only; `aigon-pro` is explicitly out of scope.

**Design principle:** do not reinvent the LLM prompt. Anthropic ships `/security-review` with a hardened prompt (exclusion list, two-stage generator+critic pipeline, confidence floor) refined by millions of runs. We invoke it headlessly via `claude --print` and own only the orchestration, scoping, dedup, suppression, and routing layers around it.

## User Stories
- [ ] As the maintainer, every Monday I get a curated digest of new security findings introduced by the previous week's commits, with no more than 10 items.
- [ ] As the maintainer, I can run `aigon security-scan` on demand against the current branch to preview the report I'd get on Monday.
- [ ] As the maintainer, I can mark a finding as a false positive once and never see it again — the suppression is committed to the repo and shared with future scans.
- [ ] As the maintainer, when Anthropic improves the `/security-review` prompt, I get the improvements automatically without touching this repo.
- [ ] As a future contributor, I can read `docs/security-scanner.md` and understand which tools run, how scoping works, and how to triage findings.

## Acceptance Criteria
- [ ] `aigon security-scan [--since <ref>] [--dry-run] [--no-llm] [--no-feedback]` exits 0 with a JSON report at `.scan/reports/<ISO-date>.json` and a human-readable digest at `.scan/reports/<ISO-date>.md`.
- [ ] Default `--since` is the SHA recorded in `.scan/state.json` from the last successful scan; on first run it falls back to `HEAD~50` and writes the new SHA on completion.
- [ ] **Deterministic layer** runs and aggregates output from: `gitleaks detect`, `osv-scanner scan source`, `semgrep --config=p/javascript --config=p/owasp-top-ten --config=p/nodejsscan`, and `npm audit --omit=dev --audit-level=high --json`. Each tool's raw output is stashed under `.scan/raw/<tool>.<ext>` for forensic review. Missing tools are skipped with a clear warning, not a hard failure.
- [ ] **LLM layer** invokes Claude Code's native `/security-review` skill headlessly via `claude --print --output-format json "/security-review"` from a temporary worktree at the `--since` SHA's diff, captures the JSON output, and normalises each finding into the same shape as deterministic-layer findings. No custom prompt is shipped in this repo.
- [ ] If the `claude` CLI is missing or `--no-llm` is passed, the scan still produces a report from the deterministic layer alone — the LLM layer is opportunistic, not required.
- [ ] Fingerprints are computed deterministically as `sha256(category | file | normalize(line_snippet))` where `normalize()` strips whitespace, replaces variable identifiers with `_v_`, and replaces string literals with `"_s_"`. Implementation lives in `lib/security-scan/fingerprint.js` with unit tests covering identifier and string normalization. Same algorithm is applied to both deterministic and LLM findings so suppressions cross both layers.
- [ ] `.scan/suppressions.json` is honored: any finding whose fingerprint appears with `status: "fp"` or `status: "accepted_risk"` is dropped before the digest is built. Unknown statuses are treated as `open` (i.e., kept).
- [ ] Per-CWE confidence priors are applied in `lib/security-scan/triage.js` to compensate for known LLM over-confidence patterns (e.g., React JSX XSS ×0.5, prototype pollution without gadget ×0.3). The priors table is small, commented, and easy for the operator to tune.
- [ ] The digest caps at 10 findings ranked by severity then confidence; overflow is summarized as a single line `N additional findings — see .scan/reports/<date>.json`.
- [ ] HIGH-severity survivors auto-create `aigon feedback` items via the existing `lib/commands/feedback.js` programmatic API (not by shelling out), with the body containing the finding's fingerprint so re-runs do not create duplicate feedback items.
- [ ] The scan is registered with `lib/commands/recurring.js` as `security-scan-weekly`, cron `0 6 * * 1` (Monday 06:00 local), and visible in `aigon recurring list`.
- [ ] `docs/security-scanner.md` documents: how the LLM layer delegates to `/security-review`, the SAST tool list, the suppression workflow, and "how to disable the LLM layer for cost reasons".
- [ ] `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh` passes.

## Validation
```bash
node --check aigon-cli.js
node -e "require('./lib/security-scan/fingerprint.js')"
aigon security-scan --dry-run --no-llm --no-feedback
```

## Pre-authorised
- May raise `scripts/check-test-budget.sh` CEILING by up to +40 LOC if new fingerprint/triage unit tests require it.
- May add `gitleaks`, `osv-scanner`, `semgrep` as optional system-level dependencies documented in `docs/security-scanner.md` (no `package.json` changes required — these are CLI tools).
- May commit a starter `.scan/suppressions.json` with `[]` and a starter `.scan/state.json` so the first run is well-defined.

## Technical Approach

### Layout
- `lib/commands/security-scan.js` — dispatch entry point wired into `aigon-cli.js`.
- `lib/security-scan/runners/{gitleaks,osv,semgrep,npm-audit}.js` — one runner per tool, each exporting `async run(opts) → { findings: [...], raw: <buffer> }`. Runners detect tool availability (`which <tool>`) and return `{ skipped: true, reason }` if missing.
- `lib/security-scan/llm.js` — thin wrapper around `claude --print --output-format json "/security-review"`. Spawns the CLI in a child process, captures stdout JSON, normalises to the common finding shape. ~60 LOC; no prompt content lives here.
- `lib/security-scan/fingerprint.js` — deterministic normalization + SHA256.
- `lib/security-scan/triage.js` — applies suppressions, per-CWE confidence priors, severity sort, top-10 cap.
- `lib/security-scan/report.js` — writes `.scan/reports/<date>.{json,md}` and updates `.scan/state.json`.
- `docs/security-scanner.md` — operator docs.

**No `templates/security-scanner/prompt.md`** — the prompt lives inside the `claude` CLI's `/security-review` skill. Prompt improvements ship with `claude` updates.

### Per-CWE confidence priors (in `triage.js`)
- React/JSX XSS without `dangerouslySetInnerHTML`: ×0.5
- Path-only SSRF: ×0.0 (drop)
- Prototype pollution without demonstrated gadget: ×0.3
- SQLi via parameterised ORM: ×0.2
- Authz missing on endpoint adjacent to authz-checked sibling: ×1.2

These compensate for systematic LLM over-confidence without forking the underlying prompt.

### State files
- `.scan/state.json` — `{ "lastScanSha": "<sha>", "lastScanIso": "<date>", "version": 1 }`. Committed.
- `.scan/suppressions.json` — array of `{ fingerprint, status, note, expires? }`. Committed.
- `.scan/reports/` — gitignored; ephemeral.
- `.scan/raw/` — gitignored; ephemeral.

### Scoping the LLM layer
`/security-review` defaults to reviewing pending changes on the current branch. To scope it to "since last scan", we run it inside a temporary git worktree checked out at `<lastScanSha>` with the current `HEAD` cherry-picked or merged in, so the diff visible to the skill matches our scan window. Implementation detail: easier to just `git stash`-style overlay; if that proves brittle we fall back to passing the diff as context via `--print` stdin and a wrapper instruction. To be settled in the implementation iteration.

### Scheduling
Uses the existing `lib/commands/recurring.js` machinery. Registration happens via `aigon security-scan --install-recurring` (idempotent). Cron `0 6 * * 1`. State stored in `.aigon/recurring-state.json` per existing convention.

### Cost
Single `claude --print` invocation per weekly run; the underlying skill's two-stage pipeline (generator + critic) is Anthropic's responsibility. Operator can disable the LLM layer with `--no-llm` if cost matters.

### Why this is `complexity: medium`
- Single new top-level CLI command + one new subdirectory under `lib/`.
- Touches `aigon-cli.js` dispatch, `lib/commands/recurring.js` registration, and `lib/commands/feedback.js` programmatic create — three engine modules but each touch is small.
- New state contract (`.scan/state.json`, `.scan/suppressions.json`) the read-path (digest builder) assumes — must follow the **Write-path contract** rule from `CLAUDE.md`.
- No prompt engineering risk — that's delegated to the `/security-review` skill.

## Dependencies
- Existing `lib/commands/recurring.js` (cron registration).
- Existing `lib/commands/feedback.js` (programmatic `feedback-create` API).
- `claude` CLI on PATH for the LLM layer (already required for Aigon usage; confirms via `which claude`, skips with warning if absent).
- System tools (optional, runners gracefully skip if missing): `gitleaks`, `osv-scanner`, `semgrep`. Documented as "install via brew" in `docs/security-scanner.md`.
- No new npm packages.

## Out of Scope
- **`aigon-pro` repo coverage.** v1 is `aigon` only. A separate feature can extend after v1 lands.
- **Custom security-review prompt.** We delegate to Anthropic's `/security-review` skill and never fork it. If a category is too noisy, we filter post-hoc in `triage.js`.
- **DAST / runtime testing.** No ZAP, no nuclei, no live HTTP probing. Static + LLM only.
- **Auto-fixing findings.** The scanner reports; humans fix.
- **Multi-model voting.** Single Claude pass, optionally re-run by the operator.
- **GitHub Action integration** (`anthropics/claude-code-security-review`). Per-PR CI scanning is a separate feature; this one is the *weekly digest*.
- **Custom semgrep rules.** Use registry packs only.
- **Slack / email delivery.** Digest lives in `.scan/reports/` and via auto-created feedback items only.

## Open Questions
- Best mechanism to scope `/security-review` to "since last scan SHA" rather than "current branch diff" — temporary worktree vs. piping a pre-computed diff via `--print` stdin. To resolve in the implementation iteration with a quick spike.
- Should suppressions expire by default (e.g., 90 days) to force re-review? Or only expire when the operator sets `expires`? Lean toward "no default expiry; operator sets it explicitly".
- Do we need a dashboard view to surface the latest digest, or is "digest as feedback items" sufficient for v1? Lean feedback-only; dashboard view is a follow-up.

## Related
- Research: none (drafted from ad-hoc deep web research on LLM security review prompts and the `anthropics/claude-code-security-review` repo, April 2026).
- Set: standalone.
- Prior features in set: none.
