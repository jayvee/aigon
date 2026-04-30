# Research Findings: publish npm package

**Agent:** Codex (cx)
**Research ID:** 38
**Date:** 2026-04-23

---

## Key Findings

### 1. Package structure for `@senlabs/aigon`

The current repo is structurally close to a publishable CLI package already:

- `package.json` already defines a `bin` entry for `aigon -> ./aigon-cli.js`
- the runtime is mostly plain Node.js with a small dependency surface
- the install/update model is still clone-based in `lib/version.js`, not registry-based

The blocker is package shape, not package existence. Running `npm pack --dry-run` locally on 2026-04-23 produced a tarball of roughly 72 MB / 1,365 files. It currently includes `.aigon/`, tests, spec files, large docs media, and even `tmp/dashboard-route-extraction.png`. That is too broad for a global CLI package.

Options considered:

1. Publish the repo root as-is and rely on `.npmignore`.
   Pros: smallest code change.
   Cons: too easy to leak test fixtures, specs, screenshots, local state, and future files. The local `npm pack --dry-run` output already shows this failure mode.

2. Keep publishing from the repo root, but switch to an explicit `files` allowlist in `package.json`.
   Pros: simplest safe path; keeps current repo layout; matches npm’s intended packaging controls.
   Cons: every runtime asset must be named explicitly and kept in sync.

3. Publish from a dedicated package subdirectory like `packages/cli/`.
   Pros: strongest boundary between runtime files and repo-only files.
   Cons: significantly more repo churn, path churn, and test churn than needed for a first publish.

Recommendation:

- Start with option 2.
- Rename the package to `@senlabs/aigon`.
- Keep the command name `aigon`.
- Add a strict `files` allowlist covering only runtime material:
  - `aigon-cli.js`
  - `lib/`
  - `templates/`
  - `assets/icon/` if used at runtime
  - selected docs only if the CLI reads them at runtime
- Add `publishConfig.access = "public"` for the first scoped public publish.
- Gate every release with `npm pack --dry-run` and fail CI on unexpected files.

This is consistent with npm docs: `bin` creates the globally runnable command, scoped public packages need `--access public` on initial publish, and omitting `files` defaults to effectively shipping everything.

### 2. Update notifications across CLI, slash commands, and dashboard

There are two implementation shapes:

1. Use `update-notifier` directly in the CLI.
   Pros: solved problem for TTY CLIs; async background check; low effort.
   Cons: it is CLI-only. The dashboard and slash-command flows still need their own logic and cache model.

2. Build a shared Aigon update-status module that checks npm registry metadata and caches the result in `~/.aigon/`.
   Pros: one source of truth for CLI, slash commands, and dashboard; predictable output; easier to expose through the server API.
   Cons: slightly more implementation work.

Recommendation:

- Use option 2 as the primary architecture.
- Reuse the existing `lib/version.js` ownership boundary, but switch the remote source for packaged installs from git-origin checks to npm registry metadata (`npm view @senlabs/aigon version dist-tags --json` or equivalent registry fetch).
- Cache the last check in `~/.aigon/` with a TTL like 24 hours.
- Surface it differently by context:
  - CLI TTY: one concise footer/banner only when stale
  - slash commands / agent hooks: one single-line note, no box UI, no blocking prompts
  - dashboard: read from a server endpoint and show a non-modal badge/banner
- Track the installed channel (`latest` vs `next`) so `next` users are compared against `dist-tags.next`, not `latest`.

Why not make `update-notifier` the core abstraction:

- it is a good leaf dependency for a terminal-only surface
- Aigon also needs dashboard status and agent/slash-command-safe output
- a shared Aigon registry-check module fits the product better than a CLI-only notifier package

### 3. Dual release strategy: stable and `next`

npm dist-tags are the right primitive here.

Options considered:

1. Stable only (`latest`).
   Pros: simplest.
   Cons: no safe preview channel.

2. `latest` + `next`.
   Pros: standard npm pattern; users can opt in with `npm i -g @senlabs/aigon@next`; easy promotion model.
   Cons: requires disciplined CI/release rules.

