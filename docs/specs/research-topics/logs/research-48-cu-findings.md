# Research Findings: aigon versioning model and multi repo update ux

**Agent:** Cursor (cu)
**Research ID:** 48
**Date:** 2026-05-09

---

## Key Findings

### How Aigon behaves today (codebase anchors)

Three “versions” are real and independent:

| Layer | Source | Role |
|--------|--------|------|
| **CLI / package** | `getAigonVersion()` reads the **installed CLI’s** `package.json` (`lib/version.js`). | Defines which templates + command logic ship with the binary. |
| **Per-repo stamp** | `.aigon/version` via `getInstalledVersion` / `setInstalledVersion` (`lib/version.js`). **Skipped in git worktrees** (avoids merge noise on feature-close). | Last version that ran `aigon update` successfully in **this repo root**. |
| **Dashboard runtime** | Server logs include `require('../package.json').version` (`lib/dashboard-server.js` ~startup). | Whatever Node process was started — stale if server not restarted after upgrade. |

`aigon check-version` (`lib/commands/setup.js`) compares CLI semver to `.aigon/version`; on mismatch it currently runs full `update` + migrations (F493 will make hooks **notice-only** so drift becomes visible without session-start writes). There is already a **second** drift signal: `.aigon/config-hash` vs `computeInstructionsConfigHash()` can force reinstall even when semver matches.

`aigon update --pull` runs `upgradeAigonCli()` → `git pull` + `npm ci` in `ROOT_DIR` (`lib/version.js`), then normal project sync — **clone / dev install path**, distinct from npm global install.

Npm users get an **advisory** registry check (`lib/npm-update-check.js`, `@senlabsai/aigon` dist-tags, 5‑minute cache) shown after sync work in `check-version`; it does not gate success.

**Implication:** The product already mixes **semver pin (a)** with **content-ish signals (config hash)**. Migrations are keyed by versioned manifests (see F353 / `lib/migration.js`), not only by “trust the pin file” — but the pin still drives *when* `check-version` believed a full sync was needed.

### Should `.aigon/version` exist? — Three models evaluated

**(a) Keep per-repo semver pin (status quo)**

- **Pros:** Committed pin is legible in PRs (“this repo moved to Aigon 2.65”); aligns with industry pattern of **project-level toolchain pins** (e.g. Volta’s `volta` block in `package.json`, workspace-scoped configs in pnpm — team reproducibility matters). Gives a stable hook for changelog surfacing (`getChangelogEntriesSince` on `update`). Worktree omission shows the pin is understood as **mainline repo state**, not every worktree clone.
- **Cons:** Three-way confusion after F493 — **global CLI vs pin vs dashboard process** feels like “broken” unless explained. Semver mismatches fire even when templates didn’t meaningfully change (noise). Pins can lag while work continues (acceptable but needs UX).

**(b) Remove the pin**

- **Pros:** Simple story: “Invoking `aigon` always materializes configs from **that** binary.” No misleading “repo is at 2.64” when files were hand-edited. Eliminates one line of drift from the trio.
- **Cons:** Lose an easy **git-visible** answered question: “Which generation of installer last ran here?” Migrational baselines and “what changed since” UX must move entirely to manifests, install manifest (`F422`), migrations, or git history — heavier mental load. Teams cannot see at a glance that a coworker hasn’t synced. **Highest risk for support/debug** (“paste your `.aigon/version`”) disappears.

**(c) Hybrid: pin a manifest hash, not semver**

- **Pros:** Sync runs when **delivered template / managed-file content** differs, not merely when patch bumps. Reduces needless churn and matches mental model (“drift = real difference”). Aligns with how package ecosystems think about lockfiles/content-addressed deps.
- **Cons:** Requires defining the canonical hashed set (templates, agent JSON payloads, hooks recipes, `.aigon/docs` vendoring, etc.), invalidation rules, and a migration story for repos that partial-sync. Separate problem: **npm still publishes semver** — users need a lane to learn “new security fix” independent of hash equality.

**Synthesis:** **Do not adopt (b) as sole model.** The repo needs a durable, introspectable “last synced generation” for teams and migrations. **Prefer retaining a pin-shaped artifact** — either classic **(a)** or **(c)** where the stored value is **content-derived** but still one field in `.aigon/`. Today’s **`config-hash` + semver** is a weak form of **(c)**; evolving toward a **single documented “sync generation”** (semver + aggregate template digest, or digest-only + separate “npm advisory”) would reduce conceptual sprawl.

### Multi-repo UX

Reasonable layered approach (no need to build everything at once):

1. **Machine-local registry** — e.g. `~/.aigon/known-repos.json` updated on `init`, `install-agent`, and successful `update` / `check-version` (read-only path could append **candidates**; writes only on explicit commands to avoid privacy surprises). This matches the research prompt’s direction.
2. **`aigon update --all` (or `aigon sync-repos`)** — walks registry, `cd` each root, runs `update` with shared summary. Exit policy: aggregate report, non-zero if any repo failed (operator-friendly for CI/scripting).
3. **Dashboard multi-repo “command center”** — materially higher cost: auth across paths, ambiguity of “which `.aigon`”, WebSocket/session model, conflict with single-repo invariant in `AGENTS.md`. **Defer** unless Pro / power-user tier justifies it; CLI + registry solves 80% for multi-repo engineers.

Cross-repo UX should **reuse** npm advisory (`checkForUpdate`) **once per machine**, not once per repo, to avoid rate / noise issues (minor product tweak).

