---
complexity: high
set: be-arch
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-07T06:05:29.429Z", actor: "cli/feature-prioritise" }
---

# Feature: be-arch-8-deprecated-shim-sunset

> **Merged scope (2026-07-08):** absorbs former #635 `be-arch-7-command-dispatcher-diet`. Both are deletion-and-relocation passes over the command layer with zero new behaviour, they overlap at the file level (`misc.js` hosts the agent-quota/agent-probe commands whose F616 shims this feature removes), and the closing AGENTS.md module-map refresh must describe the dispatcher moves anyway — done together, the map is written once. Phase A below is the old #635 scope; Phase B is the sunset + doc refresh. Sequence **last in the set** so the map captures the post-refactor shape.

## Summary

Two cleanup phases, one context, ending with the docs matching the filesystem.

**Phase A — command dispatcher diet:** enforce the codebase's own dispatcher rule — "add new commands [to extracted `lib/feature-*.js` modules] when the body exceeds ~100 lines" (AGENTS.md module map) — on the command files that have drifted past it, and dissolve the `misc.js` bucket. `lib/commands/feature.js` is documented as a "thin dispatcher" but is 2,228 lines with several fat inline handlers: `feature-close` dispatch is ~240 lines (1076–1316), `feature-backfill-timestamps` ~170, `feature-transfer` ~190, plus `feature-pause`/`feature-resume`/`feature-unprioritise` at ~80–90 each. `lib/commands/misc.js` (1,731 lines) is a low-cohesion catch-all whose name is the smell: `agent-status` (~200 lines — a load-bearing lifecycle command living in "misc"), `repair` (~200), `insights`, `stats`, `token-window`, `rollout`, `commits`, `session-list`, `agent-probe`, `agent-quota`, `agent-context`, telemetry captures, and `help` all share one file for no reason beyond accretion. Dispatchers dispatch; bodies live in named modules grouped by actual domain.

**Phase B — deprecated shim sunset + doc refresh:** sweep the compatibility layers that completed migrations never removed, then bring the architecture docs back in sync. **F616** left `/api/budget`, `/api/budget/refresh`, and `/api/quota` routes as "deprecated shims" alongside the unified `/api/agent-quota`, kept `lib/quota-poller.js` as a 16-line re-export, and kept `lib/budget-poller.js` at 888 lines when only its scrape primitives are still consumed by `agent-quota-poller.js`; **F342** deprecated `review-state.json` writers with a "synonym fallback during migration" that is still honoured. Separately, `AGENTS.md`'s module map has drifted hard from reality: it documents modules that no longer exist (`lib/dashboard.js`, `lib/devserver.js`, `lib/feature-review-state.js`) and its line counts are off 2–2.5× on the biggest modules. For a repo whose primary developers are AI agents that *plan from these docs*, doc drift is an architecture defect, not a cosmetic one. Remove what the migrations' authors said should go, refresh the map to describe the true end state (including Phase A's moves and every landed be-arch/dash-finish sibling), and add a tiny path-existence check so the map cannot silently rot again.

## User Stories

- [ ] As a maintainer, `lib/commands/feature.js` reads as a table of commands: each handler is arg-parsing + a delegate call, and I can find any command's implementation from its name.
- [ ] As an implementing agent working on agent lifecycle signals, `agent-status` lives in an agent-signals module next to `check-agent-signal` / `force-agent-ready` / `drop-agent` — not between `deploy` and `insights` in a misc bucket.
- [ ] As a maintainer, the quota/budget surface is one endpoint, one poller, one state file — the F616 end-state — with no zombie routes for a UI that no longer calls them.
- [ ] As an implementing agent reading AGENTS.md, every module the map names exists, and the size/ownership description is close enough to reality to plan against.
- [ ] As a reviewer, "deprecated during migration" markers in this codebase come with an expiry: this feature establishes the precedent by clearing the backlog of them.

## Acceptance Criteria

### Phase A — dispatcher diet

- [ ] `lib/commands/feature.js`: every inline handler body over ~60 lines is extracted to the existing pattern — either the command's documented owner module (`feature-close` dispatch logic joins `lib/feature-close.js`; pause/resume join `lib/entity.js`'s pause/resume machinery if that is the real owner — verify) or a new `lib/feature-<command>.js` following the `run(args, deps)` shape of `feature-start`/`feature-eval`/`feature-do`/`feature-autonomous`. Target: `feature.js` ≤ ~900 lines of genuine dispatch/arg-parsing; record before/after.
- [ ] `lib/commands/misc.js` is dissolved into cohesive command modules (final grouping to be validated against the code, but approximately): `lib/commands/agent-signals.js` (`agent-status`, `check-agent-signal`, `check-agent-submitted`, `force-agent-ready`, `drop-agent`, `agent-resume`, `agent-context`), `lib/commands/ops.js` (`repair`, `status`, `session-list`, `deploy`, `rollout`, `next`, `help`, `workflow-rules`), `lib/commands/insights.js` (`insights`, `stats`, `commits`, telemetry captures, `token-window`), with `agent-probe`/`agent-quota` joining whichever module already owns quota commands (coordinate with Phase B's quota consolidation — one final home, not two moves). `misc.js` is deleted; `createAllCommands` composition updated.
- [ ] The ctx pattern is preserved exactly: each new module is a factory taking ctx (or exports `run(args, deps)` like the feature-* extractions); test overrides via `createAllCommands({ ... })` keep working.
- [ ] Behaviour parity: pure moves — command output, exit codes, arg parsing, and `withActionDelegate` wrapping unchanged. The CLI help/COMMAND_REGISTRY reflects no user-visible change.
- [ ] `research.js` (1,128) audited against the same rule: any fat handler not already shared via `entity-commands.js` gets the same treatment (expected small — most research handlers come from the factory; verify rather than assume).
- [ ] Shared-parallel-command rule respected: if an extraction reveals a feature/research handler pair that should be one `entity-commands.js` factory entry, unify it there — but only for true duplicates found during the move; no speculative generalisation.
- [ ] Existing command tests pass with only import-path updates. No new cycles; `lib/commands/**` → `lib/*` direction only (module-graph guard from the merged be-arch-2, if landed).

### Phase B — shim sunset + docs

- [ ] **F616 sunset:** confirm the dashboard frontend and all CLI/tests call only `/api/agent-quota` (grep templates/dashboard + tests); then remove the `/api/budget`, `/api/budget/refresh`, `/api/quota` route entries from `lib/dashboard-routes/analytics.js`, delete `lib/quota-poller.js`, and reduce `lib/budget-poller.js` to the scrape primitives actually imported by `lib/agent-quota-poller.js` (move them into the agent-quota module family if that reads better; target: the 888-line file shrinks to the genuinely-live surface or disappears). The `aigon doctor --fix` migration for legacy `budget-cache.json`/`quota.json` state files stays (state migration ≠ API shim).
- [ ] **F342 fallback audit:** find the "review-complete sidecar accepted as synonym" fallback; determine whether any live repo still produces it (check what writes it today — expected: nothing). If dead, remove the fallback and fail loudly per the write-path contract; if still produced somewhere, fix that producer and then remove. Document the finding either way — do not extend the migration window silently.
- [ ] **Facade audit:** for each documented-or-actual thin facade (`lib/constants.js` [23 lines], `lib/utils.js` re-export surface, worktree/telemetry facades created by be-arch-4/6 if landed): verify each re-export still has importers; delete dead re-exports. Remove tombstone references to `lib/dashboard.js`/`lib/devserver.js`/`lib/feature-review-state.js` from AGENTS.md (or re-point to their successors).
- [ ] **AGENTS.md module map refresh** (after ALL code moves in this feature, rebased over landed siblings): every row verified against disk — path exists, size description true (consider dropping exact counts for size-band words [small/medium/large/x-large] to reduce future rot; decide and apply consistently), ownership sentence still true. Phase A's new modules get rows; feature.js/misc.js rows replaced; the "Where To Add Code" section's "new command" row updated to name the domains. `docs/architecture.md` audited in the same pass (reading-order item 2 for agents).
- [ ] **Freshness guard:** extend `scripts/check-module-graph.js` (or a sibling ~40-line script in `test:core`) to parse module paths named in AGENTS.md's module-map table and fail when a named path does not exist on disk. (Path-existence only — no line-count enforcement; that would be noise.)
- [ ] Dashboard e2e + full `test:core` green; `aigon agent-quota` CLI and the budget widget verified working against the surviving endpoint (MCP `browser_snapshot` of the widget).
- [ ] CHANGELOG notes the removed endpoints (external users could conceivably script them; the dashboard is localhost-only but note it anyway).

## Validation

```bash
node scripts/check-module-graph.js
npm run test:iterate
```

## Technical Approach

- **Phase A first** (moves create the shape), **Phase B sunset second** (deletions), **doc refresh strictly last** so the map describes the end state once.
- Phase A: one command (or one cohesive group) per commit; `node -c` + scoped tests each step. Deliberately mechanical — resist improving handler behaviour mid-move (any bug found gets noted in the log or filed, per fix-the-class discipline, not silently fixed inside a move commit). `agent-status` deserves care: it is the signal write path the whole workflow engine depends on (F404 aliases, role/signal matrix at misc.js:409-412) — move it with its full test coverage and treat any ambiguity as behaviour to preserve. Read `lib/commands/shared.js` (`buildCtx`) and the newest extracted module first, and clone their conventions — the goal is fewer patterns, not one more.
- Phase B: grep-prove each shim unused → delete → test → next. Verify-unused-before-deleting; every deletion in the feature log carries its grep evidence (same discipline as dash-arch-9's dead-CSS audit). The budget-poller reduction depends on reading `agent-quota-poller.js`'s actual imports — keep exactly that surface, delete the rest.
- If be-arch-3 (setup migration) runs concurrently, coordinate on `createAllCommands` composition edits to avoid conflicts; otherwise independent of 3/4/5.
- Restart the dashboard server after `lib/*.js` edits (hot rule #3) — dashboard actions shell out to these commands.

## Dependencies

- None hard. Best sequenced **last** in the set so the AGENTS.md refresh captures the post-refactor shape (soft ordering, not a frontmatter dependency — it can run standalone if the set stalls).

## Out of Scope

- Any behaviour, flag, output, or help-text change; renaming user-facing commands.
- `infra.js` (1,852) — cohesive (server/board/config/proxy/dev-server); splitting it is a possible follow-up, deliberately not bundled here.
- entity-commands factory redesign; setup commands (be-arch-3).
- Any new quota/budget behaviour (F616's design is the fixed target).
- Sunsetting compatibility facades be-arch-2/4/6 deliberately create (those are new, with live importers — their removal is future mechanical work).
- Auto-generating the module map from code (the map's value is its curated ownership prose; the existence check is the right-sized guard).
- README/site docs (AGENTS.md + docs/architecture.md only).

## Open Questions

- Correct owner for `feature-pause`/`feature-resume` bodies — `lib/entity.js` already has `pause/resumePrestartEntity` (F397); confirm whether the command bodies are thin wrappers that can delegate there or carry extra logic.
- Whether `help` output ordering depends on module composition order — verify `COMMAND_REGISTRY` drives help, not object-key order of the merged command map.
- Are there other "deprecated during migration" markers findable by grep (`deprecated`, `legacy`, `shim`, `synonym fallback`) that belong in this sweep? Inventory first, then include only those whose migration window is clearly closed — this feature must not become an unbounded cleanup.

## Related

- Prior work: the feature-start/eval/do/autonomous extractions (the pattern Phase A completes), `entity-commands.js` factory, F404 (signal aliases preserved in the agent-status move), F616 (agent-quota unification — the shims' origin and declared end-state), F342 (review-state deprecation), F294 (the precedent for deleting half-states loudly rather than carrying them).
- Set: be-arch — the hygiene close-out: the code matches its own rules again, migrations end with a sunset commit, and the map agents plan from is true.
