---
complexity: medium
set: aigon-install-contract
depends_on: [420]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-28T00:20:49.783Z", actor: "cli/feature-prioritise" }
---

# Feature: vendor-aigon-docs-to-dot-aigon-folder

## Summary

Today aigon installs two aigon-owned doc trees into the consumer's `docs/` folder: `docs/development_workflow.md` and `docs/agents/{cc,cx,cu,gg,km,op}.md`. This co-mingles tool-owned content with the consumer's own `docs/` namespace. Industry convention (OpenSpec, Spec Kit, BMAD, Cline, Continue, Cursor) is for tools to install into their own dotdir at repo root — aigon already has `.aigon/` for state, config, and workflows. This feature relocates the vendored docs into `.aigon/docs/`, leaving the consumer's `docs/` folder completely untouched. Aigon-the-repo also moves its dogfooded copies. `aigon doctor --fix` migrates legacy paths in pre-existing repos.

## User Stories
- As a brewboard maintainer, I want my `docs/` folder to contain only my own docs — aigon's workflow documentation should live in `.aigon/`, alongside its state and config.
- As an agent invoked in a consumer repo, I want a clear visual signal that `.aigon/docs/development_workflow.md` is tool-owned (regenerated on every install) vs `docs/*.md` which is user-owned.
- As an aigon skill or slash command body, I want a stable reference path (`.aigon/docs/development_workflow.md`) that's identical across all consumer repos.
- As an existing aigon user, I want `aigon doctor --fix` to move my legacy `docs/development_workflow.md` and `docs/agents/` into the new location with a clear notice.

## Acceptance Criteria
- [ ] `lib/commands/setup.js` install logic: **every `templates/docs/*.md` file** is now written to `.aigon/docs/*.md` (was: `docs/*.md`). Today this means `development_workflow.md` AND `feature-sets.md` (added by F1). Three call sites currently reference the old `development_workflow.md` path explicitly: lines 260, 1303, 1439 — generalize to iterate `templates/docs/` so future additions are picked up automatically.
- [ ] `lib/commands/setup.js` install logic: `templates/generic/docs/agent.md` per-agent content is now written to `.aigon/docs/agents/{id}.md` (was: `docs/agents/{id}.md`).
- [ ] `lib/commands/setup.js` install paths string at line 946 updated: `'docs/development_workflow.md docs/agents/'` → `'.aigon/docs/'`.
- [ ] All slash command and skill bodies that reference the old paths updated. Run `grep -rE "docs/development_workflow\.md|docs/agents/" templates/ .claude/ .cursor/ .codex/ .gemini/ .agents/ 2>/dev/null` and update each match. Likely files: every command body that mentions the workflow doc.
- [ ] Aigon-the-repo dogfoods the new layout: its own `docs/development_workflow.md` and `docs/agents/` move to `.aigon/docs/development_workflow.md` and `.aigon/docs/agents/`. Use `git mv` to preserve history.
- [ ] `aigon doctor --fix` migration step `migrate_vendored_docs_to_dot_aigon`:
  - For every file in `templates/docs/` (currently `development_workflow.md`, `feature-sets.md`), detects the legacy copy at `docs/<name>.md` in the consumer repo.
  - Verifies its content matches the current template (sha256 check or substring match on a stable header) — if it differs significantly, prints a warning and asks the user to confirm rather than auto-moving.
  - Moves each to `.aigon/docs/<name>.md`.
  - Same logic for `docs/agents/{id}.md` files.
  - Prints `✅ Migrated: docs/<name>.md → .aigon/docs/<name>.md` per file moved.
  - Idempotent: skip silently if `.aigon/docs/<name>.md` already exists and old path is gone.
  - Tracked via doctor migration counter so it runs at most once per repo.