### Dashboard: single-repo vs hub

**Default:** Stay **single-repo by default** — workflow engine paths, snapshots, proxy registration are cwd-scoped; changing that is architectural.

**Low-cost/high-value additions:** Persistent **telemetry banner**: “CLI vX · pinned vY · dashboard vZ” with **explicit “restart server”** when Z ≠ X. Optional link to changelog since pin. That addresses “dashboard open from stale process” **without** multi-repo coupling.

Large multi-repo rollup (“N/M behind”) belongs in **Pro or a dedicated “machine status” pane** feeding off the registry, not the core Kanban layout.

### Hookless agents (Codex / Kimi / OpenCode)

They miss `SessionStart` parity. **Minimal universal surfaces:**

| Surface | Purpose |
|---------|---------|
| **Dashboard banner** | Same drift line as hooked agents whenever user opens dashboard from that repo. |
| **`aigon doctor` / `check-version`** | Document as weekly habit; doctor already central for repair narrative. |
| **Optional IDE docs** — install skill text for cx/op/km | One line: run `aigon check-version`; run `aigon update` when advised. |

No substitute for proactive notice except **dashboard** or **explicit user cron/alias**.

### Scenario walk-throughs (desired UX)

1. **`npm update -g` Monday, eight repos:** One global upgrade. Across the week, first action in each repo: **non-blocking notice** (F493): “CLI ahead of pin — run `aigon update` when ready.” Optionally Monday night: **`aigon update --all`** from registry clears backlog. Rare: restart dashboard per repo session if server pinned old code.

2. **Stale repo after three months:** Open project → prominent **pin vs CLI delta** + **npm advisory** (“registry newer than CLI?” separate line) + link to changelog since pin. **`aigon update`** is the decisive action; `doctor --fix` if migrations pending. No silent mutation at agent start.

3. **Codex/Kimi/OpenCode-only:** Dashboard or **printed message on first `doctor`/`update`/`server start`** in that repo captures attention; onboarding skill lists the same.

4. **Dashboard repo A, working in repo B:** **No automatic cross-repo signal** without registry UI — acceptable v1 limitation; user runs `check-version` in B or adopts future **machine-local status** command fed by registry.

### `aigon update --pull`

**Keep first-class.** It is the **clone dogfood path** codified beside npm (`upgradeAigonCli`). Many contributors run from git checkout; starving this path pushes them toward ad-hoc scripts. Messaging can clarify tiers: **`--pull`** = developer clone; **`npm i -g`** = default consumer.

---

## Sources

- Aigon implementation: [`lib/version.js`](https://github.com/senlabsai/aigon/blob/main/lib/version.js) (conceptual — local paths: `lib/version.js`, `lib/commands/setup.js` check-version/update, `lib/npm-update-check.js`, `lib/dashboard-server.js` startup log).
- F493 scope (hook non-mutating, defer versioning UX): `docs/specs/features/03-in-progress/feature-493-make-agent-installed-hooks-notification-only.md`
- Migration idempotency note vs `.aigon/version`: `docs/specs/features/05-done/feature-353-doctor-runs-pending-schema-migrations.md`
- Historical auto-version-check design: `docs/specs/features/05-done/feature-28-auto-version-check.md`, research-07 artifacts under `docs/specs/research-topics/`
- Industry patterns — **committed per-project toolchain config** (Volta): https://voltajs.com/guide/managing-project.html
- Layered config precedence (comparison): https://pnpm.io/cli/config · https://hk.jdx.dev/configuration

---

## Recommendation

1. **Retain a persistent per-repo sync record** — effectively **keep (a)** in the near term **or** plan a deliberate migration to **(c)** by **consolidating** semver + `config-hash` (+ optional template digest) into one documented “generation” stamp. Avoid **bare removal (b)** of `.aigon/version` without replacing its **team-visible** and **migration-baseline** roles.

2. **After F493, invest in clarification UX, not silent hooks:** Dashboard + CLI banners for **CLI / pin / server runtime** divergence; shorten the path **`aigon update`** + **`aigon server restart`** when needed.

3. **Ship machine-local repo registry + `update --all` (CLI)** ahead of dashboard multi-repo; treat multi-repo dashboard as optional / Pro scope.

4. **Hookless agents:** treat **dashboard** and **printed doctor/update output** as the universal channel; tighten install docs/skills accordingly.

5. **Keep `update --pull`** as supported clone-upgrade with clear messaging beside npm installs.

---

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| `dashboard-version-trinity-banner` | Show pinned `.aigon/version`, running CLI version, and dashboard process version with restart guidance when they diverge | high | none |
| `known-repos-registry` | Maintain `~/.aigon/known-repos.json` (or successor) appended/updated from init, install-agent, and post-success update | high | none |
| `update-all-repos-command` | `aigon update --all` walks the registry and runs project sync per root with aggregated success/failure report | medium | known-repos-registry |
| `check-version-registry-npm-cache` | Deduplicate npm registry advisory across repos in one process/session to reduce redundant HTTPS checks | low | known-repos-registry (optional linkage) |
| `sync-generation-manifest` | Replace or augment raw semver pin with a content hash / manifest digest so sync triggers only when managed outputs change (implements model **(c)** in a principled way) | low | dashboard-version-trinity-banner (for surfacing digest vs npm semver) |
| `hookless-agent-version-onboarding` | Update cx/op/km skill + install snippets to prescribe `check-version`/`update` and point to dashboard banner | medium | dashboard-version-trinity-banner |