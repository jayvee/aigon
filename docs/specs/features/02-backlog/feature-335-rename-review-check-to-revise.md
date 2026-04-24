---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-24T00:49:17.804Z", actor: "cli/feature-prioritise" }
---

# Feature: rename-review-check-to-revise

## Summary

Aigon uses three different names for the same step — the author's decision (accept / revert / modify) after a reviewer has critiqued a spec or code. Commands and dashboard buttons call it `review-check`; autonomous-mode stages call it `counter-review`; docs mix both. We unify on **`revise`** (verb) and **`revision`** (stage noun), following the Constitutional-AI "critique → revise" lineage. The pairing reads cleanly: `review` is the reviewer's turn, `revise` is the author's turn.

This is a **hard rename** — no deprecated aliases, no dual-path event handlers, no read-time shims. Old command names, shortcuts, and stage types are deleted outright. A one-shot versioned migration registered in `lib/migration.js` rewrites in-flight `.aigon/workflows/**/snapshot.json` entries on the next `aigon update`, riding the existing migration framework's backup/restore safety net. Changelog advertises the breaking change; usage is low enough that this is the right moment to take the hit.

## User Stories

- [ ] As an Aigon user, I see consistent terminology across the CLI, dashboard, and autonomous-mode progress display.
- [ ] As an Aigon user, after `aigon update` I open an in-flight feature that was previously in `counter-review` stage and it opens cleanly, now labelled "Revision" — no manual recovery.
- [ ] As an Aigon user running `afrv <ID>`, I revise a feature after code review; the dashboard shows a **"Code Revise"** button only after ≥1 round of code review has completed.
- [ ] As an Aigon user with a pending spec, I see a **"Spec Revise"** action only before code implementation begins.
- [ ] As a user still typing `afsrc` / `afrc` / `arsrc`, the CLI hard-fails with "unknown command" and the changelog tells me the new names.

## Acceptance Criteria

**Commands & shortcuts (hard rename — no aliases)**
- [ ] `aigon feature-spec-revise <ID>`, `aigon feature-code-revise <ID>`, `aigon research-spec-revise <ID>` are the only forms.
- [ ] Shortcuts `afsrv`, `afrv`, `arsrv` replace `afsrc`, `afrc`, `arsrc`. Old shortcuts removed from `COMMAND_ALIASES` and `COMMAND_ALIAS_REVERSE`.
- [ ] Old commands removed from `COMMAND_REGISTRY` entirely. Typing an old name exits non-zero with "unknown command" (standard CLI behaviour).

**Stage type & workflow**
- [ ] `VALID_STAGE_TYPES` in `lib/workflow-definitions.js` contains `'revision'`; `'counter-review'` is gone.
- [ ] Built-in workflow definitions emit stage type `'revision'`.
- [ ] `AUTONOMOUS_STAGE_LABELS` displays "Revision".
- [ ] After migration runs, no snapshot on disk contains `stage.type: 'counter-review'` or any `*-review-check-pending` status string.

**Events & status**
- [ ] Projector emits `spec.revised` / `code.revised` in place of `spec.review.checked` / `code.review.checked`.
- [ ] Status strings `spec-revision-pending` and `code-revision-pending` replace `spec-review-check-pending` / `code-review-check-pending`.
- [ ] Scoping rule enforced: `spec-revision-*` only available before code implementation begins; `code-revision-*` only available after ≥1 round of code review.

**ManualActionKind enum**
- [ ] `FEATURE_SPEC_REVISE`, `FEATURE_CODE_REVISE`, `RESEARCH_SPEC_REVISE` replace the `*_REVIEW_CHECK` entries in `lib/workflow-core/types.js`. Old entries deleted.

**Agent prompt resolver**
- [ ] `VERB_TO_TEMPLATE` and `VERB_TO_PROMPT_FIELD` in `lib/agent-prompt-resolver.js` use verb `'revise'`; `'review-check'` is gone.

**Dashboard**
- [ ] Action buttons read **"Spec Revise"** (pre-implementation) and **"Code Revise"** (post-code-review).
- [ ] Modal titles, submit labels, and autonomous-mode progress UI use "Revise" / "Revision".
- [ ] Playwright screenshot captured (CLAUDE.md rule 4) showing both buttons and the autonomous-mode stage label.

**Templates & Skills**
- [ ] `templates/generic/commands/feature-spec-revise.md`, `feature-code-revise.md`, `research-spec-revise.md` exist with the revised verb throughout.
- [ ] Old template files (`feature-{spec,code}-review-check.md`, `research-spec-review-check.md`) deleted from `templates/generic/commands/`.
- [ ] Agent-specific command files regenerated via `aigon install-agent`.
- [ ] AI skills under `.agents/skills/` renamed from `*-review-check` to `*-revise` (including `aigon-feature-review-check`), updating both folder names and `SKILL.md` contents.

**Migration (registered in `lib/migration.js`)**
- [ ] New migration registered at the target release version, dynamically reading `require('../../package.json').version`.
- [ ] Migration scans every `.aigon/workflows/{features,research}/*/snapshot.json` and rewrites:
  - `stage.type: 'counter-review'` → `'revision'`
  - Any status string ending `-review-check-pending` → `-revision-pending`
  - Any event-kind literal `spec.review.checked` → `spec.revised` and `code.review.checked` → `code.revised` in persisted event logs (if present).
- [ ] Migration logs a one-line summary per file rewritten.
- [ ] Migration is idempotent (running twice is a no-op).
- [ ] Existing `lib/migration.js` backup framework covers rollback — no custom rollback needed.

