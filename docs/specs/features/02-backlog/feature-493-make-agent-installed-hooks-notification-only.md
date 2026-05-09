---
complexity: medium
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

- [ ] Claude and Gemini installed templates (`templates/agents/cc.json`, `templates/agents/gg.json`) no longer run `aigon check-version` from `SessionStart`.
- [ ] A new read-only notification command `aigon update-notice` exists in `lib/commands/setup.js`, registered alongside `check-version`. It accepts `--json` for Gemini-style hook output.
- [ ] `aigon check-version` keeps its current behavior (write path) for direct CLI use; only the hook entrypoint changes. No new `--notify-only` flag is added (avoids two ways to do the same thing).
- [ ] `update-notice` reports: project sync needed when `.aigon/version` differs from current CLI version; npm registry notice when cached state indicates a newer package; suggested commands (`npm update -g @senlabsai/aigon@next`, `aigon update`) for the user to run manually.
- [ ] `update-notice` performs **no network calls**. It reads only the cached npm-update state written by `lib/npm-update-check.js`; if no cache exists it prints the version-comparison notice without an npm hint.
- [ ] `update-notice` must not call (verified by static grep in tests): `commands['update']`, `upgradeAigonCli`, `runPendingMigrations`, `runPendingGlobalConfigMigrations`, `install-agent`, `git add`, `git commit`, or any function that writes outside `~/.aigon/cache/`.
- [ ] Claude `SessionStart` and Gemini `SessionStart` use `aigon update-notice` (with `--json` for Gemini) instead of `aigon check-version`.
- [ ] All installed hooks (`SessionStart`, `SessionEnd`/`AfterAgent`, `Stop`) always exit `0`. Failures are logged to stderr but never propagate as non-zero exit codes that block the agent session.
- [ ] `aigon project-context` is audited: confirmed read-only (it reads `templates/generic/agents-md.md` and writes only to stdout). No timeout change required (existing 10s hook timeout is sufficient). No code change needed if the audit passes.
- [ ] **Bug fix folded in:** the `Architecture overview: \`docs/architecture.md\`` line is removed from `templates/generic/agents-md.md` and the equivalent line is removed from `templates/generic/cursor-rule.mdc`. That path only exists in the Aigon monorepo, so every target repo has been receiving a broken pointer at session start. Removing the line is the full fix — there is no equivalent target-repo doc to substitute.
- [ ] Claude `Stop` hook drops `aigon check-agent-submitted` (the only currently-blocking hook). The command itself stays in `lib/commands/misc.js` for direct CLI/diagnostic use but is no longer invoked from any installed hook.
- [ ] `aigon check-agent-signal` (Gemini `AfterAgent`) is confirmed advisory: code path always exits 0, never returns a blocking JSON response. Existing behavior is preserved.
- [ ] Telemetry capture hooks (`capture-session-telemetry`, `capture-gemini-telemetry`) wrap their work in try/catch and always exit 0 even if capture fails.
- [ ] Existing installs that still have `aigon check-version` baked into a stale `.claude/settings.json`/`.gemini/settings.json` keep working: `check-version` continues to exist as a CLI command. Hook templates are rewritten the next time `aigon update`/`install-agent` runs (no special migration step needed).
- [ ] Tests:
  - [ ] Integration test runs `aigon update-notice` in a temp git repo with a clean tree and asserts `git status --porcelain` is empty before and after.
  - [ ] Integration test runs `aigon update-notice --json` and asserts stdout is a single valid JSON object with at most a `systemMessage` key.
  - [ ] Unit test asserts `update-notice` source does not import or reference `commands['update']`, `upgradeAigonCli`, `runPendingMigrations`, `runPendingGlobalConfigMigrations` (grep-style assertion against the function body).
  - [ ] Integration test stubs `lib/npm-update-check.js` to throw and asserts `update-notice` still exits 0.

## Validation

