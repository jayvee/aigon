# Feature: command-metadata-improvements

## Summary

Improve slash command UX across agents by: (1) moving Claude Code commands into a subdirectory to reduce menu clutter, (2) adding `argument-hint` frontmatter to templates for CC and CX, and (3) adding `disable-model-invocation` to destructive commands for CC. These are incremental, no-regret improvements identified by research-03 that address the primary pain of 18 flat commands cluttering the slash menu.

## User Stories

- [ ] As a Claude Code user, I want aigon commands grouped under a namespace so I can find them quickly without scrolling through 18 flat entries
- [ ] As a user of any agent, I want to see what arguments a command expects before running it
- [ ] As a Claude Code user, I want destructive commands (feature-done, feature-cleanup, worktree-open) protected from accidental autonomous invocation

## Acceptance Criteria

- [ ] Claude Code commands install to `.claude/commands/aigon/` instead of `.claude/commands/` with prefix
- [ ] CC commands appear as `/project:aigon:feature-create` (or equivalent namespaced format) in the slash menu
- [ ] Gemini commands continue to work unchanged (already in `.gemini/commands/aigon/`)
- [ ] Codex and Cursor commands continue to work unchanged (flat structure preserved)
- [ ] Templates emit `argument-hint` frontmatter for CC (e.g., `argument-hint: "<feature-name>"` for create, `"<ID> [agents...]"` for setup)
- [ ] Templates emit appropriate `args` frontmatter for CX (per-command, not hardcoded `feature_id` for all)
- [ ] `feature-done`, `feature-cleanup`, and `worktree-open` templates emit `disable-model-invocation: true` for CC
- [ ] `aigon install-agent cc` produces correctly structured output
- [ ] `aigon update` works correctly with the new directory structure

## Technical Approach

1. **Subdirectory grouping (CC):** Update `templates/agents/cc.json` to change `commandDir` to `.claude/commands/aigon` and remove the `aigon-` prefix (the subdirectory provides the namespace). Verify `safeWrite` creates the nested directory.

2. **Argument hints:** Add a `argumentHint` field to each template's metadata (or a lookup in `aigon-cli.js`) mapping command names to hint strings. Update `formatCommandOutput()` to emit `argument-hint` in CC frontmatter and per-command `args` in CX frontmatter.

3. **Safety frontmatter:** Add a `disableModelInvocation` flag to destructive command templates. Update CC output formatting to emit `disable-model-invocation: true` when the flag is set.

## Dependencies

- None — all changes are internal to Aigon's template pipeline

## Out of Scope

- Router/consolidated commands (deferred — may not be needed after this)
- CLI nested command support (`aigon feature create` syntax)
- Positional arg syntax changes (`$1`/`$2` instead of `{{args}}`)
- Changes to Cursor or Gemini command structure
- Skills migration for any agent

## Open Questions

- What is the exact CC slash menu format for subdirectory commands — `/project:aigon:feature-create` or something else? Needs verification.
- Should `aigon update` clean up old flat commands from `.claude/commands/` during migration?

## Related

- Research: `docs/specs/research-topics/04-done/research-03-simplify-command-parameters.md`
- Findings: `docs/specs/research-topics/logs/research-03-cc-findings.md`, `research-03-gg-findings.md`, `research-03-cx-findings.md`
