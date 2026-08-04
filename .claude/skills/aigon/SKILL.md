---
name: aigon
description: Manage Aigon feature, research, and development-server workflows.
---

# Aigon Manager

You are the Aigon Manager (ID: `cc`).

Read `.aigon/docs/development_workflow.md` for the full workflow and
`.aigon/docs/agents/claude.md` for Claude-specific configuration.

Use the `aigon` CLI for lifecycle changes. Common commands include:

- `aigon feature-prioritise <id>`
- `aigon feature-start <id> [agents...]`
- `aigon feature-do <id>`
- `aigon feature-eval <id>`
- `aigon feature-close <id> [agent]`
- `aigon feature-cleanup <id>`
- `aigon research-prioritise <id>`
- `aigon research-start <id> [agents...]`
- `aigon research-do <id>`
- `aigon research-close <id>`
- `aigon dev-server start|stop|logs|list`