```bash
# Syntax
node -c aigon-cli.js
node -c lib/commands/setup.js
node -c lib/commands/misc.js

# Hot loop during iteration
npm run test:iterate

# Read-only invariant smoke (manual sanity check during implementation):
# In a clean clone, capture git state, run the new hook entrypoint, confirm no diff.
( cd "$(mktemp -d)" \
  && git init -q && git commit -q --allow-empty -m init \
  && BEFORE=$(git status --porcelain) \
  && aigon update-notice --json \
  && AFTER=$(git status --porcelain) \
  && [ "$BEFORE" = "$AFTER" ] && echo "✅ no writes" || echo "❌ writes detected" )

# Pre-push gate (must pass before close)
npm run test:deploy
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

1. Add a new read-only notifier command `aigon update-notice` in `lib/commands/setup.js`. Do not add a `--notify-only` flag to `check-version` — two CLI surfaces for the same job invites drift.
2. The notifier reports:
   - project sync needed when `.aigon/version` differs from current CLI version
   - npm update available when **cached** registry state (read from whatever cache file `lib/npm-update-check.js` already maintains) indicates a newer package — never makes a fresh network call from the hook path
   - direct commands the user can run, such as `npm update -g @senlabsai/aigon@next` and `aigon update`
3. The notifier must not call `commands['update']`, `upgradeAigonCli`, `runPendingMigrations`, `runPendingGlobalConfigMigrations`, `install-agent`, `git add`, or `git commit`. A unit test asserts this via grep.
4. Update Claude/Gemini agent templates (`templates/agents/cc.json`, `templates/agents/gg.json`) so `SessionStart` calls `aigon update-notice` (with `--json` for Gemini) instead of `aigon check-version`.
5. Leave `project-context` unchanged. Audit confirms it is already read-only (template read → stdout). The only fix needed in this area is dropping the broken `docs/architecture.md` pointer from `templates/generic/agents-md.md` and `templates/generic/cursor-rule.mdc` (see Acceptance Criteria — that file is what the hook serves to every Claude/Gemini session in target repos).
6. Drop `aigon check-agent-submitted` from Claude `Stop` entirely. Keep the command in `lib/commands/misc.js` for direct CLI/diagnostic use, but no installed hook invokes it. The hook today only enforces arena agents (`feature-<id>-<agent>-<slug>` branches); solo Drive-mode sessions are unaffected by either the current behavior or its removal. **Replacement signal:** the dashboard already surfaces unsigned agents on the feature card (existing behavior). No new dashboard work in this feature; if the gap proves real in practice, file a follow-up to add a passive nudge or `feature-close` precondition.
7. Confirm `aigon check-agent-signal` (Gemini `AfterAgent`) is already advisory (it always exits 0 — verified in `lib/commands/misc.js`). No code change; verified by an integration test.
8. Wrap telemetry hooks (`capture-session-telemetry`, `capture-gemini-telemetry`) so any thrown exception is caught, logged to stderr, and the process still exits 0.
9. Add the tests listed in Acceptance Criteria (clean-tree assertion, JSON shape, static grep, npm-cache-failure swallowed).

## Dependencies

- No feature dependencies.

## Out of Scope

- Replacing all hook behavior with a full `aigon hook-run <event>` framework (Option D — good follow-up, not required here).
- Any change to the existing `aigon update` / `aigon check-version` write paths. They keep current behavior for direct CLI use; only the **hook entrypoint** changes.
- Changing workflow engine state transitions.
- Changing `agent-status` completion semantics.
- Removing transcript-based telemetry collection.
- Adding new dashboard UI for unsigned-agent enforcement (we rely on the existing surfacing; new UI is a follow-up if the gap proves real).
- Publishing a new npm package (release management is its own workflow).

## Open Questions

- (Resolved during spec review) Command name → `aigon update-notice` (no `check-version --notify-only` alias).
- (Resolved during spec review) `Stop` enforcement → drop the hook; rely on existing dashboard surfacing of unsigned agents. File a follow-up only if a gap shows up in practice.
- (Resolved during spec review) npm registry in hooks → cached state only, never a fresh network call.

No remaining open questions. New questions surfacing during implementation should be raised in the implementer's reasoning log, not added back here.

## Related

- Incident: Docker clean-room install exposed fragile agent hook behavior and noisy shell errors.
- Code: `templates/agents/cc.json`, `templates/agents/gg.json`, `templates/generic/agents-md.md`, `templates/generic/cursor-rule.mdc`, `lib/commands/setup.js` (`check-version`, `update`, `project-context`), `lib/commands/misc.js` (`check-agent-submitted`, `check-agent-signal`, `capture-*-telemetry`), `lib/npm-update-check.js`.
- F421: vendored `docs/` → `.aigon/docs/` so `development_workflow.md` and per-agent notes do exist in target repos. Confirms why dropping `docs/architecture.md` is the right fix (no equivalent target-repo doc to substitute).
