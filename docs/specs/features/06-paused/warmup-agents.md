---
complexity: high
# agent: cc    # optional — id of the agent that owns this spec. Used as the
#              #   default reviewer for spec-revise cycles when the operator
#              #   does not pick one explicitly. Precedence at revision time:
#              #     event payload nextReviewerId > frontmatter agent:
#              #     > snapshot.authorAgentId > getDefaultAgent().
# research: 44 # optional — id (or list of ids) of the research topic that
#              #   spawned this feature. Stamped automatically by `research-eval`
#              #   on features it creates. Surfaced in the dashboard research
#              #   detail panel under Agent Log → FEATURES.
# planning_context: ~/.claude/plans/your-plan.md  # optional — path(s) to plan file(s)
#              #   generated during an interactive planning session (e.g. EnterPlanMode).
#              #   Content is injected into the agent's context at feature-do time and
#              #   copied into the implementation log at feature-start for durability.
#              #   Set this whenever you ran plan mode before writing the spec.
---

# Feature: warmup agents

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file engine edits, new event types, new dashboard surfaces, judgment-heavy deletion work
       very-high — architectural shifts, write-path-contract changes, new XState transitions, cross-cutting template+engine+frontend
     At start time, model and effort defaults come from each agent's `cli.complexityDefaults[<complexity>]` in
     `templates/agents/<id>.json` (not from this spec). Do not put model IDs in the spec. -->

## Summary

Let operators schedule a **daily, minimal provider interaction** per installed agent so rolling usage windows (commonly discussed as roughly multi-hour sliding caps on premium assistant plans) can start **before** heavy work begins. Configuration lives in **`~/.aigon/config.json`** (machine-wide): each agent can be **enabled/disabled**, with a **local time** and optional **timezone** handling so Aigon fires the warmup predictably across DST.

Implementation should compose with existing **`aigon token-window`** and **`docs/token-maxing.md`**: today `token-window` only **nudges existing** Aigon-managed tmux sessions, so overnight warmups usually have **nothing to nudge**. This feature fills that gap by defining a **supported** way to run a tiny, legitimate kickoff (e.g. headless / one-shot CLI invocation where the agent supports it, or a documented OS timer + command) and by optionally driving it from **`aigon server`** when it is already running persistently.

## User Stories

- [ ] As an operator with a predictable morning deep-work block, I want my chosen agent(s) to perform a lightweight daily hello at a time I configure so my rolling usage window aligns with when I actually need the quota.
- [ ] As someone who uses multiple agents (cc, gg, cx, …), I want independent toggles and times per agent ID so I only warm agents I subscribe to use.
- [ ] As a user who prefers not to run a 24/7 server, I want a **manual or OS-scheduled** path (launchd/systemd/cron) that invokes a single **`aigon …`** command, consistent with documented `token-window` scheduler examples.
- [ ] As a user running **`aigon server start --persistent`**, I want the server-side loop to optionally run the same warmup logic at the configured time **without** maintaining a duplicate Pro “scheduled kickoff” feature store (warmup is **global machine config**, not per-repo feature scheduling).

## Acceptance Criteria

