---
aigon_id: F743
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-08-04T14:11:31.484Z", actor: "cli/feature-prioritise" }
---

# Feature: onboard-github-copilot-cli

## Summary

Add GitHub Copilot CLI as the `cp` agent through Aigon's existing registry-driven agent contract. Copilot is now a stable standalone terminal agent with an interactive launch mode, project Agent Skills discovery, shell execution, model and reasoning-effort flags, and GitHub-native tooling. That current product differs materially from the older Copilot CLI assessed in `docs/adding-agents.md`, so this feature supersedes the repository's 2026-04-28 "Skip" verdict.

The first release must use the established interactive tmux and `.agents/skills` paths rather than adding a Copilot-specific runtime. `Auto` is the default model for every task and complexity tier, while Aigon's model picker also exposes the named models supported by the installed Copilot CLI. Model availability is entitlement-dependent; Aigon must not imply that every listed model is usable on every Copilot plan.

## Agent Identity

- **Agent ID**: `cp`
- **Display name**: GitHub Copilot
- **Aliases**: `copilot`, `github-copilot`, `cp`
- **CLI binary**: `copilot`
- **Provider family**: `router` (Copilot routes across GitHub-hosted model families)
- **Install**: `brew install --cask copilot-cli` on macOS/Linux with Homebrew, or `npm install -g @github/copilot` with Node.js 22+
- **Authentication**: `copilot login`; an active Copilot plan is required, and organization-managed accounts require the Copilot CLI policy to be enabled
- **Locally verified while drafting**: GitHub Copilot CLI `1.0.78` on 2026-08-05

## Eligibility Decision

Copilot previously failed the onboarding bar because it only wrapped models already reachable through native provider CLIs. The current standalone CLI clears the "genuinely superior/different workflow" bar for these reasons:

- it gives users one GitHub Copilot entitlement across several model families without requiring separate provider CLI subscriptions;
- it is a first-party GitHub terminal agent with native GitHub context and tooling;
- it supports the shared Agent Skills standard and discovers Aigon's existing `.agents/skills` output without a new prompt format;
- it has a stable interactive TUI suitable for Aigon's observable tmux sessions.

Update `docs/adding-agents.md` so the evaluated-candidates table records the new decision and dated evidence instead of leaving the old "Skip" verdict as current guidance.

## Decision Tree Answers

- **Q1 - Prompt delivery**: **YES**. `copilot -i/--interactive <prompt>` starts an interactive session and automatically executes the initial prompt. Do not use `-p/--prompt`, which is explicitly non-interactive and exits after completion.
- **Q2 - Slash/skill support**: **YES**. Copilot discovers `SKILL.md` files under `.agents/skills` and accepts `/aigon-feature-do <ID>`-style skill invocation. Classify `cp` as slash-command invocable while generating the commands in Agent Skills format.
- **Q3 - Model flag**: **YES**. Use `--model <id>`. Copilot also supports `--effort <level>` with `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max` values.
- **Q4 - Interactive lifecycle**: **YES, subject to the final feature smoke**. A drafting smoke launched Copilot in tmux, invoked `/aigon-help`, accepted follow-up input, executed `aigon help`, and retained the live TUI. The implementation smoke must prove a complete tiny task returns to the Copilot prompt and can signal Aigon.
- **Q5 - Transcript telemetry**: **NO for v1**. The local CLI has `~/.copilot/session-store.db`, resumable sessions, logs, and transcript export, but Aigon does not yet have a stable parser/session-binding contract. Set `transcriptTelemetry: false` and defer that integration.

**Determined launch type**: interactive Slash-command using Agent Skills.

## User Stories

- [ ] As an Aigon user with Copilot CLI installed and authenticated, I can install `cp` and select it anywhere Aigon offers a launchable agent.
- [ ] As an operator starting a feature or research task with `cp`, I get a live Copilot TUI in the correct worktree with the appropriate Aigon skill invoked automatically.
- [ ] As an operator, Copilot uses `Auto` unless I explicitly choose a named model, and my model and effort choices survive every Aigon launch/respawn path.
- [ ] As an operator whose Copilot plan does not include a listed model, I see a clear launch/auth/provider error rather than Aigon claiming the model is universally available.
- [ ] As a maintainer, Copilot support is config-driven and covered by the same registry, installation, and launch-shape contracts as existing agents.

## Acceptance Criteria

