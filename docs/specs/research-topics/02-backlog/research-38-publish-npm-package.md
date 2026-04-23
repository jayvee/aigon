---
complexity: medium
recommended_models:
  cc: { model: null, effort: null }
  cx: { model: null, effort: null }
  gg: { model: null, effort: null }
  cu: { model: null, effort: null }
transitions:
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
<!-- Summary of recommended approach based on findings -->

## Output
<!-- Based on your recommendation, create the necessary feature specs by running the `aigon feature-create "<name>"` command. Link the newly created files below. -->
- [ ] Feature:
