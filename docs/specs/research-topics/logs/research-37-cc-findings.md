# Research Findings: state machine review cycle redesign

**Agent:** Claude (cc)
**Research ID:** 37
**Date:** 2026-04-24

---

## Key Findings

### 1. Current engine state map (what exists today)

Source of truth is `lib/feature-workflow-rules.js:23-65` (`FEATURE_ENGINE_STATES`) consumed by `lib/workflow-core/machine.js:170-183` (`createWorkflowMachine`). The machine states present today are:

`hydrating`, `implementing`, `paused`, `reviewing`, `evaluating`, `ready_for_review`, `closing`, `done`.

**Critically: `backlog` and `inbox` are NOT XState states.** They are values of `context.currentSpecState` set by the projector (`lib/workflow-core/projector.js:77` — `let lifecycle = 'backlog'` as the default before any lifecycle event) and observed via guards like `isBacklog` (`machine.js:69`) and `isImplementing` (`machine.js:68`) during hydration. The hydrating state has **no** `→ backlog` transition — features exit hydration only into `implementing`/`paused`/`evaluating`/`ready_for_review`/`closing`/`done` (`feature-workflow-rules.js:24-32`). Pre-start entities therefore live outside XState entirely, which is why spec review today must be modeled as context instead of a state.

`reviewing` (`feature-workflow-rules.js:46-50`) is entered via `feature.review` from `implementing` with guard `soloAllReady`. It has exactly one self-loop for `feature.review` and exits to `closing` (via `feature.close` + `autoSelectWinner`) or `paused`. There is no `review_complete` transient and no loop-back machinery.

The research cousin is built from `lib/research-workflow-rules.js` via the same `createWorkflowMachine('research')` factory (`machine.js:186`).

### 2. Spec review today — context properties, not state

The spec-review data model is defined in `lib/spec-review-state.js` (`buildSpecReviewSummary`) and created in `lib/workflow-core/projector.js:40-49` (`createSpecReviewState`). Shape:

```js
{ pendingReviews: [...], pendingCount, pendingAgents, pendingLabel,
  activeReviewers: [{agentId, startedAt}],
  activeCheckers: [{agentId, startedAt}] }
```

**Writers (event appenders):**
- `lib/commands/entity-commands.js` spec-review / spec-revise / spec-review-record / spec-revise-record handlers — the *single* shared producer for both feature and research (this is why `FEATURE_SPEC_REVIEW` has no sibling in `feature.js`).
- Projector case statements in `projector.js:385-470` for `feature.spec_review.started`, `feature.spec_review.check_started`, `feature.spec_review.submitted`, `feature.spec_review.acked`, plus the research analogs.
- Engine has a second mutation path at `lib/workflow-core/engine.js:271-347` (`applySpecReviewEventToContext`) that mirrors the projector — so spec-review context gets rebuilt both at event append time (engine) and at replay time (projector).

**Readers:**
- Snapshot surface at `engine.js:125-143`: every snapshot gets `specReview` and `pendingSpecReviews` fields.
- Action guards at `feature-workflow-rules.js:182-193`: `FEATURE_SPEC_REVIEW` is available when `currentSpecState ∈ {inbox, backlog}`; `FEATURE_SPEC_REVISE` additionally requires `specReview.pendingCount > 0`.
- Dashboard badge: `templates/dashboard/js/utils.js:94-115` reads `item.specReview` to render the "● reviewing" and "N pending" badges; `templates/dashboard/js/pipeline.js:666,812` pulls `feature.specReviewSessions` into per-reviewer rows.

**Every spec-review action has `bypassMachine: true`** (`feature-workflow-rules.js:179,189`) — the engine is deliberately side-stepped because there is no machine state to transition to. Every new review feature adds another bypass + context mutation, which is the compounding cost the research calls out.

### 3. Code review today — a sidecar file, not the engine