3. More channels (`alpha`, `beta`, nightly).
   Pros: maximum flexibility.
   Cons: not needed yet; more operational surface area.

Recommendation:

- Use option 2 first:
  - stable releases publish to `latest`
  - prereleases publish to `next`
- Encode prereleases as normal semver prereleases, e.g. `2.55.0-next.1`
- Publish preview builds with `npm publish --tag next`
- Promote tested versions by publishing or retagging intentionally, never by auto-moving `latest`

Live package examples confirm this pattern is common:

- On 2026-04-23, `@google/gemini-cli` exposes `latest`, `preview`, and `nightly`
- On 2026-04-23, `@openai/codex` exposes `latest`, `beta`, `alpha`, and platform-specific tags

This argues for starting with `latest` + `next`, while leaving room to expand later if Aigon actually needs more channels.

### 4. Interactive terminal UI for first-run setup

Main contenders:

1. `@inquirer/prompts`
   Pros: actively maintained, modular, modern API, built-in prompt set includes input/select/confirm/search/password/editor/number, supports `AbortSignal`, and documents TTY behavior clearly.
   Cons: ESM-first ecosystem means some integration care if kept in CommonJS.

2. `enquirer`
   Pros: rich prompt catalog, especially forms/multiselect/sort/survey.
   Cons: older ecosystem posture; less aligned with the modern modular prompt approach.

Recommendation:

- Use `@inquirer/prompts` unless a specific missing prompt forces otherwise.
- Keep the flow narrow:
  - preferred agent(s)
  - model defaults / effort defaults where relevant
  - terminal app
  - optional server port or proxy preference
  - whether to start the server now
- Always provide a non-interactive fallback:
  - respect existing config
  - allow flags/env to bypass prompts
  - if `stdin` is non-TTY, skip prompts and print exact follow-up commands

The non-TTY point matters because Aigon is often invoked from hooks, slash commands, dashboards, or agent shells. Inquirer explicitly documents that prompts require an interactive TTY and exposes cancellation/timeouts via `AbortSignal`, which fits setup flows better than ad hoc readline code.

### 5. Prerequisite checks during global install

Do not put heavy environment validation in npm `postinstall`.

Why:

- global installs should stay predictable and non-interactive
- `postinstall` is a poor place for prompts, repo detection, and OS-specific setup
- many prerequisites are feature-dependent, not install-dependent

Recommendation:

- Keep npm install minimal: install package, no aggressive side effects
- Run prerequisite checks on first execution or explicit `aigon setup`
- Split checks into hard vs soft:
  - hard fail: supported Node version, Git
  - soft warn / guided install: tmux, Caddy, agent CLIs, GitHub CLI
- Reuse the existing doctor/setup architecture instead of building a second installer stack

This fits the current codebase well: setup, doctor, config, and server concerns already live in dedicated modules.

### 6. Managing user preferences

Aigon already has the right storage split:

- machine/global config: `~/.aigon/config.json`
- project config: `.aigon/config.json`

Recommendation:

- first-run global install should write only machine-wide defaults to `~/.aigon/config.json`
- keep per-project settings opt-in and local to the repo
- preferences collected during setup should map directly onto existing config ownership:
  - `terminalApp`
  - default agents/models/effort
  - security defaults if needed
  - optional future `serverPort`

One important local constraint:

- today `getConfiguredServerPort()` is effectively hardcoded to 4100 in `lib/config.js`

So if server-port preference is part of the install experience, that requires a real feature first. The prompt should not pretend the setting exists before the backend does.

### 7. Server lifecycle from a global npm package

The server should be installed globally but run against the current repo, not as a machine-global singleton detached from repository context.

Options considered:

1. Auto-start server during `npm i -g`.
   Pros: zero extra step.
   Cons: wrong repo context, surprising side effect, brittle on shared machines.

2. Manual `aigon server start` / `aigon server start --persistent` after install.
   Pros: explicit, repo-aware, already matches current command model.
   Cons: one extra user step.

3. Install an OS service immediately.
   Pros: durable background process.
   Cons: too heavy for initial install; platform complexity.

Recommendation:

- Use option 2 by default.
- Keep `aigon server start` repo-scoped and current-working-directory aware.
- Offer optional persistence as a follow-up step, not as install-time side effect.
- For persistent background mode, use the existing service-management path or detached child-process behavior intentionally, with logs redirected and the process unref'ed when appropriate.

This matches Node’s documented requirements for background processes: a detached child must also avoid inherited stdio and call `unref()` if it should outlive the parent cleanly.

## Sources

- Local repo evidence:
  - `package.json`
  - `lib/version.js`
  - `lib/config.js`
  - `lib/commands/setup.js`
  - `lib/commands/infra.js`
  - local `npm pack --dry-run` on 2026-04-23
- npm package.json docs: https://docs.npmjs.com/cli/v11/configuring-npm/package-json
- npm dist-tag docs: https://docs.npmjs.com/adding-dist-tags-to-packages
- npm view docs: https://docs.npmjs.com/cli/v11/commands/npm-view
- npm scoped public package docs: https://docs.npmjs.com/creating-and-publishing-an-organization-scoped-package/
- npm trusted publishing docs: https://docs.npmjs.com/trusted-publishers
- npm provenance docs: https://docs.npmjs.com/generating-provenance-statements/
- Node child_process docs: https://nodejs.org/api/child_process.html
- Node os.homedir docs: https://nodejs.org/download/release/v20.9.0/docs/api/os.html
- Inquirer official repo/docs: https://github.com/SBoudrias/Inquirer.js
- Enquirer official repo/docs: https://github.com/enquirer/enquirer
- update-notifier package docs: https://www.npmjs.com/package/update-notifier
- Live package metadata checked with `npm view` on 2026-04-23:
  - `@google/gemini-cli`
  - `@openai/codex`

## Recommendation

Ship the npm transition in phases, not as one large rewrite.

Phase 1 should make the package safely publishable from the repo root: rename to `@senlabs/aigon`, add a strict `files` allowlist, set `publishConfig.access = "public"`, and gate releases with `npm pack --dry-run`. That removes the biggest immediate risk, which is shipping the entire repository as a global package.

Phase 2 should introduce a shared npm-registry-based update-status module for all surfaces. The CLI, slash commands, and dashboard should all read the same cached update result instead of duplicating checks or tying the product to a terminal-only notifier abstraction.

Phase 3 should add an explicit first-run setup flow using `@inquirer/prompts`, backed by existing global config storage in `~/.aigon/config.json`. Prerequisite checks should happen on first run or `aigon setup`, not in npm `postinstall`.

Phase 4 should wire publishing automation around `latest` and `next` dist-tags with trusted publishing from GitHub Actions. Stable builds go to `latest`; prereleases go to `next`.

For server lifecycle, keep the binary globally installed but the running server repo-scoped. Starting the dashboard should remain an explicit `aigon server start` action, with optional persistence, not an install-time side effect.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| npm-package-structure-and-publishing | Make Aigon publishable as `@senlabs/aigon` with a strict package file allowlist, public scoped publish config, and release validation via `npm pack --dry-run`. | high | none |
| npm-release-channels | Add automated `latest` and `next` npm release flows, including prerelease versioning and dist-tag management. | high | npm-package-structure-and-publishing |
| npm-update-notifications-and-dashboard-status | Add one shared npm-registry-based update checker with cached status for CLI, slash-command output, and dashboard UI. | high | npm-package-structure-and-publishing |
| interactive-global-setup | Add a first-run interactive setup flow using `@inquirer/prompts` with safe non-interactive fallback behavior. | medium | npm-package-structure-and-publishing |
| install-prerequisite-checks-and-remediation | Add first-run prerequisite detection for Node, Git, tmux, and optional tooling with hard/soft failure tiers and remediation guidance. | high | interactive-global-setup |
| packaged-server-lifecycle-management | Make `aigon server` work cleanly from a global npm install, including optional persistent/background management without install-time auto-start. | medium | npm-package-structure-and-publishing |
| configurable-global-server-port | Move the server port from a hardcoded default to a real global config setting so install/setup can collect and honor a user preference. | low | packaged-server-lifecycle-management |
