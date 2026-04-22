# Feature: unify-terminal-config-with-migration-framework

## Summary

Collapse the overlapping `terminal` / `tmuxApp` knobs in `~/.aigon/config.json` into a single `terminalApp` field, and introduce a **global-config migration framework** that runs on relink/update so existing users upgrade cleanly without manually editing their config. The migration framework is reusable for any future global-config rename (key, value, or shape change).

## Context / Why

The current shape has two knobs whose relationship is opaque:

- `terminal: "warp" | "terminal" | "tmux"` — launch strategy. Only affects `openSingleWorktree` (feature-open, feature-start). Everywhere else — dashboard clicks, autonomous loops, Fleet, review, eval — **ignores `terminal`** and unconditionally creates a tmux session via `createDetachedTmuxSession` / `ensureTmuxSessionForWorktree`.
- `tmuxApp: "terminal" | "iterm2" | "warp"` — which GUI app hosts `tmux attach`. Applies in the tmux-everywhere paths.

This leaves `terminal` as a vestigial knob: set `terminal: "warp"` and the dashboard still expects a tmux session that `feature-open` never created. The value `"terminal"` as a tmuxApp also collides visually with the field name.

We want the final mental model to be: **agent sessions always run in tmux; `terminalApp` picks the GUI that hosts the attach.**

## User Stories

- [ ] As a new user, I see one config knob (`terminalApp`) with three obvious values (`warp`, `iterm2`, `apple-terminal`) and no ambiguity about what controls what.
- [ ] As an existing user on an older config, when I run `aigon update` / `aigon check-version` (triggered on session start), my `~/.aigon/config.json` is migrated in place — `tmuxApp` renamed to `terminalApp`, `terminal` key dropped, old value `"terminal"` rewritten to `"apple-terminal"` — with a backup and a clear one-line console notice.
- [ ] As a user reading the `aigon init` help output, the example config uses the new field and values.
- [ ] As a future contributor adding another global-config rename (say `aiAttributionDomain` → something), I have a `registerGlobalConfigMigration(version, fn)` API that works the same way the existing per-repo `registerMigration` does.

## Acceptance Criteria

### Config consolidation
- [ ] `terminalApp` is the sole supported field for choosing the GUI terminal. Values: `"warp"`, `"iterm2"`, `"apple-terminal"`. Default: `"apple-terminal"` on darwin, unset on linux (linux path uses `linuxTerminal`).
- [ ] `terminal` field is **removed** from `DEFAULT_GLOBAL_CONFIG` in `lib/config.js`.
- [ ] `openSingleWorktree` in `lib/worktree.js` no longer branches on a `terminal` argument — it always creates a tmux session and delegates display to `openTerminalAppWithCommand` (which reads `terminalApp`). The no-tmux Warp/Terminal.app launch branches are deleted.
- [ ] Terminal adapters in `lib/terminal-adapters.js` detect on `env.terminalApp` only (`requestedTerminal` / `tmuxApp` env fields removed).
- [ ] Dashboard terminal dropdown (if still present) shows only `terminalApp` values.
- [ ] `AIGON_TERMINAL` env var renamed to `AIGON_TERMINAL_APP` (old var still honoured with a deprecation warning during the compat window — see migration below).

### Global-config migration framework
- [ ] New module `lib/global-config-migration.js` (or an extension of `lib/migration.js`) exposes `registerGlobalConfigMigration(version, migrateFn)` where `migrateFn` receives `{ config, log }` and mutates `config` in place (or returns a new object).
- [ ] `runPendingGlobalConfigMigrations(fromVersion)` reads `~/.aigon/config.json`, applies every registered migration whose version is greater than `fromVersion`, and writes back exactly once after all migrations run.
- [ ] Before writing, the framework writes a timestamped backup to `~/.aigon/backups/config-<fromVersion>-<timestamp>.json` (piggyback on the existing backup pattern at `GLOBAL_CONFIG_BACKUP_LATEST_PATH`).
- [ ] Applied versions are recorded in a new top-level key `~/.aigon/config.json.schemaVersion` (or equivalent) so re-running doesn't re-apply.
- [ ] The framework is called from `check-version` in `lib/commands/setup.js` **in addition to** the existing per-repo `runPendingMigrations(repoPath)` call. Global migrations run **once per machine**, not once per repo.
- [ ] Failures: if a migration throws, write is skipped, the backup remains, and the user gets a clear error with the backup path and a pointer to `aigon doctor`.

