# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

## [2.3.0] - 2025-01-30

### Added
- Automatic cleanup of deprecated slash commands during `install-agent` and `update`
- Scans each agent's command directory for stale aigon-managed files and removes them
- Reports removed commands with a cleanup message

## [2.2.1] - 2025-01-29

### Fixed
- Use native slash command syntax in next-step recommendations

## [2.2.0] - 2025-01-28

### Added
- Cursor agent support (`cu`) with `.cursor/commands/` integration

## [2.1.0] - 2025-01-27

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

## [2.0.0] - 2025-01-26

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

## [1.3.1] - 2025-01-25

### Fixed
- Evaluator now correctly points to worktree logs instead of main repo
- Removed unused `_aigon` cleanup code

## [1.3.0] - 2025-01-24

### Added
- Hooks system for custom pre/post command scripts
- `aigon hooks list` command to show defined hooks
- Hook documentation in README
- Support for `docs/aigon-hooks.md` configuration file

## [1.2.1] - 2025-01-23

### Fixed
- Various bug fixes and improvements

## [1.2.0] - 2025-01-22

### Added
- Initial bakeoff mode for multi-agent competitions
- Worktree-based isolation for parallel implementations

## [1.1.1] - 2025-01-21

### Fixed
- Minor bug fixes

## [1.1.0] - 2025-01-20

### Added
- Agent configuration system
- Support for Claude, Gemini, and Codex agents
- `install-agent` command

## [1.0.0] - 2025-01-19

### Added
- Initial release
- Feature lifecycle management (create, prioritise, implement, eval, done)
- Research lifecycle management (create, prioritise, start, done)
- Spec-driven development workflow
- State-as-folders architecture