- [ ] `templates/agents/cp.json` exists, passes the agent registry contract, and uses unique identity, aliases, colors, port offset, install hints, and the binary `copilot`.
- [ ] `cp` is launchable but is not a default Fleet agent until it has accumulated real Aigon benchmark evidence.
- [ ] `aigon install-agent cp` succeeds in a scratch repository, writes Copilot-compatible Aigon skills under `.agents/skills/`, writes `.aigon/docs/agents/github-copilot.md`, and leaves consumer `AGENTS.md`, `CLAUDE.md`, and `README.md` byte-identical or absent.
- [ ] The launch command uses interactive mode and has the effective shape `copilot --allow-all --interactive "/aigon-feature-do <ID>"`; it never uses `-p/--prompt` for normal Aigon sessions and does not use tmux prompt-paste injection.
- [ ] Model and effort overrides are passed through the central launch helper as `--model <value>` and `--effort <value>` in feature, research, review, evaluation, restart, resume/failover, dashboard, and autonomous spawn paths.
- [ ] `Auto` is the default for research, specification, implementation, evaluation, review, and all four complexity tiers.
- [ ] The model picker contains `Auto` plus the named models advertised by the current Copilot CLI. At implementation time, refresh the list against both `copilot /model` and GitHub's official CLI command reference; include at minimum the currently observed GPT, Claude, Gemini, and MAI families, with `lastRefreshAt`, evidence notes, and null Aigon scores until benchmarked.
- [ ] The effort picker exposes the CLI-supported values without inventing per-model compatibility claims.
- [ ] Documentation states that named-model access varies by Copilot plan/organization policy and that a rejected model can be resolved by selecting `Auto` or a model available to that account.
- [ ] Copilot sessions export the standard Aigon entity/project environment, participate in the shell-trap and heartbeat contracts, remain observable through session list/attach/Peek, and can run `aigon agent-status implementation-complete` from inside the session.
- [ ] A drafting smoke demonstrated that Copilot `1.0.78` discovers the current `.agents/skills` tree and invokes `/aigon-help`. The implementation smoke additionally completes a tiny disposable feature end to end without manual lifecycle repair.
- [ ] In a scratch repository with both `cc` and `cp` installed, `copilot skill list` reports no failures for Aigon-managed files. Repair Aigon-owned cross-agent YAML/frontmatter generation as needed; do not modify user-owned instruction files.
- [ ] `docs/adding-agents.md` records Copilot as supported with the current rationale and date rather than the obsolete 2026-04-28 verdict.
- [ ] Focused regression coverage pins registry projection, installation output, launch command shape, Auto defaults, named model/effort pickers, and the prohibition on non-interactive `-p` launch.

## Technical Approach

### 1. Add the registry template

Create `templates/agents/cp.json` following `templates/feature-template-agent-onboard.md`, using the nearest established contracts rather than a bespoke Copilot branch:

- launch semantics closest to `cu`/`cc`: initial slash-style invocation, native interactive TUI, model flag, and shell execution;
- installed instruction format closest to `cx`/`am`: `skill-md` output under `.agents/skills`;
- provider/model semantics closest to `op`/`am`: a router spanning multiple model families;
- `capabilities.supportsModelFlag: true`;
- `capabilities.resolvesSlashCommands: true`;
- `capabilities.transcriptTelemetry: false`;
- `cli.command: "copilot"`;
- `cli.implementFlag: "--allow-all --interactive"` unless the final smoke proves a narrower non-blocking permission set works across the full lifecycle;
- task prompts use `/aigon-<skill> {ID}` and never inline the entire prompt body or use `injectPromptViaTmux`;
- `cli.modelFlag: "--model"`, `cli.effortFlag: "--effort"`;
- `signals.shellTrap: true`, `signals.heartbeatSidecar: true`;
- Agent Skills output uses `.agents/skills`, which Copilot officially discovers;
- use `authCheck.method: "none"` with `loginCommand: "copilot login"` and a clear hint unless a non-interactive, credential-safe status check is found. Do not inspect or expose stored tokens.

Use an unused `portOffset` after the current roster. Keep `defaultFleetAgent: false`. Do not add hardcoded `cp` lists where registry projections already own discovery.

### 2. Curate model and effort choices

Represent `Auto` as the effective task and complexity default, not merely a label that omits `--model` and inherits a user's previously pinned Copilot setting. Include named picker options from the current live CLI catalog and official documentation. The drafting session observed models across these families:

- GPT: `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.4-mini`, `gpt-5-mini`;
- Claude: current Sonnet, Haiku, and Opus entries exposed by the picker;
- Gemini: current Pro Preview and Flash entries exposed by the picker;
- MAI: the current MAI Code Flash picker entry.

This is evidence to refresh, not a frozen allowlist: the implementer must capture the complete current catalog and use exact CLI values. Preserve Aigon's model-inclusion metadata requirements, mark scores null until benchmarked, and do not promote named models into `complexityDefaults` in this feature.

Expose the CLI effort ladder (`none` through `max`) with a neutral Default option. Do not claim every model supports every effort; Copilot remains the authority and must surface incompatibility cleanly.

### 3. Generate Copilot-compatible skills and docs

Reuse the generic skill templates already proven by `copilot skill list`. Add the generated Copilot agent guide through the normal `agentFile`/`templatePath` path. Document:

- installation using Homebrew or npm and the Node.js 22+ npm prerequisite;
- authentication with `copilot login`, Copilot plan requirements, and organization policy;
- interactive Slash-command launch using Agent Skills;
- `--allow-all` security implications for autonomous worktree sessions;
- Auto default, optional named models, and entitlement-dependent availability;
- no transcript/cost telemetry in v1.

The live smoke found that Copilot loaded the Aigon `.agents/skills` successfully but reported two unrelated Aigon-owned Claude surfaces as invalid: `.claude/skills/aigon/SKILL.md` (missing standard YAML frontmatter) and `.claude/commands/aft.md` (an unescaped quote in YAML frontmatter). Fix the source templates/formatting generically enough that co-installing `cc` and `cp` produces no Aigon-owned skill-load failures, while preserving Claude behavior and leaving consumer-owned files untouched.

### 4. Add focused regression coverage

- Extend `tests/integration/worktree-state-reconcile.test.js` with a `cp` launch assertion block proving interactive skill invocation, `--model auto`, effort forwarding, standard wrapper signals, and absence of `-p/--prompt` and tmux paste injection.
- Extend `tests/integration/agent-registry-contract.test.js` with Copilot-specific registry/model assertions if the generic every-template checks do not fully pin the contract.
- Cover fresh `install-agent cp` output in the existing installation tests, including a mixed `cc cp` fixture and byte-identical user-owned root docs.
- Every new regression test must contain the required `// REGRESSION:` explanation.

### 5. Perform the implementation smoke

Use a disposable test repository or seed fixture, not Aigon's main checkout:

1. Verify `copilot --version` and `copilot skill list`.
2. Run `aigon install-agent cp` and inspect only Aigon-managed output.
3. Start a tiny disposable feature with `cp` using Auto, then with one named model actually available to the test account.
4. Confirm the TUI invokes the Aigon skill, edits only its worktree, runs the feature's validation, returns to the Copilot prompt, and records `implementation-complete` without manual state repair.
5. Confirm session list, attach/Peek, heartbeat, shell trap, model/effort attribution, and cleanup behavior.

Do not merge or close the disposable feature as part of an ordinary unit/integration test; the operator-owned feature-close gate remains unchanged.

## Validation

```bash
node -e "const r=require('./lib/agent-registry'); const a=r.getAgent('cp'); if (!a || a.cli.command !== 'copilot') process.exit(1)"
node tests/integration/agent-registry-contract.test.js
node tests/integration/worktree-state-reconcile.test.js
node scripts/check-template-leaks.js
npm run test:iterate

# Manual, in a disposable repository after implementation:
aigon install-agent cp
copilot skill list
aigon feature-start <tiny-feature-id> cp
aigon session-list
```

## Dependencies

- A local GitHub Copilot CLI installation and an active authenticated Copilot account for the manual smoke.
- `docs/adding-agents.md` and `templates/feature-template-agent-onboard.md`.
- Existing registry, agent-launch, Agent Skills generation, shell-trap, heartbeat, and session-observability contracts.

## Out of Scope

- Starting or implementing F743 as part of creating this specification.
- A new ACP-based Aigon runtime or launching Copilot through `copilot --acp`.
- Parsing `~/.copilot/session-store.db`, transcript/cost/token telemetry, provider-session binding, or resumable-session integration.
- Copilot plugins, custom agents/subagents, hooks, memory, remote control, or GitHub cloud-agent orchestration beyond what the existing Aigon workflow requires.
- Making `cp` a default Fleet agent before real benchmark and reliability evidence exists.
- Guaranteeing that every named model is available on every Copilot plan.
- Adding target-repository language, package-manager, test, build, deployment, or directory-layout assumptions.

## Open Questions

- Assumed: v1 uses Aigon's existing interactive tmux and Agent Skills architecture; ACP, transcript/cost telemetry, and resume support remain follow-up work. Confirm during spec review.
- Can Copilot expose a credential-safe non-interactive login-status command in a future release? If not, keep authentication as operator-managed rather than probing credential storage.
- Should a later catalog-refresh feature derive the Copilot model list dynamically, or keep the existing reviewed static-registry policy? This feature uses the reviewed static registry.

## Related

- `docs/adding-agents.md`
- `templates/feature-template-agent-onboard.md`
- `templates/agents/cu.json`
- `templates/agents/cx.json`
- `templates/agents/op.json`
- GitHub Docs: https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli
- GitHub Docs: https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli
- GitHub Docs: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference
- GitHub Docs: https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills
