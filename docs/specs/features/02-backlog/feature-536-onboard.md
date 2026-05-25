---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-25T08:56:49.671Z", actor: "cli/feature-prioritise" }
---

# Feature: onboard-ampcode-agent

## Summary

Add Amp Code (`am`) as a supported Aigon agent. Amp is a multi-model coding agent with an interactive terminal CLI (`amp`), project skills under `.agents/skills/`, built-in thread management, and mode-based model selection. The first release should make Amp a reliable Aigon workflow participant through the registry-first agent path: one `templates/agents/am.json`, generated agent docs/skills, Amp mode picker support in Aigon's existing model picker, focused launch-shape tests, and a manual smoke run.

Primary classification from `docs/adding-agents.md`: **TUI-inject**, pending final smoke validation. `amp -x/--execute` is intentionally not the production launch mode because it exits after one turn; Aigon needs the tmux session to remain at the agent's interactive prompt.

## Agent Identity

- **Agent ID**: `am`
- **Display name**: `Amp`
- **CLI binary**: `amp`
- **Provider family**: `router`
- **Install hint**: `curl -fsSL https://ampcode.com/install.sh | bash` or `brew install ampcode/tap/ampcode`
- **Local version observed during spec drafting**: `0.0.1779686836-g4ef406`, released `2026-05-25T05:27:16.000Z`

## Decision Tree Answers

- **Q1 - Prompt delivery**: Amp does not accept an interactive prompt as a plain command-line argument. It accepts the first message through stdin in interactive mode, and `-x/--execute [message]` runs execute mode then exits. Use **TUI-inject** for Aigon's live tmux sessions.
- **Q2 - Slash-command support**: Do not assume Aigon slash-command resolution. Amp has a command palette and skills, but the first release should paste the inlined Aigon prompt body into the TUI, matching OpenCode's lower-risk path.
- **Q3 - Model flag**: Amp exposes `-m/--mode <deep|large|rush|smart>` and `--effort`, not `--model <model-id>`. First release should still use Aigon's model picker, but the option values represent **Amp modes**. Set `capabilities.supportsModelFlag: true` and `cli.modelFlag: "--mode"` so selected picker values launch as `amp --mode <mode>`, never `amp --model <mode>`.
- **Q4 - Interactive lifecycle**: Expected to stay at the Amp interactive prompt after a task. This must be proven in the manual smoke before closing the feature.
- **Q5 - Transcript telemetry**: Defer. Amp has `threads list`, `threads markdown`, `threads export`, and `usage`, but Aigon does not yet know the active thread id from a launched tmux session. Set `transcriptTelemetry: false` in v1.

## User Stories

- [ ] As an Aigon user with Amp installed and logged in, I can run `aigon install-agent am` and see Amp appear in the same registry-derived surfaces as other agents.
- [ ] As an operator starting a feature with `am`, I get a live Amp TUI in the feature worktree with the correct Aigon prompt injected automatically.
- [ ] As an operator starting a feature with `am`, I can choose an Amp mode from Aigon's normal model picker and have that choice passed as `--mode` at launch.
- [ ] As an operator using Aigon worktrees, Amp launch does not leak active IDE context from my main editor into the isolated worktree.
- [ ] As a maintainer, I can validate Amp's launch shape and registry contract through focused tests rather than hardcoded agent-specific branching.

## Step-by-Step Implementation Plan

1. **Confirm the CLI contract locally**
   - Run `amp --version`, `amp --help`, `amp skill --help`, `amp threads --help`, and `amp usage --help`.
   - In a disposable tmux session, launch `amp --no-ide --no-jetbrains --no-notifications`, paste a short prompt, and confirm:
     - prompt submission via paste-buffer works;
     - Amp can run shell commands;
     - the session returns to an interactive Amp prompt after completion;
     - `aigon agent-status implementation-complete` can be invoked from inside the session.
   - Also verify whether `--dangerously-allow-all` is accepted and whether Amp blocks tool execution without it (determines the `cli.implementFlag` value in Step 2).
   - Do not use `amp -x` for the primary workflow unless this smoke proves the interactive TUI path cannot work.

