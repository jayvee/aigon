---
complexity: medium
research: 48
set: apply-model
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-10T09:02:05.662Z", actor: "cli/feature-prioritise" }
---

# Feature: apply-5-multi-repo-registry

## Summary

A machine-local registry of aigon repos so a single command (`aigon apply --all`) can re-apply across every known repo, and the dashboard's Phase 3 pill (feature #4) can list all stale repos rather than just the current one. Uses the **existing `~/.aigon/config.json` `repos` array** — already read by `readConductorReposFromGlobalConfig()` (`lib/config.js:879`) and already auto-populated by `autoRegisterRepoIfNeeded()` (`lib/commands/infra.js:43`) when the server starts. `aigon apply` gains a call to `autoRegisterRepoIfNeeded()` so repos are registered even without a running server. Plus an `npm postinstall` hook on `@senlabsai/aigon` that lists which known repos are now behind after a CLI upgrade.

## User Stories

- [ ] As a customer who has aigon-applied to 8 repos, I run `aigon apply --all` from anywhere and every repo gets re-applied with an aggregated success/failure report.
- [ ] As a customer who just ran `npm update -g @senlabsai/aigon`, I see in the npm output a list of which of my known repos are now behind, with `aigon apply --all` quoted as the next command.
- [ ] As a customer with stale registry entries (a repo I deleted months ago), `aigon apply --all` and `aigon server repos list` skip them silently — the registry self-prunes on read.
- [ ] As a dashboard user, the Phase 3 panel (from feature #4) lists all known repos with per-row stale-state, not just the current one.

## Acceptance Criteria

- [ ] On every `aigon apply` invocation, `autoRegisterRepoIfNeeded(repoPath)` is called — writing the repo path into `~/.aigon/config.json` `repos` array if not already present. (`install-agent` and `init` already call it via server start; `apply` is the gap.)
- [ ] On every read of the registry, paths that no longer exist or have no `.aigon/` dir are skipped silently (already handled by `readConductorReposFromGlobalConfig` callers).
- [ ] New CLI flag: `aigon apply --all` reads `readConductorReposFromGlobalConfig()` and runs `aigon apply` per repo, sequentially. Aggregate exit code: zero if all succeed, non-zero if any fail. Per-repo output grouped and labeled `[i/n] <repo>: <status>`.
- [ ] `aigon apply --all` skips repos already at the current digest (no-op fast path).
- [ ] `npm postinstall` hook on `@senlabsai/aigon` runs `aigon installed-notice` (new command) that reads `readConductorReposFromGlobalConfig()` and prints:
  ```
  ✓ aigon upgraded to vX.Y
    N of your M known repos were applied with an older aigon:
      <repo-path-1>  (applied vX.Z)
      <repo-path-2>  (applied vX.Z)
    Re-apply all:  aigon apply --all
  ```
- [ ] `aigon installed-notice` is silent when no known repos exist (first-time install) or all repos are current.
- [ ] No new files, no new schema, no migrations. Storage is the existing `repos` array in `~/.aigon/config.json`.
- [ ] Dashboard backend (feature #4) already reads `readConductorReposFromGlobalConfig()` — no new wiring needed for the Phase 3 multi-repo panel.

## Validation

```bash
node --check lib/commands/infra.js
# Apply in two repos, verify both appear in config
mkdir -p /tmp/repo-a /tmp/repo-b && cd /tmp/repo-a && git init -q && aigon apply
cd /tmp/repo-b && git init -q && aigon apply
aigon server repos list | grep -c "/tmp/repo-" # 2
# Delete one repo, verify registry skips it on read
rm -rf /tmp/repo-a
aigon server repos list | grep -c "/tmp/repo-" # 1
# apply --all skips current repos
aigon apply --all | grep -q "skipped"
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets.

## Technical Approach

**Existing registry.** `~/.aigon/config.json` already has a `repos: []` array. Three functions already own it:
- `readConductorReposFromGlobalConfig()` — `lib/config.js:879` — reads the array, exported
- `writeRepoRegistry(repos)` — `lib/dashboard-server.js` — writes the array back
- `autoRegisterRepoIfNeeded(repoPath)` — `lib/commands/infra.js:43` — adds current repo if absent; called today only on server start

**Gap to close.** Add one call to `autoRegisterRepoIfNeeded(repoPath)` in the `apply` command handler (after confirming it's a valid aigon repo). This ensures repos are registered even when no server has ever been started.

**`aigon apply --all`.** New flag handler in `apply` command:

```js
if (args.includes('--all')) {
  const { readConductorReposFromGlobalConfig } = require('../config');
  const repos = readConductorReposFromGlobalConfig()
    .filter(r => fs.existsSync(path.join(r, '.aigon')));
  const results = [];
  for (const repo of repos) {
    results.push(await applyOne(repo));
  }
  reportAggregate(results);
  process.exit(results.some(r => r.failed) ? 1 : 0);
}
```

Per-repo apply runs in sequence (not parallel — apply does git operations). Stream progress with `[<i>/<n>] <repo>: <status>`.

**npm postinstall hook.** Add to `package.json`:

```json
"scripts": {
  "postinstall": "node ./scripts/installed-notice.js || true"
}
```

The `|| true` ensures a broken notice never breaks installs. The script calls `readConductorReposFromGlobalConfig()`, computes digest delta per repo, and prints the notice block. Silent if nothing to say.

**`aigon installed-notice` command.** Same logic as postinstall script, exposed as a CLI verb for manual re-display.

**Privacy.** Document in help text that repo paths are stored in `~/.aigon/config.json`. No upload, no telemetry.

## Dependencies

- depends_on: apply-3-session-drift-notice

## Out of Scope

- Concurrent (parallel) apply across repos. Sequential is safer for git operations.
- Cloud sync of the registry. Pure local.
- A separate `aigon repos` top-level command. `aigon server repos list/add/remove` already exists.
- Do worktrees get registered? No — worktrees skip `.aigon/version` writes today (per `lib/version.js:30-31`); skip `autoRegisterRepoIfNeeded` in apply for the same reason. Avoids registry pollution from feature-close cycles.

## Open Questions

- What happens if the user has 200 repos and `apply --all` takes minutes? Default: print live progress, no parallelism, let it run. Add a `--parallel N` flag later if needed.

## Related

- Research: #48 aigon-versioning-model-and-multi-repo-update-ux
- Set: apply-model
- Prior features in set: apply-1, apply-2, apply-3
