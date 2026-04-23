---
status: submitted
---
# Research Findings: publish npm package

**Agent:** Gemini (gg)
**Research ID:** 38
**Date:** 2026-04-23

---

## Key Findings

### NPM Package Structure & Publishing Workflows
- **Package Structure:** The `package.json` should have a `bin` entry pointing to `aigon-cli.js`. Dependencies should remain under `dependencies` rather than `devDependencies` to ensure they are installed globally with the CLI. The `files` array must include all source directories (e.g., `lib/`, `templates/`, `scripts/`).
- **Publishing:** We should use standard NPM publish commands (`npm publish`).

### Update Notifications
- **CLI:** A lightweight, daily check against the NPM registry can be performed in the background (caching the result in `~/.aigon/update-check.json`). This avoids adding latency to every CLI command. If an update is available, a small notice can be printed.
- **Slash Commands:** Since slash commands (e.g., from within Claude Code or Cursor) expect clean output, update notices should either be very brief (a single line prefix) or disabled entirely to avoid breaking agent parsing logic.
- **Dashboard:** The UI can poll the NPM registry or an Aigon API periodically and display an update banner.

### Dual-Release Strategy (stable vs. next)
- **Implementation:** Utilize NPM tags. Stable releases use the default `latest` tag (`npm publish`). Beta or release candidates should be published using the `next` tag (`npm publish --tag next`).
- **Installation:** Users install the stable version via `npm i -g @aigon/cli` and the beta via `npm i -g @aigon/cli@next`.

### Interactive Installation UI
- **Tooling:** Using a lightweight interactive prompt library like `@inquirer/prompts` or `prompts` is recommended for initial setup (`aigon init`). These libraries have minimal dependencies and provide a clean terminal UI.

### Prerequisite Checks
- **Node.js:** Enforce Node.js versions using the `engines` field in `package.json`.
- **Other Prerequisites (Git, etc.):** Perform these checks on the first run of the CLI (e.g., during `aigon init`) rather than as an NPM `postinstall` script, as postinstall failures can result in a poor user experience and confusing error messages.

### Configuration Management
- **Setup Flow:** During `aigon init`, prompt the user for their preferred terminal, default AI agent, and server port. Save these preferences to `~/.aigon/config.json`. This provides a guided onboarding experience.

### Server Management
- **Global Context:** When installed globally, the `aigon server start --persistent` command can continue to use the existing `lib/supervisor-service.js` to manage the server as a background service via `launchd` (macOS) or `systemd` (Linux).

## Sources

- https://docs.npmjs.com/cli/v10/commands/npm-publish
- https://www.npmjs.com/package/@inquirer/prompts
- https://docs.npmjs.com/cli/v10/configuring-npm/package-json

## Recommendation

Implement a global NPM package deployment strategy utilizing NPM tags (`latest` and `next`) for stable and beta releases. Shift the initial setup logic from manual script execution to a guided `aigon init` interactive command using `@inquirer/prompts` to gather user preferences and perform prerequisite checks. Implement a lightweight, background update notification system that displays brief notices in the CLI and dashboard, while minimizing output in slash commands.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| npm-package-structure-and-publishing | Updates package.json for global distribution and sets up publish scripts | high | none |
| interactive-setup-and-update-notifications | Implements the aigon init interactive setup and background update checker | medium | npm-package-structure-and-publishing |
