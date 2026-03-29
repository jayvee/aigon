# Research Findings: improve agent signalling

**Agent:** Codex (cx)
**Research ID:** 26
**Date:** 2026-03-29

---

## Key Findings

### 1. The biggest reliability gap is architectural, not wording

Aigon still depends on the model to remember lifecycle commands that are deterministic side effects:

- `research-do` and `feature-do` explicitly tell the agent to run `aigon agent-status implementing` at the start and `aigon agent-status submitted` at the end.
- `buildAgentCommand()` only launches the agent with a prompt; it does not wrap the session with mandatory pre/post shell steps.
- `setup doctor` already contains recovery logic for stale `implementing` states after the fact, which is evidence that prompt-only signalling is known to be lossy.

That makes the current system vulnerable to exactly the kinds of failures the research topic describes: long tasks, context compaction, interrupted sessions, or the model simply prioritising code changes over workflow bookkeeping.

### 2. Aigon already treats Claude and Gemini as more automatable than Codex

The repo installs `SessionStart` hooks for Claude and Gemini today:

- Claude gets `aigon check-version` and `aigon project-context` on session start, plus telemetry capture on `SessionEnd`.
- Gemini gets `SessionStart` hooks through `.gemini/settings.json`.
- Codex currently gets only `.codex/prompt.md` and `.codex/config.toml`; there is no Aigon-managed hook installation for Codex in `templates/agents/cx.json`.

So the product already assumes deterministic hooks are the right tool for some lifecycle work. The gap is that Codex signalling is still mostly delegated to prompt compliance.

### 3. Current Codex supports stronger control points than Aigon is using

As of March 29, 2026, Codex docs expose project-scoped config, approval/sandbox controls, and a hook system behind the `features.codex_hooks` flag. The official hooks docs also expose:

- `PreToolUse` and `PostToolUse` hooks for Bash tool activity
- `UserPromptSubmit` to inject extra developer context
- `Stop`, which can automatically continue a turn with a follow-up instruction instead of ending cleanly

That means Codex now has two usable enforcement layers beyond “hope the prompt is followed”:

1. Shell wrapper around launch/exit in Aigon
2. Codex-native hooks that can inspect or steer the session before it ends

Important limitation: the Codex hooks docs explicitly say some outputs such as `permissionDecision: "allow"`, `"ask"`, `continue: false`, and `stopReason` are parsed but “not supported yet” and fail open in some events. So hooks are useful, but not strong enough to be the only safety mechanism.

### 4. `submitted` is the easiest signal to externalize; dev-server is only partially externalizable

Signals fall into two categories:

- Fully deterministic:
  - mark `implementing` when the session actually begins
  - mark `submitted` when the agent process exits after producing expected artefacts
  - emit session-ended flags when a tmux session dies unexpectedly
- Judgment-dependent:
  - deciding whether a dev server is needed at all
  - deciding whether the app is healthy enough to keep using
  - deciding whether work is actually complete vs blocked

`submitted` should not remain a prompt instruction. Aigon can verify whether the expected artefact exists before setting it:

- feature mode: commit exists and/or implementation log updated
- research mode: findings file changed and committed

Dev-server work should be split:

- externalize the mechanical parts: port allocation, registry entry, URL derivation, stale-process cleanup
- keep the agent responsible for the judgment step: “does this task require a server and did the app actually work?”

### 5. Temperature is a weak lever here, and Codex does not expose it as an obvious first-class CLI control

I did not find a temperature flag in the installed `codex --help`, and the current Codex project/user config in this environment exposes `model`, `model_reasoning_effort`, `approval_policy`, and `sandbox_mode`, not temperature.

Gemini does expose temperature in model config aliases, but this does not solve Aigon’s cross-agent reliability problem. Even if a lower temperature improves consistency a bit, it does not create a guarantee that mandatory shell commands happen. This research topic is better framed as “remove deterministic workflow state from the model loop” than “tune sampling harder.”

### 6. There is not enough telemetry yet to answer “which agent drops signals most frequently?”

The codebase has strong hints and anecdotes that Codex is the main offender, but I did not find a quantitative, repo-level compliance report separating:

- missing `implementing`
- missing `submitted`
- dev-server not started when needed
- dev-server started incorrectly
- session exited with work present but no completion signal

