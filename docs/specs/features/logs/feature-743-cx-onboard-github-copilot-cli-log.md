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

## Code Review

**Reviewed by**: cc
**Date**: 2026-08-05

### Fixes Applied
- `912415619 fix(review): expose full Copilot effort ladder (none, minimal)` — the spec (Q3 and Technical Approach "the CLI effort ladder (`none` through `max`)") enumerates `none, minimal, low, medium, high, xhigh, max`, but `cp.json` `effortOptions` shipped only Default/low/medium/high/xhigh/max, dropping `none` and `minimal`. Added both in ladder order.

### Validation
- Validation not run by reviewer per policy.

### Escalated Issues (exceptions only)
- ESCALATE:blocked — The 8 named `modelOptions` entries (Claude/GPT/Gemini/MAI) have no `summary` block. Per `docs/model-inclusion-policy.md` line 82, a `summary` is required on any new model added after F618 (PR-review-enforced, not validator-enforced). Authoring accurate `summary`/`notes` requires discovery + benchmark evidence, which CLAUDE.md rule 11 designates as maintainer-only tooling; a reviewer cannot fabricate headline/confidence/sources without inventing claims the spec explicitly forbids ("Aigon must not imply that every listed model is usable on every Copilot plan"). Left for maintainer catalog backfill. Not a functional blocker — `score: null` + no `complexityDefaults` promotion is a valid "brand-new model" state per policy line 25.

### Notes
- Registry contract is satisfied: `portOffset: 9` is unique across the roster, `pricing` is correctly omitted (plan-bundled SKU), and `notes` are correctly absent (policy requires them only on `complexityDefaults`-promoted models; all cp tiers default to `auto`).
- The `templates/generic/skill.md` rewrite is safe: `install-agent.js` only runs `processTemplate` substitution on it (no structural parsing of the removed `tools:`/`system_prompt:` block), and it installs only for agents with `extras.skill.enabled` (cc), whose install test confirms the new standard frontmatter. cp uses `extras: {}` and per-command skills.
- The `lib/templates.js` `JSON.stringify(hint)` change correctly YAML-escapes the embedded quotes in the `feature-transfer` argument hint that previously broke `copilot skill list`; scoped to the `markdown` frontmatter branch.
- Launch shape verified against the spec: `copilot --allow-all --interactive --model auto '/aigon-feature-do <ID>'`, no `-p/--prompt`, no tmux paste injection.

### Author Revision

- Accepted `912415619`: `none` and `minimal` are supported by the tested Copilot CLI and required by the F743 effort-ladder specification.
- Resolved the catalog-summary escalation with low-confidence, provider-sourced summaries for every named model. The summaries make the lack of Aigon benchmarks and entitlement-dependent access explicit; Auto remains the only default.
