---
complexity: low
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-09T12:54:42.963Z", actor: "cli/feature-prioritise" }
---

# Feature: Make session hooks non-mutating

## Summary

Agent-installed `SessionStart` hooks currently rewrite project files. `aigon check-version` (run on every Claude / Gemini / Cursor session start) silently calls `aigon apply` when `.aigon/version` is stale, which reinstalls agents, runs migrations, and may auto-commit. That makes session startup a write path, which is fragile in clean Docker/Linux installs and surprising in customer repos.

This feature makes hooks **non-mutating**. `check-version` keeps printing the same drift notice it already prints; it just stops auto-syncing afterward. The user runs `aigon apply` themselves when they choose to. No new commands, no new versioning UI.

The broader question — *how should aigon coordinate versions across the global CLI, N repos on a machine, and the dashboard?* — is deferred to a separate research topic. Bolting an `update-notice` command and a dashboard surface onto the current per-repo `.aigon/version` model would lock in a versioning UX before we've decided what model we want.

## User Stories

- [ ] As an Aigon user starting Claude, Gemini, or Cursor, I see a clear notice when this project is behind the installed CLI, and I decide when to sync.
- [ ] As an Aigon user, starting an agent session never rewrites Aigon-managed files, reinstalls agents, runs migrations, or creates commits.
- [ ] As an Aigon maintainer, installed hooks are safe in Docker/Linux/macOS clean-room installs.
- [ ] As an Aigon maintainer, telemetry hooks are best-effort and cannot block or break the agent session.

## Acceptance Criteria

- [ ] `check-version` (`lib/commands/setup.js`) no longer calls `commands['update']`, `runPendingMigrations`, `runPendingGlobalConfigMigrations`, `upgradeAigonCli`, `install-agent`, `git add`, or `git commit`. It still prints the existing drift message (`🔄 Project sync needed (project: X, CLI: Y). Run \`aigon apply\`.`) and the existing npm-update notice.
- [ ] `aigon apply` is unchanged. Its current write-path behavior stays for direct CLI use; `aigon apply --pull` still works for clone-installed users.
- [ ] All session-start hooks across `templates/agents/cc.json`, `templates/agents/gg.json`, and `templates/agents/cu.json` (`extras.hooks` block, `.cursor/hooks.json`) keep calling `aigon check-version` — the hook payload doesn't change. Only the command's behavior does.
- [ ] All installed hooks (`SessionStart`, `SessionEnd`/`AfterAgent`, `Stop`) always exit `0`. Failures are logged to stderr but never propagate as non-zero exit codes that block the agent session.
- [ ] Telemetry hooks (`capture-session-telemetry`, `capture-gemini-telemetry` in `lib/commands/misc.js`) wrap their work in try/catch and always exit 0 even if capture fails.
- [ ] Claude `Stop` hook drops `aigon check-agent-submitted` from `templates/agents/cc.json`. The command stays in `lib/commands/misc.js` for direct CLI/diagnostic use but is no longer invoked from any installed hook. **Replacement signal — already in place:** the universal shell trap (`lib/worktree.js:780-789`, `trap _aigon_cleanup EXIT`) auto-calls `aigon agent-status <successStatus>` on every agent's session exit and is on by default for all six supported agents (`lib/worktree.js:413-414`). The Stop hook covered only 1 of 6 agents and fired between assistant turns rather than on actual exit, so dropping it removes nothing the shell trap doesn't already do.
- [ ] `aigon check-agent-signal` (Gemini `AfterAgent`) is verified advisory: code path always exits 0, never returns a blocking JSON response. No code change required; verified by an integration test.
- [ ] **Bug fix folded in:** the `Architecture overview: \`docs/architecture.md\`` line is removed from `templates/generic/agents-md.md` and the equivalent line is removed from `templates/generic/cursor-rule.mdc`. That path only exists in the Aigon monorepo, so every target repo has been receiving a broken pointer at session start. Removing the line is the full fix — there is no equivalent target-repo doc to substitute.
- [ ] Tests:
  - [ ] Integration test runs `aigon check-version` in a clean temp git repo with a stale `.aigon/version` and asserts `git status --porcelain` is empty before and after.
  - [ ] Static-grep test asserts `check-version` source body does not call `commands['update']`, `upgradeAigonCli`, `runPendingMigrations`, or `runPendingGlobalConfigMigrations`.
  - [ ] Integration test stubs telemetry capture to throw and asserts the hook still exits 0.

## Validation

