# Research Findings: aigon versioning model and multi repo update ux

**Agent:** Claude (cc)
**Research ID:** 48
**Date:** 2026-05-09

---

## Key Findings

### Reframe: "three versions" is the wrong frame

The research prompt names three versions (CLI, repo pin, dashboard runtime) and asks how to coordinate them. That framing is what makes the problem feel hopeless after F493 — three numbers, six pairwise comparisons, vague obligations. It's the wrong frame.

There are really **three conceptually distinct user-facing questions**, only one of which is per-repo:

| Question | Scope | Today's signal | What the user actually does |
|----------|-------|----------------|-----------------------------|
| **Q1.** Is my Aigon CLI up to date? | machine-global | `lib/npm-update-check.js` (registry advisory, 5-min cache) | `npm update -g @senlabsai/aigon` (or `aigon update --pull` for clone installs) |
| **Q2.** Are this repo's Aigon-managed files what the current CLI would write? | per-repo | `.aigon/version` semver compare, plus `.aigon/config-hash` for instructions | `aigon update` |
| **Q3.** Is my running dashboard server the same code as my CLI binary? | per-process | none today; only the startup log line in `lib/dashboard-server.js:1852` | `aigon server restart` |

Each question is independent of the others, has a different fix, and can be surfaced in the right place. The "three-way drift" anxiety dissolves once you stop trying to render it as one composite badge.

`.aigon/version` today does **two unrelated jobs at once**: it's both a *content-drift proxy* (for Q2) and a *human-readable provenance stamp* ("which CLI generation last touched this repo"). Conflating those is the root of the noise — semver bumps fire content-drift warnings even when no template changed, and meanwhile a hand-edited managed file produces no signal at all because the pin still matches.

### Codebase anchors

- **Pin:** `lib/version.js:8-36` — `VERSION_FILE = '.aigon/version'`, `getInstalledVersion`, `setInstalledVersion`. Worktree-skipped to avoid merge noise on `feature-close` (line 30-31). Set by `update`, written via `safeWrite` after sync (`lib/commands/setup.js:1417` and similar).
- **Content hash (already exists, weakly used):** `.aigon/config-hash` → `computeInstructionsConfigHash()` in `lib/profile-placeholders.js:598`. Currently checks only the *instructions config* surface (profile placeholders), **not** the broader template payload. Drives a "config changed → reinstall agents" branch in `check-version` (`lib/commands/setup.js:1181-1188`).
- **Drift compare:** `check-version` (`lib/commands/setup.js:1117-1213`) compares `currentVersion` (CLI `package.json`) to `installedVersion` (`.aigon/version`). On mismatch: today calls `update` + `runPendingMigrations`. F493 will replace those calls with notice-only text.
- **Dashboard runtime stamp:** `lib/dashboard-server.js:1852` reads `require('../package.json').version` at startup log time. There is no comparison logic between the running process and the on-disk CLI; the startup log is the only artifact. Once F493 lands, an out-of-date long-running dashboard is invisible.
- **CLI freshness signal:** `lib/npm-update-check.js` already has the right shape (cache, channels, `formatUpdateNotice`). Reused in `aigon-cli.js:184` (CLI exit notice) and `lib/dashboard-status-collector.js:1489` (dashboard background prefetch). Already global, already cached.
- **Migrations:** `lib/migration.js` is keyed off versioned manifests, not the pin itself. F353 made `doctor --fix` runnable independent of version. So the pin is **not** load-bearing for migration baseline anymore — the manifest is.

### Re-evaluating the three models

**(a) Keep per-repo semver pin.** The status quo. The hidden cost cu undersells: every CLI patch bump that didn't touch a template still produces a "🔄 Project sync needed" line at the next session start, even though nothing meaningfully changed. With Aigon shipping multi-times-a-day during heavy iteration, this trains users to ignore the notice — which then bites them when a real template drift occurs. The pin's other claimed value (PR-visible "this repo moved to 2.65") is real but small: `git log` of `.aigon/version` rarely answers a useful question that `git log` of the templates wouldn't.

**(b) Remove the pin entirely.** Loses the human-visible provenance and the "did anything change since X" hook (`getChangelogEntriesSince`). But cu over-weights this: in the npm-installed world, *every* tool has this problem and the answer is `package-lock.json` analogues, not a hand-maintained version file. The bigger objection to bare (b) is that **`aigon update` becomes a hidden write** — there's no longer a stamped reason to ever run it, but templates *do* still need to be re-emitted when the CLI changes. So pure (b) doesn't actually eliminate updates; it just hides them.

