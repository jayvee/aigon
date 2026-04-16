# Feature: fix-stale-command-references-in-docs-and-landing-page

## Summary

Multiple docs, templates, agent instruction files, and the public landing page reference CLI commands that were renamed or removed. Users and agents following these instructions hit "command not found" errors. This feature fixes every stale reference to point to the correct current command.

## User Stories

- [ ] As a Codex agent reading SKILL.md, I need the listed commands to actually exist so I can execute the workflow without errors.
- [ ] As a new user reading the landing page terminal demos, I need the shown commands to work if I copy them.
- [ ] As an agent reading docs/agents/*.md, I need `aigon research-spec` to either exist or be replaced with a working alternative.

## Acceptance Criteria

### Templates (shipped to user repos)

- [ ] `templates/docs/development_workflow.md`: all `aigon feature-implement` replaced with `aigon feature-do`
- [ ] `templates/docs/development_workflow.md`: all `aigon feature-done` replaced with `aigon feature-close`
- [ ] `templates/generic/skill.md`: `aigon feature-implement` replaced with `aigon feature-do`
- [ ] `templates/generic/skill.md`: `aigon feature-done` replaced with `aigon feature-close`
- [ ] `templates/generic/skill.md`: `aigon research-conduct` replaced with `aigon research-do`
- [ ] `templates/generic/skill.md`: `aigon research-done` replaced with `aigon research-close`
- [ ] `docs/development_workflow.md` (the installed copy) updated to match

### Landing page

- [ ] `site/public/home.html`: all `aigon feature-autopilot` replaced with `aigon feature-autonomous-start` (or a shorter alias if the demo looks better)
- [ ] `site/public/home.html`: all `aigon feature-setup` replaced with `aigon feature-start`
- [ ] `site/public/home.html`: all `aigon worktree-open` replaced with `aigon feature-open`

### Agent instruction files

- [ ] `docs/agents/claude.md`: `aigon research-spec` replaced with a working command or removed
- [ ] `docs/agents/gemini.md`: `aigon research-spec` replaced with a working command or removed
- [ ] `docs/agents/codex.md`: `aigon research-spec` replaced with a working command or removed
- [ ] `docs/agents/cursor.md`: `aigon research-spec` replaced with a working command or removed

### Validation

- [ ] `grep -r 'aigon feature-implement\|aigon feature-done\|aigon research-conduct\|aigon research-done\|aigon feature-autopilot\|aigon feature-setup\|aigon worktree-open\|aigon research-spec' docs/ templates/ site/public/home.html` returns zero matches (excluding 05-done historical specs)

## Validation

```bash
node -c aigon-cli.js
# Verify no stale commands remain (excluding historical done specs)
! grep -r --include='*.md' --include='*.html' 'aigon feature-implement\|aigon feature-done\|aigon research-conduct\|aigon research-done\|aigon feature-setup\|aigon worktree-open\|aigon research-spec' docs/development_workflow.md docs/agents/ templates/ site/public/home.html
```

## Technical Approach

Pure find-and-replace across a known set of files. No code logic changes.

Command mapping:
- `aigon feature-implement` -> `aigon feature-do`
- `aigon feature-done` -> `aigon feature-close`
- `aigon research-conduct` -> `aigon research-do`
- `aigon research-done` -> `aigon research-close`
- `aigon feature-autopilot` -> `aigon feature-autonomous-start` (or shorter form for terminal demo readability)
- `aigon feature-setup` -> `aigon feature-start`
- `aigon worktree-open` -> `aigon feature-open`
- `aigon research-spec` -> remove or replace with `cat $(aigon feature-spec <id>)` pattern (there is no research-spec command)

After template changes, run `aigon install-agent cc` to sync working copies.

## Dependencies

- None

## Out of Scope

- Historical specs in `docs/specs/features/05-done/` that reference old command names (these are archives)
- Adding a `research-spec` command (that would be a separate feature)
- Updating the reference docs site pages (those already have correct command names per the audit)

## Open Questions

- [ ] For `aigon feature-autopilot` in the landing page demos: should we use `aigon feature-autonomous-start` (correct but long) or just show a shorter conceptual command?

## Related

- Feature 261 (entity-repair-command) — same review session discovered these issues