`lib/feature-review-state.js` (227 LOC) maintains a separate `review-state.json` per feature (path via `getReviewStatePath`, written to `.aigon/workflows/features/<id>/review-state.json`). It has its own reducer shape (`{ current, history[] }`), its own cycle counter (`cycle: history.length + 1` — `feature-review-state.js:46`), its own event stream (`review.started` / `review.completed` — note these are **not** namespaced `feature.review.*`), and its own reconciler (`reconcileReviewState` — flips `current → history` when the tmux session dies + ≥30s old).

`lib/workflow-read-model.js:423-616` is the only consumer: it reads `review-state.json`, finds running tmux sessions by prefix, auto-starts review state when a review session is observed without an event (`workflow-read-model.js:528-534` — `startReviewSync` on sighted tmux), and publishes `reviewStatus`, `reviewSessions[]`, `reviewState` onto the dashboard row.

The engine's `reviewing` state and this sidecar are **weakly coupled** — entering `reviewing` (event `feature.review_requested` at `projector.js:152-158`) just flips `lifecycle` to `'reviewing'`; it does not write `review-state.json`. The sidecar is what actually drives the dashboard "● Reviewing" row. This is the second bolt-on layer the research wants collapsed.

The `FEATURE_CODE_REVISE` action lives in `FEATURE_INFRA_CANDIDATES` (`feature-workflow-rules.js:397-404`) with `bypassMachine: true` and a guard on `context.reviewStatus === 'done'` — but `reviewStatus` is injected into the snapshot by `enrichSnapshotWithInfraData` at read time (`workflow-read-model.js:181-186`), it is **not** a projected context field. So the action appears only when the dashboard enriches the snapshot; CLI callers that read the raw snapshot do not see it.

### 4. Review cycle support today

Cycle counting exists in exactly one place: `feature-review-state.js:46,71` sets `cycle = history.length + (current ? 1 : 0) + 1`. It is never read anywhere (grep for `.cycle` across `lib/` surfaces only writes). There is **no** multi-reviewer flow, **no** loop-back transition, **no** context array of cycles, and **no** event that records "another cycle requested".

### 5. Owning agent tracking today

`context.authorAgentId` (`projector.js:92,116`, `engine.js:63,75,135,1226`) is seeded at `feature.bootstrapped`/`feature.started` from the event payload and preserved across `context` rebuilds. It is not surfaced in the action registry, the dashboard read model, or any revision logic — it is effectively dead state beyond event attribution.

`context.agents` is an unordered dict keyed by agent id; **there is no "implementing agent" designation** within it. For solo features `Object.keys(context.agents)[0]` is used as a stand-in (`machine.js:137` `autoSelectWinner`). For fleet this does not work and would need to be explicit.

### 6. Frontmatter `agent:` field — does not exist

Grep of `lib/spec-crud.js`, `lib/cli-parse.js`, `lib/commands/entity-commands.js`, `lib/commands/feature.js`, `lib/commands/setup.js` for any frontmatter `agent:` key returns nothing. `cli-parse.js:parseFrontMatter` is a generic YAML reader; specs currently carry only `complexity:` and `transitions:[]` in frontmatter. `feature-create` (in `entity-commands.js`) does not write an `agent:` field. `feature-start` reads agents from CLI args; spec-review reviewer resolution in `entity-commands.js` goes CLI `--agent=` → config default. `doctor --fix` (`lib/commands/setup.js`) has no `agent:` frontmatter check.

### 7. Missing-snapshot / dashboard read-model

`lib/workflow-read-model.js:74-104` (`buildMissingSnapshotState`) synthesizes pre-engine actions from folder stage for `inbox`/`backlog` rows with no snapshot; later stages keep `validActions: []` (F294). Actions are pulled from `workflowSnapshotAdapter.snapshotToDashboardActions(entityType, entityId, null, actionStage)` — i.e. the action registry is **already** capable of emitting actions from a null snapshot + stage alone. This is the substrate a data-driven review UI would reuse.

### 8. Migration infrastructure

