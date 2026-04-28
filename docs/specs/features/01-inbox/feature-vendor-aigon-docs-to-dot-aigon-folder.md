---
complexity: medium
set: aigon-install-contract
depends_on: stop-scaffolding-consumer-agents-md
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