**(c) Hash-based pin.** The right direction. The codebase is already 70% there — `config-hash` exists; it just covers the wrong slice (only profile-derived instructions). Promote it to cover *all* CLI-emitted artifacts in the repo (templates, agent configs, vendored docs, hook payloads). Then "needs sync" fires iff content actually differs, which is what the user mental model expects.

There's a fourth option worth naming explicitly — the prompt didn't list it:

**(d) Pin both: a humanstamp (semver) AND a contentstamp (digest).** The semver answers "what generation of installer last touched this repo" (provenance, support tickets, changelog "since"). The digest answers "is sync needed". They serve different jobs and shouldn't be conflated. This is what most modern tools converged on: `package.json` declares a version; `package-lock.json` carries the resolved-content fingerprint. They're complementary, not competing.

**Verdict:** (d) is the lowest-risk path. Keep `.aigon/version` for provenance (no semantic load on it), introduce `.aigon/sync-digest` (or extend `config-hash` to cover everything) as the actual sync-needed signal. The "needs sync" check uses the digest. The semver just records "this is the CLI generation that last successfully synced". Independent of either, the npm registry advisory already handles Q1.

### Multi-repo UX

Three honest sub-questions:

1. **How does the machine learn which repos are aigon repos?**
2. **How does the user act on N stale repos?**
3. **Should the dashboard play a role?**

For (1), cu proposes `~/.aigon/known-repos.json`. That's the obvious shape and matches what `nvm`, `direnv`, `mise` etc. do. The pitfalls in practice are:
- **Stale entries:** registry persists deleted-repo paths forever. Needs a pruning policy (skip-if-missing on read).
- **Privacy/scope:** writing repo paths from any aigon invocation to a global file surprises some users (Docker mounts, ephemeral worktrees, customer audits).
- **Race conditions:** parallel aigon invocations writing JSON.

A lower-friction alternative: **filesystem-as-registry**. Touch `~/.aigon/repos/<sha256(repoPath)>` (a zero-byte marker file containing the repo path) on every aigon invocation that reads `.aigon/`. Auto-prunes by walking the directory and skipping markers whose stored path no longer exists. No JSON, no race, no schema migration. `aigon repos list` does the walk. Same idea as `~/.npm/_logs/` — filesystem as append-only event store.

For (2), `aigon update --all` (or `aigon repos update`) is the obvious CLI. It walks the registry, runs `update` per-repo with aggregate exit code. Prereq: registry exists. Low-risk feature once (1) ships.

For (3), the dashboard's single-repo invariant is load-bearing — workflow engine paths, snapshot routing, proxy registration are all `cwd`-scoped. Multi-repo dashboard is a much bigger change than a banner. **Defer** to a Pro / "machine status" surface. v1 should not touch the dashboard's repo scope.

### Dashboard's role for versioning

The dashboard's right role here is **not** a "version trinity banner" (cu's framing). Three numbers is too much information for a status indicator — most users will glaze over.

Better: **two binary states, two actions**:

1. **"This repo is out of sync with your CLI"** — fired by content digest mismatch. Action: `aigon update`. (Same surface as the F493 session-start notice, but always visible while dashboard is open.)
2. **"This dashboard is running older code than your CLI"** — fired by `runningProcessVersion < binaryVersion`. Action: `aigon server restart`.

The npm-registry "your CLI itself is behind" notice already lands at CLI startup; it doesn't need a dashboard banner. (It could appear there too, but it's not the urgent signal — the user can install npm updates whenever.)

This gives the dashboard a clean role: surface what would otherwise require running `check-version` manually, and only when there's a real problem.

### Hookless agents (Codex / Kimi / OpenCode)

cx, km, op have no hook framework. Today they get **zero** version notices anywhere — the only thing they ever see is the npm registry banner that prints from `aigon-cli.js:184` if they happen to invoke an aigon CLI command from inside the agent.

Options for closing this gap:

- **Dashboard banner** (above): only works if the user has the dashboard open in that repo. Many cx/km users don't.
- **Wrap the agent launcher.** When `aigon agent-start` (or equivalent) spawns the hookless agent, print the same drift notice to stderr before exec. This is the "shell trap" pattern from F493 (`lib/worktree.js:780-789`) flipped to fire on entry rather than exit. It's the most reliable surface for hookless agents.
- **`aigon doctor` as a habit.** Document doctor as the universal "check my world" command. Doesn't help users who don't run it.

