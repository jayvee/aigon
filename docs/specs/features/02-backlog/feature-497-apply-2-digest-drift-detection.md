---
complexity: medium
research: 48
set: apply-model
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-10T09:01:55.501Z", actor: "cli/feature-prioritise" }
---

# Feature: apply-2-digest-drift-detection

## Summary

Switch the "this repo needs re-applying" trigger from a semver compare (`.aigon/version` vs CLI `package.json`) to a content-digest compare. Today, every CLI patch bump fires "🔄 Project sync needed" even when no template actually changed — training users to ignore the notice. After this feature, drift fires **only when CLI-emitted artifacts would actually change**: zero false positives. `.aigon/version` is retained as a human-readable applied-version stamp (provenance only), with no semantic load.

## User Stories

- [ ] As a customer, when I upgrade aigon from v2.65 → v2.66 and the new version only changed internal logic (no template edits), I see **no** "out of sync" notice in my repo. Silence is the reward.
- [ ] As a customer, when I upgrade aigon and templates/agent configs/slash commands actually changed, I see a notice that names the real delta ("4 files would change") — not a vague version-number comparison.
- [ ] As a customer, when I run `aigon apply` against an in-sync repo (digest matches), the apply is a no-op and reports zero changes. Same as `terraform apply` against in-sync state.

## Acceptance Criteria

- [ ] `.aigon/config-hash` is extended (or replaced by `.aigon/applied-digest`) to cover **all** CLI-emitted artifacts in the repo: vendored docs (`.aigon/docs/`), agent configs (`.claude/`, `.cursor/`, `.codex/`, `.gemini/`, `.agents/`), slash command files, hook payloads, install-manifest entries.
- [ ] `lib/profile-placeholders.js:computeInstructionsConfigHash()` (or its replacement) takes the full set of inputs the CLI would write and returns a stable digest.
- [ ] `aigon check-version` (and the SessionStart hook path it powers) compares the stored `.aigon/applied-digest` against `computeAppliedDigest(installedCli)`. Drift is reported iff digests differ.
- [ ] Semver compare in `check-version` is removed as the drift trigger. `.aigon/version` is still written by `aigon apply` (for `git log` provenance and the in-session notice's "applied at vX" line) but plays no role in deciding "is sync needed".
- [ ] `aigon apply` writes both `.aigon/version` (the CLI semver that just applied) **and** `.aigon/applied-digest` (the digest of what was applied) atomically.
- [ ] Drift report includes a short summary of *what* differs (e.g., "3 slash commands changed, 1 agent config changed") so the user can judge urgency.
- [ ] Existing repos with only `.aigon/config-hash` (today's narrower hash) auto-migrate to the broader digest on first `aigon apply` after this ships — no doctor command required.

## Validation

```bash
node --check lib/profile-placeholders.js
node --check lib/commands/setup.js
node --check lib/version.js
# Apply twice in a row with no CLI changes → second run reports no drift
aigon apply && aigon check-version | grep -q "current"
# Touch a template, expect drift on next check
touch templates/generic/commands/afn.md
aigon check-version | grep -q "out of date"
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets.

## Technical Approach

**Define the hashed input set.** Enumerate everything `aigon apply` writes into a target repo. Hash the *contents that would be written* (not the on-disk state of the target repo) so the digest represents "what the CLI would emit right now". Use SHA-256 over a canonical concatenation of `(relative_path, content_bytes)` tuples sorted by path.

**Storage.** Either extend `.aigon/config-hash` (rename internally if it makes the file's broadened scope clearer — e.g., `.aigon/applied-digest`) or write a new file alongside. Whichever, the file is written atomically with `.aigon/version` at the end of every successful `aigon apply`.

**Drift check.** Replace the semver compare in `check-version` with:

```js
const applied = readAppliedDigest(repoRoot);
const wouldEmit = computeAppliedDigest(installedCli, repoProfile);
const isDrifted = applied !== wouldEmit;
```

**Drift summary.** When digests differ, walk the input set and report which categories changed (slash commands / agent configs / vendored docs / hooks / install manifest). Used by the in-session notice in feature #3.

**Migration.** Any repo whose `.aigon/applied-digest` is missing OR whose `.aigon/config-hash` predates this feature: treat as "drift" on first check, prompt `aigon apply`, which writes the new digest. No special migration command needed.

## Dependencies

- depends_on: apply-1-rename-update-verb

## Out of Scope

- The in-session notice format (feature #3 — this feature provides the data, not the surface).
- The dashboard pill (feature #4 — same).
- Multi-repo `apply --all` (feature #5).
- Removing `.aigon/version`. It stays for human-readable provenance.

## Open Questions

- Does the digest input include `.aigon/docs/` content verbatim, or just the source paths in the aigon repo? Verbatim is more accurate; source paths are cheaper. Default: verbatim, since that's what catches "vendored doc was edited upstream".
- Should the digest include the resolved profile placeholders, or the unresolved templates? Resolved — that's what actually lands in the repo.

## Related

- Research: #48 aigon-versioning-model-and-multi-repo-update-ux
- Set: apply-model
- Prior features in set: apply-1-rename-update-verb
