# Security Scanner

The `aigon security-scan` command runs a weekly security digest against the aigon repo, combining deterministic SAST/secret/dependency tools with Anthropic's `/security-review` LLM skill.

## How to run

```bash
# On-demand scan (defaults to commits since the last scan)
aigon security-scan

# Preview only — no files written, no feedback items created
aigon security-scan --dry-run

# Scope to a specific commit or ref
aigon security-scan --since <sha|ref>

# Skip the LLM layer (faster, saves cost)
aigon security-scan --no-llm

# Skip auto-creating feedback items
aigon security-scan --no-feedback

# Install the Monday 06:00 recurring schedule
aigon security-scan --install-recurring
```

## Tools that run

| Tool | What it scans | Required? |
|------|--------------|-----------|
| `gitleaks` | Secrets / credentials in tracked files | Optional (skipped if absent) |
| `osv-scanner` | Known CVEs in npm dependencies | Optional |
| `semgrep` | SAST: JavaScript, OWASP Top 10, Node.js | Optional |
| `npm audit` | Known vulnerabilities in direct/transitive deps | Always runs (npm is already required) |
| `claude /security-review` | LLM two-stage security review of the current diff | Optional (skipped if `claude` CLI is absent or `--no-llm` passed) |

Install optional tools via Homebrew:
```bash
brew install gitleaks
brew install osv-scanner
brew install semgrep
```

## How the LLM layer works

The LLM layer delegates entirely to Anthropic's built-in `/security-review` skill by running:

```
claude --print --output-format json "/security-review"
```

No custom prompt lives in this repo. Improvements to the skill (better coverage, smarter critic pipeline, updated exclusion lists) ship automatically with `claude` CLI updates.

The skill reviews the pending changes on the current branch. Its findings are normalised into the same shape as deterministic-layer findings so fingerprinting, suppression, and triage apply equally to both.

## How to disable the LLM layer for cost reasons

Pass `--no-llm` on the command line, or set a wrapper alias:

```bash
alias aigon-scan-cheap="aigon security-scan --no-llm"
```

The scan still produces a complete report from the deterministic tools.

## Scoping

By default, the scan covers commits since the SHA recorded in `.scan/state.json` from the last successful run. On the first run it falls back to `HEAD~50`. After a successful scan the current `HEAD` SHA is written back to `.scan/state.json`.

Pass `--since <sha|ref>` to override the scope explicitly.

## Fingerprinting and suppression

Every finding is assigned a deterministic fingerprint:

```
sha256(category | file | normalize(line_snippet))
```

`normalize()` strips whitespace, replaces variable identifiers with `_v_`, and replaces string literals with `"_s_"`. This makes fingerprints stable across minor code reformatting.

To suppress a false positive, add an entry to `.scan/suppressions.json`:

```json
[
  {
    "fingerprint": "<sha256-hex>",
    "status": "fp",
    "note": "This is a test fixture, not production code"
  }
]
```

Valid statuses:
- `fp` — false positive: never show again
- `accepted_risk` — acknowledged risk: never show again
- Any other status is treated as `open` (finding is shown)

Suppressions are committed to the repo and shared across all scan runs.

## Confidence priors

The triage layer adjusts LLM confidence scores to compensate for known over-confidence patterns:

| Pattern | Multiplier |
|---------|-----------|
| React/JSX XSS without `dangerouslySetInnerHTML` | ×0.5 |
| Path-only SSRF (no network call in context) | ×0.0 (drop) |
| Prototype pollution without demonstrated gadget | ×0.3 |
| SQLi via parameterised ORM | ×0.2 |
| Authz missing adjacent to authz-checked sibling | ×1.2 |

Priors are defined in `lib/security-scan/triage.js` and are easy to tune.

## Output

After each scan:
- `.scan/reports/<ISO-date>.json` — full machine-readable report
- `.scan/reports/<ISO-date>.md` — human-readable digest (capped at 10 findings)
- `.scan/raw/<tool>.<ext>` — raw tool output for forensic review
- `.scan/state.json` — updated with the current HEAD SHA

Reports and raw output are gitignored (ephemeral). `state.json` and `suppressions.json` are committed.

## Recurring schedule

Run `aigon security-scan --install-recurring` once to register the Monday 06:00 cron (`0 6 * * 1`) in `docs/specs/recurring/security-scan-weekly.md`. After that, `aigon recurring list` will show it.
