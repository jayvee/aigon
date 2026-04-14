# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note on entries from v2.19 onwards:** the changelog was backfilled in bulk from git history on 2026-04-07 ahead of the public launch. Entries are grouped by theme and dated by month rather than per-patch. For commit-level detail, see `git log v2.18.0..HEAD` or browse the [git tags](https://github.com/jayvee/aigon/tags).

## [2.50.0 – 2.50.43] - 2026-03-18 → 2026-04-07

### Added
- **OSS / Pro repo split** — Pro feature specs, logs, and workflow state moved to a private companion repo. Public aigon now contains only OSS-tier content. Historical Pro features (114, 115, 118, 122, 123, 152, 153, 159, 211, 219, 221, 222, 226) and the corresponding research topics are listed in `docs/specs/features/MOVED-TO-AIGON-PRO.md`.
- **Apache License 2.0** under Sen Labs (replaces the prior MIT-without-LICENSE-file claim).
- **Standard OSS hygiene** — `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, GitHub issue/PR templates, CI workflow (`test.yml`) running the unit suite on Node 18/20/22.
- **Auto-restart server in `feature-close`** when `lib/*.js` files changed during the feature (feature 234) — keeps the dashboard in sync with the new code without manual restart.
- **Stats aggregation** — `aigon stats` rolls up `stats.json` reports across all features, with totals + per-agent + weekly/monthly buckets cached at `.aigon/cache/stats-aggregate.json` (feature 230).
- **Per-agent cost breakdown** in feature stats (feature 231).
- **Honest Pro gate messaging** — gate messages no longer imply a purchase flow exists. Pro is in development and not yet for sale (feature 159).

### Changed
- **`feature-do --autonomous` / `--ralph` renamed to `--iterate`** — old flags print a migration hint and exit 1.
- **`docs/architecture.md` "Aigon Pro" section** trimmed to remove implementation surface (helper API contract details, Pro-side repo structure tree).
- **`site/content/guides/amplification.mdx`** rewritten to remove the "Setting up Pro" install instructions that referenced the private aigon-pro repo path.

### Removed
- **AADE wording** purged from public-facing docs (`README.md`, `docs/architecture.md`, `site/content/comparisons.mdx`, `site/content/guides/_meta.js`) — feature 232.
- **Dead submit-command doc page** rewritten as a deprecation page pointing at `feature-do` and `aigon agent-status submitted`.
- **Two broken image references** in `site/content/guides/amplification.mdx`.
- **GA4 placeholder tracking** from `site/public/home.html` — relies on Vercel Analytics now.
- **19 root-level dev artifacts** — 16 orphan PNG screenshots, `reproduce_bug.js`, `worktree_link` (broken symlink), and stale `COMPARISONS.md` (the public version at `site/content/comparisons.mdx` is canonical now).

### Fixed
- **Pro availability is global, not project-scoped** (feature 226) — `lib/pro.js` no longer reads project config; the dashboard top nav and subprocesses now agree about Pro state.
- **Site `npm audit fix`** cleared 10 vulnerabilities in the Next.js docs site (9 high, 1 moderate) including picomatch ReDoS, lodash-es, chevrotain, langium.

### Security
- Apache 2.0 includes an explicit patent grant.
- Adopted GitHub Security Advisories as the preferred private disclosure channel (`SECURITY.md`).

## [2.45.0 – 2.49.x] - 2026-03-16 → 2026-03-17

### Added
- **`lib/pro-bridge.js`** — single Pro extension seam (feature 219). Pro is loaded as a subscriber that registers routes via `proBridge.initialize()`; no Pro-specific knowledge in OSS modules.
- **AutoConductor for solo mode** — `feature-autonomous-start --review-agent <agent>` runs implement → review → close unattended (feature 214 + follow-ups).
- **Tiered polling cache** for dashboard status collection — hot/warm/cold data separation, reducing dashboard cost on repos with many features.
- **Server reliability hardening** (feature 220).
- **Inline cx prompt body at launch** instead of `/prompts:` discovery (feature 218) — works around codex 0.117's prompt resolution change.
- **Codex skills migration** — codex install switched to the project-local skills format under `.agents/skills/aigon-*/`.
- **Orphaned session detection, dashboard display, and bulk cleanup**.
- **VS Code extension** — right-click context menu commands in the sidebar.
- **Agent Log tab** in the feature drawer.
- **Feature review check shortcut** — `aigon feature-review-check` for quick review accept/challenge/modify decisions.
- **Standardised tmux session naming** with explicit role prefix (impl/review/eval) so multiple sessions per feature stay distinguishable.

## [2.40.0 – 2.44.x] - 2026-03-13 → 2026-03-15

### Added
- **Repo-scoped tmux session naming convention** — sessions are namespaced by repo, so two repos working on the same feature ID don't collide.
- **Auto-exit tmux session after implementation submission**.
- **Workflow-core engine cutover** — features and research now run on event-sourced state with an XState machine and durable effects.

### Changed
- Engine state is the source of truth for lifecycle transitions; the old `state.json` files are migrated on first read.

## [2.35.0 – 2.39.x] - 2026-03-11 → 2026-03-13

### Added
- **Descriptive tmux window titles** for fast feature/research identification at a glance.
- **Arena conduct command** with per-agent notifications and tests (Fleet research orchestration).
- **Tmux support in `research-open`** — opens all Fleet research agents side-by-side in tmux.
- **Needs Attention section** in the menubar app.
- **Reliability & Safety concepts page** in the docs.
- **Amplification Dashboard guide** in the docs.
- **Telemetry & Analytics guide** in the docs.
- **Screenshot component** with graceful placeholder fallback for missing images.

## [2.30.0 – 2.34.x] - 2026-03-05 → 2026-03-10

### Added
- **`aigon deploy` command** with `deployAfterDone` integration (feature 36) — automatic deploy after a feature reaches done state.
- **Auto-commit on `aigon update`** — keeps update transitions atomic.
- **Multi-agent telemetry normalisation** — common schema for sessions across cc, gg, cx so cross-agent cost reporting works (feature 151).
- **Security scan merge gate** with gitleaks + semgrep, severity thresholds, diff-aware (features 119, 120, 133).

## [2.25.0 – 2.29.x] - 2026-03-02 → 2026-03-04

### Added
- **`/aigon:next` command** — context-aware "what should I do next" suggestions based on current feature/research state. Alias `/an`.
- **Mistral Vibe (`mv`) agent support** — added then later retired (CLI cost structure made it unviable).
- **`aigon doctor` enhancements** — broader environment checks.

## [2.19.0 – 2.24.x] - 2026-02-25 → 2026-03-01

### Added
- **`sessions-close` command** — kills all agent sessions for a feature/research ID and closes the Warp tab.
- **`cli.models` config** — per-task-type model selection (e.g. opus for implement, sonnet for review). Feature 19.
- **Combined project + feature-level validation** in the iterate (Ralph) loop.
- **Findings file open + summary** on arena research completion.
- **Status signal design** — formalised the agent-status signaling model used by the workflow engine.

### Fixed
- Various stability fixes across sessions, telemetry capture, and the dashboard pipeline view.

## [2.18.0] - 2026-02-20

### Added
- **Feedback workflow** — Complete lifecycle for capturing and triaging user/customer input
- `docs/specs/feedback/` with six lifecycle folders (inbox, triaged, actionable, done, wont-fix, duplicate)
- Feedback template with YAML front matter schema (attribution, provenance, severity, tags, links)
- `aigon feedback-create <title>` — Create feedback items with auto-assigned IDs
- `aigon feedback-list` — List and filter feedback by status, type, severity, tags
- `aigon feedback-triage <ID>` — AI-assisted triage with classification, duplicate detection, and status management
- AI duplicate detection using token-based similarity (title + summary)
- Preview-first safety model (requires `--apply --yes` to commit changes)
- Agent prompt templates for feedback-create, feedback-list, feedback-triage
- Feedback commands in all agent configs (cc, gg, cx, cu)
- "The Big Picture: Closing the Loop" section in GUIDE.md explaining research → features → feedback cycle
- Complete product lifecycle documentation with forward/backward traceability

### Changed
- README.md: Added feedback to "Why Aigon" section with full lifecycle explanation
- README.md: Updated directory structure to show research → features → feedback flow
- README.md: Added feedback commands to CLI Reference
- README.md: Updated all agent slash command tables to include feedback commands
- GUIDE.md: Added "Detailed Feedback Lifecycle" section
- GUIDE.md: Added conceptual overview of the three-pillar system (research, features, feedback)
- docs/specs/README.md: Listed feedback as third area alongside research and features

## [2.17.0] - 2026-02-18

### Added
- **Local dev proxy with subdomain routing** — `aigon proxy-setup` installs Caddy + dnsmasq for `*.test` domain routing; `aigon dev-server start` spawns the dev server, allocates a port, registers with the proxy, and waits for a health check
- URL scheme: `http://{agent}-{featureId}.{appId}.test` (e.g., `http://cc-119.whenswell.test`)
- `aigon dev-server` subcommands: `start`, `stop`, `logs`, `list`, `gc`, `url`
- `dev-server start` spawns the process in the background with output captured to `~/.aigon/dev-proxy/logs/`
- `dev-server logs [-f] [-n N]` to view and follow dev server output
- `dev-server stop` kills the process by PID and deregisters from the proxy
- `--register-only` flag for manual process management
- `/aigon:dev-server` slash command template for all agents
- Skill tools (`aigon_dev_server_start`, `aigon_dev_server_stop`, `aigon_dev_server_logs`, `aigon_dev_server_list`) so agents discover dev-server commands from natural language
- Per-project `devProxy` config in `.aigon/config.json` (command, healthCheck, basePort)
- `NEXT_PUBLIC_AIGON_*` env vars in `.env.local` for in-app dev banner support
- Fallback to `localhost:<port>` when proxy is not set up
- README and GUIDE documentation with setup, usage, and troubleshooting

