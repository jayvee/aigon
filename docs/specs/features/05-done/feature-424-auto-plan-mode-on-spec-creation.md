---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-28T00:22:11.852Z", actor: "cli/feature-prioritise" }
---

# Feature: auto-plan-mode-on-spec-creation

## Summary
When `feature-create` or `research-create` spawns an agent to draft a spec (via `--agent <id>`, the dashboard "Create with agent" path, or the equivalent slash command), the agent must launch in its native plan / read-only mode if the agent supports a programmatic flag for it. Plan mode is only applied to *initial spec drafting*. Spec-review, spec-revise, and all implementation phases continue using `implementFlag` unchanged — those phases must Edit the spec, run `aigon ...-record` CLIs, and `git commit`, all of which plan mode would block.

## User Stories
- [ ] As an operator running `aigon feature-create <name> --agent cc`, the spawned Claude Code session starts in plan mode so the agent explores the codebase and proposes the spec before writing anything.
- [ ] As an operator running `aigon research-create <name> --agent cc`, the spawned session starts in plan mode for the same reason — the artifact is a research brief, not code.
- [ ] As an operator using an agent without a programmatic plan flag (cx, gg today), behaviour is unchanged — no spurious flags, no broken launches.
- [ ] As an operator running `feature-spec-review`, `feature-spec-revise`, `research-spec-review`, or `research-spec-revise`, plan mode is **not** applied — those agents continue to launch with `implementFlag` so they can Edit + commit + record state transitions.

## Acceptance Criteria
- [ ] `templates/agents/cc.json` adds `cli.planFlag: "--permission-mode plan"`.
- [ ] `templates/agents/cu.json` adds `cli.planFlag: "--mode=plan"` (verify the exact Cursor CLI flag during implementation; if cursor-agent does not yet expose a stable plan-mode flag, leave `planFlag: null` and document it in the spec-revise loop).
- [ ] `templates/agents/cx.json` and `templates/agents/gg.json` either omit `planFlag` or set it to `null` — these resolve to "no flag" at launch.
- [ ] `lib/config.js` surfaces `planFlag` on the resolved CLI config alongside `implementFlag`, with the same project/global override precedence.
- [ ] `lib/feature-draft.js` `draftSpecWithAgent()` (currently line 117) builds its argv as `[...planFlagTokens, contextMessage]` using `getAgentLaunchFlagTokens(binary, cliConfig.planFlag, { autonomous: false })`. When `planFlag` is empty/null, behaviour matches today exactly.
- [ ] `lib/research-draft.js` `draftSpecWithAgent()` (line 71) gets the same change.
- [ ] No code path in `lib/commands/entity-commands.js` (spec-review / spec-revise launchers) is altered — `implementFlag` continues to gate those.
- [ ] `feature-do.js`, `feature-eval.js`, `worktree.js`, `validation.js`, `dashboard-server.js`, `dashboard-routes/sessions.js`, `agent-registry.js` are NOT touched — implementation/eval/worktree paths are out of scope.
- [ ] If a dashboard "Create" button exists that spawns a draft agent (verify during implementation), it routes through `draftSpecWithAgent` so it inherits the change for free; if it has its own spawn path, gate it the same way.
- [ ] `templates/generic/commands/feature-create.md` and `.../research-create.md` get a one-line operator nudge: in your own session (not a spawned agent), Shift+Tab into plan mode before drafting.
- [ ] Unit test in `tests/` covers: (a) cc resolves `planFlag` and the argv includes `--permission-mode plan` ahead of the prompt, (b) cx with no `planFlag` produces the current argv unchanged, (c) `feature-spec-review` launches still use `implementFlag` not `planFlag`.

## Validation
```bash
node --check lib/feature-draft.js
node --check lib/research-draft.js
node --check lib/config.js
npm test
```

## Pre-authorised
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

**The seam.** Two functions spawn the spec-drafting agent:
- `lib/feature-draft.js:117` — `spawnSync(binary, [contextMessage], ...)` for `aigon feature-create <name> --agent <id>`
- `lib/research-draft.js` (same shape) — for `aigon research-create <name> --agent <id>`

Both currently pass **zero flags** to the agent. Change argv construction to:

```js
const flagTokens = getAgentLaunchFlagTokens(binary, cliConfig.planFlag, { autonomous: false });
const result = spawnSync(binary, [...flagTokens, contextMessage], { ... });
```

When `planFlag` is empty or null (cx, gg, or any agent without a programmatic plan flag), `getAgentLaunchFlagTokens` already returns `[]`, so the call is a no-op for unsupported agents. This is the entire enforcement story.

**Config resolution.** `lib/config.js:888` already merges per-agent CLI config from template + global + project layers for `implementFlag`. Add identical handling for `planFlag` (lines ~888, ~901–902, ~926–927). `lib/agent-registry.js:187` exposes the resolved config to the registry consumer — add `planFlag` there too.

**Why not gate on command name.** I considered putting the plan-mode decision inside `launchPromptCommand()` and switching on the command name. But `feature-draft` doesn't go through that path — it spawns directly. The cleanest model is: there are **two distinct verbs** (draft vs. review/implement), and they live in two distinct functions. `feature-draft` / `research-draft` always plan. Everything else always implements. No conditional logic, no command-name switch.

**What plan mode blocks (and why review/revise must stay out).** Claude Code's plan mode blocks `Edit`, `Write`, `Bash`, and `NotebookEdit`. Spec-review and spec-revise agents must Edit the spec, run `aigon feature-spec-review-record`, and `git commit` with trailers. Putting them in plan mode would deadlock the workflow. This is the load-bearing reason the gate is per-function, not per-session.

**Cursor CLI flag verification.** Earlier research indicated `--mode=plan` was added to cursor-agent in Jan 2026. Implementation must verify this against the installed `cursor-agent --help` before shipping; if the flag doesn't exist or has a different name, set `planFlag: null` for cu and document it in the spec-revise round (note: feature-spec-revise, not this spec — leave a placeholder in Open Questions for the implementer).

**Operator's own session.** When the operator runs `afc <name>` *without* `--agent`, this Claude Code session (or whichever agent the operator is using) drafts the spec. We can't programmatically force the operator's session into plan mode from a CLI-spawned child — the operator already owns that process. The mitigation is a one-line nudge in the `feature-create.md` skill template instructing the operator to Shift+Tab before drafting.

**Codex/Gemini fallback (out of scope for v1).** A prompt-prefix fallback ("READ-ONLY: propose the spec, do not edit yet") was considered for cx/gg. Skipped here — it's advisory at best, easily ignored by the model, and adds a code path with no enforcement guarantee. Filed as a future open question rather than scoped in.

## Dependencies
-

## Out of Scope
- Plan mode for `feature-spec-review`, `feature-spec-revise`, `research-spec-review`, `research-spec-revise` — those must stay out of plan mode (load-bearing rationale in Technical Approach).
- Plan mode for `feature-do`, `feature-eval`, `feature-code-review`, `feature-code-revise`, autopilot, fleet — implementation phases are unchanged.
- Prompt-prefix fallback for agents without a programmatic plan flag (cx, gg). Tracked in Open Questions.
- Forcing the operator's own interactive session into plan mode — not addressable from a child process. Mitigated by a skill-template nudge only.
- Dashboard UI changes beyond inheriting the gate via the existing draft path.

## Open Questions
- Does `cursor-agent` v1.x expose a stable `--mode=plan` (or equivalent) flag? Implementer should verify against `cursor-agent --help` before setting `cu.cli.planFlag`. If absent, leave `null` and add a note to AGENTS.md.
- Should there be a config knob to *disable* auto-plan-mode (e.g. for power users who want straight-to-edit)? Default to "always on when supported"; revisit if friction emerges.
- Prompt-prefix fallback for cx/gg — worth a separate feature later, or not worth the noise given lack of enforcement?

## Related
- Research:
- Set:
- Prior features in set:
