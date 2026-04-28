---
complexity: medium
set: aigon-install-contract
depends_on: [421]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-28T00:20:50.039Z", actor: "cli/feature-prioritise" }
---

# Feature: install-manifest-tracked-files

## Summary

Today the canonical list of files aigon writes during `install-agent` is a hardcoded space-separated string at `lib/commands/setup.js:946`. There's no record of which version wrote them, no way to detect when a user has hand-edited a tool-owned file, and no clean uninstall. OpenSpec, BMAD, and Spec Kit all maintain a tracked manifest for this purpose. This feature promotes the install paths string to a real manifest file — `.aigon/install-manifest.json` — with `{path, sha256, version, installedAt}` per file. Enables clean `aigon uninstall`, partial reinstall recovery, and warning when an aigon-managed file has been modified outside the install path.

## User Stories
- As a consumer who decides to remove aigon, I want `aigon uninstall` to delete every file aigon wrote and leave my own files alone.
- As an aigon maintainer doing a version upgrade, I want to know which aigon-managed files in a consumer repo have been hand-edited so we can warn the user before overwriting their changes.
- As a debugger investigating "where did this file come from?", I want to look up any path in the manifest and see when aigon wrote it and at which version.
- As a future feature that adds or removes installed files, I want the manifest to be the single source of truth for "what does aigon own in this repo?"

## Acceptance Criteria
- [ ] Manifest schema (`.aigon/install-manifest.json`):
  ```json
  {
    "version": "1.0",
    "aigonVersion": "<from package.json>",
    "files": [
      { "path": ".claude/commands/aigon/feature-create.md",
        "sha256": "<hex>",
        "version": "<aigonVersion at write time>",
        "installedAt": "<ISO 8601>" }
    ]
  }
  ```
- [ ] New module `lib/install-manifest.js` exposing: `readManifest(repoRoot)`, `writeManifest(repoRoot, manifest)`, `recordFile(manifest, absPath, repoRoot, aigonVersion)` (computes sha256, normalizes to relative path), `removeFile(manifest, relPath)`, `getModifiedFiles(manifest, repoRoot)` (returns paths whose on-disk sha256 differs from manifest entry).
- [ ] `lib/commands/setup.js` install paths: every `safeWrite` / `safeWriteWithStatus` call site that writes an aigon-owned file calls `manifest.recordFile()` after a successful write. Audit existing call sites in `lib/commands/setup.js` and `lib/commands/setup/*.js` and the `lib/templates.js` install helpers.
- [ ] On every `install-agent` run, manifest is written/updated atomically (write to `.aigon/install-manifest.json.tmp` then rename).
- [ ] Pre-install check: if manifest exists, run `getModifiedFiles()` and warn if any aigon-managed file has been modified. Output:
  ```
  ⚠ The following aigon-managed files have been modified outside install:
    - .claude/commands/aigon/feature-create.md
  Proceed with overwrite? [y/N]
  ```
  Skip the prompt if `--force` is passed; abort if user declines.
- [ ] New command `aigon uninstall [--dry-run]`:
  - Reads `.aigon/install-manifest.json`.
  - Lists every file it would delete (always, even without --dry-run, before confirmation).
  - With `--dry-run`: prints the list and exits.
  - Without `--dry-run`: prompts for confirmation, deletes every listed file, removes empty parent directories, deletes the manifest itself, prints summary.
  - Refuses to delete files whose on-disk sha256 differs from manifest (user-modified) unless `--force` is passed.
  - Does NOT delete `.aigon/workflows/`, `.aigon/state/`, `.aigon/sessions/`, `.aigon/config.json` — those are runtime state, not install footprint. Document this clearly in the command's `--help`.
  - Prints final reminder: "Aigon uninstalled. Your `AGENTS.md`, `CLAUDE.md`, `README.md`, and project files were not touched."
- [ ] `aigon doctor --fix` migration step `migrate_initialize_install_manifest`:
  - If `.aigon/install-manifest.json` does not exist, scan the standard install paths (post-F2/F3 set: `.claude/commands/aigon/`, `.claude/skills/aigon/`, `.cursor/commands/aigon-*.md`, `.cursor/rules/aigon.mdc`, `.codex/`, `.gemini/`, `.agents/skills/aigon-*/`, `.aigon/docs/`) and synthesize a manifest entry for each found file (sha256 of current content, version=current aigonVersion, installedAt=now).
  - Idempotent: skip if manifest exists.
  - Print `✅ Initialized install manifest at .aigon/install-manifest.json (N files tracked)`.
- [ ] `aigon doctor` (without `--fix`) reports manifest health: missing files (in manifest but not on disk), modified files (sha256 differs), untracked aigon-pattern files (e.g. files in `.claude/commands/aigon/` not in manifest).
- [ ] Tests:
  - Unit tests for `lib/install-manifest.js` covering each exposed function.
  - Integration test: `install-agent cc` in temp repo → assert manifest written with correct entries.
  - Integration test: `install-agent cc` twice → assert idempotent (manifest doesn't grow duplicates, sha256s update if templates changed).
  - Integration test: hand-edit an installed file → re-run `install-agent` → assert warning printed.
  - Integration test: `aigon uninstall --dry-run` → assert correct file list, no deletions.
  - Integration test: `aigon uninstall` → assert all manifest files removed, runtime state preserved.
  - Integration test: `doctor --fix` on legacy repo without manifest → assert manifest synthesized.
- [ ] `AGENTS.md` § "Install Architecture" updated to mention the manifest.
- [ ] `docs/architecture.md` adds a new sub-section "Install manifest" describing the schema and lifecycle.
- [ ] `docs/README.md` (from F1) lists `lib/install-manifest.js` as a new module with one-line description.

## Validation
```bash
node --check lib/install-manifest.js
node --check lib/commands/setup.js
node aigon-cli.js uninstall --dry-run  # in a repo with manifest, should list files
node scripts/run-tests-parallel.js "tests/integration/install-manifest-*.test.js"
```

## Pre-authorised
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets. Playwright still runs at the pre-push gate.

## Technical Approach

The manifest module is small (~150 lines): JSON read/write, sha256 helper, modified-file detection. Atomic writes via tempfile + rename to avoid partial manifests on crash.

Integration into `install-agent` is the riskier part — every existing write site must be threaded through `manifest.recordFile()`. Audit pass: grep `safeWrite\|safeWriteWithStatus\|fs.writeFileSync` in `lib/commands/setup.js` and `lib/commands/setup/*.js`. Each call that writes a file aigon owns must record it. Each call that writes user-owned content (none should remain after F2) must NOT record it.

The pre-install modification warning is interactive — design the prompt to be skippable via `AIGON_NONINTERACTIVE=1` env var or `--force` flag for CI/automation contexts. Check for an existing convention in `lib/commands/setup.js`.

`aigon uninstall` is a new command surface — register in `lib/commands/setup.js` (or wherever uninstall most logically lives — possibly its own domain file `lib/commands/uninstall.js` if substantial). Reuse `safeWrite` / file deletion helpers if they exist; otherwise add the necessary primitives to `lib/utils.js`.

## Dependencies
- depends_on: vendor-aigon-docs-to-dot-aigon-folder

## Out of Scope
- Pre-install modification warning blocking re-installs in CI by default — add the `AIGON_NONINTERACTIVE` / `--force` escape hatch but don't change CI behavior here.
- Manifest schema migrations across aigon major versions — version field is in the manifest; future schema changes get a separate feature.
- Brewboard seed refresh (F5 — but F5 will exercise the manifest end-to-end).
- Removing `.aigon/workflows/`, `.aigon/state/`, `.aigon/sessions/`, `.aigon/config.json` during `aigon uninstall` — these are user-generated runtime state, not install footprint.
- Detecting and warning about manually-added files in aigon-namespaced directories (e.g. user adds `.claude/commands/aigon/my-custom.md`) — `doctor` reports them, but no enforcement.

## Open Questions
- Should `aigon uninstall` print a summary of "files preserved" (the runtime state in `.aigon/workflows/`, etc.) so the user knows their feature history isn't deleted? **Default:** yes, brief one-line summary.
- What happens if manifest exists but is corrupted (invalid JSON)? **Default:** print error, refuse to install/uninstall, suggest `aigon doctor --fix` to regenerate.
- Should the manifest be in `.aigon/install-manifest.json` or `.aigon/state/install-manifest.json`? **Default:** root of `.aigon/` for discoverability — it's a contract artifact, not runtime state.

## Related
- Set: aigon-install-contract
- Prior features in set: F-aigon-repo-internal-doc-reorg, F-stop-scaffolding-consumer-agents-md, F-vendor-aigon-docs-to-dot-aigon-folder
- Industry alignment: matches OpenSpec (`update` regenerates from manifest), BMAD (`_bmad/_config/manifest.yaml`), Spec Kit (manifest-tracked teardown).
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1468" height="132" viewBox="0 0 1468 132" role="img" aria-label="Feature dependency graph for feature 422" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-422" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-422)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-422)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-422)"/><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-422)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#419</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">aigon repo internal doc r…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#420</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">stop scaffolding consumer…</text><text x="336" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#421</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">vendor aigon docs to dot …</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#422</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">install manifest tracked …</text><text x="936" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#423</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">refresh brewboard seed po…</text><text x="1236" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