2. **Add `templates/agents/am.json`**
   - Model it closest to `templates/agents/op.json` (TUI-inject, `supportsModelFlag: true`), not `cx.json`.
   - Required fields (see `templates/feature-template-agent-onboard.md` for the full checklist):
     - `id: "am"`, `name: "Amp"`, `displayName: "Amp"`, `shortName: "AM"`, `aliases: ["amp", "ampcode", "am"]`
     - `providerFamily: "router"`, `portOffset: 7`
     - `terminalColor` / `bannerColor`: pick unused values (check existing agents)
     - `defaultFleetAgent: false`
     - `installHint` / `installCommand`: use the install URLs from Agent Identity above
     - `cli.command: "amp"`
     - `cli.implementFlag`: set to `"--no-ide --no-jetbrains --no-notifications --dangerously-allow-all"` if Step 1 smoke confirms the flag combination is accepted; otherwise use the minimal verified flags and document the reason in the commit message.
     - `cli.injectPromptViaTmux: true`
     - `cli.injectViaTmuxSkillCommand`: set to `true` only if the Step 1 smoke proves Amp accepts a pasted `/skill:aigon-feature-do <ID>`-style invocation from its TUI. Amp has native project skills under `.agents/skills/`, but direct invocation syntax must be verified. If that syntax is not stable, leave `injectViaTmuxSkillCommand` unset/false and use the proven OpenCode-style raw prompt paste path.
     - `cli.implementPrompt/evalPrompt/reviewPrompt/reviewCheckPrompt`: `"feature-do"`, `"feature-eval"`, `"feature-code-review"`, `"feature-code-revise"` (skill names, not slash commands — TUI-inject agents)
     - `cli.submitKey: "Enter"`
     - `capabilities.supportsModelFlag: true`
     - `capabilities.transcriptTelemetry: false`
     - `capabilities.resolvesSlashCommands: false`
     - `runtime`: `{ "telemetryStrategy": null, "sessionStrategy": null, "trustInstallScope": "worktree-base", "resume": null }`
     - `signals.shellTrap: true`, `signals.heartbeatSidecar: true`
     - `git.hasEmailAttribution: true` (verify during smoke — does Amp commit with an email?)
     - `worktreeEnv: {}`
   - **Placeholders block** (required for skill installation and prompt template resolution):
     - `AGENT_ID: "am"`, `AGENT_NAME: "Amp"`, `AGENT_TITLE: "Amp Configuration"`
     - `ARG_SYNTAX: "$ARGUMENTS"`, `ARG1_SYNTAX: "$1"`, `CMD_PREFIX: "aigon-"` (skill prefix, not slash)
   - **Outputs array** (plural `outputs`, not singular `output` — see op.json for the canonical shape):
     - Entry 1 (skill-md): `{ "format": "skill-md", "commandDir": ".agents/skills", "commandFilePrefix": "aigon-", "commandFileExtension": "", "skillFileName": "SKILL.md", "global": false }`
     - If Amp also supports a separate markdown command format, add a second entry; otherwise one skill-md entry is sufficient.
   - **Top-level doc fields**: `supportsAgentsMd: true`, `agentFile: "amp.md"`, `templatePath: "generic/docs/agent.md"`, `rootFile: null`
   - Add `cli.modelFlag: "--mode"` and `cli.modelOptions` for the supported Amp modes:
     - `{ "value": null, "label": "Default" }`
     - `{ "value": "smart", "label": "Smart (Claude Opus 4.7)" }`
     - `{ "value": "deep", "label": "Deep (GPT-5.5 reasoning)" }`
     - `{ "value": "rush", "label": "Rush (GPT-5.5 fast)" }`
   - `large` mode: include it quarantined with `reason: "Amp manual marks as not recommended"`. Do not omit — quarantine preserves the audit trail per project convention.
   - Use `complexityDefaults` to make low-complexity work default to `rush`, medium to `smart`, and high / very-high to `deep`. Set the same mode defaults in `cli.models` for `research`, `implement`, `evaluate`, and `review` only if needed by the existing config resolver.
   - Leave `effortOptions` empty in v1. Amp's `--effort` values vary by mode; that is a follow-up feature.

