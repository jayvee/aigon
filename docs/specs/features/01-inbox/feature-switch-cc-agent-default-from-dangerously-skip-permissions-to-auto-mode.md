# Feature: Switch CC agent default from --dangerously-skip-permissions to auto mode

## Summary

Replace `--dangerously-skip-permissions` with Claude Code's new `--permission-mode auto` (auto mode) as the default CC agent permission flag. Auto mode runs a safety classifier before each tool execution, blocking destructive actions while still allowing autonomous operation — providing the same developer experience but with a safety net. Currently the global config (`~/.aigon/config.json`) overrides the template default of `acceptEdits` with `--dangerously-skip-permissions`, which has zero safety checks.

## User Stories

- [ ] As an aigon user, I want CC agents to run autonomously with destructive-action protection so I don't risk accidental mass deletes or data exfiltration from a runaway agent
- [ ] As an aigon user, I want the template default and docs to reflect auto mode as the recommended permission level

## Acceptance Criteria

- [ ] `cc.json` template `implementFlag` changed from `--permission-mode acceptEdits` to `--permission-mode auto`
- [ ] Global config migration: `aigon update` or `aigon install-agent cc` detects the old `--dangerously-skip-permissions` value in global/project config and prompts the user to switch to `--permission-mode auto`
- [ ] Documentation updated: `docs/agents/claude.md`, configuration reference, and any permission-related docs reflect auto mode as the recommended default
- [ ] `aigon doctor` warns if it detects `--dangerously-skip-permissions` in global or project config

## Validation

```bash
node --check aigon-cli.js
```

## Technical Approach

1. **Template change**: Update `templates/agents/cc.json` `cli.implementFlag` to `--permission-mode auto`
2. **Config migration**: In `install-agent` or `update`, check if `agents.cc.implementFlag` is `--dangerously-skip-permissions` and offer to migrate
3. **Doctor check**: Add a warning in `aigon doctor` for deprecated permission flags
4. **Prerequisite**: Auto mode requires `claude --enable-auto-mode` as a one-time opt-in — document this in setup instructions

## Dependencies

- **External**: Claude Code auto mode must be GA (currently research preview, Team plan only). Do not implement until auto mode is available on all plans.

## Out of Scope

- Changing permission models for other agents (gg, cx, cu)
- Modifying the `permissions.allow` / `permissions.deny` lists in settings.json (these remain as defense-in-depth)

## Open Questions

- What is the exact CLI flag syntax once GA? Blog says `--enable-auto-mode` for opt-in, but runtime flag may be `--permission-mode auto` — verify when available
- Does auto mode work correctly with `--print` / non-interactive mode used by agent spawning?
- Will the classifier's false positives cause issues in autonomous loops (e.g., blocking legitimate `rm` during cleanup)?

## Related

- Blog post: https://claude.com/blog/auto-mode
- Research: research-06 (CC findings, line 81 — `--dangerously-skip-permissions` reference)
- Global config: `~/.aigon/config.json` → `agents.cc.implementFlag`