**Docs & changelog**
- [ ] `AGENTS.md`, `CLAUDE.md`, `docs/architecture.md`, `docs/autonomous-mode.md`, `docs/workflow-rules.md`, `docs/development_workflow.md`, `site/content/**` updated.
- [ ] `CHANGELOG.md` entry at the top: **"BREAKING: `review-check` renamed to `revise`. Run `aigon update` to migrate in-flight features. Any scripts or docs referencing `feature-*-review-check` commands or the `afsrc`/`afrc`/`arsrc` shortcuts must be updated."**

**Tests**
- [ ] All integration tests updated to the new names; any test asserting old names either renamed or deleted.
- [ ] New test: migration fixture — seed a snapshot with `counter-review` + `*-review-check-pending` + old event kinds, run migration, assert snapshot now uses `revision` + `-revision-pending` + new event kinds.
- [ ] New test: migration idempotency — run twice, no diff on second run.
- [ ] `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh` green.

## Validation

```bash
node -c aigon-cli.js
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh
```

## Pre-authorised

- May regenerate agent-specific command files under `.claude/commands/`, `.cursor/commands/`, `.codex/commands/`, `.gemini/commands/`, `.opencode/commands/` via `aigon install-agent` as part of this rename.
- May restart the Aigon dashboard server after any `lib/*.js` edit (per CLAUDE.md hot rule 3).

## Technical Approach

**Tone: hard rename.** Every occurrence of `review-check` / `counter-review` / `*-review-check-pending` is replaced — no compat shims, no dual-path registry entries, no keep-old-for-safety. The versioned migration in `lib/migration.js` is the only safety net, and it runs automatically on the user's next `aigon update`, with the framework's existing tarball backup covering rollback.

**Sequence:**

1. **Library rename.** In a single pass, delete-and-replace across:
   - `lib/workflow-definitions.js` — `VALID_STAGE_TYPES` + built-in workflows + validation (lines 7, 27, 38, 68, 184–199).
   - `lib/workflow-read-model.js` — `AUTONOMOUS_STAGE_LABELS` (line 44), stage branching (lines 253, 280, 374).
   - `lib/workflow-core/types.js` — `ManualActionKind` enum entries.
   - `lib/workflow-core/projector.js` — rename event handlers; *delete* old-event handlers (migration rewrites persisted events before projector ever sees them again).
   - `lib/agent-prompt-resolver.js` — `VERB_TO_TEMPLATE`, `VERB_TO_PROMPT_FIELD`, JSDoc, comments.
   - `lib/action-command-mapper.js` — rename cases; delete old cases.
   - `lib/dashboard-routes.js` — rename command dispatch (lines 335–336).
   - `lib/feature-autonomous.js` — rename comments / stage literals (lines 41, 438).
   - `lib/commands/workflow.js` — rename stage references (lines 61, 67, 69, 161, 249).
   - `lib/commands/entity-commands.js` — audit & rename.
   - `lib/templates.js` — `COMMAND_REGISTRY`, `COMMAND_ALIASES`, `COMMAND_ALIAS_REVERSE`, `COMMAND_ARG_HINTS` — replace entries, don't deprecate.

2. **Template & Skill rename.** `git mv` the three template files and all four `.agents/skills/*-review-check` directories; update their body text to use the new verb throughout. Delete any old references in other templates or skills.

3. **Dashboard UI.** `templates/dashboard/js/actions.js` — rename action cases (711–718, 728–735, 799–800) and the `stages.push` stage type (1332). Enforce scoping rule in the render logic (spec-revise hidden once code implementation begins; code-revise hidden until ≥1 code review completes).

4. **Register the migration.** In `lib/migration.js`, append:

   ```js
   registerMigration('<TARGET_VERSION>', async ({ repoPath, log }) => {
       // Scan .aigon/workflows/{features,research}/*/snapshot.json
       // Rewrite: stage.type 'counter-review' → 'revision'
       //          status '*-review-check-pending' → '*-revision-pending'
       //          event kind 'spec.review.checked' → 'spec.revised'
       //          event kind 'code.review.checked' → 'code.revised'
       // Log each rewritten file. Idempotent.
   });
   ```

   Set `<TARGET_VERSION>` to the release that ships this rename. The framework handles backup, execution, and rollback on failure (see pattern at `lib/migration.js:459`).

5. **Test updates.** Rename assertions in integration tests to the new names. Add migration fixture test + idempotency test. No dual-name tests (there's only one name now).

6. **Docs sweep.** Global search-and-replace across docs and `site/content/**`; write the CHANGELOG entry.

7. **Regenerate agent command files** via `aigon install-agent`.

**Non-functional constraints:**
- Migration must be idempotent so `aigon update` can safely run twice.
- Migration must handle missing files / empty repos gracefully (first-time users have nothing to migrate).
- No break in the write-path contract (F294 lesson): every producer of the old strings is updated in the same change as every consumer. Grep for each old literal before committing — there should be zero hits outside the migration script itself and the CHANGELOG entry.

## Dependencies

- None — self-contained rename.

## Out of Scope

- Workflow semantics or ordering changes. Pure vocabulary rename.
- A genuine "counter-review" stage (second independent reviewer). If that ever gets built, it gets the name `counter-review` back.
- Refactoring the internal `reviewCheckPrompt` field name in data structures — low-cost to leave, can be a follow-up.
- Adding a `schemaVersion` to snapshots. The migration framework already tracks what's been applied; no per-snapshot versioning needed here.
- "Did you mean" hints in the CLI for the old commands (a hard "unknown command" is sufficient).
- Tooltips or disabled states in the UI explaining the scoping rules (hiding the button when out of phase is sufficient).

## Related

- Set: <!-- standalone -->
- Prior features in set: <!-- F299 (feature-review → feature-code-review) is the naming-precedent reference but not a formal dependency; note that F299 used deprecated aliases — this feature deliberately does not -->