3. **Fix hardcoded `--model` in foreground/direct launch paths**
   - The **tmux launch path** (`lib/worktree.js` → `lib/agent-launch.js:103-111`) already uses `agentRegistry.getModelFlag(agentId)` and is correct — no changes needed there.
   - The **foreground/direct launch paths** currently include hardcoded `['--model', model]` construction in at least:
     - `lib/commands/entity-commands.js` (`launchPromptCommand`)
     - `lib/feature-do.js`
     - `lib/feature-eval.js`
   - Change each path to use the agent's registry `modelFlag`:
     ```js
     const agentConfig = agentRegistry.getAgent(agentId);
     const modelFlag = agentConfig?.cli?.modelFlag || '--model';
     const modelTokens = (model && agentRegistry.supportsModelFlag(agentId)) ? [modelFlag, model] : [];
     ```
   - Verify no other foreground paths build `--model` directly (grep for `'--model'` in `lib/`). If any are only help text or docs, leave them alone; if they build launch args, route them through `cli.modelFlag`.
   - Keep the change generic: if an agent's `cli.modelFlag` is `--model`, behavior stays unchanged; if it is `--mode`, the same picker value is passed through that flag.

4. **Install generated project instructions as Amp skills**
   - The `outputs` array and top-level doc fields defined in Step 2 drive `install-agent am`. No additional config is needed here — this step validates that the install produces the expected files.
   - Verify `aigon install-agent am` produces:
     - `.agents/skills/aigon-feature-do/SKILL.md` (and other skill dirs for eval, review, etc.)
     - `.aigon/docs/agents/amp.md`
   - Keep installed templates stack-neutral. Do not add target-repo package-manager commands.

5. **Avoid new hardcoded agent lists**
   - If Amp does not appear in install help, dashboard agent payloads, model config surfaces, port maps, or prerequisite checks after adding `am.json`, fix the generic registry consumer rather than adding `am` special cases.
   - Use `lib/agent-registry.js` accessors only; do not introduce direct `agent === "am"` branching unless a test proves an unavoidable CLI-specific edge.

6. **Add focused regression tests**
   - Extend `tests/integration/worktree-state-reconcile.test.js` with an Amp assertion block:
     - `buildAgentCommand({ agent: "am", ... }, "do")` contains bare `amp`;
     - command includes the verified flags from Step 1;
     - command includes `--mode <selected-mode>` when the feature start payload or config supplies a selected Amp mode;
     - command does not include `amp -x`, `amp --execute`, `--model`, or `exec bash -l`;
     - command includes `tmux load-buffer`, `tmux paste-buffer`, `tmux send-keys`, and the universal trap (TUI-inject pattern).
   - Add regression coverage for the foreground/direct launch fixes in Step 3: an agent with `modelFlag: "--mode"` launches with `--mode smart`, not `--model smart`. Existing agents with `modelFlag: "--model"` must be unaffected.
   - Extend `tests/integration/agent-registry-contract.test.js` if current contract coverage does not automatically include every `templates/agents/*.json` file.

7. **Add Amp-specific agent docs**
   - Create `.aigon/docs/agents/amp.md` through `install-agent` output generation or the source template contract used by the other agents.
   - Document:
     - launch type: TUI-inject;
     - expected binary: `amp`;
     - login prerequisite: `amp login` or `AMP_API_KEY`;
     - Aigon's "model" picker maps to Amp modes (`rush`, `smart`, `deep`) via `--mode`;
     - why Aigon passes `--no-ide` / `--no-jetbrains`;
     - transcript telemetry is intentionally absent in v1.

8. **Manual install and workflow smoke**
   - In a disposable repo or seed reset:
     - `aigon install-agent am`
     - confirm `.agents/skills/aigon-feature-do/SKILL.md` and `.aigon/docs/agents/amp.md` exist;
     - create or use a tiny backlog feature;
     - `aigon feature-start <ID> am` with the default mode, then with an explicit picker/config override such as `smart` or `rush`;
     - confirm the Amp tmux pane receives the prompt, edits only the worktree, runs validation, and calls `aigon agent-status implementation-complete`.
   - Confirm selected Amp modes are visible in the dashboard/start modal and result in `--mode <mode>` in the launched command.
   - Confirm `aigon session-list`, dashboard attach/peek, heartbeat, and feature state all show the Amp session correctly.