- [ ] **`~/.aigon/config.json`** supports a documented schema for daily agent warmup: at minimum `enabled`, `time` (local HH:MM or equivalent), and per-agent entries keyed by agent id (`cc`, `gg`, …). Timezone behavior is explicit (e.g. `timezone` IANA string + documented default to system local).
- [ ] **Recommendation (docs + inline help)** explains how to pick a warmup time **without hardcoding brittle provider semantics**: anchor to “shortly before your first serious session,” respect local timezone, note that rolling windows move with usage and policies change; cite community reading (including [How to make best of Claude Code's 5 hour limits](https://dev.to/avsi/how-to-make-best-of-claude-codes-5-hour-limits-4j32)) as **informal context**, not contractual guarantees.
- [ ] **`aigon` CLI**: a verb (name TBD: e.g. `agent-warmup`, `warmup-agents`) runs the warmup **once**, honours config + optional `--dry-run`, and exits nonzero with a clear message when an enabled agent cannot be warmed (CLI missing, unsupported non-interactive path, sandbox).
- [ ] At least **one** code path performs a **real provider touch** for at least **one** first-class agent template where a safe minimal invocation exists today; unsupported agents fail loud or are skipped with documented reason — no silent success.
- [ ] Observability: a durable log or state stamp (similar in spirit to **`.aigon/state/last-token-kickoff`** / `lastTokenKickoffAt`) records **last warmup run per agent** for debugging and dashboard/API surfacing **if** a small API extension fits the existing budget read-model without mutating workflow state.
- [ ] **Tests**: regression coverage for config parsing defaults, dry-run branching, and “disabled / no-op” behaviour; defer live provider calls behind mocks/spawn stubs per project norms.
- [ ] **`docs/token-maxing.md`** updated so “Scheduler Setup” points at the new **first-party** command for warmups (while keeping external timer examples for users who do not run the server).

## Validation

```bash
npm test
node -c aigon-cli.js
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

1. **Config contract** — Extend **global** config (same file family as `tokenWindow` in `lib/config.js` / `loadGlobalConfig`) with something like `agentWarmup: { timezone?, agents: { cc: { enabled, time, ... }, ... } }`. Validate on read; migration note in `lib/global-config-migration.js` if new keys need defaults.

2. **Execution model (two supported triggers)**  
   - **OS scheduler / manual**: user runs `aigon <warmup-verb>` from cron/launchd/systemd (mirrors current `token-window` documentation pattern).  
   - **Persistent server**: if `supervisor`/dashboard bootstrap already runs a periodic tick, attach a **once-per-local-day** gate that fires at the next eligible minute for each agent (avoid duplicate runs across restarts using the same stamp file logic).

3. **Warmup implementation** — For each enabled agent:
   - Prefer **capabilities-driven** branching from `templates/agents/<id>.json` (avoid hardcoded `if cc`) so new agents opt in explicitly.
   - Use the **minimal** legitimate interaction documented for that CLI (headless/`print`/equivalent — exact mechanism is implementation-defined but must align with Terms of Normal Use in `docs/token-maxing.md` caveats).
   - If nothing is runnable without a logged-in tty, **fail loud** or document “install launchd separately” rather than pretending success.

4. **Relation to existing commands** — `token-window` remains focused on **nudging live Aigon tmux sessions**; warmup may **call shared helpers** (`nudge`, process detection, telemetry) where appropriate but should not redefine rolling-window theory.

5. **Pro boundary** — Do **not** depend on **`@aigon/pro` scheduled kickoff** (F367) for this OSS feature; keep warmup machine-global and orthogonal to repo-scoped scheduler features.

## Dependencies

- Existing: `docs/token-maxing.md`, `aigon token-window` (`lib/commands/misc.js`), `lib/nudge.js`, `lib/config.js`, `templates/agents/*.json` capability metadata.
- External: Operators must have the relevant agent CLI installed, authenticated, and allowed to run non-interactive invocations where used.

## Out of Scope

- Circumventing provider rate limits or ToS; hidden or spoofed usage.
- Coordinating warmup across machines or sharing one subscription (“two laptops”).
- Automatically choosing the “best” time using live provider telemetry (future enhancement unless trivial).
- Replacing **`aigon install-agent`** ownership of IDE files beyond what is needed for config documentation.

## Open Questions

- Should the dashboard expose toggles/time pickers for global warmup, or stay CLI + config-first for OSS v1?
- Which agents have stable, testable non-interactive “ping” semantics in CI without credentials?

## Related

- Reading: [How to make best of Claude Code's 5 hour limits](https://dev.to/avsi/how-to-make-best-of-claude-codes-5-hour-limits-4j32) (informal community write-up on rolling windows and warm-up idea).
- Internal: `docs/token-maxing.md`, F352 `token-window` / `tokenWindow` config (AGENTS.md).
- Pro: `aigon schedule` remains Pro; this feature must not require it.