Best-bang-for-buck: launcher prints drift notice on every agent start, regardless of which agent. That gives all six agents a consistent baseline; hooks become a finer-grained add-on for agents that support them, not the only path.

### `aigon update --pull` for clone installs

Keep first-class. Clone-installed users (Aigon contributors, dogfooders) are a meaningful tier. The `--pull` path is also the only way to test pre-release CLI changes without publishing. Messaging in `update` already differentiates `--pull` (CLI upgrade + project sync) from bare `update` (project sync only) — that distinction is correct as-is.

Two tweaks worth considering:

- After `--pull`, if the new CLI changes the dashboard surface, prompt to restart any running dashboard. Today the user has to know to do this.
- Document `--pull` only for clone installs — npm users running `--pull` get a `git pull` against `ROOT_DIR` that may not be a git repo at all (`upgradeAigonCli` will fail noisily). Worth a guard.

### Concrete user scenarios

Walking the prompt's scenarios under the (d) + filesystem-registry + dashboard-as-status proposal:

1. **`npm update -g` Monday, 8 repos.** Monday's npm update bumps the CLI. As the user works in each repo through the week, the first session-start in each (or first dashboard open) shows the digest-mismatch notice if templates actually changed. If only patch logic changed without template diffs, **no notice at all** — the user isn't pestered about non-events. At any time, `aigon repos update` (which walks the filesystem-marker registry) clears all 8 in one command. End state: zero ambient noise across the week.

2. **3-month-old repo.** Open it. Dashboard banner appears: "Templates 12 generations behind. Run `aigon update`". Changelog link shows what shipped. CLI prints the same. `aigon update` syncs; if migrations needed, `doctor --fix` is suggested in the output. No silent mutation.

3. **cx/km/op only.** Agent launcher (wrap on entry) prints the digest-drift notice on every session start. Dashboard banner shows the same when open. No hook framework needed.

4. **Dashboard in repo A, working in repo B.** Dashboard A continues to show A's status only. Working in B from a terminal: B's `aigon` invocations see B's drift state via CLI output. Cross-repo aggregation only happens when the user explicitly runs `aigon repos status`. No sneaky cross-talk.

### What this all means for F493

F493 makes hooks notification-only. The danger it surfaced — "user gets a confusing 'sync needed' message and doesn't know what to do" — is mitigated by:

- Notice is **only** about real content drift (not patch-bump noise) once digest replaces semver as the trigger.
- Notice always quotes the exact next command: `aigon update`.
- Dashboard surfaces the same state, so users who ignore terminal noise still see it.
- For long-untouched repos, the "what changed" link to changelog gives context.

In other words: F493 is fine to ship before any of this lands, but the deferred research direction should be **"reduce false positives in the drift notice"** as the highest-priority follow-up, not "build a multi-repo dashboard". Noise is the immediate post-F493 risk.

---

## Sources

- Aigon implementation:
  - `lib/version.js` — pin read/write, `compareVersions`, `checkAigonCliOrigin`, `upgradeAigonCli`
  - `lib/commands/setup.js:1117-1213` — `check-version` (post-F493 will be notice-only)
  - `lib/commands/setup.js:1215+` — `update` (project sync, optionally with `--pull`)
  - `lib/profile-placeholders.js:598` — `computeInstructionsConfigHash` (today: instructions-only)
  - `lib/npm-update-check.js` — registry advisory, channels, cache
  - `lib/dashboard-server.js:1852` — runtime version startup log (no compare)
  - `lib/dashboard-status-collector.js:1489` — dashboard background npm prefetch
  - `lib/worktree.js:780-789` — universal shell trap (cited as the model for an entry-trap for hookless agents)
- Aigon specs:
  - `docs/specs/features/03-in-progress/feature-493-make-agent-installed-hooks-notification-only.md` — the trigger for this research
  - `docs/specs/features/05-done/feature-28-auto-version-check.md` — original auto-version-check design
  - `docs/specs/features/05-done/feature-353-doctor-runs-pending-schema-migrations.md` — confirms migrations are version-independent now
- Industry references for the pin-vs-digest split:
  - npm `package.json` (semver intent) vs `package-lock.json` (resolved-content fingerprint) — https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json
  - pnpm config layering (`pnpm-workspace.yaml` + `pnpm-lock.yaml`) — https://pnpm.io/cli/config
  - Volta's project pin (`volta` block in `package.json`) — https://docs.volta.sh/guide/understanding#managing-your-project
  - mise / asdf `.tool-versions` (project pin without digest) — https://mise.jdx.dev/configuration.html
  - rustup `rust-toolchain.toml` (project pin) — https://rust-lang.github.io/rustup/overrides.html
- Filesystem-as-registry pattern: comparable to `~/.npm/_logs/`, `~/.cache/`, `git rerere` directory — append-only marker files instead of mutable JSON

---

## Recommendation

Take a sequenced position on the four sub-questions:

1. **Pin model: adopt option (d) — pin both.** Keep `.aigon/version` purely as a human-readable provenance stamp (last-synced CLI semver, no semantic check derived from it). Introduce a content digest (extend the existing `config-hash` to cover all CLI-emitted artifacts: templates, agent configs, hook payloads, vendored docs). Drift-detection in `check-version` switches from semver compare to digest compare. Eliminates patch-bump false positives, preserves the team-visible "this repo last synced at v2.65" line.

2. **Multi-repo registry: filesystem markers, not central JSON.** `~/.aigon/repos/<sha256(repoPath)>` zero-byte markers, written on aigon invocations that read `.aigon/`. Self-pruning on read. `aigon repos list` walks markers; `aigon repos update` does an `update` per repo with aggregated exit. Lower failure surface than JSON; no schema versioning needed.

3. **Dashboard role: stay single-repo, add two minimal indicators.** "Templates out of sync" banner (digest-driven, action: `aigon update`) and "Server is older than CLI" banner (action: `aigon server restart`). Skip the "version trinity" multi-number badge — it's noise. Multi-repo dashboard belongs in a Pro / machine-status surface, deferred.

4. **Hookless agents: wrap the launcher.** Mirror the F493 shell-trap pattern — the agent-start path prints the same drift notice to stderr before exec'ing the agent. Universal across all six agents; doesn't depend on the agent's hook capabilities. Dashboard banner is the secondary surface.

5. **`aigon update --pull`: keep, with two guards.** (a) Detect non-git `ROOT_DIR` and refuse with a clear "this is an npm install — use `npm update -g @senlabsai/aigon`" message. (b) After successful `--pull`, prompt to restart any running dashboard if the dashboard surface changed.

Sequencing for implementation: ship (1) and the digest extension first (it's the smallest fix with the largest noise reduction). Then ship (4) the launcher wrap (universal hookless coverage with one mechanism). Then (3) the dashboard banners. (2) the registry can come later once the single-repo story is solid; without it, users still have a working per-repo flow.

---

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| `content-digest-drift-detection` | Extend `.aigon/config-hash` to cover all CLI-emitted artifacts (templates, agent configs, hook payloads, vendored docs) and switch `check-version` drift trigger from semver compare to digest compare; `.aigon/version` stays as human-readable provenance only | high | none |
| `agent-launcher-drift-notice` | When the agent-start path spawns any agent (cc, gg, cu, cx, km, op), print the digest-drift notice to stderr before exec — universal coverage that doesn't depend on per-agent hook frameworks | high | content-digest-drift-detection |
| `dashboard-drift-and-restart-banners` | Two minimal dashboard indicators: "templates out of sync" (digest-driven, links `aigon update`) and "dashboard server older than CLI binary" (links `aigon server restart`); replaces the proposed "version trinity" multi-number display | high | content-digest-drift-detection |
| `repos-filesystem-registry` | Touch `~/.aigon/repos/<sha256(repoPath)>` markers on aigon invocations that read `.aigon/`; self-pruning on read; `aigon repos list` walks markers — replaces a central JSON registry to avoid stale-entry / race-condition / schema-migration costs | medium | none |
| `repos-update-all` | `aigon repos update` walks the filesystem-marker registry, runs `update` per repo, returns aggregated exit code — single command to clear post-`npm-update -g` backlog across all known repos | medium | repos-filesystem-registry |
| `update-pull-clone-only-guard` | `aigon update --pull` detects non-git `ROOT_DIR` and refuses with a clear "use npm" message; after successful `--pull`, prompts to restart running dashboard if the dashboard surface changed | low | none |