```bash
# Syntax
node -c aigon-cli.js
node -c lib/commands/setup.js
node -c lib/commands/misc.js

# Hot loop during iteration
npm run test:iterate

# Read-only invariant smoke (manual sanity check during implementation):
( cd "$(mktemp -d)" \
  && git init -q && git commit -q --allow-empty -m init \
  && mkdir -p .aigon && echo "0.0.0" > .aigon/version \
  && BEFORE=$(git status --porcelain) \
  && aigon check-version \
  && AFTER=$(git status --porcelain) \
  && [ "$BEFORE" = "$AFTER" ] && echo "✅ no writes" || echo "❌ writes detected" )

# Pre-push gate
npm run test:deploy
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May add focused unit/integration tests for setup/version commands.
- May edit agent templates (`cc.json`, `gg.json`, `cu.json`) and the two generic templates (`agents-md.md`, `cursor-rule.mdc`).

## Technical Approach

### Problem

`templates/agents/cc.json`, `gg.json`, and `cu.json` (via `extras.hooks` → `.cursor/hooks.json`) all install a session-start hook that runs `aigon check-version`. In `lib/commands/setup.js`, `check-version` compares the CLI version with `.aigon/version` and, when they differ, calls `commands['update'](args)`. `update` rewrites managed project files, reinstalls detected agents, updates `.aigon/version`, and may auto-commit. The hook is therefore a write path. Hook failures are noisy in clean installs; hook successes mutate customer repos at session start.

### Recommended fix

Make `check-version` non-mutating in place. The two write branches in `lib/commands/setup.js` to remove:

1. The version-mismatch branch (around `setup.js:1153-1168`) currently does:
   ```
   console.log("🔄 Project sync needed ...");
   await commands['update'](args);
   await runPendingMigrations(...);
   ```
   Replace with: keep the log line; append `"   Run \`aigon apply\` to sync."`. Drop the `update` and `runPendingMigrations` calls.

2. The config-changed branch (around `setup.js:1181-1188`) currently does:
   ```
   console.log("🔄 Config change detected. Reinstalling agents...");
   await commands['update'](args);
   ```
   Replace with: keep the log line; append `"   Run \`aigon apply\` to apply."`. Drop the `update` call.

Everything else in `check-version` stays — the npm registry notice, the origin-behind notice, the `--json` output shape, the `runGlobalConfigMigrations()` calls (which write to `~/.aigon/`, not the project, and are out of scope for "non-mutating in the project").

The `Stop` hook removal, telemetry try/catch wrappers, broken-pointer fix, and `check-agent-signal` verification are independent mechanical edits that ship alongside.

### Why no new `update-notice` command

We considered adding `aigon apply-notice` as a separate read-only command and rewriting the hooks to call it. We rejected it because:

- It introduces a second CLI surface for the same job, which invites drift.
- The drift problem it makes more visible (per-repo `.aigon/version` vs global CLI vs dashboard runtime) is a model question, not a UI question. Layering UI over a confused model locks in the model.

Both questions are deferred to a research topic on the aigon versioning model (see Related).

### Hooks remaining after this feature lands

CLI hooks installed in agent settings:

- **Claude (`cc.json`)**
  - `SessionStart`: `aigon check-version`, `aigon project-context` — both read-only after this feature, always exit 0
  - `SessionEnd`: `aigon capture-session-telemetry` — best-effort, errors swallowed, always exit 0
  - `Stop`: *(removed — was `aigon check-agent-submitted`)*
- **Gemini (`gg.json`)**
  - `SessionStart`: `aigon check-version --json`, `aigon project-context --json` — both read-only after this feature, always exit 0
  - `AfterAgent`: `aigon check-agent-signal --json` (advisory, already exits 0), `aigon capture-gemini-telemetry` (best-effort, errors swallowed)
- **Cursor (`cu.json`)**
  - `sessionStart` (`.cursor/hooks.json`): `aigon check-version`, `aigon project-context` — both read-only after this feature, always exit 0
- **Codex / Kimi / OpenCode (`cx.json`, `km.json`, `op.json`)**: their CLIs do not expose a hook framework — there is no event we can subscribe to. Users on these agents see no session-startup update notice. Closing that gap is part of the deferred versioning research.

Universal lifecycle infrastructure (unchanged):

- **Shell trap** (`lib/worktree.js:780-789`) — wraps every agent CLI; on exit auto-runs `aigon agent-status <successStatus>` (or `error`). On by default for all agents. This is the primary completion-signal enforcement; the dropped `Stop` hook was a partial duplicate.
- **Heartbeat sidecar** (`lib/worktree.js:639-661`) — background `touch`-loop tied to the parent PID; consumed by `lib/workflow-heartbeat.js` for the SIGKILL/crash cases the trap can't catch.

## Dependencies

- No feature dependencies.

## Out of Scope

- New `aigon apply-notice` command. Deferred — `check-version` itself is non-mutating after this feature.
- Any change to the versioning model: per-repo `.aigon/version`, global CLI version, npm registry checks, dashboard runtime version. Deferred to research (see Related).
- Multi-repo update UX (e.g. `aigon apply --all`, known-repos registry). Deferred to research.
- Dashboard surfacing of update availability. Deferred to research.
- Replacement enforcement for the dropped `Stop` hook beyond confirming the shell trap covers it.
- Any change to the existing `aigon apply` write path. It stays as-is for direct CLI use.
- Replacing all hook behavior with a full `aigon hook-run <event>` framework.
- Changing workflow engine state transitions or `agent-status` completion semantics.
- Removing transcript-based telemetry collection.
- Publishing a new npm package.

## Open Questions

None. Direction was decided in the spec-review/spec-revise pass.

## Related

- Incident: Docker clean-room install exposed fragile agent hook behavior and noisy shell errors.
- Research (to be filed alongside this revise pass): "Aigon versioning model and multi-repo update UX" — should `.aigon/version` exist? What's the right multi-repo story? Where does the dashboard fit?
- Code touched: `lib/commands/setup.js` (`check-version`), `lib/commands/misc.js` (`capture-session-telemetry`, `capture-gemini-telemetry`, `check-agent-submitted` removal from cc Stop), `templates/agents/cc.json` (drop Stop block), `templates/agents/gg.json` (no behavior change — verified `check-agent-signal` advisory), `templates/agents/cu.json` (no payload change — `check-version` itself is now safe), `templates/generic/agents-md.md` (drop architecture line), `templates/generic/cursor-rule.mdc` (drop architecture line).
- F421: vendored `docs/` → `.aigon/docs/` so `development_workflow.md` and per-agent notes do exist in target repos. Confirms why dropping `docs/architecture.md` is the full fix (no equivalent target-repo doc to substitute).