9. **Document follow-up candidates without pulling them into v1**
   - Transcript/cost telemetry from `amp threads export`, `amp threads markdown`, or `amp usage`.
   - Amp plugin integration for richer completion signals or thread-id capture.
   - Quota detection patterns once real depleted/quota outputs are observed.
   - Effort picker support via `--effort`, once stable values are validated for each Amp mode.

## Acceptance Criteria

- [ ] `templates/agents/am.json` exists and `node -e "require('./lib/agent-registry').getAgent('am')"` exits 0.
- [ ] `am` appears in registry-derived agent lists without new hardcoded lists.
- [ ] The dashboard/start modal model picker for `am` exposes Amp modes with labels `"Default"`, `"Rush (GPT-5.5 fast)"`, `"Smart (Claude Opus 4.7)"`, and `"Deep (GPT-5.5 reasoning)"` (or equivalent format showing the underlying model). `large` is quarantined and hidden from the picker.
- [ ] Selecting an Amp picker value passes `--mode <value>` to `amp` in the tmux launch path (`buildAgentCommand`) and the foreground launch path (`entity-commands.js`); no Amp path emits `--model`.
- [ ] `aigon install-agent am` completes in a test repo and writes Amp-compatible skills under `.agents/skills/`.
- [ ] A generated Amp agent doc exists and explains launch mode, login/API-key setup, IDE isolation flags, and telemetry limitations.
- [ ] `buildAgentCommand()` launches bare `amp` in interactive mode and injects the prompt through tmux; it does not use `amp -x` / `--execute` for normal feature sessions.
- [ ] Amp launch exports the standard `AIGON_ENTITY_TYPE`, `AIGON_ENTITY_ID`, `AIGON_AGENT_ID`, and `AIGON_PROJECT_PATH` environment variables.
- [ ] Amp sessions participate in shell-trap completion and heartbeat sidecars.
- [ ] Focused integration tests cover Amp registry discovery and launch command shape.
- [ ] Manual smoke proves Amp can complete a tiny feature and signal back to Aigon without manual state repair.

## Validation

```bash
node -c lib/agent-registry.js
node -c lib/worktree.js
node -c lib/config.js
node -c lib/agent-prompt-resolver.js
npm test

# Feature-specific checks
node -e "const r=require('./lib/agent-registry'); const a=r.getAgent('am'); if (a.cli.command !== 'amp' || a.cli.modelFlag !== '--mode') process.exit(1); console.log(a.cli.modelOptions.map(o => o.value).join(','))"
aigon install-agent am
aigon feature-start <tiny-feature-id> am
aigon session-list
```

## Dependencies

- Local Amp installation and authentication (`amp login` or `AMP_API_KEY`).
- `docs/adding-agents.md` and `templates/feature-template-agent-onboard.md`.
- A disposable test repo or seed repo for the final smoke.

## Out of Scope

- Transcript, token, and cost telemetry for Amp.
- Amp plugin-based lifecycle integration.
- Amp effort picker support via `--effort`.
- Any target-repo language, package-manager, test, lint, or build assumptions in installed templates.
- Adding Pro/internal release scripts or credentials.

## Open Questions

- Does `--dangerously-allow-all` need to be included on every Aigon-launched Amp session, or is Amp's default permission behavior enough for non-blocking feature work? (Step 1 smoke must answer this — it determines `cli.implementFlag`.)
- Does Amp expose the active thread id in the TUI, shell env, or logs in a way Aigon can capture after launch? (Deferred to transcript telemetry follow-up, but note findings from the Step 1 smoke.)
- Should Amp default thread visibility be forced private for Aigon-launched sessions, or should Aigon leave visibility entirely to the user's Amp settings? (v1: leave to user settings; revisit if worktree isolation concerns arise.)

## Related

- `docs/adding-agents.md`
- `templates/feature-template-agent-onboard.md`
- `templates/agents/op.json`
- `tests/integration/worktree-state-reconcile.test.js`
- Amp manual: https://ampcode.com/manual
- Amp models: https://ampcode.com/models
- Amp plugin API: https://ampcode.com/manual/plugin-api
