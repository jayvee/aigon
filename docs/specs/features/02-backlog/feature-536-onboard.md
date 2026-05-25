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
   - Do not use `amp -x` for the primary workflow unless this smoke proves the interactive TUI path cannot work.

2. **Add `templates/agents/am.json`**
   - Model it closest to `templates/agents/op.json`, not `cx.json`.
   - Suggested core fields:
     - `id: "am"`, `name/displayName: "Amp"`, aliases `["amp", "ampcode", "am"]`
     - `portOffset: 7`
     - `cli.command: "amp"`
     - `cli.implementFlag: "--no-ide --no-jetbrains --no-notifications --dangerously-allow-all"` if the smoke confirms the flag combination is accepted; otherwise use the minimal verified flags and document the reason.
     - `cli.injectPromptViaTmux: true`
     - `cli.implementPrompt/evalPrompt/reviewPrompt/reviewCheckPrompt`: `feature-do`, `feature-eval`, `feature-code-review`, `feature-code-revise`
     - `capabilities.supportsModelFlag: true`
     - `capabilities.transcriptTelemetry: false`
     - `capabilities.resolvesSlashCommands: false`
     - `runtime.telemetryStrategy: null`, `runtime.sessionStrategy: null`
     - `signals.shellTrap: true`, `signals.heartbeatSidecar: true`
   - Add `cli.modelFlag: "--mode"` and `cli.modelOptions` for the supported Amp modes:
     - `null`: `Default`
     - `smart`: `Smart mode (Claude Opus 4.7)`
     - `deep`: `Deep mode (GPT-5.5 reasoning)`
     - `rush`: `Rush mode (GPT-5.5 fast)`
   - Do not include `large` in the normal picker because the Amp manual currently marks it as not recommended. If the JSON keeps it for audit, quarantine it so dashboard picker surfaces hide it.
   - Use `complexityDefaults` to make low-complexity work default to `rush`, medium to `smart`, and high / very-high to `deep`. Set the same mode defaults in `cli.models` for `research`, `implement`, `evaluate`, and `review` only if needed by the existing config resolver.
   - Leave `effortOptions` empty in v1 unless the smoke test proves stable values across selected modes. Amp's `--effort` is a separate follow-up because supported effort levels vary by mode.

3. **Make picker launch flags registry-driven everywhere**
   - The normal tmux launch path already has `buildAgentLaunchInvocation()` and `agentRegistry.getModelFlag()`, which can emit `--mode <value>` for Amp.
   - Audit foreground/direct launch paths such as `feature-do`, `feature-eval`, and `launchPromptCommand()` in `lib/commands/entity-commands.js`. Any path still building `['--model', model]` directly must be changed to use the agent's registry `modelFlag`.
   - Keep the change generic: if an agent's `cli.modelFlag` is `--model`, behavior stays unchanged; if it is `--mode`, the same picker value is passed through that flag.

4. **Install generated project instructions as Amp skills**
   - Use the existing skill output shape:
     - `output.format: "skill-md"`
     - `output.commandDir: ".agents/skills"`
     - `output.commandFilePrefix: "aigon-"`
     - `output.commandFileExtension: ""`
     - `output.skillFileName: "SKILL.md"`
     - `supportsAgentsMd: true`
     - `agentFile: "amp.md"`
     - `templatePath: "generic/docs/agent.md"`
   - Keep installed templates stack-neutral. Do not add target-repo package-manager commands.

5. **Avoid new hardcoded agent lists**
   - If Amp does not appear in install help, dashboard agent payloads, model config surfaces, port maps, or prerequisite checks after adding `am.json`, fix the generic registry consumer rather than adding `am` special cases.
   - Use `lib/agent-registry.js` accessors only; do not introduce direct `agent === "am"` branching unless a test proves an unavoidable CLI-specific edge.

6. **Add focused regression tests**
   - Extend `tests/integration/worktree-state-reconcile.test.js` with an Amp assertion block:
     - `buildAgentCommand({ agent: "am", ... }, "do")` contains bare `amp`;
     - command includes the verified flags;
     - command includes `--mode <selected-mode>` when the feature start payload or config supplies a selected Amp mode;
     - command does not include `amp -x`, `amp --execute`, `--model`, or `exec bash -l`;
     - command includes `tmux load-buffer`, `tmux paste-buffer`, `tmux send-keys`, and the universal trap.
   - Add or extend a direct-launch unit/integration test proving registry model flags are honoured: an agent with `modelFlag: "--mode"` launches with `--mode smart`, while existing agents still launch with `--model <id>`.
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
- [ ] The dashboard/start modal model picker for `am` exposes Amp modes, at least `Default`, `Rush`, `Smart`, and `Deep`, with labels making clear these are Amp modes.
- [ ] Selecting an Amp picker value passes `--mode <value>` to `amp` in every launch path that honours model overrides; no Amp path emits `--model`.
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

- Does `--dangerously-allow-all` need to be included on every Aigon-launched Amp session, or is Amp's default permission behavior enough for non-blocking feature work?
- Does Amp expose the active thread id in the TUI or logs in a way Aigon can capture after launch?
- Does direct skill invocation have a stable syntax that could replace full prompt injection later, or should Aigon keep using inlined prompts for Amp?
- Should Amp default thread visibility be forced private for Aigon-launched sessions, or should Aigon leave visibility entirely to the user's Amp settings?

## Related

- `docs/adding-agents.md`
- `templates/feature-template-agent-onboard.md`
- `templates/agents/op.json`
- `tests/integration/worktree-state-reconcile.test.js`
- Amp manual: https://ampcode.com/manual
- Amp models: https://ampcode.com/models
- Amp plugin API: https://ampcode.com/manual/plugin-api
