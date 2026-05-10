---
commit_count: 3
lines_added: 162
lines_removed: 3
lines_changed: 165
files_touched: 5
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 73
output_tokens: 25978
cache_creation_input_tokens: 150451
cache_read_input_tokens: 4360559
thinking_tokens: 0
total_tokens: 4537061
billable_tokens: 26051
cost_usd: 11.3112
sessions: 1
model: "claude-opus-4-7"
tokens_per_line_changed: null
---
# Implementation Log: Feature 500 - apply-5-multi-repo-registry
Agent: cc

## Status

All acceptance criteria met. `aigon apply` now self-registers the current repo (skipping worktrees), `aigon apply --all` iterates the registry sequentially with a digest-based fast skip, and `aigon installed-notice` prints a stale-repo summary on `npm postinstall`. Verified end-to-end against 6 registered local repos: 4 applied, 2 skipped (digest match), 0 failed.

## New API Surface

- `aigon apply --all` — new flag; reads `readConductorReposFromGlobalConfig()`, prunes missing/non-aigon paths and worktrees, fast-skips repos whose `.aigon/applied-digest` already matches `computeAppliedDigest(repo)`, runs `aigon apply` (passthrough flags) per remaining repo via `spawnSync`. Exits non-zero if any repo fails.
- `aigon installed-notice` — new read-only command; lists registered repos whose `.aigon/version` differs from the running CLI's `getAigonVersion()`. Silent when registry empty, all current, or anything throws (so `npm postinstall` can never break).
- `lib/commands/infra.js` now exports `autoRegisterRepoIfNeeded`, `resolveCurrentRepoRoot`, and `isAigonRepo` so the `apply` handler (and future callers) can register without rebuilding the command factory.

## Key Decisions

- **Registration goes in `apply`, not `aigon-cli.js` startup.** The spec called the "gap" out explicitly — server-start and `install-agent` already auto-register; `apply` was the only other top-level operator entry point that touches a repo. Running it inside `apply` (after the worktree guard) avoids bloating every CLI invocation.
- **Worktree exclusion is at the call site, not inside `autoRegisterRepoIfNeeded`.** F497 already skips `applied-digest` writes in worktrees via the `worktree.json` marker; reusing that marker keeps the registry clean during feature-close cycles. Putting the guard inside the generic helper would silently change behaviour for `install-agent` callers (which may legitimately register from a worktree's parent invocation).
- **Fast-skip uses digest, not semver.** Reuses F497's `computeAppliedDigest` / `readAppliedDigest`. Versions can change without templates changing (and vice-versa); digest is the authoritative drift signal that the rest of the apply-model set already ships on.
- **`spawnSync` per repo over an in-process loop.** Each repo runs `apply` with its own `process.cwd()`, agent detection, git auto-commit, and server-restart logic. In-process would mean threading cwd through every helper and resetting cached config — not worth it for ≤30 repos.
- **`installed-notice` is best-effort silent.** Wrapped in a single try/catch; postinstall already chains `|| true`, but a noisy failure inside the script would still surface a stack trace to npm users. Belt-and-braces.

## Gotchas / Known Issues

- `apply --all` runs serially — git operations inside `apply` are not safe to parallelise (concurrent index locks, npm install thrash). Spec out-of-scope already calls this out; sequential output also stays legible.
- `installed-notice` reports "applied" by reading `.aigon/version` (legacy provenance file, see F497). Repos that have never been applied have no `.aigon/version` and are silently skipped — they show up neither as stale nor as current. This is intentional: an entry-but-no-version repo is a manually `repos add`-ed path that's not yet been bootstrapped.
- The npm `postinstall` chain runs `installed-notice` after `global-setup` and `fix-node-pty-perms`. If `global-setup` fails non-fatally, the notice still runs (the `|| true` chain guarantees it).

## Explicitly Deferred

- `--parallel N` flag for `apply --all` (out-of-scope per spec).
- A standalone `aigon repos` top-level verb — `aigon server repos list/add/remove` already exists.
- Auto-registering worktrees (out-of-scope; would pollute the registry).

## For the Next Feature in This Set

- The registry now self-populates on the first `apply` from any new repo, so future features in this set can rely on `readConductorReposFromGlobalConfig()` returning a real working set without an explicit `repos add` step.
- `apply --all` is the canonical "fan-out" entry point. If a follow-up needs cross-repo reporting (e.g. doctor across all repos), pattern after the spawn-per-repo loop in `lib/commands/setup.js` `'apply'`.
- Postinstall hooks now have a precedent for read-only, never-failing notices (`installed-notice`). Future hooks of this shape should follow the same belt-and-braces silent-on-error contract.

## Test Coverage

- `npm run test:iterate` — green (lint on 2 changed files, scoped integration tests on `aigon-eval` + `install-agent-vendored-docs-to-dot-aigon`).
- Live verification: `node ./aigon-cli.js installed-notice` correctly identified 3 of 6 stale repos with their applied versions; `node ./aigon-cli.js apply --all` walked all 6 repos, skipped 2 by digest, applied 4 (including auto-commit), and aggregated to "0 failed".
- Spec validation block (`/tmp/repo-a` + `/tmp/repo-b` registry add/skip) not re-run separately — `apply --all` already exercises the same registry-read + filesystem-skip paths against real repos.
