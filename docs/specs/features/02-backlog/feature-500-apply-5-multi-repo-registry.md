---
complexity: medium
research: 48
set: apply-model
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-10T09:02:05.662Z", actor: "cli/feature-prioritise" }
---

# Feature: apply-5-multi-repo-registry

## Summary

A machine-local registry of aigon repos so a single command (`aigon apply --all`) can re-apply across every known repo, and the dashboard's Phase 3 pill (feature #4) can list all stale repos rather than just the current one. Uses **filesystem markers** (`~/.aigon/repos/<sha256(repoPath)>` files containing the repo path) — auto-pruning on read, no JSON schema, no race conditions, no migration story. Plus an `npm postinstall` hook on `@senlabsai/aigon` that lists which known repos are now behind after a CLI upgrade.

## User Stories

- [ ] As a customer who has aigon-applied to 8 repos, I run `aigon apply --all` from anywhere and every repo gets re-applied with an aggregated success/failure report.
- [ ] As a customer who just ran `npm update -g @senlabsai/aigon`, I see in the npm output a list of which of my known repos are now behind, with `aigon apply --all` quoted as the next command.
- [ ] As a customer with stale registry entries (a repo I deleted months ago), `aigon apply --all` and `aigon repos list` skip them silently — the registry self-prunes on read.
- [ ] As a customer who works in a Docker-mounted ephemeral repo, the registry doesn't fill up with marker files — markers are written only on aigon commands that *read* `.aigon/`, and stale paths skip on read.
- [ ] As a dashboard user, the Phase 3 panel (from feature #4) lists all known repos with per-row stale-state, not just the current one.

## Acceptance Criteria

- [ ] On every `aigon apply`, `aigon install-agent`, `aigon init`, and `aigon check-version` invocation, a marker file `~/.aigon/repos/<sha256(absoluteRepoPath)>` is created (or touched) containing the absolute repo path as text content.
- [ ] On every read of the registry, paths whose marker target no longer exists (or is no longer a valid aigon repo — no `.aigon/` dir) are skipped. No active pruning command is required.
- [ ] New CLI: `aigon repos list` walks the registry, prints absolute paths of known live repos, with applied-version per repo.
- [ ] New CLI flag: `aigon apply --all` walks the registry and runs `aigon apply` per repo. Aggregate exit code: zero if all succeed, non-zero if any fail. Per-repo output is grouped and labeled.
- [ ] `aigon apply --all` skips repos already at the current digest (no-op fast path).
- [ ] `npm postinstall` hook on `@senlabsai/aigon` runs a small `aigon installed-notice` command (new) that reads the registry and prints, after npm's own output:
  ```
  ✓ aigon upgraded to vX.Y
    N of your M known repos were applied with an older aigon:
      <repo-path-1>  (applied vX.Z)
      <repo-path-2>  (applied vX.Z)
    Re-apply all:  aigon apply --all
  ```
- [ ] `aigon installed-notice` is silent when no known repos exist (first-time install) or all repos are current.
- [ ] No JSON file. No central manifest. No migrations. Pure filesystem.
- [ ] Marker writes are atomic (use a temp file + rename, or just write since content is the path string only).
- [ ] Dashboard backend (feature #4) reads the registry to populate the Phase 3 multi-repo panel.

## Validation

```bash
node --check lib/version.js
# Apply in two repos, verify both have markers
mkdir -p /tmp/repo-a /tmp/repo-b && cd /tmp/repo-a && git init -q && aigon apply
cd /tmp/repo-b && git init -q && aigon apply
ls ~/.aigon/repos/ | wc -l   # should be >= 2
# repos list shows both
aigon repos list | grep -c "/tmp/repo-" # 2
# Delete one repo, verify registry skips it on read
rm -rf /tmp/repo-a
aigon repos list | grep -c "/tmp/repo-" # 1
# apply --all skips current repos
aigon apply --all | grep -q "skipped"
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets.

## Technical Approach

**Filesystem registry.** Directory `~/.aigon/repos/`. One file per known repo, named `<sha256(absoluteRepoPath)>`, content is the absolute path as a single line.

**Marker write.** New helper `lib/repo-registry.js:markRepo(repoPath)`:

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const REGISTRY_DIR = path.join(os.homedir(), '.aigon', 'repos');

function markRepo(repoPath) {
  const abs = path.resolve(repoPath);
  fs.mkdirSync(REGISTRY_DIR, { recursive: true });
  const marker = path.join(REGISTRY_DIR, crypto.createHash('sha256').update(abs).digest('hex'));
  fs.writeFileSync(marker, abs + '\n');
}
```

Called from: `apply` handler, `install-agent` handler, `init` handler, `check-version` handler.

**Marker read with self-prune.** `lib/repo-registry.js:listRepos()` walks `~/.aigon/repos/`, reads each marker's content, checks `fs.existsSync(path.join(repoPath, '.aigon'))`, returns the live ones. Stale markers are NOT deleted (keeps reads cheap and avoids race conditions); they're just skipped. A periodic `aigon doctor --gc` could optionally rm stale markers, but reads don't need it.

**`aigon apply --all`.** New flag handler in `apply` command:

```js
if (args.includes('--all')) {
  const repos = listRepos();
  const results = [];
  for (const repo of repos) {
    results.push(await applyOne(repo));
  }
  reportAggregate(results);
  process.exit(results.some(r => r.failed) ? 1 : 0);
}
```

Per-repo apply runs in sequence (not parallel — apply does git operations and we don't want concurrent commits). Stream progress to stdout with `[<i>/<n>] <repo>: <status>` format.

**npm postinstall hook.** Add to `package.json`:

```json
"scripts": {
  "postinstall": "node ./scripts/installed-notice.js || true"
}
```

The `|| true` ensures the npm install never fails if the notice errors (defensive — a broken postinstall must not break installs). The script reads the registry, computes the digest delta per repo, and prints the notice block. Silent if nothing to say.

**`aigon installed-notice` command.** Same logic as the postinstall script, exposed as a CLI verb so users can re-display the notice manually.

**Privacy.** Document in `aigon repos --help` that markers are written to `~/.aigon/repos/`. No upload, no telemetry — pure local.

## Dependencies

- depends_on: apply-3-session-drift-notice

## Out of Scope

- Concurrent (parallel) apply across repos. Sequential is safer for git operations.
- Cloud sync of the registry. Pure local.
- Pruning markers automatically. They're skipped on read; deletion can be a `doctor --gc` add-on later.
- A `aigon repos add <path>` / `aigon repos remove <path>` command. Markers are managed implicitly by aigon command invocations.

## Open Questions

- Should `aigon check-version` itself create a marker, or only mutating commands? Default: yes — any aigon command that reads `.aigon/` is a strong signal "this is an aigon repo I care about."
- What happens if the user has 200 repos and `apply --all` takes minutes? Default: print live progress, no parallelism, let it run. Add a `--parallel N` flag later if needed.
- Do we mark worktrees? Default: no — worktrees skip `.aigon/version` writes today (per `lib/version.js:30-31`); they should also skip registry markers. Avoids registry pollution from feature-close cycles.

## Related

- Research: #48 aigon-versioning-model-and-multi-repo-update-ux
- Set: apply-model
- Prior features in set: apply-1, apply-2, apply-3