Two layers exist:
- `lib/workflow-core/migration.js` (122 LOC) — one-shot bootstrap of pre-engine features into the event log (discovers folder + spec, synthesises `feature.started`/`winner.selected`/`feature.closed` for already-completed rows). Not versioned, no rollback.
- `lib/migration.js` (~300 LOC) — versioned state migrations with backup/restore/validate lifecycle (per AGENTS.md), runs during install. This is where a "spec review events re-interpret" or "snapshot re-shape" migration would be registered.

There is no event schema version on individual events; event types have been additive only. Adding new event names (`feature.spec_review.started`, `feature.code_review.*`) is safe; renaming or removing them is not. Old snapshots that carry a legacy `specReview.pendingCount` must continue to project — the new projector has to accept both the old event stream and the new one for the lifetime of one migration window.

### 9. Dashboard bespoke per-sub-state rendering

Three distinct spots:
- `templates/dashboard/js/utils.js:94-115` — `specReview` badge HTML built directly from `item.specReview`.
- `templates/dashboard/js/pipeline.js:666-812` — `specReviewSessions` / reviewer section rendering.
- `templates/dashboard/index.html:108-114` and `pipeline.js:322,611` — hardcoded `status-reviewing` / `status-review-done` classes driven by `rs.running` from `reviewSessions[]`.

All three are fed by sidecar or enrichment data — not by `currentSpecState`. The frontend never looks at engine state to decide "should the review badge be visible". If review becomes a first-class state, these three sites become fully derivable from `currentSpecState ∈ {spec_review_in_progress, spec_revision_in_progress, code_review_in_progress, ...}` plus `reviewCycles[]` context.

### 10. AutoConductor coupling

`lib/feature-autonomous.js:339,395,489` keys the Solo autonomous loop on the **`review-complete` agent-status signal** (sidecar file), not on an engine event. If review moves into the engine, AutoConductor must poll the snapshot for a transient (`code_revision_complete`) or for a specific event in the event log rather than for a status file. Bridging is straightforward because `feature-autonomous.js:111` takes `--stop-after=review` as an explicit arg — the detection site is one switch away.

### 11. What is missing to land the research design

A concrete gap list derived from the inventory above:
- No `backlog` XState state (only `currentSpecState='backlog'`); new spec-review states must be reachable from hydration. Either add a first-class `backlog` state or keep `currentSpecState` as the driver and give `hydrating` transitions to the new review states.
- No transient-state idiom in XState wired yet — machine.js currently uses `always:` only for `hydrating` (`machine.js:150-156`); every other state is event-driven. Adding `*_complete` transients with conditional `always:` loop-back is a one-pattern precedent away.
- No event payload carrying "next reviewer" — `feature.review` today is agent-agnostic. The loop-back needs `{ type: 'feature.code_review.started', reviewerId, cycleNumber }` at minimum.
- No `reviewCycles[]` context field; no projector case for it; no dashboard reader.
- No read-side helper that maps `currentSpecState → stage` that knows about the new sub-states (`workflow-snapshot-adapter.js` has `LIFECYCLE_TO_STAGE` mapping which needs `spec_review_* → backlog`, `code_review_* → in-progress`).
- No `agent:` frontmatter parsing/writing.

---

## Sources

- `lib/feature-workflow-rules.js:23-65` — state rules; `:67-307` action candidates; `:397-404` `FEATURE_CODE_REVISE`
- `lib/workflow-core/machine.js:13-188` — XState setup, guards, `buildStateConfig` (only `hydrating` uses `always:`)
- `lib/workflow-core/projector.js:40-49` `createSpecReviewState`; `:75-210` main reducer; `:385-470` spec-review events
- `lib/workflow-core/engine.js:125-153` snapshot writer; `:271-347` `applySpecReviewEventToContext`
- `lib/spec-review-state.js` — `buildSpecReviewSummary`
- `lib/feature-review-state.js` entire file — sidecar code review store
- `lib/workflow-read-model.js:22-158` — `WORKFLOW_SOURCE`, `buildMissingSnapshotState`, `enrichSnapshotWithInfraData`; `:423-616` code review derivation
- `lib/commands/entity-commands.js` — shared spec-review/revise handlers (writers of `spec_review.*` events)
- `lib/commands/feature.js:823-855` — `feature-code-review`, `feature-code-revise` dispatch
- `lib/feature-autonomous.js:339,395,489` — AutoConductor polling `review-complete`
- `templates/dashboard/js/utils.js:94-115`, `pipeline.js:666-812`, `index.html:108-114` — bespoke review rendering
- `lib/workflow-core/migration.js`, `lib/migration.js` — migration scaffolding
- AGENTS.md §State Architecture & §Write-Path Contract (F285→F293→F294→F296 incident list) — invariant precedent: every new read must have a producer
- Repository search: no `agent:` frontmatter key anywhere in `lib/`

