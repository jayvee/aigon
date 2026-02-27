# Feature: command-display-preference

## Summary
Add a user preference that controls whether aigon shows long-form (`/aigon:feature-submit`) or short-form (`/afs`) command names in all output: board suggestions, completion messages, help text, and command templates. Default to short.

## User Stories
- [ ] As a new user, I want to see long-form commands until I learn the shortcuts, then switch to short
- [ ] As an experienced user, I want all suggested commands in short form so I can act fast
- [ ] As a user installing aigon in a shared project, I want the team to agree on a display style

## Acceptance Criteria
- [ ] New config option `commandStyle` in `.aigon/config.json` with values `"short"` (default) or `"long"`
- [ ] A new template placeholder `{{CMD_SHORT_PREFIX}}` resolves to `/` when short, `{{CMD_PREFIX}}` when long
- [ ] Board output, feature-submit completion messages, help text, and all "next step" suggestions respect the preference
- [ ] `aigon config set commandStyle short|long` CLI command to toggle
- [ ] Short form always uses `a`-prefixed aliases (e.g., `/afs`, `/afi`, `/ab`)
- [ ] Long form uses full namespaced commands (e.g., `/aigon:feature-submit`)
- [ ] When short is active, a lookup map is available so templates can resolve `feature-submit` → `afs`
- [ ] `node --check aigon-cli.js` passes

## Validation
```bash
node --check aigon-cli.js
```

## Technical Approach
- Add `commandStyle` to `.aigon/config.json` schema (default: `"short"`)
- Create a `getCommandRef(cmdName)` helper that returns the display form:
  - short: `/${COMMAND_ALIASES_REVERSE[cmdName]}` (e.g., `/afs`)
  - long: `/${agentPrefix}${cmdName}` (e.g., `/aigon:feature-submit`)
- Add `CMD_REF_*` placeholders for commonly referenced commands in templates:
  - `{{CMD_REF_SUBMIT}}` → `/afs` or `/aigon:feature-submit`
  - `{{CMD_REF_EVAL}}` → `/afe` or `/aigon:feature-eval`
  - etc.
- Process these during `install-agent` based on the active config
- For CLI output (board, help), read the config at runtime

## Dependencies
- Command aliases feature (must exist first)

## Out of Scope
- Per-command override (all or nothing)
- Different preferences per agent (project-wide setting)
- Changing the actual command file names (just display)

## Open Questions
- Should `aigon help` always show both forms regardless of preference? Recommend: yes, show short as primary with long in parentheses.

## Related
- Feature: command-aliases (prerequisite)
- Feature: board-action-hub (consumer of this preference)
- Feature: context-aware-next (consumer of this preference)
