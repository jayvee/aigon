---
complexity: medium
set: be-arch
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-07T06:05:29.270Z", actor: "cli/feature-prioritise" }
---

# Feature: be-arch-7-command-dispatcher-diet

## Summary

Enforce the codebase's own dispatcher rule — "add new commands [to extracted `lib/feature-*.js` modules] when the body exceeds ~100 lines" (AGENTS.md module map) — on the command files that have drifted past it, and dissolve the `misc.js` bucket. `lib/commands/feature.js` is documented as a "thin dispatcher" but is 2,228 lines with several fat inline handlers: `feature-close` dispatch is ~240 lines (1076–1316), `feature-backfill-timestamps` ~170, `feature-transfer` ~190, plus `feature-pause`/`feature-resume`/`feature-unprioritise` at ~80–90 each. `lib/commands/misc.js` (1,731 lines) is a low-cohesion catch-all whose name is the smell: `agent-status` (~200 lines — a load-bearing lifecycle command living in "misc"), `repair` (~200), `insights`, `stats`, `token-window`, `rollout`, `commits`, `session-list`, `agent-probe`, `agent-quota`, `agent-context`, telemetry captures, and `help` all share one file for no reason beyond accretion. Low-strength coupling at zero distance is the definition of low cohesion — this feature restores the documented architecture: dispatchers dispatch; bodies live in named modules grouped by actual domain.

## User Stories

- [ ] As a maintainer, `lib/commands/feature.js` reads as a table of commands: each handler is arg-parsing + a delegate call, and I can find any command's implementation from its name.
- [ ] As an implementing agent working on agent lifecycle signals, `agent-status` lives in an agent-signals module next to `check-agent-signal` / `force-agent-ready` / `drop-agent` — not between `deploy` and `insights` in a misc bucket.
- [ ] As a reviewer, a diff to `feature-close` behaviour touches `lib/feature-close.js` (the documented owner) — not a 240-line closure in the dispatcher that wraps it.

## Acceptance Criteria

- [ ] `lib/commands/feature.js`: every inline handler body over ~60 lines is extracted to the existing pattern — either the command's documented owner module (`feature-close` dispatch logic joins `lib/feature-close.js`; pause/resume join `lib/entity.js`'s pause/resume machinery if that is the real owner — verify) or a new `lib/feature-<command>.js` following the `run(args, deps)` shape of `feature-start`/`feature-eval`/`feature-do`/`feature-autonomous`. Target: `feature.js` ≤ ~900 lines of genuine dispatch/arg-parsing; record before/after.
- [ ] `lib/commands/misc.js` is dissolved into cohesive command modules (final grouping to be validated against the code, but approximately): `lib/commands/agent-signals.js` (`agent-status`, `check-agent-signal`, `check-agent-submitted`, `force-agent-ready`, `drop-agent`, `agent-resume`, `agent-context`), `lib/commands/ops.js` (`repair`, `status`, `session-list`, `deploy`, `rollout`, `next`, `help`, `workflow-rules`), `lib/commands/insights.js` (`insights`, `stats`, `commits`, telemetry captures, `token-window`), with `agent-probe`/`agent-quota` joining whichever module already owns quota commands. `misc.js` is deleted; `createAllCommands` composition updated.
- [ ] The ctx pattern is preserved exactly: each new module is a factory taking ctx (or exports `run(args, deps)` like the feature-* extractions); test overrides via `createAllCommands({ ... })` keep working.
- [ ] Behaviour parity: pure moves — command output, exit codes, arg parsing, and `withActionDelegate` wrapping unchanged. The CLI help/COMMAND_REGISTRY reflects no user-visible change.
- [ ] `research.js` (1,128) audited against the same rule: any fat handler not already shared via `entity-commands.js` gets the same treatment (expected small — most research handlers come from the factory; verify rather than assume).
- [ ] Shared-parallel-command rule respected: if an extraction reveals a feature/research handler pair that should be one `entity-commands.js` factory entry, unify it there (that is the documented home for parallel commands) — but only for true duplicates found during the move; no speculative generalisation.
- [ ] Existing command tests pass with only import-path updates. No new cycles; `lib/commands/**` → `lib/*` direction only (be-arch-1 guard).
- [ ] AGENTS.md module map: feature.js/misc.js rows replaced with the new modules; the "Where To Add Code" section's "new command" row updated to name the domains.

## Validation

```bash
node scripts/check-module-graph.js
npm run test:iterate
```

## Technical Approach

- One command (or one cohesive group) per commit; `node -c` + scoped tests each step. This is deliberately mechanical — resist improving handler behaviour mid-move (any bug found gets noted in the log or filed, per fix-the-class discipline, not silently fixed inside a move commit).
- `agent-status` deserves care: it is the signal write path the whole workflow engine depends on (F404 aliases, role/signal matrix at misc.js:409-412). Move it with its full test coverage and treat any ambiguity as behaviour to preserve.
- Read `lib/commands/shared.js` (`buildCtx`) and the newest extracted module (probably `feature-do.js` or `feature-autonomous.js`) first, and clone their conventions — the goal is fewer patterns, not one more.
- If be-arch-3 (setup migration) runs concurrently, coordinate on `createAllCommands` composition edits to avoid conflicts; otherwise independent.
- Restart the dashboard server after `lib/*.js` edits (hot rule #3) — dashboard actions shell out to these commands.

## Dependencies

- None hard. Benefits from be-arch-1 (guard) but safe standalone; independent of 2–6.

## Out of Scope

- Any behaviour, flag, output, or help-text change.
- `infra.js` (1,852) — it is at least cohesive (server/board/config/proxy/dev-server); splitting it is a possible follow-up, deliberately not bundled here to keep the set shippable.
- entity-commands factory redesign; setup commands (be-arch-3).
- Renaming user-facing commands.

## Open Questions

- Correct owner for `feature-pause`/`feature-resume` bodies — `lib/entity.js` already has `pause/resumePrestartEntity` (F397); confirm whether the command bodies are thin wrappers that can delegate there or carry extra logic.
- Whether `help` output ordering depends on module composition order — verify `COMMAND_REGISTRY` drives help, not object-key order of the merged command map.

## Related

- Prior work: the feature-start/eval/do/autonomous extractions (the pattern this completes), `entity-commands.js` factory (F-era parallel-command dedupe), F404 (signal aliases preserved in the agent-status move).
- Set: be-arch — the "keep your own rules" feature: the architecture documented the right pattern; this makes the code match the docs again.
