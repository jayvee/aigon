# Feature: rename feature-review → feature-code-review

## Summary

Rename the `feature-review` command (and its companion `feature-review-check`) to
`feature-code-review` / `feature-code-review-check` to eliminate confusion with the
existing `feature-spec-review` / `feature-spec-review-check` commands.

The current naming implies "review of the feature" without specifying what is being
reviewed. With spec-review and code-review coexisting, unambiguous names are essential
for users and agents reading help output, templates, and command listings.

## Acceptance criteria

- [ ] `aigon feature-code-review <ID>` works identically to the current `aigon feature-review <ID>`
- [ ] `aigon feature-code-review-check [ID]` works identically to the current `aigon feature-review-check [ID]`
- [ ] Old commands (`feature-review`, `feature-review-check`) emit a deprecation notice and delegate to the new names (one-release grace period, then remove)
- [ ] Aliases updated: `afr` → `feature-code-review`, `afrc` → `feature-code-review-check`
- [ ] `ManualActionKind.FEATURE_REVIEW` renamed to `FEATURE_CODE_REVIEW`; `FEATURE_REVIEW_CHECK` → `FEATURE_CODE_REVIEW_CHECK`
- [ ] All generic command templates updated (`templates/generic/commands/afr.md`, `afrc.md`, new `afcr.md`/`afcrc.md` if aliases change)
- [ ] All agent config templates updated (`.claude/`, `.cursor/`, `.gemini/`, `.codex/`, `.agents/skills/`) — regenerated via `aigon install-agent`
- [ ] `docs/development_workflow.md` and any docs referencing `feature-review` updated
- [ ] Public docs site updated:
  - `site/content/reference/commands/feature/feature-review.mdx` renamed to `feature-code-review.mdx` with title/synopsis updated
  - `site/content/reference/commands/feature/_meta.tsx` entry updated from `"feature-review"` to `"feature-code-review"`
  - `site/content/reference/commands/index.mdx` link updated
  - All inline references updated (`guides/drive-mode.mdx`, `guides/fleet-mode.mdx`, `guides/autopilot-mode.mdx`, `guides/telemetry.mdx`, `concepts/evaluation.mdx`, `reference/commands/feature/feature-autonomous-start.mdx`)
  - Add `feature-code-review-check.mdx` if a `feature-review-check` doc page is added (currently none exists)
- [ ] `agent-prompt-resolver.js` verb mapping updated (`review` → `code-review`, `review-check` → `code-review-check`)
- [ ] Tests updated: `agent-prompt-resolver.test.js`, `command-registry-drift.test.js`, any lifecycle tests
- [ ] `getLaunchMode()` in `templates/dashboard/js/actions.js` updated to match new action names
- [ ] Existing installed repos: document migration path (re-run `aigon update` / `aigon install-agent`)

## Out of scope

Renaming research equivalents (`research-review`) is a separate decision — leave for a follow-up.

## Notes

The dashboard UI label was already updated to "Code Review" / "Check Code Review" as part of
the wiring fix that added the missing `feature-review-check` menu item (same session).
This feature covers the underlying CLI and template layer to match.