### Changed
- `feature-implement` template updated: agents use `aigon dev-server start` instead of manual PORT management
- Web/API profile `testInstructions` updated to reference `aigon dev-server start`
- `STOP_DEV_SERVER_STEP` includes `aigon dev-server stop`

## [2.16.3] - 2026-02-17

### Fixed
- `STOP_DEV_SERVER_STEP` reads PORT from `.env.local` instead of assuming `$PORT` is set in the shell

## [2.16.2] - 2026-02-17

### Fixed
- Prevent nested Claude Code session error when opening worktrees — prepend `unset CLAUDECODE &&` to agent launch commands
- `AGENT_DEV_SERVER_NOTE` placeholder for Codex PTY/background process warning
- Clearer dev server instructions in worktree test steps (removed confusing `PORT=<port>` literal)

## [2.16.1] - 2026-02-16

### Added
- `feature-now` detects inbox features and fast-tracks them (prioritise + setup + implement)
- Kanban board example in README opening section

### Changed
- README and GUIDE updated for config refactor and port configuration

## [2.16.0] - 2026-02-16

### Added
- **Base port configuration** — reads PORT from `.env.local` or `.env` and derives arena agent ports as PORT+1 (cc), PORT+2 (gg), PORT+3 (cx), PORT+4 (cu)
- `readBasePort()` helper to parse PORT from env files (checks `.env.local` first, then `.env`)
- `showPortSummary()` displays port configuration during `init`, `update`, `install-agent`, and `profile show`
- Warning during `feature-setup` when no PORT found for web/api profiles
- Port label echo in arena split panes (`🔌 Claude — Port 3401`) so each pane shows its port on launch

