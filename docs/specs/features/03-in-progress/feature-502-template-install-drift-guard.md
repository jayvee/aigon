---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-10T10:17:15.331Z", actor: "cli/feature-prioritise" }
---

# Feature: template-install-drift-guard

## Summary

`templates/generic/commands/*.md` is the source of truth for every agent's slash commands, but installed copies in `.claude/commands/`, `.cursor/commands/`, `.gemini/commands/`, `.agents/skills/` only refresh when a human runs `aigon install-agent <id>`. There is **zero auto-propagation** when templates change, and **no detection** of post-install hand-edits. Evidence from the aigon repo today (2026-05-10):

- `templates/generic/commands/feature-code-review.md` mtime: May 7 (canonical).
- `.claude/commands/aigon/feature-code-review.md`: installed Apr 29 — **8 days stale**.
- `.cursor/commands/aigon-feature-code-review.md`: installed Apr 29, plus **on-disk SHA != install-manifest SHA** (file was edited *after* install).
- `.gemini/commands/aigon/feature-code-review.toml`: installed today, but already drifted from manifest.

The f495 incident surfaced this when cu read a stale slash command and AGENTS.md guidance pointing at a phantom state. Spec A removes the phantom state. This spec ensures agents never read week-old playbooks again.

This feature adds a three-layer drift guard: a fast template-vs-manifest check at every CLI invocation, a version-change auto-reinstall, a CI test that pins templates and manifest in lockstep, and a `prepublishOnly` hook that re-dogfoods aigon's own installed agents at release time.

## User Stories
- [ ] As a maintainer editing `templates/generic/commands/feature-code-review.md`, when I next run any `aigon` command, I get a one-line warning that installed agents (cc, cu, gg, …) have stale templates and a single command to fix.
- [ ] As a user upgrading aigon (`npm i -g @senlabsai/aigon@latest`), the next time I run `aigon` in a project, my installed slash commands are silently brought up to date — without clobbering any file I have manually edited post-install.
- [ ] As a maintainer cutting a release, the `prepublishOnly` hook re-runs `aigon install-agent --all` against the aigon repo itself, so the published version always ships with installed copies that match the templates.
- [ ] As a reviewer of a PR that edits `templates/`, CI fails the build if `.aigon/install-manifest.json` for the dogfood install is not regenerated in the same PR.
- [ ] As a user with a hand-edited `.cursor/commands/aigon-foo.md`, the auto-reinstall does **not** silently overwrite my edits. I get a clear message naming the drifted file and the option to keep, refresh, or diff.

## Acceptance Criteria

### Layer 1 — Dev-time drift guard (template-vs-manifest)
- [ ] On `aigon` CLI startup (after argument parsing, before subcommand dispatch), a `checkTemplateDrift()` helper compares the SHA of every file under `templates/generic/commands/` (and other installable template trees per the install-paths list in `lib/commands/setup.js`) against the most recent install recorded in `.aigon/install-manifest.json` for each installed agent.
- [ ] When drift is detected, print exactly one line per affected agent at startup: `⚠️  cc: 3 templates updated since install (feature-code-review.md, feature-do.md, feature-eval.md). Run aigon install-agent --all` Truncate the file list at 3 with `(+N more)`.
- [ ] The check is gated by an mtime fingerprint cached in `.aigon/state/template-drift-cache.json`. If `templates/` has not been touched since the last cache, the check returns instantly without hashing. Worst-case cold-cache cost: <50ms on a modern machine.
- [ ] The warning is suppressible per repo via `.aigon/config.json`: `{"installDriftWarnings": false}`. Default is on.
- [ ] No drift warning fires for agents that are not installed (i.e. not in `manifest.agents`). A repo with only `cc` installed never sees warnings about gemini's templates.

### Layer 2 — Version-change auto-reinstall
- [ ] When `package.json` `aigonVersion` ≠ `manifest.aigonVersion`, on next CLI invocation, `aigon` automatically runs `install-agent` for every agent currently in `manifest.agents` — silently, before subcommand dispatch.
- [ ] Auto-reinstall is **safe**: a file is only overwritten if its current on-disk SHA matches its `manifest.files[i].sha256`. Drifted files (manifest sha != disk sha) are skipped with a single grouped message at end of reinstall: `Skipped 2 hand-edited files (run aigon doctor --fix-templates to review):` followed by the list. Never silently clobber a file the user has touched.
- [ ] Auto-reinstall is suppressible via `AIGON_NO_AUTO_REINSTALL=1` env var (for CI / scripts) and via `.aigon/config.json` `{"autoReinstallOnVersionChange": false}`.
- [ ] Auto-reinstall logs one summary line: `✓ aigon upgraded 2.64.0-beta.6 → 2.64.0 — refreshed 4 agents (cc, cu, gg, km).`

### Layer 3 — CI guard
- [ ] A new test `tests/integration/install-manifest-lockstep.test.js` runs `aigon install-agent` for every supported agent in a tmpdir against the current templates, then compares the resulting manifest+files against the committed `.aigon/install-manifest.json`. Fails with a diff if they diverge.
- [ ] The test runs as part of `npm run test:core` (and therefore `test:iterate` via the iterate gate's smart-scope rules — when `templates/` files change, this test runs).
- [ ] Test failure message includes the exact remediation: `Templates edited but install-manifest not regenerated. Run: aigon install-agent --all && git add .aigon/install-manifest.json .claude/ .cursor/ .gemini/ .agents/`.

### `aigon doctor --fix-templates`
- [ ] New `aigon doctor --fix-templates` subcommand. Walks the manifest, identifies template-vs-installed drift and manifest-vs-disk drift, and prints a per-file table: `STATUS  PATH  ACTION`. Statuses: `OK`, `STALE_TEMPLATE` (template newer than installed), `HAND_EDITED` (disk sha != manifest sha).
- [ ] `--fix` flag (in addition to `--fix-templates`) prompts for each `HAND_EDITED` file: `[r]efresh / [k]eep / [d]iff`. Refreshes all `STALE_TEMPLATE` files automatically.
- [ ] Non-interactive runs (`--fix --yes` or piped stdin) refresh all `STALE_TEMPLATE` files and skip all `HAND_EDITED` files with a summary message — never silently overwrite.

### Release-time hook (`prepublishOnly`)
- [ ] `package.json` `prepublishOnly` runs `node ./aigon-cli.js install-agent --all` against the aigon repo itself before `check-pack.js`, ensuring the package being published has installed copies that match the templates.
- [ ] If `install-agent --all` produces a non-empty git diff (i.e. the maintainer forgot to commit reinstalled files), `prepublishOnly` exits non-zero with a clear message. (Otherwise the manifest would be re-recorded with a newer `installedAt` timestamp on every publish even when nothing else changed — too noisy. The diff check separates "I edited templates and forgot to install" from "the install timestamp ticked.")
- [ ] Document this in `CONTRIBUTING.md` under a new "Release checklist" section so maintainers know what `prepublishOnly` is enforcing and how to clean up if it fails.

### Audit + cleanup
- [ ] One-time pass: run `aigon install-agent --all` in the aigon repo itself and commit the regenerated `.aigon/install-manifest.json`, `.claude/commands/`, `.cursor/commands/`, `.gemini/commands/`, `.agents/skills/`. (This brings the dogfood install into compliance with the new CI test before that test is allowed to merge.)
- [ ] Identify the orphan `.cursor/aigon-afsb.md`, `.cursor/aigon-afi.md`, `.cursor/aigon-arsb.md` files (which have no template source) and decide: regenerate from a new template or delete. Spec A may already delete them; if not, delete here.
- [ ] Document in `AGENTS.md` (under "## Agent install / template sync"): the three layers, the `aigon doctor --fix-templates` workflow, and the explicit guarantee that no hand-edited file is ever silently overwritten.

## Validation

```bash
node -c lib/install-manifest.js
node -c lib/commands/setup.js
node tests/integration/install-manifest-lockstep.test.js
npm run test:iterate
# Smoke: edit a template, run `aigon`, expect a drift warning.
echo "# drift test" >> templates/generic/commands/feature-code-review.md
aigon --version 2>&1 | head -5  # expect drift warning, then version
git checkout templates/generic/commands/feature-code-review.md
```

## Pre-authorised
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May add a new `.aigon/config.json` field (`installDriftWarnings`, `autoReinstallOnVersionChange`) without separate config-schema review — both are simple boolean opt-outs.
- May raise `scripts/check-test-budget.sh` ceiling by up to +60 LOC for the new `install-manifest-lockstep.test.js`.

## Technical Approach

**Cost containment is the headline constraint.** Layer 1 runs on every `aigon` invocation, so the steady-state path must add <5ms or maintainers will rip it out. Strategy:
- Stat `templates/` once and compare to a cached fingerprint at `.aigon/state/template-drift-cache.json`. If the directory mtime hasn't ticked, return immediately. Hash work only happens when `templates/` actually changed.
- The cache stores `{ templatesMtimeMs, installedAgents: [...], lastCheckedAt, driftSummary }`. On miss, recompute drift and rewrite the cache.
- The cache is gitignored; it's per-clone state.

**Layer 2's safety contract is the design centre.** The whole drift problem exists because we can't distinguish "stale because templates moved" from "stale because user edited locally." Solution: the install manifest already records SHAs at install time. Trust that record:
- `manifest.files[i].sha256 === diskSha` ⇒ file is unmodified since install ⇒ safe to overwrite.
- `manifest.files[i].sha256 !== diskSha` ⇒ user touched it ⇒ never overwrite without consent.

This is the same guarantee `aigon doctor --fix-templates` uses interactively in Layer 3.

**Layer 3 (CI) is the only layer that catches the "merged a template edit without reinstall" case.** Implementation: spin up a tmpdir, copy `templates/`, run `aigon install-agent` for every agent in the committed manifest, diff the result against the committed `.aigon/install-manifest.json` + installed-file trees. The aigon repo's own dogfood install becomes the canonical fixture.

**`prepublishOnly` is the belt-and-suspenders for releases.** Even if Layer 3 fails-open in CI for some reason, no published version can ship without `install-agent --all` having been run.

**What NOT to do:**
- Don't symlink installed paths to templates — each agent target needs format conversion (md→toml for Gemini, placeholder substitution everywhere) and runtime resolution would do that on every read. The build step is real work.
- Don't put the drift check inside the per-subcommand handlers — the cost would multiply across nested invocations (e.g. `feature-status` calling `feature-list` internally). One check at top-level dispatch only.
- Don't auto-reinstall on Layer 1's drift detection. Auto-reinstall is for version changes (Layer 2), where the upgrade is a clear signal of intent. Layer 1's editor case is the maintainer's own pending edit; auto-reinstalling would clobber an in-progress template change before they meant to ship it.

**Implementation order:**
1. Layer 3 (CI test) — needs a `.aigon/install-manifest.json` that matches reality. Run the audit cleanup first to bring the dogfood install into compliance, then write the test that pins the invariant.
2. `aigon doctor --fix-templates` — the manual remediation tool. Layer 1's warning will point at it, so it must exist before Layer 1 ships.
3. Layer 1 (dev-time warning) — wire into CLI startup, with the mtime cache.
4. Layer 2 (version-change auto-reinstall) — depends on Layer 1's drift detection helpers.
5. `prepublishOnly` hook — depends on Layer 3's test passing.

**Constraint — no breaking change to the manifest schema.** `lib/install-manifest.js` already records the SHAs we need (`files[i].sha256`). Adding new top-level fields (e.g. `installDriftWarnings` migration timestamps) is fine; renaming or restructuring existing fields is not.

## Dependencies
- None hard. Spec A is independent and may land first or after — if Spec A lands first, Layer 3's CI test will catch any future template edit that forgets to reinstall, including Spec A's own `feature-code-review.md` Step 5 rewrite.

## Out of Scope
- A full schema migration of `.aigon/install-manifest.json` — current schema (v1.0) is sufficient.
- Adding drift detection for AGENTS.md, CLAUDE.md, or `.aigon/docs/` content beyond what install-manifest already tracks. Those files are tracked in the manifest already; the same Layer 1/2/3 logic applies uniformly.
- Replacing `processTemplate()` with a full templating engine (Mustache, Handlebars, etc.). The `{{KEY}}` substitution pattern is fine.
- Cross-machine sync (e.g. cloud-stored manifests) — the manifest is per-checkout state.
- A GUI-driven reinstall flow in the dashboard. CLI-only for now.

## Open Questions
- Should Layer 2 auto-reinstall on **patch** version bumps (`2.64.0-beta.6 → 2.64.0-beta.7`)? Templates often don't change between betas. Recommendation: auto-reinstall on any version mismatch — it's cheap, and false positives ("nothing actually changed in templates") just produce a no-op manifest update. Erring on freshness.
- Should `prepublishOnly` be allowed to update `.aigon/install-manifest.json` and the installed file trees on the publishing maintainer's behalf, or strictly fail with instructions? Recommendation: fail with instructions — auto-staging during release is the kind of magic that hides regressions.
- For the orphan `.cursor/aigon-afsb.md` etc.: are these still load-bearing for any user, or pure dead weight? If anyone has a Cursor "always-on" rule referencing them, deletion will silently break their setup. Worth a one-time announcement in the release notes for the version that ships this feature.

## Related
- Research: —
- Set: —
- Companion: Spec A (`remove-phantom-submitted-state-and-fix-review-complete-cli`) — the f495 incident that exposed this drift problem.
- Prior features: F422 (install-manifest synthesis migration — established the manifest as load-bearing).
- Incident: f495 — cu read a stale slash command and stale AGENTS.md guidance.