- [ ] `templates/docs/development_workflow.md` source content updated if it contains internal links that assume `docs/agents/`-relative paths — update to `.aigon/docs/agents/`.
- [ ] Tests: any test that asserts presence of `docs/development_workflow.md` or `docs/agents/` in install output updated to the new paths.
- [ ] New test: `install-agent cc` in temp repo → assert `.aigon/docs/development_workflow.md` and `.aigon/docs/agents/cc.md` exist; assert `docs/development_workflow.md` and `docs/agents/` are absent.
- [ ] New test for `doctor --fix` migration: seed temp repo with legacy paths → run `doctor --fix` → assert files moved.
- [ ] `AGENTS.md` § "Install Architecture" updated to reflect new install footprint: `.aigon/`, `.claude/`, `.cursor/`, `.codex/`, `.gemini/`, `.agents/` — explicitly note `docs/` is never touched.
- [ ] `docs/architecture.md` updated similarly.
- [ ] Update `docs/README.md` catalog (created in F1) to note that `.aigon/docs/development_workflow.md` is the canonical location for the vendored workflow doc; aigon-the-repo dogfoods it from there.

## Validation
```bash
node --check lib/commands/setup.js
test -f .aigon/docs/development_workflow.md
test -d .aigon/docs/agents
! test -f docs/development_workflow.md
! test -d docs/agents
node scripts/run-tests-parallel.js "tests/integration/install-agent-*.test.js"
```

## Pre-authorised
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets. Playwright still runs at the pre-push gate.
- May `git mv` `docs/development_workflow.md` and `docs/agents/` into `.aigon/docs/` without per-file confirmation.
- May update slash command and skill bodies in bulk via `sed` if the change is purely a path substitution (`docs/development_workflow.md` → `.aigon/docs/development_workflow.md`).

## Technical Approach

This is a path migration. The risk is missing a reference. Strategy:
1. Update install code (`lib/commands/setup.js` lines 260, 946, 1303, 1439) to write to new paths.
2. Run `git mv` on aigon-the-repo's existing `docs/development_workflow.md` and `docs/agents/` into `.aigon/docs/`.
3. Grep-and-replace all references in `templates/`, `.claude/`, `.cursor/`, `.codex/`, `.gemini/`, `.agents/`, plus any docs files. Verify zero hits for the old paths after.
4. Add the `doctor --fix` migration step alongside the F2 migrations.
5. Update tests.

The sha256 / content check in the doctor migration prevents the migration from clobbering a consumer who has hand-edited their `docs/development_workflow.md` — if the file diverges from the template, warn instead of overwriting blindly. This matches the conservative migration philosophy.

`.aigon/docs/agents/` will contain only the per-agent files for agents the consumer has installed (e.g. just `cc.md` if only Claude Code is installed). Other agents' files appear when their `install-agent` runs.

## Dependencies
- depends_on: stop-scaffolding-consumer-agents-md

## Out of Scope
- Manifest-tracked install (F4 — this feature lays groundwork for the manifest by stabilizing install paths but doesn't add the manifest itself).
- Brewboard seed refresh (F5).
- Renaming `development_workflow.md` to `aigon_development_workflow.md` — earlier discussion considered this for `docs/` placement; under `.aigon/docs/` the namespace is already implicit, so the simpler filename is fine.
- Moving any consumer-owned content; this feature only touches aigon-vendored content.

## Open Questions
- Should `.aigon/docs/` be gitignored in consumer repos by default, or committed? **Default:** committed. The vendored docs are part of the install footprint and committing them gives the consumer's team visibility. Consumers who want them out of their git history can add to their `.gitignore` themselves. (Confirm during implementation by checking what aigon currently does for `.aigon/workflows/` and matching that policy.)
- Should the doctor migration also `rmdir docs/agents` if empty after moving the files out? **Default:** yes, attempt `rmdir` and silently ignore failure if non-empty (the consumer may have added their own files there).

## Related
- Set: aigon-install-contract
- Prior features in set: F-aigon-repo-internal-doc-reorg, F-stop-scaffolding-consumer-agents-md
- Industry alignment: matches Spec Kit (`.specify/`), BMAD (`_bmad/`), Cline (`.clinerules/`), Continue (`.continue/`), Cursor (`.cursor/`), OpenSpec (`openspec/`) — tool-owned dotdir convention.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1468" height="132" viewBox="0 0 1468 132" role="img" aria-label="Feature dependency graph for feature 421" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-421" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-421)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-421)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-421)"/><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-421)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#419</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">aigon repo internal doc r…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#420</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">stop scaffolding consumer…</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#f59e0b" stroke-width="3"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#421</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">vendor aigon docs to dot …</text><text x="636" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#422</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">install manifest tracked …</text><text x="936" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#423</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">refresh brewboard seed po…</text><text x="1236" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