---

## Recommendation

### Q1 — adding states to the centralised workflow definition
Extend `FEATURE_ENGINE_STATES` in `lib/feature-workflow-rules.js` with the eight new state keys (`spec_review_in_progress`, `spec_review_complete`, `spec_revision_in_progress`, `spec_revision_complete`, `code_review_in_progress`, `code_review_complete`, `code_revision_in_progress`, `code_revision_complete`). Rename the existing `reviewing` to `code_review_in_progress` in the same PR (keep an alias case in the projector's hydrate-from-old-snapshot path for one release). Update the consumers in the same PR: `machine.js` (guards for every new state), `projector.js` (new case statements — default lifecycle shift), `workflow-snapshot-adapter.js` (`LIFECYCLE_TO_STAGE`), `workflow-read-model.js` (`STAGE_TO_VISIBLE_DIR` unchanged but stage-derivation paths need updated allow-lists), the action registry (below), and `lib/workflow-definitions.js` if it enumerates states. Grep for every string match of `'reviewing'` / `'backlog'` in `lib/` before merging — per AGENTS.md §Write-Path Contract incident list, partial renames are a recurring failure mode.

### Q2 — modelling `*_complete` transients
Use XState `always:` conditional transitions — the exact pattern that already governs `hydrating` (`machine.js:150-156`). A `code_review_complete` state carries `always: [{ target: 'code_review_in_progress', guard: 'anotherCycleRequested' }, { target: 'submitted', guard: 'default' }]`. This keeps the transient invisible to operators (no external event fires it) and makes the loop-back deterministic. Do **not** invent a `code_review.proceed` event — operators should never see the transient. The "Another cycle" / "Proceed" choice should be captured in the event that enters the transient (e.g. `feature.code_review.completed` carrying `{ requestAnotherCycle: bool, nextReviewerId? }`); the guard reads from the latest event in context.

### Q3 — migration path
One-shot migration in `lib/migration.js` that runs on next `aigon install-agent` / server start:
1. Detect legacy snapshots where `currentSpecState === 'reviewing'` → rewrite to `'code_review_in_progress'`; rewrite every `context.specReview.pendingCount > 0` snapshot to include `context.reviewCycles = []` (backfill cycle 1 if pending).
2. Accept both old and new event names in the projector (case statements for `feature.review_requested` AND `feature.code_review.started`) for one release; log a `console.warn` when legacy events are projected.
3. `review-state.json` sidecar: one-shot read → synthesize `feature.code_review.started`/`feature.code_review.completed` events per history entry → append to events.jsonl → delete sidecar. Fail loudly if append fails; cite `aigon doctor --fix`.
4. Snapshots with neither old nor new review state fall through to the existing `buildMissingSnapshotState` path — no silent `LEGACY_MISSING_WORKFLOW` degrade (the F294 precedent).

Failure behaviour: any snapshot the projector cannot fully rebuild under the new rules gets `readModelSource: WORKFLOW_SOURCE.MISSING_SNAPSHOT` + an error banner citing `aigon doctor --fix`; never silently degrade. Add a `scripts/audit-snapshots.js` invoked by doctor that rebuilds every snapshot from events and diffs.

### Q4 — producers/consumers that become obsolete

| Module | Action | Reason |
|---|---|---|
| `lib/feature-review-state.js` | **Delete** after migration | Every responsibility (cycle counter, history, reconciliation) moves into the engine projector/events. `startReviewSync`/`reconcileReviewState` auto-creation by sighting tmux is a producer gap — violates AGENTS.md write-path contract. |
| `lib/workflow-read-model.js:512-616` (`readFeatureReviewState`, `readResearchReviewState`) | **Delete** | Consumer of the sidecar. Replaced by direct snapshot read. |
| `lib/workflow-read-model.js:181-186` `enrichSnapshotWithInfraData` reviewSessions/reviewStatus | **Simplify** | Keep the eval-enrichment code path; drop the review-specific fields. |
| `lib/workflow-core/engine.js:271-347` `applySpecReviewEventToContext` | **Keep but narrow** | Event-time mutation stays (the engine needs it for append-time guard evaluation), but the shape changes from context-blob to projected state. |
| `lib/spec-review-state.js` `buildSpecReviewSummary` | **Keep as adapter** | Still useful for computing `pendingLabel` / `pendingAgents`; move into projector helper. |
| `templates/dashboard/js/utils.js` `buildSpecReviewBadgeHtml` / `buildSpecReviewActiveHtml` | **Delete** | Replaced by data-driven state → badge mapper fed from `validActions` + `currentSpecState`. |
| `templates/dashboard/js/pipeline.js:666-812` reviewer section assembly | **Simplify** | Render from `reviewCycles[]` context, not from `specReviewSessions`/`reviewSessions`. |
| `lib/feature-autonomous.js` review detection | **Retarget** | Poll for `currentSpecState === 'code_revision_complete'` and/or a specific event in `events.jsonl` instead of `review-complete` status file. |

### Q5 — the loop-back transition

`code_revision_complete` is a transient; its `always:` list is:

```js
code_revision_complete: [
  { always: [
    { target: 'code_review_in_progress', guard: 'anotherCycleRequested', effect: 'recordNextCycle' },
    { target: 'submitted' }, // default
  ]}
]
```

Guard `anotherCycleRequested` inspects the latest `feature.code_revision.completed` event in the reducer: `event.requestAnotherCycle === true && typeof event.nextReviewerId === 'string'`. Effect `recordNextCycle` appends to `context.reviewCycles` and writes the next reviewer agent id onto a small `context.pendingCodeReviewer` slot that `code_review_in_progress` consumes when it fires the launch side-effect.

### Q6 — passing the next reviewer

Put it on the event payload: `feature.code_revision.completed { nextReviewerId, requestAnotherCycle, at, authorAgentId }`. The projector writes it to `context.pendingCodeReviewer`. The action registry exposes two actions from `code_revision_complete` (which is reachable only by an operator confirming the revision's dispositions) — "Another review cycle" (with agent picker → event payload sets `requestAnotherCycle: true, nextReviewerId`) and "Proceed" (event payload sets `requestAnotherCycle: false`). Both actions append the **same** event type with different payloads — the machine's transient handles the routing. This keeps the operator UI data-driven (two entries in `validActions[]`) and the engine event log dense (one event type per cycle transition).

### Q7 — data-driven dashboard rendering
Yes. Today's bespoke logic has three inputs: `specReview` (projected), `reviewSessions` (enriched), `reviewStatus` (enriched). Collapse to one: `currentSpecState` + `reviewCycles[]` read from the snapshot. Expose a tiny `STATE_RENDER_META` object in `lib/feature-workflow-rules.js` mapping each state to `{ badgeLabel, badgeClass, activityKind }` and have the dashboard render solely from `workflow.validActions` (for buttons) and `STATE_RENDER_META[snapshot.currentSpecState]` (for badges). No frontend eligibility logic — this conforms to rule #8 in AGENTS.md. Concretely: `templates/dashboard/js/utils.js:94-115` reduces to one switch over `currentSpecState`.

### Q8 — `agent:` frontmatter field format
Plain YAML scalar: `agent: cc` at the top of the spec. Parsed by the existing `cli-parse.js:parseFrontMatter` with no schema changes (it already returns a dict). `feature-create` in `entity-commands.js` should accept `--agent=<id>` and write the field; default behaviour is to write nothing (preserving back-compat). `feature-start` should seed `context.authorAgentId` from the frontmatter when present, else from the CLI-selected implementer, else from `getDefaultAgent()`. `doctor --fix` flags any spec in `02-backlog/` or beyond with no `agent:` when `currentSpecState === 'backlog'` — suggests the canonical default — and auto-writes only with `--fix`. Resolution precedence for revision targets:

| Flow | Resolution |
|---|---|
| Spec revision | frontmatter `agent:` → `authorAgentId` → `getDefaultAgent()` |
| Code revision | implementing agent (solo: single key of `context.agents`; fleet: `context.winnerAgentId` once set, else `authorAgentId`) |

### Q9 — producer/consumer tests
Pin invariants with these tests (co-located with each owner module, per AGENTS.md T2):
- `test/workflow-core/projector-spec-review.test.js` — replaying the old `feature.spec_review.*` events against the new projector yields equivalent `specReview` summary values; new `spec_review_*` states reached when events drive into them.
- `test/workflow-core/projector-code-review.test.js` — multi-cycle event stream builds `reviewCycles[]` in order; `pendingCodeReviewer` cleared after the loop-back fires.
- `test/integration/review-cycle.test.js` — full CLI round-trip: `feature-code-review cc` → agent-status `review-complete` → revise with --another-cycle=gg → code_review_in_progress with reviewer gg.
- `test/migration/snapshot-review-migration.test.js` — legacy snapshot + sidecar → migrated snapshot. Assert sidecar deletion + equivalent event log.
- `test/workflow-snapshot-adapter.test.js` — `LIFECYCLE_TO_STAGE` contains every new state; `validActions` for each state matches the registry.
- `test/workflow-read-model.test.js` — `buildMissingSnapshotState` returns empty `validActions[]` for rows in the new review states (no silent pre-engine synthesis).

### Q10 — implementation sequence

Seven phases, each a single aigon feature, ordered so every PR is independently deployable and every read path lands with its producer:

1. **Promote spec review to first-class engine states** — add `spec_review_in_progress`, `spec_review_complete` to `FEATURE_ENGINE_STATES`; update projector case statements; teach `hydrating` to reach them; migrate `specReview.activeReviewers` to drive the new state. Touches: `feature-workflow-rules.js`, `research-workflow-rules.js`, `workflow-core/{machine,projector,engine}.js`, `workflow-snapshot-adapter.js`, `workflow-read-model.js`, `migration.js` (back-compat for old specReview field).
2. **`agent:` frontmatter field + `authorAgentId` surfacing** — add field to `spec-crud.js` serializer; teach `entity-commands.js feature-create` / `research-create` to write it; teach `feature-start` to seed `authorAgentId`; doctor check. Prereq for spec revision. Touches: `spec-crud.js`, `cli-parse.js` (no change expected), `commands/entity-commands.js`, `commands/setup.js` (doctor).
3. **Spec revision state + owning-agent resolution** — add `spec_revision_in_progress`, `spec_revision_complete`; action registry entry for "Revise spec" targeting the owning agent from §8; transient with `always` routing to `backlog` (proceed) or another spec review loop.
4. **Rename `reviewing` → `code_review_in_progress` + add `code_review_complete`** — biggest risk/cost step because it touches AutoConductor, sidecar deprecation starts here. Keep the sidecar in read-only mode; all *writes* shift to engine events in this phase. Touches: `feature-review-state.js` (deprecate writers), `feature-autonomous.js` (poll snapshot), all action-registry references.
5. **Code revision state** — mirror of §3 but for code; owning agent = implementer per §8.
6. **Review cycle loop + `reviewCycles[]` context** — wire the `always:` loop-back; event payload `nextReviewerId`/`requestAnotherCycle`; render cycle history on dashboard.
7. **Dashboard data-driven rendering + delete sidecar** — collapse the three bespoke rendering sites behind `STATE_RENDER_META`; delete `feature-review-state.js` and `workflow-read-model.js:512-616`; replace sidecar migration with the one-shot in §4's migration (so deletion is safe).

Dependency graph: **1 → 2 → 3**, **4 → 5 → 6**, then **7 depends on {3, 6}**. 1 and 2 are independent; 4 can start in parallel with 2 but merges must stage.

### Preferred target model (one-page summary)

| Stage | State | Type | Activity | Owning agent |
|---|---|---|---|---|
| Backlog | `backlog` | stable | — | — |
| Backlog | `spec_review_in_progress` | active | reviewer | event.reviewerId |
| Backlog | `spec_review_complete` | transient | — | — |
| Backlog | `spec_revision_in_progress` | active | owner | frontmatter `agent:` → `authorAgentId` → default |
| Backlog | `spec_revision_complete` | transient | — | — |
| In Progress | `implementing` | active | implementer | `context.agents[*]` |
| In Progress | `code_review_in_progress` | active | reviewer | event.reviewerId |
| In Progress | `code_review_complete` | transient | — | — |
| In Progress | `code_revision_in_progress` | active | owner | implementer from `context.agents` |
| In Progress | `code_revision_complete` | transient | — | — |
| In Evaluation | `evaluating` / `ready_for_review` / `closing` | unchanged | unchanged | unchanged |
| Paused | `paused` | unchanged | — | — |
| Done | `done` | final | — | — |

Module ownership (post-migration):

| Concern | Module |
|---|---|
| Machine definition | `lib/feature-workflow-rules.js`, `lib/research-workflow-rules.js` |
| Event schema + append | `lib/workflow-core/engine.js` |
| Snapshot projection | `lib/workflow-core/projector.js` (+ `lib/spec-review-state.js` as a helper) |
| Action eligibility | `lib/feature-workflow-rules.js` (registry) |
| Dashboard read model | `lib/workflow-read-model.js` (snapshot + enrichment) |
| Agent launch decisions | `lib/agent-launch.js` (existing — unchanged); owning-agent resolution injected from `context.authorAgentId` + `event.reviewerId` |

---

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| spec-review-first-class-states | Promote spec review from context properties to `spec_review_in_progress` + `spec_review_complete` XState states, with projector + hydrate-from-legacy migration, and dashboard badge driven by `currentSpecState` | high | none |
| agent-frontmatter-field | Add `agent:` YAML scalar to feature/research specs; write on `feature-create`/`research-create`; seed `authorAgentId` on `feature-start`; doctor flags missing value on backlog rows | high | none |
| spec-revision-state | Add `spec_revision_in_progress` + `spec_revision_complete` transient; owning-agent resolution precedence (frontmatter → authorAgentId → default); action registry entry | high | spec-review-first-class-states, agent-frontmatter-field |
| code-review-rename-plus-complete | Rename `reviewing` → `code_review_in_progress`; add `code_review_complete` transient; keep sidecar as read-only for one release; retarget AutoConductor to poll snapshot | high | none |
| code-revision-state | Add `code_revision_in_progress` + `code_revision_complete`; implementing-agent resolution from `context.agents`/`winnerAgentId` | high | code-review-rename-plus-complete |
| review-cycle-loop-and-history | Implement `always:` loop-back via `anotherCycleRequested` guard; add `reviewCycles[]` projected context; event payload carries `nextReviewerId`/`requestAnotherCycle`; expose "Another cycle" vs "Proceed" actions | medium | code-revision-state, spec-revision-state |
| dashboard-data-driven-review-rendering | Introduce `STATE_RENDER_META` map; collapse `specReview` / `reviewSessions` / `reviewStatus` bespoke rendering into state-driven badges + `validActions`-driven buttons | medium | review-cycle-loop-and-history |
| review-sidecar-deletion | Delete `lib/feature-review-state.js` + `workflow-read-model.js` review consumers; one-shot migration that replays sidecar history into engine events | medium | dashboard-data-driven-review-rendering |
