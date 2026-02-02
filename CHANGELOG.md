# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
