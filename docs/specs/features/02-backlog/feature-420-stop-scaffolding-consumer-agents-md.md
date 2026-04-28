---
complexity: medium
set: aigon-install-contract
depends_on: [419]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-28T00:20:49.539Z", actor: "cli/feature-prioritise" }
---

# Feature: stop-scaffolding-consumer-agents-md

## Summary

Aigon's `install-agent` currently writes/updates the consumer's `AGENTS.md` via `syncAgentsMdFile()` in `lib/templates.js`, and reads `docs/aigon-project.md` from the consumer's repo as the user-authored seed for that scaffold. Both behaviors are out of step with industry: of seven comparable tools surveyed (OpenSpec, Spec Kit, BMAD, Aider, Cline, Continue, Cursor), six leave consumer root-MD files entirely alone, and only one asks the user to author content for the tool to consume — and even then, optionally and post-install. This feature deletes both behaviors. After this lands, `install-agent` writes only into `.claude/`, `.cursor/`, `.codex/`, `.gemini/`, `.agents/`, and `.aigon/`. It never touches `AGENTS.md`, `CLAUDE.md`, or `README.md`. Discovery of the aigon workflow happens via per-agent skill descriptions and slash commands (already installed). At the end of a successful install, aigon prints a suggested one-line snippet the user MAY paste into their `AGENTS.md` if they want a top-level pointer — but aigon does not edit it.

## User Stories
- As a brewboard maintainer, I don't want aigon to overwrite or merge into my `AGENTS.md` — I have my own project description and agent context.
- As an agent in a consumer repo, I want a clear "tool-owned" vs "user-owned" boundary so I know which files are safe to regenerate vs which are user content.
- As an aigon-the-repo maintainer, I don't want a 110-line duplicate (`docs/aigon-project.md`) of `AGENTS.md`'s structural content sitting in `docs/`.
- As an existing aigon user upgrading to this version, I want `aigon doctor --fix` to clean up legacy aigon marker blocks from my `AGENTS.md` and delete the obsolete `docs/aigon-project.md` for me, with clear notices.

