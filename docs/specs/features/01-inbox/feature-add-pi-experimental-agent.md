---
complexity: high
---

# Feature: add-pi-experimental-agent

## Summary

Add Pi (`pi`, package `@mariozechner/pi-coding-agent`) as an experimental open-source harness agent in Aigon. Pi overlaps with OpenCode as a provider-flexible OSS coding harness, so this feature intentionally adds it as non-default and bench-gated: available for explicit selection, installable through `aigon install-agent pi`, and measurable through the normal lifecycle/telemetry paths before any future promotion to a default Fleet agent.

## User Stories

- [ ] As an Aigon operator, I can install Pi support and explicitly start a feature with `pi` to evaluate it against OpenCode and native provider agents.
- [ ] As an Aigon maintainer, I can compare Pi against `op` using the same bench, telemetry, session, and lifecycle surfaces used for other agents.
- [ ] As an implementing agent, I can use Pi's prompt-template and skill conventions without relying on hardcoded Pi-specific launch behavior outside the agent registry strategy hooks.
- [ ] As a dashboard user, I can see Pi as experimental/non-default and avoid accidentally selecting it as a default Fleet participant before it has bench evidence.

## Acceptance Criteria

- [ ] `templates/agents/pi.json` exists and is loaded by `lib/agent-registry.js` without special-case agent-id branches.
- [ ] Pi is configured as `defaultFleetAgent: false` and is clearly marked experimental in its display/notes/docs.
- [ ] Pi uses prompt-template launch, not TUI injection:
  - `capabilities.resolvesSlashCommands: true`
  - `cli.command: "pi"`
  - `cli.implementPrompt: "/aigon-feature-do {featureId}"` and equivalent eval/review/revision prompts.
  - `cli.injectPromptViaTmux` is absent or false.
- [ ] `aigon install-agent pi` writes Aigon-owned Pi prompt templates under `.pi/prompts/` using Pi-compatible markdown frontmatter and does not modify user-owned `AGENTS.md`, `CLAUDE.md`, or README files.
- [ ] Pi also receives `.agents/skills/aigon-*/SKILL.md` outputs so the same canonical command bodies remain available through the Agent Skills path.
- [ ] Pi model and effort overrides are wired through existing launch helpers:
  - `--model <value>` for model override.
  - `--thinking <off|minimal|low|medium|high|xhigh>` for effort/thinking override.
  - `supportsModelFlag: true`.
- [ ] Pi session capture is implemented via a new runtime strategy, e.g. `runtime.sessionStrategy: "pi-sessions"`, that finds the newest matching Pi JSONL session under `~/.pi/agent/sessions/` for the launched worktree.
- [ ] Pi telemetry is implemented via a new telemetry strategy, e.g. `runtime.telemetryStrategy: "pi-jsonl"`, parsing Pi session JSONL enough to populate normalized Aigon telemetry:
  - session id/path
  - model/provider when present
  - turn/message counts
  - tool-call counts
  - input/output/cache/thinking tokens when present
  - cost when present
- [ ] If Pi token/cost fields are missing in a session, telemetry degrades explicitly to `null` fields rather than inventing totals.
- [ ] Resume support is configured if Pi's `--session <path|id>` path works in smoke testing; otherwise `runtime.resume` is left null and the agent doc states resume is not yet supported.
- [ ] Quota/failure patterns are configured conservatively for common provider errors (`quota`, `rate limit`, `429`, `insufficient credits`, `context length`) without treating unknown output as depleted.
- [ ] `tests/integration/worktree-state-reconcile.test.js` includes a Pi launch-command assertion block covering:
  - initial prompt passed as a quoted `/aigon-feature-do <id>` CLI argument
  - no TUI paste-buffer injection
  - model flag injection
  - `--thinking` effort flag injection
- [ ] Unit or integration tests cover the new Pi session finder and telemetry parser using fixture JSONL files.
- [ ] Docs are added or updated to explain Pi's experimental status, expected install command (`npm i -g @mariozechner/pi-coding-agent`), auth prerequisites, and how it differs from `op`.
- [ ] The dashboard and `aigon config models` surfaces show Pi from registry data without any hardcoded Pi-specific UI branch.