Until that measurement exists, “Codex is worst” is still a plausible hypothesis, not a proven fleet-wide result.

### 7. The best near-term design is layered enforcement, not a single fix

The strongest pattern is:

1. **Launch wrapper** sets `implementing` before invoking the agent.
2. **Exit wrapper / monitor** verifies expected artefacts and writes `submitted` when safe.
3. **Doctor/dashboard safety net** flags ambiguous or incomplete sessions.
4. **Prompt cleanup** keeps only the non-deterministic responsibilities in the agent instructions.
5. **Optional Codex hooks** provide extra guardrails, but do not replace shell-level enforcement.

This preserves implementation quality because the agent still decides how to solve the task, but it removes trivial workflow bookkeeping from the set of things the model can forget.

## Sources

- Aigon `research-do` prompt: `templates/generic/commands/research-do.md`
- Aigon agent launch path: `lib/worktree.js`
- Aigon shared submit flow: `lib/entity.js`
- Aigon stale-session doctor checks: `lib/commands/setup.js`
- Aigon dev-server flow: `lib/commands/infra.js`
- Aigon Codex template: `templates/agents/cx.json`
- Aigon Claude template: `templates/agents/cc.json`
- Aigon Gemini template: `templates/agents/gg.json`
- Codex config basics: https://developers.openai.com/codex/config-basic
- Codex hooks: https://developers.openai.com/codex/hooks
- Codex CLI features: https://developers.openai.com/codex/cli/features
- Claude Code hooks guide: https://code.claude.com/docs/en/hooks-guide
- Gemini CLI README: https://github.com/google-gemini/gemini-cli
- Gemini CLI configuration reference: https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/reference/configuration.md

## Recommendation

Adopt a three-layer signalling strategy, in this order:

1. **Move `implementing` out of prompts immediately.**
   The shell/tmux launcher should write `aigon agent-status implementing` before the agent is invoked. This is deterministic and should never depend on LLM compliance.

2. **Add a verified exit path for `submitted`.**
   When the agent process or tmux session ends, Aigon should check for expected evidence:
   - research: findings file changed, and ideally committed
   - feature: worktree has implementation commits and log progress

   If evidence is strong, set `submitted` automatically. If evidence is ambiguous, set a `sessionEnded`/`needsAttention` flag instead of silently trusting the model.

3. **Keep prompt instructions only for judgment calls.**
   The agent should still decide whether to start a dev server, whether the app is healthy, and whether the work is actually complete. Those are not purely mechanical.

4. **Use Codex hooks as a secondary guardrail, not the primary mechanism.**
   Codex hooks are now good enough to add reminders or continuation prompts near turn end, but they are not yet strong enough to be the sole enforcement layer because parts of the hook output surface still fail open.

5. **Instrument before tuning.**
   Add explicit compliance telemetry before investing in temperature or prompt-copy experiments. Otherwise the team will argue from anecdotes and cannot measure whether reliability actually improved.

Net: externalize deterministic lifecycle signals; verify on exit; keep the model responsible only for choices that require reasoning.

## Suggested Features

<!--
Use the table format below. Guidelines:
- feature-name: Use kebab-case, be specific (e.g., "user-auth-jwt" not "authentication")
- description: One sentence explaining the capability
- priority: high (must-have), medium (should-have), low (nice-to-have)
- depends-on: Other feature names this depends on, or "none"
-->

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| shell-managed-agent-lifecycle-signals | Wrap agent launch and session exit so `implementing` and safe `submitted` signals are emitted by Aigon rather than the prompt alone. | high | none |
| verified-session-exit-reconciliation | Add repo-level verification that inspects commits, findings files, and session termination state before auto-submitting or flagging an agent. | high | shell-managed-agent-lifecycle-signals |
| codex-hook-guardrails | Install optional Codex hook configuration that injects end-of-turn reminders or continuation prompts when lifecycle evidence is missing. | medium | shell-managed-agent-lifecycle-signals |
| signal-compliance-telemetry | Record per-agent lifecycle compliance metrics so Aigon can measure missing `implementing`, missing `submitted`, and dev-server compliance over time. | high | none |
| dev-server-intent-and-verification-split | Separate mechanical dev-server setup from agent judgment so port allocation is automated while task-specific verification remains with the model. | medium | shell-managed-agent-lifecycle-signals |
