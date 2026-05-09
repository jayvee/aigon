---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-09T12:54:42.963Z", actor: "cli/feature-prioritise" }
---

# Feature: Make agent installed hooks notification only

## Summary

Agent-installed hooks currently mix lightweight session notices with heavyweight write paths. Claude and Gemini startup hooks run `aigon check-version`, and `check-version` can call `aigon update`, rewrite managed project files, reinstall agents, run migrations, and auto-commit. That is too much authority for an agent-session hook: hook failures are noisy and fragile in clean Docker/Linux installs, while hook success can unexpectedly mutate a customer repo during agent startup. Preserve the useful session-visible update notice, but make installed hooks read-only, best-effort, and unable to modify project state.

## User Stories

- [ ] As an Aigon user starting Claude or Gemini, I see a clear notice when my project or global Aigon install needs attention.
- [ ] As an Aigon user, starting an agent session never rewrites Aigon-managed files, reinstalls agents, runs migrations, or creates commits.
- [ ] As an Aigon maintainer, installed hooks are safe in Docker/Linux/macOS and do not rely on `/bin/zsh` or login-shell behavior for correctness.
- [ ] As an Aigon maintainer, telemetry hooks are best-effort and cannot block or break the agent session.

## Acceptance Criteria

- [ ] Claude and Gemini installed templates no longer run `aigon check-version` from `SessionStart`.
- [ ] A new read-only notification command exists, for example `aigon update-notice` or `aigon check-version --notify-only`.
- [ ] The notification command compares the current CLI package version, project `.aigon/version`, and cached/npm registry update state where available.
- [ ] The notification command never calls `aigon update`, `install-agent`, migration runners, `git add`, `git commit`, or any other project write path.
- [ ] Claude and Gemini startup hooks use the new read-only notifier and continue to surface session-visible messages.
- [ ] Hook commands always exit `0` unless invoked directly in a diagnostic mode.
- [ ] `project-context` remains available to agent startup only if it is best-effort and read-only.
- [ ] Telemetry capture hooks remain best-effort or are replaced with an equivalent non-blocking capture path.
- [ ] Tests prove the read-only notifier does not change `git status --short` in a clean repo.
- [ ] Tests cover JSON hook output for Gemini-compatible hook responses.

## Validation

```bash
node -c aigon-cli.js
node -c lib/commands/setup.js
node -c lib/commands/misc.js
npm test -- --runInBand
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May add focused unit/integration tests for setup/version commands.
- May update agent templates and installed-hook migration logic.

## Technical Approach

### Problem

Current installed hooks:

- Claude `SessionStart` runs `aigon check-version` and `aigon project-context` from `templates/agents/cc.json`.
- Claude `SessionEnd` runs `aigon capture-session-telemetry`.
- Claude `Stop` runs `aigon check-agent-submitted`.
- Gemini `SessionStart` runs `aigon check-version --json` and `aigon project-context --json` from `templates/agents/gg.json`.
- Gemini `AfterAgent` runs `aigon check-agent-signal --json` and `aigon capture-gemini-telemetry`.

The risky part is `check-version`. In `lib/commands/setup.js`, `check-version` compares the CLI version with `.aigon/version`, and when they differ it calls `commands['update'](args)`. `update` rewrites managed project files, reinstalls detected agents, updates `.aigon/version`, and may auto-commit the changes.

That means an agent startup hook is currently a write path. This conflicts with the desired hook contract: hooks may enrich or warn, but they should not mutate repo state or block normal agent execution.

### Options

Option A: Remove all installed hooks.

- Pros: eliminates hook fragility immediately.
- Cons: users lose session-visible update notices, startup project context, and best-effort telemetry capture.
- Verdict: too blunt before replacing telemetry/context paths.

Option B: Keep current hooks but make shell execution more portable.

- Pros: smaller implementation.
- Cons: preserves the core design bug: `check-version` can still mutate project state from agent startup.
- Verdict: insufficient on its own.

Option C: Split notification from update and keep hooks read-only.

- Pros: users still see update notices in agent sessions; hooks cannot rewrite repos or block sessions; project sync stays explicit.
- Cons: requires a new command path and tests.
- Verdict: recommended.

Option D: Move all hook behavior behind `aigon hook-run <event>`.

- Pros: clean long-term API with centralized logging, JSON output, and compatibility handling.
- Cons: larger migration; not necessary to make the next package safe.
- Verdict: good follow-up, not required for this immediate fix.

### Recommended Solution

Implement Option C now.

1. Add a read-only notifier command, named either `aigon update-notice` or `aigon check-version --notify-only`.
2. The notifier should report:
   - project sync needed when `.aigon/version` differs from current CLI version
   - npm update available when cached or fresh registry state indicates a newer package
   - direct commands the user can run, such as `npm update -g @senlabsai/aigon@next` and `aigon update`
3. The notifier must not call `commands['update']`, `upgradeAigonCli`, `runPendingMigrations`, `runPendingGlobalConfigMigrations`, `install-agent`, `git add`, or `git commit`.
4. Update Claude/Gemini agent templates so startup hooks call the notifier instead of `check-version`.
5. Keep `project-context` only as read-only best-effort startup context.
6. Remove or soften enforcement hooks:
   - Prefer removing `check-agent-submitted` from Claude `Stop`, or make it advisory and always exit `0`.
   - Keep `check-agent-signal` advisory only.
7. Keep telemetry hooks best-effort for now, but ensure their errors are swallowed and logged quietly.
8. Add tests that invoke the notifier in a temp repo and assert no file changes.

## Dependencies

- No feature dependencies.

## Out of Scope

- Replacing all hook behavior with a full `aigon hook-run <event>` framework.
- Changing workflow engine state transitions.
- Changing `agent-status` completion semantics.
- Removing transcript-based telemetry collection.
- Publishing a new npm package.

## Open Questions

- Should the command name be a new explicit `aigon update-notice`, or should this be `aigon check-version --notify-only`?
- Should Claude `Stop` keep any blocking behavior, or should all stop/signal checks become advisory only?
- Should npm registry checks in hooks use only cached state to avoid network calls during agent startup?

## Related

- Incident: Docker clean-room install exposed fragile agent hook behavior and noisy shell errors.
- Code: `templates/agents/cc.json`, `templates/agents/gg.json`, `lib/commands/setup.js`, `lib/commands/misc.js`.
