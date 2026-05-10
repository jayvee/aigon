# Research Findings: aigon versioning model and multi repo update ux

**Agent:** Codex (cx)
**Research ID:** 48
**Date:** 2026-05-10

---

## Key Findings

### Current Aigon Model

Aigon has three independent version facts:

| Fact | Local source | User meaning |
|------|--------------|--------------|
| CLI/package version | `lib/version.js:getAigonVersion()` reads the installed Aigon package `package.json`. | Which code and bundled templates this command invocation will use. |
| Repo sync stamp | `.aigon/version`, read/written by `getInstalledVersion()` / `setInstalledVersion()`. | The last Aigon version that synced managed files in this repository. |
| Dashboard process version | Running Node process, surfaced from package metadata during server startup and indirectly through dashboard status. | The version of the already-running server, which can lag behind a newly upgraded CLI until restart. |

`aigon check-version` currently compares the CLI version to `.aigon/version` and, before F493, auto-runs `aigon apply` on mismatch. F493 intentionally makes that hook path non-mutating, so users will start seeing drift that was previously hidden by automatic writes. There is already a second content-ish signal in the repo: `.aigon/config-hash`, which detects instruction/config changes even when semver did not change. That means the product is already halfway between "version pin" and "content generation hash"; the model needs clarification rather than another notice command.

`aigon apply --pull` is a separate clone-installed path: `upgradeAigonCli()` runs `git pull` and `npm ci` in the Aigon source checkout, then runs normal project sync. Npm-installed users instead use npm's global package update path and then sync each repo.

### Should `.aigon/version` Exist?

**Option A: keep the per-repo semver pin.**

Pros: It is simple, git-visible, and useful in support/debugging: the repo can answer "what generation of Aigon last synced these managed files?" It also powers changelog ranges in `aigon apply`. This matches common project-local tooling records: Corepack uses a project `packageManager` field to select a package-manager version, and package-lock/Terraform lock files keep committed records of generated dependency selections.

Cons: After F493, users can see three version numbers at once. A semver mismatch can also be noisy when a patch release did not materially change generated files.

**Option B: remove the pin entirely.**

Pros: The story is simple: the installed CLI is always the source of truth, and a repo is never "behind" except by actual file content.

Cons: It removes an important audit/debug artifact. Teams lose a committed signal that a repo has or has not been synced after an Aigon upgrade. Migration and changelog UX would need to move to a heavier manifest/history mechanism anyway. This does not eliminate drift; it makes drift harder to explain.

**Option C: replace the semver pin with a sync-generation manifest/hash.**

Pros: This is the cleanest long-term model. Store one durable "managed output generation" derived from the templates, agent configs, installed command assets, vendored docs, and relevant project config. Drift then means "generated content would change", not just "package semver differs". This aligns with lockfile/checksum models: npm lockfiles record an exact tree, and Terraform's lock file records provider versions plus checksums and changes only on explicit upgrade.

Cons: The implementation is non-trivial. Aigon must define the hashed input set, handle partial installs across agents, preserve changelog/security-update visibility, and migrate existing `.aigon/version` users without losing supportability.

**Conclusion:** Do not remove the per-repo sync record. Keep `.aigon/version` in the near term, but treat it as the current shape of a broader "sync generation" concept. The best long-term direction is Option C: a manifest-backed generation record that includes semver for human readability plus a content digest for actual drift detection.

### Multi-Repo UX

Aigon already has a global repo list through `readConductorReposFromGlobalConfig()`, used by dashboard collection and older rollout-style commands. The research prompt's `~/.aigon/known-repos.json` idea is sound, but Aigon may not need a separate file if the existing global `repos` registry can be formalized as the known-repos source.

Recommended layering:

1. Add a repo-sync status primitive that reports, per repo: CLI version, repo sync stamp, dashboard runtime if applicable, config-hash drift, and whether generated content would change.
2. Add `aigon apply --all` over the known repo registry, with an aggregate report and non-zero exit when any repo fails.
3. Keep the dashboard primarily single-repo. Add a small "machine status" or Pro-level rollup later if users need "N of M repos behind".

The UX should distinguish package update from repo sync. npm's `npm update -g` updates global packages; Homebrew separates refreshing formulae, checking outdated packages, and upgrading. Aigon should use the same conceptual split: upgrade Aigon CLI/package, inspect repo drift, then sync one repo or all known repos.

### Dashboard Role

The dashboard should stay single-repo by default because workflow state, tmux/session attachment, dev-server routing, and repo-specific actions all assume a concrete repo root. Turning it into a full multi-repo command center would be expensive and risks diluting the current workflow UI.

The right minimum dashboard improvement is a visible version-status surface:

`CLI vX | repo sync vY | dashboard process vZ`

It should show clear next actions:

- CLI newer than repo sync: run `aigon apply`.
- Dashboard process older than CLI: restart the Aigon server.
- npm registry newer than CLI: run the npm upgrade command, then sync repos.
- Config/template digest drift: run `aigon apply` even if semver matches.

This solves the confusing "dashboard server was started on v2.63, CLI is v2.65, repo is v2.64" scenario without turning the dashboard into a multi-repo orchestrator.

### Codex / Kimi / OpenCode Interaction

Aigon currently installs SessionStart checks for cc/gg/cu, not for cx/km/op. However, official Codex docs now document `SessionStart` hooks behind `features.codex_hooks = true`, with commands run from the session cwd and JSON output capable of adding developer context. That changes the Codex answer: Codex should get a targeted parity feature once Aigon can safely generate/test the hook config.

