# Feature: feature-ship-command

## Summary

Add `aigon feature-ship <name-or-id>` — a single command that runs the full autonomous pipeline from inbox/backlog all the way through to deployment: prioritise (if needed) → setup → implement --ralph --auto-submit → feature-close → deploy.

## User Stories

- [ ] As a developer, I want to run one command and have a feature go from inbox to production without touching the keyboard again, so I can work on something else while it runs
- [ ] As a developer, I want the ship command to stop safely and report clearly if Ralph exhausts all iterations or if deploy fails, so I always know the outcome

## Acceptance Criteria

- [ ] `aigon feature-ship <name>` accepts an inbox feature name (slug or partial match) and runs the full pipeline
- [ ] `aigon feature-ship <ID>` accepts a backlog ID and skips the prioritise step
- [ ] Pipeline stages printed with progress headers: `[1/4] Prioritising...`, `[2/4] Setting up...`, `[3/4] Implementing (Ralph)...`, `[4/4] Deploying...`
- [ ] If `commands.deploy` is not configured, command completes after `feature-close` with a warning — does not error
- [ ] If Ralph exhausts all iterations without passing, command stops and reports failure — does NOT proceed to `feature-close` or `deploy`
- [ ] If `feature-close` fails, command stops and reports the error — does NOT run `deploy`
- [ ] `aigon feature-ship --dry-run <name>` prints the planned pipeline steps without executing
- [ ] Alias `afsh` → `feature-ship`

## Validation

```bash
node -c aigon-cli.js
```

## Technical Approach

Add `'feature-ship'` to the commands object in `aigon-cli.js`:

1. Resolve input: numeric arg → backlog ID, string → find in inbox via `findFile()`
2. If inbox name: run `feature-prioritise` logic to assign ID, move to backlog
3. Run `feature-setup` logic (solo mode)
4. Spawn `aigon feature-do <ID> --ralph --auto-submit` as a child process with `spawnSync(..., { stdio: 'inherit', shell: true })` — Ralph manages its own complex output; cleaner to shell out than inline
5. Check exit code — non-zero → stop with failure message
6. Run `feature-close` logic inline
7. Call `runDeployCommand()` if `commands.deploy` is configured in `.aigon/config.json`

Add to `COMMAND_ALIASES`: `'afsh': 'feature-ship'`
Add to `COMMAND_ARG_HINTS`: `'feature-ship': '<name-or-ID> [--dry-run]'`
Add to `COMMANDS_DISABLE_MODEL_INVOCATION`
Add to help output under Feature Commands

## Dependencies

- `resolveDeployCommand()` / `runDeployCommand()` — feature 36
- `feature-prioritise`, `feature-setup`, `feature-close` existing logic
- `feature-do --ralph --auto-submit` — features 35

## Out of Scope

- Arena mode (ship is solo-only — arena requires human evaluation)
- Automatic retry if deploy fails
- `--adopt` support

## Open Questions

-

## Related

- Feature 35: --auto-submit
- Feature 36: deploy command
- Feature B: vscode-context-menu (will call this command)