## Validation

```bash
node -c aigon-cli.js
node -c lib/agent-registry.js
node -c lib/session-sidecar.js
node -c lib/telemetry.js
npm test

# Smoke in a disposable or seed-reset repo after local auth is configured:
aigon install-agent pi
aigon feature-start 01 pi --skip-quota-check
aigon session-list
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May run `npm view @mariozechner/pi-coding-agent version --json` and Pi CLI help/version commands to verify current flags.
- May install Pi temporarily with `npm i -g @mariozechner/pi-coding-agent` only if it is not already present and only for local smoke validation.
- May add small JSONL fixtures under the existing test fixture structure for Pi session and telemetry parsing.
- May run `aigon seed-reset brewboard --force` for an end-to-end smoke test after the implementation is otherwise complete.

## Technical Approach

Follow `docs/adding-agents.md` and `templates/feature-template-agent-onboard.md`.

Pi classification:

- Q1 prompt delivery: yes, Pi accepts initial prompt arguments.
- Q2 slash-command support: yes, Pi prompt templates invoke as `/name`; install Aigon commands as `.pi/prompts/aigon-feature-do.md` etc.
- Q3 model flag: yes, `--model <pattern>` exists.
- Q4 interactive: expected yes in default interactive mode with an initial prompt; verify with tmux smoke before declaring done.
- Q5 transcript telemetry: yes, Pi writes JSONL sessions under `~/.pi/agent/sessions/`, but Aigon needs a new parser/finder.

Implementation steps:

1. Add `templates/agents/pi.json`, based on the documented agent-onboarding template and the closest existing prompt-template agents.
2. Use `outputs` with two entries:
   - `.pi/prompts/aigon-*.md` as Pi prompt templates.
   - `.agents/skills/aigon-*/SKILL.md` for skill-compatible prompt bodies.
3. Add `pi-sessions` to the strategy map in `lib/session-sidecar.js`. Use Pi's cwd-encoded session directory and/or session header `cwd` to match the launched worktree. Prefer header validation over filename-only matching.
4. Add `pi-jsonl` parsing in `lib/telemetry.js`. Reuse Aigon's normalized telemetry writer and pricing helper where possible. Keep parser behavior fixture-driven and tolerant of missing optional fields.
5. Configure model/effort options in `pi.json` conservatively. Use provider-prefixed model values only where Pi accepts them. Do not make Pi a default Fleet agent in this feature.
6. Add install/launch tests, parser tests, and a real smoke checklist in the implementation log.

## Dependencies

- Local Pi auth is required for real smoke testing. Supported routes include API keys or Pi's subscription login flow.
- Pi requires Node `>=20.6.0`.
- This feature intentionally depends on the existing pluggable agent registry and install-agent multi-output behavior; do not add hardcoded Pi branches unless a strategy hook is missing and covered by tests.

## Out of Scope

- Promoting Pi to default Fleet membership.
- Removing or replacing OpenCode.
- Adding Pi-specific dashboard controls beyond what the registry already exposes.
- Building an Aigon-over-Pi RPC supervisor. This feature uses the same tmux-oriented lifecycle model as existing agents.
- Supporting Pi packages beyond prompt templates and skills.

## Open Questions

- Does Pi interactive mode with an initial prompt always return to its editor after task completion under Aigon's tmux wrapper, or does it ever exit like print mode?
- Is `--session <id>` sufficient for deterministic resume, or should Aigon store and pass the full session file path?
- Which default provider/model should `pi.json` use for low/medium/high/very-high complexity without duplicating native `cc`/`cx` routes too aggressively?
- Should Pi's experimental status be represented only in docs/model notes, or should the dashboard grow a generic registry-driven `experimental` badge in a later feature?

## Related

- `docs/adding-agents.md`
- `templates/feature-template-agent-onboard.md`
- Pi upstream: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent
- OpenCode agent precedent: `templates/agents/op.json`