### Changed
- Arena split panes now sort by port offset order (cc, gg, cx, cu) instead of alphabetically
- Ports are always derived from `.env` PORT — removed `arena.ports` config override support

## [2.9.0] - 2026-02-07

### Added
- **Project profile system** for non-web project support (`aigon profile`)
- Six profiles: `web`, `api`, `ios`, `android`, `library`, `generic`
- Auto-detection from project files (Xcode, Gradle, Next.js, Cargo.toml, etc.)
- Checks `ios/` and `android/` subdirectories for mobile projects
- Explicit override via `.aigon/config.json` (`aigon profile set <type>`)
- Profile-aware arena mode: dev server, ports, `.env.local`, and template content adapt to project type
- `aigon profile show` — display current profile and settings
- `aigon profile set <type>` — set project profile explicitly
- `aigon profile detect` — show what auto-detection would choose
- Project profile summary in `aigon config show`

### Changed
- Templates use `{{PLACEHOLDER}}` values for test instructions, dependency checks, and `.env.local` setup
- `feature-setup` only creates `.env.local` with PORT when dev server is enabled (web/api profiles)
- `processTemplate()` uses callback replacement to prevent `$` back-reference issues in multi-line values

## [2.8.0] - 2026-02-06

### Added
- Prompt suggestion hints to all workflow command templates
- Each command now guides Claude Code's grey text suggestion to the next workflow step
- Covers the full chain: create → prioritise → setup → implement → eval/review → done → cleanup

## [2.4.1] - 2026-02-02

### Added
- `feature-now` command — fast-track a feature from idea to implementation in one step (create + prioritise + setup, solo branch)
- `feature-now` slash command template for guided spec writing and implementation
- `feature-now` to all agent configs (cc, gg, cx, cu)
- `pre-feature-now` / `post-feature-now` hook support
- `feature-now` documentation in README (workflow, CLI reference, agent macros, hooks)

## [2.4.0] - 2026-02-02

### Added
- `feature-list` command to show features by status, mode, and location
- Solo worktree mode — `feature-setup <ID> <agent>` creates an isolated worktree for parallel development of multiple features
- Argument resolution to slash command templates — agents can now resolve partial or missing IDs interactively
- Worktree reorganization — worktrees grouped under `../<repo>-worktrees/` directory
- `feature-done` auto-detects solo worktree agent

### Changed
- Slash command templates updated with codebase exploration before spec writing
- Agents instructed to create tasks from acceptance criteria during implementation
- README updated with solo worktree mode, feature-list, and worktree reorganization docs

## [2.3.0] - 2026-01-30

### Added
- Automatic cleanup of deprecated slash commands during `install-agent` and `update`
- Scans each agent's command directory for stale aigon-managed files and removes them
- Reports removed commands with a cleanup message

## [2.2.1] - 2026-01-29

### Fixed
- Use native slash command syntax in next-step recommendations

## [2.2.0] - 2026-01-28

### Added
- Cursor agent support (`cu`) with `.cursor/commands/` integration

## [2.1.0] - 2026-01-27

### Added
- Arena mode for research topics - multiple agents can research in parallel
- `research-setup` command for setting up solo or arena research
- `research-conduct` command for agents to write findings
- `research-synthesize` command for comparing agent findings in arena mode
- Interactive feature selection with deduplication in `research-done`
- Findings file template for arena mode research

### Changed
- Research workflow now mirrors feature workflow pattern (setup → conduct → done)
- `research-done` auto-detects arena mode and shows findings summary

### Removed
- `research-start` command (replaced by `research-setup` and `research-conduct`)

## [2.0.0] - 2025-12-17

### Added
- Unified workflow commands for solo and arena modes
- Arena mode terminology (renamed from "bakeoff")

### Changed
- **Breaking:** Renamed bakeoff commands to arena commands:
  - `bakeoff-setup` → `feature-setup <ID> <agents...>`
  - `bakeoff-implement` → `feature-implement <ID>`
  - `bakeoff-cleanup` → `feature-cleanup <ID>`
- `feature-setup` now handles both solo (no agents) and arena (with agents) modes
- `feature-implement` auto-detects mode based on current directory
- Arena log files now created in worktrees instead of main repo

### Removed
- Separate bakeoff commands (unified into feature commands)

## [1.3.1] - 2025-12-16

### Fixed
- Evaluator now correctly points to worktree logs instead of main repo
- Removed unused `_aigon` cleanup code

## [1.3.0] - 2025-12-16

### Added
- Hooks system for custom pre/post command scripts
- `aigon hooks list` command to show defined hooks
- Hook documentation in README
- Support for `docs/aigon-hooks.md` configuration file

## [1.2.1] - 2025-12-15

### Fixed
- Various bug fixes and improvements

## [1.2.0] - 2025-12-10

### Added
- Initial bakeoff mode for multi-agent competitions
- Worktree-based isolation for parallel implementations

## [1.1.1] - 2025-12-09

### Fixed
- Minor bug fixes

## [1.1.0] - 2025-12-09

### Added
- Agent configuration system
- Support for Claude, Gemini, and Codex agents
- `install-agent` command

## [1.0.0] - 2025-11-24

> **Note:** No git tag was cut for v1.0.0 — it's the conceptual initial release marker. The first actual tag is `v1.1.0` on 2025-12-09. The first commit (`5d73102a`) is dated 2025-11-24.

### Added
- Initial release
- Feature lifecycle management (create, prioritise, implement, eval, done)
- Research lifecycle management (create, prioritise, start, done)
- Spec-driven development workflow
- State-as-folders architecture
