---
complexity: medium
transitions:
  - { from: "in-evaluation", to: "done", at: "2026-04-23T13:35:45.703Z", actor: "cli/research-close" }
  - { from: "inbox", to: "backlog", at: "2026-04-23T11:31:42.842Z", actor: "cli/research-prioritise" }
---

# Research: publish-npm-package

## Context
Aigon is currently installed by cloning the repository. To improve accessibility and user experience, we want to allow users to install and update Aigon as a global NPM package (e.g., `npm i -g @aigon/cli`). This requires research into NPM publishing workflows, update notification mechanisms across different interfaces, and a robust interactive installation experience.

## Questions to Answer
- [ ] How should the `@aigon/cli` package be structured for global installation?
- [ ] What is the best strategy for update notifications in the CLI, slash commands (when used within other agents), and the Aigon dashboard?
- [ ] How can we implement a dual-release strategy (stable vs. `next` tag) using NPM?
- [ ] What are the best practices for an interactive terminal UI for initial setup (e.g., using `inquirer` or `enquirer`)?
- [ ] How do we handle prerequisite checks (Node version, Git, etc.) during a global install?
- [ ] What is the best way to manage user preferences (agent/model defaults, terminal preference, server port) during installation?
- [ ] How should the Aigon server be managed (installed and started) when running from a global NPM package?

## Scope

### In Scope
- NPM package structure and publishing workflows.
- Update notification mechanisms for CLI, slash commands, and dashboard.
- Release utilities for stable and non-stable (`next`) releases.
- Design of an interactive installation terminal UI.
- Prerequisite check logic.
- Configuration management for installation preferences.
- Global installation lifecycle management (server start/stop).

### Out of Scope
- Implementing the actual publishing (this is research).
- Deep architectural changes to the core Aigon engine (unless required for global distribution).

## Inspiration
- Installation guide: https://www.aigon.build/docs/getting-started
- Comparison with `@openai/codex` or Gemini CLI installation flows.

## Findings
<!-- Document discoveries, options evaluated, pros/cons -->

## Recommendation
Use a staged implementation plan centered on publish safety first, then release/process maturity. Start with a strict package boundary and publish controls (`@aigon/cli`, `files` allowlist, dry-run validation), then add explicit `latest`/`next` release automation, followed by a shared update-status path used by CLI/slash/dashboard, and finally complete first-run onboarding plus prereq remediation and packaged server lifecycle support. This sequencing keeps risk low, delivers user-visible value early, and preserves clean dependency ordering for implementation.

## Output

### Set Decision

- Proposed Set Slug: `publish-npm-package`
- Chosen Set Slug: `publish-npm-package`

### Selected Features

| Feature Name | Description | Priority | Create Command |
|--------------|-------------|----------|----------------|
| publish-npm-package-1-package-structure-and-publishing | Make Aigon publishable as `@aigon/cli` with strict package allowlisting and publish safeguards. | high | `aigon feature-create "publish-npm-package-1-package-structure-and-publishing" --set publish-npm-package` |
| publish-npm-package-2-release-channels | Add automated `latest`/`next` npm release flow with dist-tag discipline. | high | `aigon feature-create "publish-npm-package-2-release-channels" --set publish-npm-package` |
| publish-npm-package-3-update-notifications-and-dashboard-status | Build one shared npm-registry update checker for CLI, slash output, and dashboard. | high | `aigon feature-create "publish-npm-package-3-update-notifications-and-dashboard-status" --set publish-npm-package` |
| publish-npm-package-4-interactive-global-setup | Add guided first-run setup with non-interactive fallback. | medium | `aigon feature-create "publish-npm-package-4-interactive-global-setup" --set publish-npm-package` |
| publish-npm-package-5-prerequisite-checks-and-remediation | Add hard/soft prerequisite checks and remediation guidance at setup time. | high | `aigon feature-create "publish-npm-package-5-prerequisite-checks-and-remediation" --set publish-npm-package` |
| publish-npm-package-6-packaged-server-lifecycle-management | Ensure `aigon server` works cleanly from global npm installs, including persistent mode behavior. | medium | `aigon feature-create "publish-npm-package-6-packaged-server-lifecycle-management" --set publish-npm-package` |

### Feature Dependencies

- `publish-npm-package-2-release-channels` depends on `publish-npm-package-1-package-structure-and-publishing` (feature 2 spec has `depends_on: publish-npm-package-1-package-structure-and-publishing`)
- `publish-npm-package-3-update-notifications-and-dashboard-status` depends on `publish-npm-package-1-package-structure-and-publishing` (feature 3 spec has `depends_on: publish-npm-package-1-package-structure-and-publishing`)
- `publish-npm-package-4-interactive-global-setup` depends on `publish-npm-package-1-package-structure-and-publishing` (feature 4 spec has `depends_on: publish-npm-package-1-package-structure-and-publishing`)
- `publish-npm-package-5-prerequisite-checks-and-remediation` depends on `publish-npm-package-4-interactive-global-setup` (feature 5 spec has `depends_on: publish-npm-package-4-interactive-global-setup`)
- `publish-npm-package-6-packaged-server-lifecycle-management` depends on `publish-npm-package-1-package-structure-and-publishing` (feature 6 spec has `depends_on: publish-npm-package-1-package-structure-and-publishing`)

### Not Selected

- configurable-global-server-port: Deferred for later; lower priority than the selected six and can be revisited once packaged server lifecycle changes land.
- example-feature: Placeholder row from an unfilled findings template; not actionable.