### The first migration (the terminal rename)
- [ ] Migration version `<next-aigon-version>`:
  - If `terminal` + `tmuxApp` both exist → set `terminalApp = tmuxApp`, drop both old keys.
  - If only `terminal` exists → map `"warp"` → `terminalApp: "warp"`, `"terminal"` → `terminalApp: "apple-terminal"`, `"tmux"` → `terminalApp: "apple-terminal"` (the pre-existing implied default), then drop `terminal`.
  - If `tmuxApp` exists alone → rename to `terminalApp`; rewrite value `"terminal"` → `"apple-terminal"`.
  - Print a single line: `🔄 Config migrated: unified terminal settings → terminalApp=<value>. Backup: <path>`.

### Runtime compat (safety net while migration rolls out)
- [ ] `loadGlobalConfig()` in `lib/config.js` reads old keys if the migration hasn't run yet (e.g. user on an air-gapped machine, or schema version read fails) and logs a one-time deprecation warning. Never silently drops the user's preference.

### Docs, help text, tests
- [ ] `lib/commands/infra.js` help text (`aigon init` output) references only `terminalApp`.
- [ ] `docs/development_workflow.md`, `docs/architecture.md`, any getting-started doc mentioning `terminal`/`tmuxApp` are updated.
- [ ] Integration test: write an old-shape config to a tmpdir, point `GLOBAL_CONFIG_PATH` at it, run the migration, assert new shape, assert backup exists, assert schemaVersion updated. Re-run migration, assert idempotent.
- [ ] Unit tests for each legacy-shape permutation listed above.
- [ ] `npm test` passes.

## Validation

```bash
node --check lib/config.js
node --check lib/terminal-adapters.js
node --check lib/worktree.js
node --check lib/commands/setup.js
npm test -- --testPathPattern='(config|migration|terminal)' 2>&1 | tail -40
```

## Pre-authorised

- May add one new module file under `lib/` (e.g. `lib/global-config-migration.js`) — this feature explicitly introduces new framework code.
- May expand `scripts/check-test-budget.sh` CEILING by up to +80 LOC for the new migration tests.

## Technical Approach

### 1. Migration framework design

Model it on the existing per-repo `lib/migration.js` but with different scope:

| | Per-repo (existing) | Global (new) |
|---|---|---|
| Scope | `<repoPath>/.aigon/workflows/` | `~/.aigon/config.json` |
| Ctx | `{ repoPath, workflowsDir, log }` | `{ config, log }` |
| Registry | `migrations` Map (version → fn) | separate Map in new module |
| Version source | compare against `.aigon/manifest.json` `fromVersion` | compare against `config.schemaVersion` (top-level) |
| Backup | tarball in `.aigon/migrations/<v>/` | JSON in `~/.aigon/backups/config-<v>-<ts>.json` |
| Trigger | `check-version` per-repo | `check-version` once per machine |

Rationale for **not** extending `lib/migration.js` directly: its current API assumes a repoPath + tarball backup of a directory tree. Forcing the global config into that shape is awkward. A sibling module with shared helpers (semver compare, backup rotation) is cleaner.

### 2. Trigger point

`lib/commands/setup.js:1544 'check-version'` — the existing post-update hook. Run global migrations **before** per-repo migrations so the rest of the run sees the new config shape.

`check-version` is already invoked by the SessionStart hook (we see `✅ Aigon is up to date (v2.53.1)` at session start), so every user gets the migration on their next session start after `aigon update` pulls the new version. No explicit user action needed — matches the user's "on relink" requirement.

### 3. Schema versioning

Add `schemaVersion: 1` to `DEFAULT_GLOBAL_CONFIG`. Missing key = treat as `0`, run all registered migrations. After each run, bump to the latest registered version. This is how the repo-side migration manifest already works — reuse the semver compare helper.

### 4. The terminalApp rename

Code changes (beyond the framework):
- `lib/config.js`:
  - `DEFAULT_GLOBAL_CONFIG`: drop `terminal`, rename `tmuxApp` → `terminalApp`, default `"apple-terminal"`.
  - `loadGlobalConfig()`: add a read-time fallback — if `terminalApp` missing but `tmuxApp` or `terminal` present, synthesise `terminalApp` and warn once. (Belt-and-suspenders for the rare case migration didn't run.)
- `lib/terminal-adapters.js`: 
  - Warp adapter detect: `env.terminalApp === 'warp'` (simplify — drop `requestedTerminal` / `tmuxApp` fallbacks).
  - iTerm2 adapter detect: `env.terminalApp === 'iterm2'`.
  - Terminal.app adapter detect: `env.terminalApp === 'apple-terminal'` (was the platform-darwin fallback).
- `lib/worktree.js`:
  - `openTerminalAppWithCommand` builds `env.terminalApp = effectiveConfig.terminalApp`. Drops `tmuxApp` / `requestedTerminal`.
  - `openSingleWorktree` signature: drop the `terminal` parameter; always go through the tmux branch.
  - Log message uses `{ warp: 'Warp', iterm2: 'iTerm2', 'apple-terminal': 'Terminal.app' }[terminalApp]`.
- `lib/commands/feature.js`, `lib/commands/research.js`, `lib/commands/infra.js`: remove `terminalOverride` / `effectiveConfig.terminal` call sites; read `terminalApp` instead.
- Dashboard: check `templates/dashboard/js/` for any terminal dropdown and update the options list.

### 5. Migration alert UX

User sees **one short line** on the first `check-version` after upgrade, not a multi-line walkthrough. Example:

```
🔄 Config migrated (v2.53.2 → v2.54.0): terminal/tmuxApp → terminalApp=warp
   Backup: ~/.aigon/backups/config-2.53.2-2026-04-22T19-30-00Z.json
```

Silent if no migration was needed. Loud (full error + backup path) only on failure.

### 6. Testing strategy

- Pure-function unit tests for each legacy → canonical transform (no filesystem).
- Integration test that stands up a tmp HOME, writes an old-shape config, runs `runPendingGlobalConfigMigrations`, inspects the result + backup.
- Test idempotence: second run is a no-op.
- Test runtime fallback in `loadGlobalConfig` for the case where migration hasn't run (simulating an older aigon reading a config written by a newer one is out of scope — we only support forward migration).

## Dependencies

- None. This is foundational and self-contained.
- After this ships, any future global-config rename should register a migration rather than editing `loadGlobalConfig` with another alias branch.

## Out of Scope

- **Per-repo config migration framework**: already exists (`lib/migration.js`) — don't touch it beyond extracting shared helpers if convenient.
- **Linux terminal consolidation** (`linuxTerminal`): leave untouched. That's a different dimension (darwin-specific vs linux-specific).
- **Dropping non-tmux launch modes entirely** beyond `openSingleWorktree`: the tmux-everywhere assumption is already true of every other path; this feature just aligns `feature-open` / `feature-start` with that reality.
- **New terminal emulator support** (kitty, alacritty on macOS, etc.): separate feature.
- **Per-project `.aigon/config.json` migration**: global config only. Project config doesn't currently have the terminal keys.
- **A `aigon config migrate` manual subcommand**: migrations run automatically on `check-version`; no need for a manual invocation unless a user reports an edge case.

## Open Questions

- Should `terminalApp` default differ per platform (`"apple-terminal"` on darwin, fall through to `linuxTerminal` on linux), or is it darwin-only and linux ignores it entirely? Leaning: darwin-only field, linux reads `linuxTerminal` as today.
- Do we keep the alias value `"terminal"` working forever as a synonym for `"apple-terminal"`, or only during the compat window and then reject? Leaning: one-release compat window, then reject with a clear error pointing at the migration.
- For the migration log line, should the backup path be relative to `$HOME` or absolute? Leaning: absolute — copy-pasteable.
- Do we emit the deprecation warning on every `loadGlobalConfig()` call if migration somehow didn't run, or only once per process? Leaning: once per process (module-level flag).

## Related

- F141 (linux-terminal-support) — established the `linuxTerminal` pattern; don't regress it.
- F183 (cmux removal) — set the precedent for `tmuxApp` being the durable config surface.
- `lib/migration.js` — existing per-repo migration framework; pattern to mirror.
- `lib/config.js:500` `resolveConfigKeyAlias` — existing read-time alias helper; conceptually subsumed by the new framework for global config, but kept for project-config aliases (`fleet` → `arena` etc.).
- Conversation 2026-04-22: user observation that `terminal` is vestigial since every non-`feature-open` path already assumes tmux unconditionally.