## Acceptance Criteria
- [ ] `getProjectInstructions()` (`lib/templates.js:443–450`) deleted.
- [ ] `syncAgentsMdFile()` (`lib/templates.js:460–466`) deleted.
- [ ] All callers of `syncAgentsMdFile()` removed (grep `lib/commands/setup.js`, `lib/commands/setup/*.js` for the function name and remove call sites).
- [ ] `docs/aigon-project.md` deleted (aigon-the-repo's own copy).
- [ ] `templates/scaffold.md` deleted (was the fallback content for `getProjectInstructions()`).
- [ ] `templates/root-file.md` deleted IF and only IF no remaining caller exists after `syncAgentsMdFile()` removal — verify via grep.
- [ ] `lib/commands/setup.js` install path string at line 946 (`'docs/development_workflow.md docs/agents/ AGENTS.md ...'`) — `AGENTS.md` removed from the list.
- [ ] `install-agent` end-of-run output prints a suggested snippet block (informational, not actioned), e.g.:
  ```
  Optional: to make aigon visible in your project's AGENTS.md, add:
      > This repo uses aigon for feature workflow.
      > See `.aigon/docs/development_workflow.md`.
  (Aigon does not edit your AGENTS.md.)
  ```
- [ ] `aigon doctor --fix` migration step `migrate_drop_aigon_agents_md_block`:
  - Detects the aigon-managed marker block (`<!-- AIGON-MANAGED-START -->...<!-- AIGON-MANAGED-END -->` or whatever marker the current scaffold uses — verify in `templates/generic/agents-md.md`) inside the consumer's `AGENTS.md`.
  - Removes the marker block AND its content.
  - Prints `✅ Migrated: removed legacy aigon marker block from AGENTS.md` (with file path).
  - Idempotent: skip silently if no marker block present.
- [ ] `aigon doctor --fix` migration step `migrate_drop_aigon_project_md`:
  - Detects `docs/aigon-project.md` in the consumer repo.
  - Deletes it.
  - Prints `✅ Migrated: removed obsolete docs/aigon-project.md (aigon no longer reads this file)`.
  - Idempotent: skip silently if absent.
- [ ] Both migration steps tracked via `aigon doctor` migration counter mechanism (already exists per F353 — verify in `lib/commands/setup.js`) so each runs at most once per repo.
- [ ] Tests: any existing test that exercises `syncAgentsMdFile()`, `getProjectInstructions()`, or asserts content in a scaffolded `AGENTS.md` removed or rewritten to assert the new "no scaffold" behavior.
- [ ] New test in `tests/integration/install-agent-no-agents-md-scaffold.test.js`: run `install-agent` in a temp repo with no `AGENTS.md` → assert no `AGENTS.md` is created.
- [ ] New test: run `install-agent` in a temp repo with an existing `AGENTS.md` → assert it is byte-identical before and after.
- [ ] New test for `doctor --fix` migration: seed a temp repo with a legacy aigon marker block in `AGENTS.md` and a `docs/aigon-project.md` → run `doctor --fix` → assert both are cleaned up and notices printed.
- [ ] `AGENTS.md` § "Install Architecture" (lines 167–181) updated: remove the "scaffolded on first install only, never overwritten" wording; replace with "aigon does not write or modify `AGENTS.md` or `CLAUDE.md` — these are user-owned. Discovery happens via per-agent skill descriptions and always-loaded rule files."
- [ ] `docs/architecture.md` line 17 updated: remove the `docs/aigon-project.md` reference; replace with the new install contract description.

## Validation
```bash
node --check lib/templates.js
node --check lib/commands/setup.js
! grep -q "syncAgentsMdFile\|getProjectInstructions" lib/templates.js
! test -f docs/aigon-project.md
! test -f templates/scaffold.md
node scripts/run-tests-parallel.js "tests/integration/install-agent-*.test.js"
```

## Pre-authorised
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets. Playwright still runs at the pre-push gate.
- May delete `docs/aigon-project.md`, `templates/scaffold.md`, and (conditionally) `templates/root-file.md` without per-file confirmation — these are explicit deliverables.

## Technical Approach

The cleanup is small and localised: one function file (`lib/templates.js`) loses two functions; one install-paths string in `lib/commands/setup.js` loses one entry; two doctor migration steps are added.

The trickiest piece is detecting the marker block in `AGENTS.md` for the migration. Read `templates/generic/agents-md.md` to find the exact marker pattern, then in the migration step regex-match the entire block (start marker through end marker, multiline) and replace with empty string. Trim trailing whitespace if the removal leaves three or more consecutive newlines.

The end-of-install snippet is printed via `console.log` after the existing success summary in `lib/commands/setup.js`. Format it as a code-block-styled hint so the user can copy it cleanly.

User-impact framing: at the time of writing, the user has stated they have very few aigon installs in the wild, so a `doctor --fix` migration with a clear notice is sufficient — no need for a multi-version deprecation cycle.

## Dependencies
- depends_on: aigon-repo-internal-doc-reorg

## Out of Scope
- Moving `docs/development_workflow.md` and `docs/agents/` into `.aigon/docs/` (covered by F3).
- Manifest-tracked install (F4).
- Brewboard seed regeneration (F5 — but this feature's migration steps will be exercised by F5's migration test).
- Adding an `aigon set-project-context` opt-in command — not needed; user authors their own AGENTS.md if they want a project description.

## Open Questions
- What exact marker pattern does `templates/generic/agents-md.md` use? Verify before writing the regex. **Action:** read the template at start of implementation.
- Should the end-of-install snippet vary per-agent (e.g. mention `.cursor/rules/aigon.mdc` for Cursor) or always show the universal `AGENTS.md` snippet? **Default:** universal snippet; the per-agent files self-describe.

## Related
- Set: aigon-install-contract
- Prior features in set: F-aigon-repo-internal-doc-reorg
- Industry research: comparison of OpenSpec, Spec Kit, BMAD, Aider, Cline, Continue, Cursor install contracts (conducted in design conversation; six of seven leave consumer root MD files alone).
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="132" viewBox="0 0 868 132" role="img" aria-label="Feature dependency graph for feature 420" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-420" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-420)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-420)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#419</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">aigon repo internal doc r…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#420</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">stop scaffolding consumer…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#421</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">vendor aigon docs to dot …</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