Kimi/OpenCode still need dashboard and CLI surfaces unless their hook capabilities are confirmed and modeled in `templates/agents/*.json` / `lib/agent-registry.js`.

Minimum universal channel:

- Dashboard version-status banner for any repo.
- `aigon check-version` as read-only notice after F493.
- `aigon doctor` surfacing pending repo sync/migration issues.
- Agent install docs/skills for cx/km/op telling users where update status appears and which command to run.

### Scenario Walkthroughs

**User runs `npm update -g @senlabsai/aigon` on Monday and has eight repos.**

The CLI updates once. Each repo remains at its prior sync generation until the user explicitly syncs it. `aigon check-version` and the dashboard show non-blocking drift in any repo the user opens. `aigon apply --all` gives a single way to clear all registered repos.

**User opens a repo untouched for three months.**

They should see: current CLI version, repo sync generation, available npm version if newer, changelog since repo sync, and one explicit command: `aigon apply`. If migrations are pending or state is malformed, point to `aigon doctor --fix`.

**User uses only Codex/Kimi/OpenCode.**

Codex can eventually receive a generated SessionStart hook. Until then, the dashboard and CLI notice paths must be enough. Kimi/OpenCode should be treated the same until hook support is confirmed.

**Dashboard is open for repo A while user works in repo B.**

Core dashboard should not pretend to be global. Repo B gets signals only when the user runs Aigon there or opens that repo's dashboard. A future registry-backed machine-status view can show cross-repo drift, but it should be additive.

### `aigon apply --pull`

Keep it first-class. It is the contributor/dogfood path for clone-installed Aigon and should remain supported alongside npm installs. Improve wording so users understand:

- `npm update -g @senlabsai/aigon` upgrades packaged installs.
- `aigon apply --pull` upgrades clone installs.
- `aigon apply` syncs the current repo to the installed/checked-out CLI.
- `aigon apply --all` syncs all known repos.

## Sources

- Local Aigon implementation: `lib/version.js`, `lib/commands/setup.js`, `lib/npm-update-check.js`, `lib/dashboard-status-collector.js`, `templates/dashboard/js/settings.js`, `templates/agents/cx.json`, `templates/agents/km.json`, `templates/agents/op.json`.
- F493 non-mutating hook scope: `docs/specs/features/03-in-progress/feature-493-make-agent-installed-hooks-notification-only.md`.
- Doctor/migration producer gap context: `docs/specs/features/05-done/feature-353-doctor-runs-pending-schema-migrations.md`.
- Historical auto-version-check design: `docs/specs/features/05-done/feature-28-auto-version-check.md`.
- npm global update / outdated docs: https://docs.npmjs.com/cli/v8/commands/npm-update/ and https://docs.npmjs.com/cli/v8/commands/npm-outdated/.
- npm lockfile rationale: https://docs.npmjs.com/cli/v6/configuring-npm/package-lock-json/.
- Terraform dependency lock file: https://developer.hashicorp.com/terraform/language/files/dependency-lock.
- Node Corepack project-local package-manager versioning: https://nodejs.org/download/release/v18.20.7/docs/api/corepack.html and https://github.com/nodejs/corepack.
- Angular CLI update and migrations: https://angular.dev/cli/update.
- Homebrew update/outdated/upgrade split: https://docs.brew.sh/FAQ.
- OpenAI Codex CLI and hooks docs: https://developers.openai.com/codex/cli and https://developers.openai.com/codex/hooks.

## Recommendation

Keep a repo-local sync record. Do not remove `.aigon/version` until there is a replacement sync-generation manifest that preserves human-readable semver, content drift detection, and migration/changelog support.

Ship clarification UX before structural rewrites: a dashboard/CLI version-status surface that names all three facts, plus explicit next commands. Then add known-repo status and `aigon apply --all`. Keep dashboard multi-repo orchestration as later/optional scope.

Treat Codex as a new hook-parity opportunity, not as permanently hookless. Keep dashboard/CLI notices as the universal fallback for Kimi, OpenCode, and non-agent workflows.

Keep `aigon apply --pull` as the supported clone-install upgrade path, with clearer messaging beside npm install guidance.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| `repo-sync-generation-status` | Add a shared read model that reports CLI version, repo sync stamp, dashboard runtime version, config-hash drift, and generated-content drift for one repo. | high | none |
| `dashboard-version-status-banner` | Show repo sync, CLI, dashboard process, and npm registry update status with explicit update/restart commands. | high | repo-sync-generation-status |
| `known-repos-sync-status` | Formalize the known-repos registry and expose per-repo sync status for CLI/dashboard consumers. | high | repo-sync-generation-status |
| `update-all-known-repos` | Add `aigon apply --all` to sync every known repo with aggregate success/failure reporting. | medium | known-repos-sync-status |
| `sync-generation-manifest` | Replace or augment `.aigon/version` with a manifest digest so drift is based on managed output changes, not semver alone. | medium | repo-sync-generation-status |
| `codex-sessionstart-check-version-hook` | Install and test a non-mutating Codex `SessionStart` hook for check-version/project-context parity. | medium | dashboard-version-status-banner |
| `hookless-agent-version-guidance` | Update Kimi/OpenCode installed instructions to point users to dashboard/check-version/update while hook support remains absent or unconfirmed. | low | dashboard-version-status-banner |
