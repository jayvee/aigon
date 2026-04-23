---
recurring_slug: weekly-docs-gap-scan
complexity: medium
recurring_week: 2026-W17
recurring_template: weekly-docs-gap-scan.md
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-23T02:23:05.819Z", actor: "recurring/feature-prioritise" }
---

# docs-gap-scan-2026-W17

## Summary

Scan for documentation gaps across two surfaces and fix them directly: (1) **internal docs** (`AGENTS.md`, `docs/architecture.md`, `docs/development_workflow.md`) that are behind code changes in `lib/` and `templates/`; and (2) **public-facing docs** (`site/content/`) that are missing pages, have stale command references, or don't cover features that have shipped since the last docs update. Write the fixes, commit them, and close without review.

## Acceptance Criteria

### Internal docs gap
- [ ] Find the most recent commit that modified any of `AGENTS.md`, `docs/architecture.md`, or `docs/development_workflow.md`
- [ ] Diff `lib/` and `templates/` changes since that commit
- [ ] Identify new or significantly changed `lib/*.js` files not reflected in the internal docs
- [ ] Identify new `templates/generic/commands/` entries and new `templates/agents/*.json` entries not mentioned in internal docs

### Public docs gap
- [ ] Find the most recent commit that modified any file under `site/content/`
- [ ] Diff `lib/`, `templates/`, and `docs/specs/features/05-done/` changes since that commit
- [ ] For each shipped feature (in `05-done/`) since the last site update: check whether its capability is covered in any `site/content/guides/` or `site/content/reference/` page
- [ ] Identify commands in `aigon help` output that have no corresponding `site/content/reference/commands/` page
- [ ] Identify `site/content/` pages that reference commands, flags, or file paths that no longer exist

### Fixes
- [ ] For each internal doc gap: edit the affected file (`AGENTS.md`, `docs/architecture.md`, or `docs/development_workflow.md`) to add or update the missing content
- [ ] For each public doc gap: edit or create the affected `site/content/` page with accurate, up-to-date content; create new `.mdx` files for missing reference pages and add them to the relevant `_meta.tsx`
- [ ] Remove or correct stale references (commands, flags, file paths) in any `site/content/` page
- [ ] Commit all doc changes: `git add AGENTS.md docs/architecture.md docs/development_workflow.md site/content/ && git commit -m "docs: automated gap fixes {{YYYY-WW}}"`
- [ ] Close the feature (no eval step needed)

## Technical Approach

### Internal docs
1. `git log --format=%H -1 -- AGENTS.md docs/architecture.md docs/development_workflow.md` → `$INTERNAL_SHA`
2. `git diff --name-only $INTERNAL_SHA..HEAD -- lib/ templates/` → list of changed code files
3. Cross-reference each changed file against `AGENTS.md` and `docs/architecture.md` (grep for filename stem)
4. New `templates/agents/` entries that aren't mentioned in `AGENTS.md` = gap

### Public docs
5. `git log --format=%H -1 -- site/content/` → `$SITE_SHA`
6. `git diff --name-only $SITE_SHA..HEAD -- lib/ templates/ docs/specs/features/05-done/` → changed since last site update
7. For each feature spec in `05-done/` committed after `$SITE_SHA`: read its Summary and check if any guide or reference page covers that capability (grep key terms in `site/content/`)
8. Run `aigon help 2>&1` and extract all command names; for each command check whether `site/content/reference/commands/<cmd>.mdx` exists
9. For each `site/content/` page: grep for command names, file paths, and flag names; verify each still exists in the codebase

### Fix and close
10. For each identified gap, make the edit directly — update the relevant doc file or create the missing page
11. `git add AGENTS.md docs/architecture.md docs/development_workflow.md site/content/ && git commit -m "docs: automated gap fixes {{YYYY-WW}}"`
12. `aigon agent-status submitted`
13. `aigon feature-close <ID>`

## Pre-authorised

- Skip eval step: automated doc updates do not require human review
- Write to `AGENTS.md`, `docs/architecture.md`, `docs/development_workflow.md`, and `site/content/**`
