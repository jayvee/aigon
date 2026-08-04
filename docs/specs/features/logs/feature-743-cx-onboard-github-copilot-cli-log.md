# Implementation Log: Feature 743 - onboard-github-copilot-cli
Agent: cx

## Status

Implemented `cp` as a launchable GitHub Copilot CLI agent in `templates/agents/cp.json`, with Agent Skills installation, interactive tmux launch, Auto defaults, named model and effort pickers, generated agent docs, and focused regressions.

## New API Surface

- Agent ID `cp`; aliases `copilot`, `github-copilot`, and `cp`.
- `aigon install-agent cp` installs `.agents/skills/aigon-*/SKILL.md` and `.aigon/docs/agents/github-copilot.md`.

## Key Decisions

- Launch `copilot --allow-all --interactive` with `/aigon-*` Agent Skill prompts; never use one-shot `-p`/`--prompt` for normal Aigon sessions.
- Use `auto` for every task and complexity tier while keeping current named GPT, Claude, Gemini, and MAI choices in the picker.
- Keep `cp` outside the default Fleet roster until benchmark and reliability evidence exists.

## Gotchas / Known Issues

- Named model access depends on the user's Copilot plan and organization policy.
- A new working directory can still show Copilot's one-time folder-trust prompt before the initial skill runs.
- Copilot scans `.claude/skills` as well as `.agents/skills`; the shared Aigon skill template now uses standard frontmatter, and generated Claude argument hints are YAML-escaped.

## Explicitly Deferred

- Transcript, cost, token, resume, ACP, plugin, hook, remote-control, memory, and cloud-agent integration.
- Dynamic refresh of the entitlement-dependent model catalog.

## For the Next Feature in This Set

Benchmark `cp` and gather session reliability evidence before considering default Fleet promotion or telemetry/resume work.

## Test Coverage

- Required spec validation: registry smoke, registry contract, worktree launch contract, template leak check, and `npm run test:iterate` all pass.
- Focused installer regression confirms Agent Skills and generated docs are written while `AGENTS.md`, `CLAUDE.md`, and `README.md` remain byte-identical.
- Disposable live smoke on Copilot CLI 1.0.78: mixed `cc` + `cp` install, clean `copilot skill list`, `/aigon-help` invocation, and an interactive session remaining open for follow-up.
