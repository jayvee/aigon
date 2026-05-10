---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-10T21:42:28.964Z", actor: "cli/feature-prioritise" }
---

# Feature: merge-init-into-apply

## Summary

Collapse `aigon init` and `aigon apply` into a single verb: **`aigon apply`**. When invoked in a Git repo that does not yet contain `.aigon/`, `apply` runs the bootstrap that `init` does today (spec folder layout, gitignore entries, pre-commit hook, port-block allocation, workflow-snapshot bootstrap, worktree base + agent trust) *before* the normal template-refresh logic — no separate verb, no "are you sure?" prompt. Then expose the inverse operation under a name that pairs naturally with `apply`: **`aigon remove`**. The existing per-repo cleanup logic (today's `aigon uninstall`) is renamed to `aigon remove`, extended to deregister from the global repo registry and (optionally) purge `.aigon/` runtime state, and documented in the public command reference. There is no deprecation alias for `uninstall` — it is renamed cleanly.

Net effect: the verb pair is **`aigon apply`** (bring Aigon into a repo, keep it current) and **`aigon remove`** (take it back out). The two-verb mental model (`init` then `apply`) is retired, and the confusing "`uninstall` sounds like it removes the global CLI" footgun is gone.

## User Stories

- [ ] As a new user adopting Aigon in an existing project, I `cd` into the repo and run `aigon apply`. Aigon bootstraps the repo (spec folders, hooks, port block, workflow engine) and reports what it did. No interactive prompt.
- [ ] As a new user who never read the docs in order, I do not have to discover `aigon init` exists. `aigon apply` is the only verb I need to know.
- [ ] As an existing user, `aigon apply` keeps doing what it does today — refreshing templates and writing the applied-digest. The bootstrap path is silent on already-initialised repos.
- [ ] As a user who decides Aigon isn't for me (or for *this* repo), I run `aigon remove` to remove every file Aigon wrote, with `--purge` to also wipe runtime state under `.aigon/`. My spec history (`docs/specs/`), `AGENTS.md`, `CLAUDE.md`, and `README.md` are never touched.
- [ ] As a user who reads `aigon --help` for the first time, the verb that mirrors `apply` is `remove`. I don't have to wonder whether `uninstall` means "uninstall the CLI globally" — there is no such verb in Aigon's vocabulary (`npm uninstall -g @senlabsai/aigon` is the canonical CLI uninstall).
- [ ] As a user running `aigon init` out of habit (or from a stale script / blog post), the command still works for one release cycle but prints a deprecation note pointing me at `aigon apply`.
- [ ] As a user running `aigon apply` from a worktree (`.aigon/worktree.json` present), the worktree-skip behaviour is preserved — no digest write, no bootstrap, no registry mutation. Same as today.
- [ ] As a user running `aigon apply` in a non-Git directory, I get a clear error telling me to `git init` first; nothing is created. (Previously `aigon init` had the same precondition.)

## Acceptance Criteria

### Apply: bootstrap on first run

- [ ] `aigon apply` in a Git repo where `.aigon/` does not exist runs the full bootstrap path that `aigon init` runs today: create `docs/specs/{features,research,feedback}/<lanes>` with `.gitkeep`, create `docs/specs/README.md`, ensure `.aigon/.board-map.json` is gitignored, ensure `.env.local` is gitignored, install the pre-commit hook, allocate a base port (when the active profile enables dev servers), bootstrap workflow snapshots for any pre-existing specs (seed-clone case), and create `~/.aigon/worktrees/<repo>/` with agent trust.
- [ ] The bootstrap step **prints a one-line banner** before doing the work: `✨ First-time setup: bringing Aigon into this repo…` — so a user who misfired into the wrong directory sees the intent and can Ctrl-C before further work.
- [ ] The bootstrap step **does not prompt** the user. No "Proceed? [y/N]". Pre-authorisation is the user typing `aigon apply` in this directory.
- [ ] After bootstrap, the normal `apply` logic runs (register repo, refresh templates for any installed agents, write `.aigon/version` + `.aigon/applied-digest`, auto-commit unless `--no-commit`).
- [ ] At the end of a first-time-bootstrap apply, print a "what to do next" hint: `Next: aigon install-agent cc gg cx cu …` listing only the agent codes whose CLIs are on PATH.

### Apply: preserve existing behaviour

- [ ] `aigon apply` in an already-initialised repo (i.e. `.aigon/` exists) behaves exactly as today — no bootstrap path, no banner, no "next step" hint. Pure template refresh.
- [ ] `aigon apply --all` does **not** auto-bootstrap unregistered or missing repos. Pruning behaviour is unchanged: paths in `~/.aigon/config.json` `repos` whose `.aigon/` is gone are skipped silently.
- [ ] `aigon apply` from inside a worktree (`.aigon/worktree.json` present) skips bootstrap, digest write, version write, and registry write — same set of skips as today.
- [ ] `aigon apply` in a non-Git directory exits non-zero with: `Not a Git repository. Run \`git init\` first, then re-run \`aigon apply\`.` Nothing is created.

### Init: deprecate

- [ ] `aigon init` still works but prints to stderr: `⚠ "aigon init" is deprecated, use "aigon apply" — this alias will be removed in a future release.` Then forwards to the apply handler. Same shape as the `aigon update → aigon apply` deprecation (F496).
- [ ] `aigon init` is removed from `aigon --help` output. It remains callable; it is not listed.
- [ ] All in-repo references to `aigon init` in user-facing docs, CLI hints, error messages, slash-command templates, agent JSON configs, the onboarding wizard, and the help text are updated to `aigon apply`. (Internal historical references in `docs/specs/features/05-done/` are left as-is — that is historical record.)
- [ ] `lib/commands/infra.js:547` error message and `lib/commands/setup.js` lines that say "aigon init" are updated to "aigon apply".
- [ ] The onboarding wizard (`lib/onboarding/wizard.js`) calls `commands['apply']([])` (not `commands['init']([])`) in the brewboard-seed step and the autonomous-feature provisioning path (`lib/commands/setup.js:3979`).

### Remove: rename and extend

- [ ] The existing `'uninstall'` handler in `lib/commands/setup.js` is renamed to `'remove'`. The handler body keeps the manifest-driven cleanup logic and gains the additions below.
- [ ] `aigon uninstall` is **deleted** from the CLI command names list. There is no deprecation alias. Running `aigon uninstall` prints `Unknown command: uninstall. Did you mean: aigon remove?` and exits non-zero. (The clean break is acceptable because `uninstall` was undocumented in public reference docs and lived only in source / `help.txt`.)
- [ ] `aigon remove` is added to the public command reference at `site/content/reference/commands/setup/remove.mdx` and listed in `commands/index.mdx` under Setup commands.
- [ ] The CLI help text (`templates/help.txt`) lists `remove` alongside `apply` under Setup.
- [ ] `aigon remove` deregisters the current repo from `~/.aigon/config.json` `repos` (so `aigon apply --all` and the dashboard's multi-repo view stop listing it). This is an additive change relative to today's `uninstall`.
- [ ] New flag: `aigon remove --purge` removes **all** of `.aigon/` (workflows, state, sessions, cache, applied-digest, version, config, install-manifest, port allocation entry). Without `--purge`, runtime state under `.aigon/workflows/`, `.aigon/state/`, `.aigon/sessions/`, `.aigon/config.json` is preserved exactly as today's `uninstall`.
- [ ] `aigon remove` refuses to run in a worktree (`.aigon/worktree.json` present) with: `Refusing to remove from a worktree — would affect the main repo. Run \`aigon remove\` in the main repo (\`<resolved path>\`).`
- [ ] `aigon remove` does **not** delete `docs/specs/` under any flag. Spec history is user data. (Codify the invariant in tests.)
- [ ] `aigon remove` does not modify `AGENTS.md`, `CLAUDE.md`, `README.md`, or any non-Aigon source file. The existing manifest-driven approach ensures this; codify in tests.
- [ ] `aigon remove --help` prints the flag summary and a one-liner reminding the user: `To uninstall the Aigon CLI globally, run: npm uninstall -g @senlabsai/aigon — see "Uninstalling Aigon completely" in the docs.`

### Doctor: catch partial states

- [ ] `aigon doctor` detects the "`.aigon/` exists but spec folder structure is missing" partial-bootstrap state and offers `aigon apply` as the fix. (Most likely produced by a half-finished old `init` or by manual deletion.)
- [ ] `aigon doctor` detects the "`.aigon/install-manifest.json` references files that no longer exist" state (already partly handled) and recommends `aigon apply` to re-emit them.

## Validation

```bash
node --check aigon-cli.js
node --check lib/commands/setup.js

# Fresh-repo bootstrap
mkdir /tmp/apply-bootstrap && cd /tmp/apply-bootstrap && git init -q
aigon apply 2>&1 | grep -q "First-time setup"
test -d docs/specs/features/01-inbox    # bootstrap created lanes
test -f .aigon/install-manifest.json    # apply ran refresh
test -f .aigon/applied-digest           # digest written
aigon apply 2>&1 | grep -qv "First-time setup"  # banner NOT shown on re-run

# Non-git dir
mkdir /tmp/apply-nogit && cd /tmp/apply-nogit
aigon apply 2>&1 | grep -q "Not a Git repository"
test ! -d .aigon                        # nothing was created

# Deprecation alias
aigon init 2>&1 | grep -q 'deprecated.*aigon apply'

# Remove preserves spec history
cd /tmp/apply-bootstrap
aigon remove --force 2>&1 | grep -q "Removed"
test -d docs/specs/features/01-inbox    # spec folder PRESERVED
test ! -d .claude/commands/aigon        # agent files removed

# Remove --purge wipes runtime state
cd /tmp/apply-bootstrap && aigon apply && aigon remove --purge --force
test ! -d .aigon                        # runtime state gone

# Registry deregistration
cd /tmp/apply-bootstrap && aigon apply
grep -q "/tmp/apply-bootstrap" ~/.aigon/config.json
aigon remove --force
! grep -q "/tmp/apply-bootstrap" ~/.aigon/config.json

# Old name is gone
aigon uninstall 2>&1 | grep -q "Did you mean: aigon remove"
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

### Apply handler — add the bootstrap branch

In `lib/commands/setup.js`, the existing `'apply'` handler (around line 1283) gets a new branch at the top, after the `--pull` rejection and before the `--all` branch:

```js
'apply': async (args = []) => {
  if (args.includes('--pull')) { /* unchanged */ }

  if (args.includes('--all')) { /* unchanged */ }

  const cwd = process.cwd();
  const aigonDir = path.join(cwd, '.aigon');
  const isWorktree = fs.existsSync(path.join(aigonDir, 'worktree.json'));
  const isGitRepo = fs.existsSync(path.join(cwd, '.git')) || isWorktree;

  if (!isGitRepo) {
    console.error('❌ Not a Git repository. Run `git init` first, then re-run `aigon apply`.');
    process.exit(1);
  }

  const isFirstTime = !fs.existsSync(aigonDir) && !isWorktree;
  if (isFirstTime) {
    console.log('✨ First-time setup: bringing Aigon into this repo…');
    await runInitBootstrap(cwd);  // factor today's `'init'` body into this helper
  }

  // …existing apply logic (auto-register, agent template refresh, digest+version write, auto-commit)…

  if (isFirstTime) {
    printFirstTimeNextStepHint(cwd);
  }
}
```

Factor the body of today's `'init'` handler (`lib/commands/setup.js:140–238`) into a pure helper `runInitBootstrap(repoPath)` in the same file (or a new `lib/commands/setup/bootstrap.js`). The `'init'` handler then shrinks to the deprecation shim that forwards to `'apply'`.

### Init handler — deprecation shim

```js
'init': async (args = []) => {
  process.stderr.write('⚠ "aigon init" is deprecated, use "aigon apply" — this alias will be removed in a future release.\n');
  return commands['apply'](args);
},
```

Mirror the existing `update → apply` deprecation (`lib/commands/setup.js:1278`). Remove `init` from the names array's help-print position (keep it callable, drop it from the listed names).

### Remove handler — rename + three additive changes

The existing `'uninstall'` handler (`lib/commands/setup.js:3563`) is renamed to `'remove'`. The `names` array at line 4275 has `'uninstall'` replaced with `'remove'`. All user-facing strings inside the handler (`✅ Uninstalled:`, `Uninstall aborted.`, `Proceed with uninstall? [y/N]`) become `Removed`, `Remove aborted.`, `Proceed with remove? [y/N]`. The internal variable `unRepoRoot` becomes `removeRepoRoot` for clarity.

A small alias-trap is added so `aigon uninstall` produces a clear redirect:

```js
'uninstall': () => {
  console.error('Unknown command: uninstall. Did you mean: aigon remove?');
  console.error('  (aigon remove deletes Aigon-managed files from this repo.)');
  console.error('  (npm uninstall -g @senlabsai/aigon uninstalls the CLI globally.)');
  process.exit(1);
},
```

Then three additive changes inside the renamed handler:

1. **Worktree refusal** — at the top, after `removeRepoRoot = process.cwd()`:
   ```js
   const worktreeMarker = path.join(removeRepoRoot, '.aigon', 'worktree.json');
   if (fs.existsSync(worktreeMarker)) {
     const wt = JSON.parse(fs.readFileSync(worktreeMarker, 'utf8'));
     console.error(`Refusing to remove from a worktree — would affect the main repo.`);
     console.error(`Run \`aigon remove\` in the main repo (${wt.mainRepo}).`);
     process.exit(1);
   }
   ```

2. **Registry deregistration** — after the manifest-driven file removal, before the final summary:
   ```js
   try {
     const { readConductorReposFromGlobalConfig, writeRepoRegistry } = require('../config');
     const repos = readConductorReposFromGlobalConfig().filter(r => path.resolve(r) !== removeRepoRoot);
     writeRepoRegistry(repos);
   } catch (_) { /* best-effort */ }
   ```

3. **`--purge`** — new flag at the top:
   ```js
   const purge = args.includes('--purge');
   ```
   After the per-file removal loop, if `purge` is true, recursively delete the entire `.aigon/` directory:
   ```js
   if (purge && fs.existsSync(path.join(removeRepoRoot, '.aigon'))) {
     fs.rmSync(path.join(removeRepoRoot, '.aigon'), { recursive: true, force: true });
     console.log('   ↳ --purge: removed .aigon/ runtime state');
   }
   ```

### Wizard + provisioning paths

- `lib/onboarding/wizard.js:436` — replace `aigon init` call with `aigon apply`.
- `lib/commands/setup.js:3977` (autonomous provisioning) — replace `commands['init']([])` with `commands['apply']([])`.

### Doctor

`lib/commands/setup.js`'s `doctor` handler (or wherever the doctor checks live) gains one check: if `fs.existsSync('.aigon')` but `!fs.existsSync('docs/specs/features/01-inbox')`, report it and offer `aigon apply` as the fix.

### Help text + doc sweep

- `templates/help.txt` — remove the `aigon init` line and the `aigon uninstall` line; document `aigon apply` and `aigon remove` in the Setup section.
- `site/content/getting-started.mdx` — replace the `aigon init && aigon install-agent …` flow with `aigon apply && aigon install-agent …`. Link to the new "Uninstalling Aigon completely" guide (see below).
- `site/content/reference/commands/setup/init.mdx` — delete the file (parallel to the F496 deletion of `setup/update.mdx`).
- `site/content/reference/commands/setup/_meta.js` — remove the `init` entry, add `remove`.
- `site/content/reference/commands/setup/apply.mdx` — extend the existing "apply vs init" section into "What apply does on a fresh repo" (since init no longer exists as a public verb).
- `site/content/reference/commands/setup/remove.mdx` — **new page** documenting `aigon remove`, `--purge`, `--force`, `--dry-run`, the worktree-refusal safety, and an explicit note: *to uninstall the CLI globally, see [Uninstalling Aigon completely](/docs/guides/uninstalling-aigon)*.
- `site/content/reference/commands/index.mdx` — Setup commands list: drop `init`, add `remove`.
- `site/content/guides/applying-aigon-updates.mdx` — opening paragraph reframed: "`aigon apply` is the one verb you run to bring Aigon into a repo and to keep it current".
- **`site/content/guides/uninstalling-aigon.mdx`** — **new end-to-end guide** covering full removal in this order:
  1. `aigon remove --purge` in every repo (or just one).
  2. `aigon proxy uninstall` if the `.localhost` proxy was installed.
  3. Stop the dashboard service: `launchctl unload ~/Library/LaunchAgents/com.aigon.server.plist && rm ~/Library/LaunchAgents/com.aigon.server.plist` (macOS) or `systemctl --user disable --now aigon-server && rm ~/.config/systemd/user/aigon-server.service` (Linux).
  4. `rm -rf ~/.aigon/` to remove worktrees, logs, the global registry, the proKey, dashboard runtime file.
  5. `npm uninstall -g @senlabsai/aigon @senlabsai/aigon-pro` to remove the CLI binaries.
  6. Optional: per-agent CLI uninstalls (Claude Code, Gemini, Codex, Cursor) with copy-paste commands.
- `AGENTS.md`, `CONTRIBUTING.md`, vendored docs under `.aigon/docs/` — sweep `aigon init` and `aigon uninstall` references.

### Telemetry

Emit a single event on first-time bootstrap (the path where `isFirstTime === true`) so we can count merged-apply adoption: `aigon_apply.first_time_bootstrap` with `{ repoPath, profile, hadPreexistingSpecs }`. Reuses the existing telemetry hook in `lib/telemetry.js`.

### Tests

New integration tests under `tests/integration/`:

- `apply-bootstrap-fresh-repo.test.js` — fresh `git init`, run `aigon apply`, assert lanes + `.aigon/applied-digest` + registry entry exist.
- `apply-noop-existing-repo.test.js` — second `aigon apply` does not re-print the bootstrap banner.
- `apply-non-git-error.test.js` — non-git dir errors and creates nothing.
- `apply-worktree-skip.test.js` — worktree never gets a digest write.
- `init-deprecation.test.js` — `aigon init` prints the deprecation warning and forwards.
- `remove-default.test.js` — manifest files removed, spec folder preserved, registry entry removed.
- `remove-purge.test.js` — `--purge` also removes `.aigon/`.
- `remove-worktree-refusal.test.js` — worktree remove errors and changes nothing.
- `remove-then-apply.test.js` — full cycle: bootstrap → remove → bootstrap is idempotent.
- `uninstall-alias-error.test.js` — `aigon uninstall` exits non-zero with the "Did you mean: aigon remove?" hint.

Mark these `@smoke` so the iterate gate (`npm run test:iterate`) catches regressions.

## Dependencies

- None. F496 (the `update → apply` rename), F500 (multi-repo registry + `autoRegisterRepoIfNeeded`), and the existing `install-manifest` infrastructure are all already in place and form the foundation. This feature is an additive change layered on top.

## Out of Scope

- **Auto-installing agents on first-time apply.** Apply is about Aigon state; agent wiring stays in `install-agent`. The bootstrap path only *suggests* the next-step `install-agent` command.
- **`aigon doctor` automatically running `apply` on detected partial state.** Doctor reports and recommends; the user runs the fix. Matches existing doctor philosophy.
- **Migrating data on uninstall** (e.g., archiving spec history to a tarball). User-data preservation is "leave it where it is".
- **A separate `eject` verb.** `uninstall` is the right name and the handler already exists.
- **Renaming `install-agent` to fit the new vocabulary.** It is still the right name for what it does. Out of scope; revisit only if the merged model exposes a naming awkwardness in practice.
- **Dashboard "Uninstall this repo" button.** The dashboard surfaces `apply` actions (F499 upgrade pill); the inverse is a deliberate, terminal-only action.

## Open Questions

- **First-time-bootstrap banner copy** — `✨ First-time setup: bringing Aigon into this repo…` vs `→ Setting up Aigon in this repo (first run)…` vs no emoji. Default: keep the emoji, matches existing CLI tone (other commands use ✅ / ⚠ / ℹ).
- **Should `--purge` also remove `docs/specs/`?** Default: NO. Spec history is user data. If a user explicitly wants to also remove specs, they can `rm -rf docs/specs/` themselves; the CLI should never destroy user prose by default.
- **Deprecation lifetime for `aigon init`** — one release cycle (mirrors `update`), or two (because `init` is more deeply muscle-memoried)? Default: two releases. `init` lives in many users' fingers and external blog posts.

## Related

- F496 apply-1-rename-update-verb — the precedent for verb renames and deprecation aliases
- F500 apply-5-multi-repo-registry — `autoRegisterRepoIfNeeded` already lives in the apply handler
- F497 apply-2-digest-drift-detection — digest writes are part of the existing apply path; bootstrap on first run includes them
