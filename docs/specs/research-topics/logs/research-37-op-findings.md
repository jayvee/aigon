# Research Findings: State Machine & Review Cycle Redesign

**Agent:** OpenCode (op)
**Research ID:** 37
**Date:** 2026-04-24

---

## Current-State Inventory

### Engine States (8 XState states)

Defined in `lib/feature-workflow-rules.js:23-65` as `FEATURE_ENGINE_STATES`:

| State | Type | Stage | Activity? |
|-------|------|-------|-----------|
| `hydrating` | transient | — | no |
| `implementing` | active | in-progress | yes — owning agent |
| `paused` | stable | paused | no |
| `reviewing` | active | in-progress | yes — reviewer agent |
| `evaluating` | active | in-evaluation | yes — eval agent |
| `ready_for_review` | stable | in-evaluation | no |
| `closing` | transient | in-evaluation | no |
| `done` | final | done | no |

**Critical: `backlog` and `inbox` are NOT XState states.** They are values of `context.currentSpecState` set by the projector (`lib/workflow-core/projector.js:86-102`). The `hydrating` state has no `→ backlog` transition; backlog entities bypass the machine entirely. This is the root of the spec-review inconsistency — when a feature is in backlog, the XState machine is not the authority, so spec review was bolted on as context properties.

### Snapshot Fields

`snapshotFromContext()` (`lib/workflow-core/engine.js:125-153`) produces:

| Field | Source |
|-------|--------|
| `lifecycle` | `context.currentSpecState` (alias) |
| `currentSpecState` | `context.currentSpecState` (canonical) |
| `agents` | `context.agents` — per-agent status map |
| `authorAgentId` | Seeded at `feature.started`, never updated |
| `winnerAgentId` | Set by `selectWinner` XState action |
| `specReview` | Built from `context.specReview` via `buildSpecReviewSummary()` |
| `pendingSpecReviews` | Extracted from specReview summary |
| `effects`, `lastEffectError`, `lastCloseFailure` | Engine internals |
| `mode` | `solo_branch` / `solo_worktree` / `fleet` / null |
| `pauseReason` | Set on `feature.paused` event |
| `nudges` | Ring buffer, max 20 |
| `agentFailover` | `{ chain: string[] }` or null |

### Status Files

| File | Owner Module | Shape |
|------|-------------|-------|
| `.aigon/workflows/features/{id}/snapshot.json` | `engine.js:125` | Full projected snapshot |
| `.aigon/workflows/features/{id}/events.jsonl` | `engine.js:598` | Append-only event log |
| `.aigon/workflows/features/{id}/review-state.json` | `lib/feature-review-state.js:8` | `{ current, history }` — **sidecar, not in engine** |
| `.aigon/workflows/features/{id}/review-state.json` (research) | `lib/research-review-state.js:8` | Same shape |
| `.aigon/state/feature-{id}-{agent}.json` | `lib/agent-status.js` | Per-agent status |

### Dashboard Read Models

| Module | Function | What It Reads |
|--------|----------|--------------|
| `lib/workflow-read-model.js:415` | `getFeatureDashboardState()` | Snapshot + `readSpecReviewSessions()` + `readSpecCheckSessions()` + `readFeatureReviewState()` + `readFeatureEvalState()` |
| `lib/workflow-read-model.js:785` | `readSpecReviewSessions()` | `snapshot.specReview.activeReviewers` + `pendingReviews` → joins with tmux |
| `lib/workflow-read-model.js:824` | `readSpecCheckSessions()` | `snapshot.specReview.activeCheckers` → joins with tmux |
| `lib/workflow-read-model.js:511` | `readFeatureReviewState()` | `review-state.json` + tmux sessions → `reviewStatus`, `reviewSessions`, `reviewState` |
| `lib/dashboard-status-collector.js:282` | `applySpecReviewFromSnapshots()` | `snapshot.specReview` → `item.specReview` |
| `lib/workflow-snapshot-adapter.js:358` | `snapshotToStage()` | `LIFECYCLE_TO_STAGE` map → dashboard stage |
| `lib/workflow-snapshot-adapter.js:384` | `snapshotToDashboardActions()` | `deriveAvailableActions()` → `validActions` |

### Review Helper Modules

| Module | Lines | Owns | First-class state? |
|--------|-------|------|---------------------|
| `lib/spec-review-state.js` | 145 | `buildSpecReviewSummary()`, `readHeadSpecReviewCommit()` | No — context-property helper |
| `lib/feature-review-state.js` | 227 | `startReview()`, `completeReview()`, `reconcileReviewState()` | Sidecar file, parallel to engine |
| `lib/research-review-state.js` | 228 | Mirror of feature-review-state | Same sidecar pattern |
| `lib/feature-review-state.js:46,71` | — | `cycle` counter | Written but **never read** |

---

## Q1: How Should New States Be Added — Write/Read Path Audit

### Write Paths That Must Change

| Path | Module | Current | Target |
|------|--------|---------|--------|
| State rule table | `lib/feature-workflow-rules.js:23-65` | 8 states in `FEATURE_ENGINE_STATES` | Add 8 new states: `backlog`, `spec_review_in_progress`, `spec_review_complete`, `spec_counter_review_in_progress`, `spec_counter_review_complete`, `code_review_in_progress`, `code_review_complete`, `code_counter_review_in_progress`, `code_counter_review_complete`. Rename `reviewing` → `code_review_in_progress` |
| Research state table | `lib/research-workflow-rules.js:5-49` | 8 states | Same additions (research shares the pattern) |
| Hydrating rules | Both workflow-rules files | Guards for 8 states | Add guards for all new states |
| Machine guards | `lib/workflow-core/machine.js:19-76` | `isReviewing`, `isImplementing`, etc. | Add `isBacklog`, `isSpecReviewInProgress`, `isSpecReviewComplete`, `isSpecCounterReviewInProgress`, `isCodeReviewInProgress`, `isCodeReviewComplete`, `isCodeCounterReviewInProgress`, `isCodeCounterReviewComplete` |
| Projector lifecycle | `lib/workflow-core/projector.js:86-160` | Switch on event types to set `lifecycle` | Add cases for all new review/counter-review events |
| Engine `applyTransition()` | `lib/workflow-core/engine.js:598-602` | Routes `feature.review` → XState | Route all new events through XState machine |
| Engine public API | `lib/workflow-core/engine.js:1746-1802` | `recordSpecReview*()` functions | Change to emit machine-transition events instead of context-only events |
| Lifecycle-to-stage map | `lib/workflow-snapshot-adapter.js:23-32` | `LIFECYCLE_TO_STAGE` | Add `backlog→backlog`, `spec_review_in_progress→backlog`, `spec_review_complete→backlog`, `spec_counter_review_in_progress→backlog`, `spec_counter_review_complete→backlog`, `code_review_in_progress→in-progress`, `code_review_complete→in-progress`, `code_counter_review_in_progress→in-progress`, `code_counter_review_complete→in-progress` |
| Lifecycle-to-dir map | `lib/workflow-core/paths.js` | `LIFECYCLE_TO_FEATURE_DIR` | Same additions for directory path resolution |
| Action candidates | `lib/feature-workflow-rules.js:67-307` | `FEATURE_SPEC_REVIEW` / `FEATURE_SPEC_REVISE` with `bypassMachine: true` | Convert to machine-governed action candidates with proper `eventType` |
| `canCloseFeature()` | `lib/workflow-core/engine.js:1042-1076` | Reads `snapshot.specReview.pendingCount` | Replace with machine guard — can't close from review-in-progress states |

### Read Paths That Must Change

| Path | Module | Current | Target |
|------|--------|---------|--------|
| `applySpecReviewFromSnapshots()` | `lib/dashboard-status-collector.js:282-309` | Reads `snapshot.specReview` | Derive review badges from `currentSpecState` + `context.reviewCycles` |
| `readSpecReviewSessions()` | `lib/workflow-read-model.js:785-822` | Reads `snapshot.specReview.activeReviewers` | Read from `context.reviewCycles` + `context.pendingCodeReviewer` |
| `readFeatureReviewState()` | `lib/workflow-read-model.js:511-615` | Reads sidecar `review-state.json` | Read from engine snapshot + reviewCycles context |
| Dashboard card rendering | `templates/dashboard/js/pipeline.js:314-345` | Bespoke `if/else` on agent status | Data-driven lookup from `STATE_RENDER_META` map |
| Spec review badges | `templates/dashboard/js/utils.js:93-120` | Reads `item.specReview.activeReviewers/pendingCount` | Read from engine-derived display state |
| Monitor review rows | `templates/dashboard/index.html:108-114` | Alpine `:class` on `rs.running` | Read from engine-derived status |

### Invariant: Both LIFECYCLE_TO_STAGE and LIFECYCLE_TO_FEATURE_DIR Must Stay Aligned

Every new state must appear in both `lib/workflow-snapshot-adapter.js:LIFECYCLE_TO_STAGE` AND `lib/workflow-core/paths.js:LIFECYCLE_TO_FEATURE_DIR`. If either is missing, features in the new state will either display in the wrong board column or resolve to the wrong spec directory.

---

## Q2: Internal Transient States — `always` Transitions vs Ephemeral Events

### XState `always` Pattern (Current Precedent: `hydrating`)

`lib/workflow-core/machine.js:150-156` builds `hydrating` as an `always` (eventless/transient) state:

```js
hydrating: {
    always: [
        { target: 'done', guard: 'isDone' },
        { target: 'implementing', guard: 'isImplementing' },
        // ... ordered by specificity, last has no guard (default) ...
    ]
}
```

XState evaluates `always` transitions synchronously on state entry — no event required. The state is never observed at rest; the machine immediately resolves to the target.

### Recommended: `always` for `*_complete` Transients

The four `*_complete` states (`spec_review_complete`, `spec_counter_review_complete`, `code_review_complete`, `code_counter_review_complete`) should use `always` transitions for the same reason `hydrating` does: **no operator action is needed to leave them**. The decision of what comes next is already baked into the event that entered them.

**Implementation**: Extend `buildStateConfig()` in `machine.js` to recognize transient states. Two options:

**Option A — Convention-based**: Add a `TRANSIENT_STATES` set to the rules file:

```js
const TRANSIENT_STATES = new Set([
    'hydrating',
    'spec_review_complete', 'spec_counter_review_complete',
    'code_review_complete', 'code_counter_review_complete',
]);
```

Then `buildStateConfig()` checks `TRANSIENT_STATES.has(stateName)` and generates `{ always: [...] }` instead of `{ on: { ... } }`.

**Option B — Rule annotation**: Add `_transient: true` to each transient state entry in the rule table, and `buildStateConfig()` checks for it.

**I recommend Option A** — it keeps the rule table clean (no new field per entry) and makes the set of transient states easily auditable in one place.

### Why Not Ephemeral Events

An alternative would be to make `*_complete` normal states requiring an explicit event to leave (e.g., `feature.resume_after_review`). This was considered and rejected because:

1. It requires an operator or automation to fire a follow-up event — creating a stuck-state risk if the event is never sent.
2. The decision of "proceed vs loop-back" is already encoded in the event payload that *entered* the transient. Making it a separate event is redundant state.
3. It contradicts the design's intent: `*_complete` states are internal machine bookkeeping, not operator-visible states.

### Transient State in Snapshots

When the machine processes an event that enters a transient, it **immediately** evaluates the `always` transitions and exits. The snapshot will show the *resolved target state*, not the transient itself. This means:

- `spec_review_complete` → immediately resolves to `backlog` (proceed) or `spec_counter_review_in_progress` (counter-review needed)
- `code_review_complete` → immediately resolves to `submitted` (proceed) or `code_counter_review_in_progress` (counter-review needed)
- `code_counter_review_complete` → immediately resolves to `submitted` (proceed) or `code_review_in_progress` (another cycle)

**However**, the event log records the full chain. For dashboard timeline rendering, the read model can detect `spec_review.submitted` events to show "Spec review complete" even though the snapshot never rests at that state.

---

## Q3: Migration Path — Context Properties to Engine States

### Four-Step Migration

**Step 1: Add new states to engine rules, guards, and projector — additive only**

Add all new states with their transitions and guards. At this point, nothing routes *to* them yet — the machine just knows they exist. No existing behavior changes. This step must land before any other migration steps.

**Step 2: Dual event-name acceptance in projector**

The projector (`lib/workflow-core/projector.js`) must accept both old and new event names during transition. For example, both `spec_review.submitted` (old, context-mutating) and `feature.spec_review.completed` (new, machine-transition) must produce correct projections. This allows features with mixed old/new event logs to project correctly.

```js
case 'spec_review.completed':  // NEW
    lifecycle = 'spec_review_complete';
    // ... also update context.reviewCycles ...
    break;
case 'spec_review.submitted':  // OLD — legacy compat
    // Same logic as today, but also writes to reviewCycles for migration
    break;
```

**Step 3: Versioned migration — rewrite snapshots and synthesize events**

A new migration in `lib/migration.js` (e.g., `2.xx.0`):

1. **Rewrite snapshot**: For any feature with `snapshot.specReview.pendingCount > 0` and `currentSpecState === 'backlog'`, set `currentSpecState = 'spec_review_in_progress'` (or the appropriate review state based on `activeReviewers`/`activeCheckers`).

2. **Synthesize review cycle events**: For each entry in `review-state.json` history, synthesize equivalent `feature.code_review.completed` / `feature.code_counter_review.completed` events and append to `events.jsonl` (if not already present — idempotency check by looking for matching timestamp or cycle marker).

3. **Rewrite `reviewing` lifecycle**: Any snapshot with `lifecycle === 'reviewing'` gets rewritten to `lifecycle = 'code_review_in_progress'`.

4. **Strip `specReview` from snapshot**: After the migration, `specReview` becomes a derived field — the snapshot no longer needs to store it. However, for backward compatibility during transition, keep it as a read-only projection.

**Step 4: Remove legacy producers after transition is complete**

Once all repos have been migrated, remove:
- `createSpecReviewState()` from projector
- `refreshSpecReviewState()` from projector
- `applySpecReviewEventToContext()` from engine
- The `specReview`/`pendingSpecReviews` keys from `snapshotFromContext()`
- `buildSpecReviewSummary()` from `lib/spec-review-state.js` (or simplify it to a thin adapter)

### Failure Mode: Legacy State Encountered Mid-Transition

If a snapshot carries `specReview.pendingCount > 0` but no corresponding engine events exist (i.e., the migration hasn't run), the system must:

1. **Detect** — `buildMissingSnapshotState()` or a new detection function checks for `snapshot.specReview` presence without matching `reviewCycles[]` entries.
2. **Fail loudly** — Return `MISSING_MIGRATION` read-model tag, show a dashboard badge: "Run `aigon doctor --fix` to migrate review state."
3. **Never degrade silently** — Do NOT fall back to context-property rendering for partially-migrated entities. The AGENTS.md rule is clear: "When a read path can't find the state it needs, fail loudly and cite the repair command."

### Event Log Compatibility

The event log is append-only and immutable. Old `spec_review.*` events stay in the log forever. The projector's dual-acceptance (Step 2) ensures they still project correctly. New features will only produce `feature.spec_review.*` / `feature.code_review.*` events.

---

## Q4: Obsolete Producers/Consumers of Spec-Review State

### Delete After Migration

| Module | Lines | What to Delete |
|--------|-------|---------------|
| `lib/workflow-core/projector.js` | 40-49 | `createSpecReviewState()` — replaced by machine initial context |
| `lib/workflow-core/projector.js` | 59-66 | `refreshSpecReviewState()` — replaced by machine state entry actions |
| `lib/workflow-core/projector.js` | 387-458 | All 4 `spec_review.*` event handlers (legacy path) — kept only as compat during transition |
| `lib/workflow-core/engine.js` | 271-347 | `applySpecReviewEventToContext()` — replaced by XState actions |
| `lib/spec-review-state.js` | 69-89 | `buildSpecReviewSummary()` — replaced by machine-derived state |
| `lib/feature-review-state.js` | entire | Delete after sidecar → engine migration completes. `review-state.json` becomes engine context |
| `lib/research-review-state.js` | entire | Same as feature version |

### Simplify (Keep as Adapter)

| Module | Lines | What Changes |
|--------|-------|-------------|
| `lib/workflow-core/engine.js:1746-1802` | — | `recordSpecReview*()` functions change to emit machine-transition events. Function signatures stay similar, internals change. |
| `lib/dashboard-status-collector.js:282-309` | — | `applySpecReviewFromSnapshots()` simplifies — reads from machine state instead of manually projecting `specReview` context |
| `lib/workflow-read-model.js:785-839` | — | `readSpecReviewSessions()` / `readSpecCheckSessions()` read from `context.reviewCycles` instead of `specReview.activeReviewers` |
| `lib/workflow-read-model.js:511-615` | — | `readFeatureReviewState()` reads from engine snapshot + reviewCycles instead of sidecar file |

### Keep Unchanged

| Module | Reason |
|--------|--------|
| `lib/commands/entity-commands.js:112-198` | CLI command handlers stay; they call engine APIs whose signatures are stable |
| `lib/dashboard-server.js:433-498` | `handleLaunchSpecReview()` stays; calls engine APIs |
| `lib/dashboard-routes.js:293-355` | API routes stay |
| `lib/action-command-mapper.js` | Action name mappings stay |
| `lib/workflow-snapshot-adapter.js:89-133` | `SNAPSHOT_ACTION_DESCRIPTORS` stays (action metadata) |
| Dashboard frontend files | Badge rendering stays; data source changes from `item.specReview.*` to engine-derived payload |

---

## Q5: Loop-Back Transition — `code_counter_review_complete` → `code_review_in_progress`

### XState Machine Definition

```js
code_counter_review_complete: [
    { always: [
        { target: 'code_review_in_progress', guard: 'anotherCycleRequested', effect: 'recordNextCycle' },
        { target: 'submitted' },  // default: proceed
    ]}
]
```

This mirrors the `hydrating` pattern — an `always` transition with ordered guards. The first matching guard wins; the unguarded entry is the default fallback.

### The Guard

`anotherCycleRequested` inspects the **latest event** that entered the transient:

```js
anotherCycleRequested: ({ context, event }) => {
    return event.requestAnotherCycle === true;
}
```

The event `feature.code_counter_review.completed` carries `requestAnotherCycle: true` or `false` in its payload. The guard is deterministic — the decision was made by the operator when they chose the action.

### Why Not a Separate Event

Making "request another cycle" a separate event (e.g., `feature.start_another_review`) would require:
1. The machine to rest at `code_counter_review_complete` waiting for an event
2. An operator or automation to fire the event
3. A stuck-state risk if the event never fires

By encoding the decision in the entering event's payload, the transient auto-resolves — no stuck state, no operator follow-up needed.

### The `recordNextCycle` Effect

```js
recordNextCycle: assign({
    reviewCycles: ({ context, event }) => [
        ...context.reviewCycles,
        {
            type: 'code',
            cycle: context.reviewCycles.filter(c => c.type === 'code').length + 1,
            reviewer: event.nextReviewerId,
            startedAt: event.at,
        },
    ],
    pendingCodeReviewer: ({ event }) => event.nextReviewerId,
}),
```

This appends a new entry to `reviewCycles[]` and sets `pendingCodeReviewer` so the `code_review_in_progress` state can use it when launching the reviewer agent.

---

## Q6: Next Reviewer Agent in Loop-Back Transitions

### Event Payload Approach

Two distinct `validActions` entries appear when the feature is at `code_counter_review_complete` (or rather, when actions are derived for the state *before* entering the transient):

**Action: "Another Review Cycle"**
```js
{
    kind: 'FEATURE_CODE_REVIEW_CYCLE',
    label: 'Another review cycle',
    eventType: 'feature.code_counter_review.completed',
    requiresInput: 'agentPicker',
    eventPayload: { requestAnotherCycle: true, nextReviewerId: '${selectedAgent}' },
    recommendedOrder: 30,
}
```

**Action: "Proceed"**
```js
{
    kind: 'FEATURE_PROCEED_AFTER_REVIEW',
    label: 'Proceed',
    eventType: 'feature.code_counter_review.completed',
    eventPayload: { requestAnotherCycle: false },
    recommendedOrder: 40,
}
```

Both actions fire the **same event type** but with different payloads. The agent picker only appears for the "Another review cycle" action (via `requiresInput: 'agentPicker'`).

### How `nextReviewerId` Flows Through the System

1. **Operator selects** an agent from the picker (or AutoConductor passes `--review-agent`)
2. **Dashboard/CLI** builds the event with `requestAnotherCycle: true, nextReviewerId: 'gg'`
3. **Engine** appends the event to `events.jsonl`
4. **Projector** processes the event: sets `context.pendingCodeReviewer = event.nextReviewerId`, appends to `context.reviewCycles[]`
5. **Machine** enters `code_counter_review_complete` → `always` guard `anotherCycleRequested` passes → transitions to `code_review_in_progress`
6. **Effect** `recordNextCycle` writes `pendingCodeReviewer` and cycle entry
7. **`code_review_in_progress`** state: the launch side-effect reads `context.pendingCodeReviewer` and passes it to `buildAgentCommand()`

### For Spec Counter-Review → Spec Review Loop-Back

Same pattern, but the next reviewer for spec review is resolved from:

| Priority | Source |
|----------|--------|
| 1 | Event payload `nextReviewerId` (operator picked a specific agent) |
| 2 | `agent:` frontmatter field from spec |
| 3 | Configured default agent (`getDefaultAgent()`) |

---

## Q7: Dashboard Data-Driven State Rendering

### Current Bespoke Logic

The dashboard has three categories of bespoke rendering:

1. **Agent status** (`pipeline.js:314-345`): A large `if/else` chain mapping status strings to `{icon, label, cssClass}`. Compound conditions (tmux running, solo drive mode, session ended) prevent a simple map.

2. **Spec review badges** (`utils.js:93-120`): `buildSpecReviewBadgeHtml()` reads `item.specReview.activeReviewers` and `pendingCount` — a read path from context properties, not engine state.

3. **Monitor review rows** (`index.html:108-114`): Alpine `:class` bindings comparing `rs.running` to determine CSS class.

### Proposed: `STATE_RENDER_META` Server-Side Map

Define a centralized map in `lib/workflow-snapshot-adapter.js` (or a new `lib/state-render-meta.js`):

```js
const STATE_RENDER_META = {
    backlog:                          { icon: '○', label: 'Backlog',               cls: 'status-idle' },
    spec_review_in_progress:          { icon: '●', label: 'Reviewing spec',       cls: 'status-reviewing', badge: 'spec-review' },
    spec_counter_review_in_progress:  { icon: '●', label: 'Addressing spec review', cls: 'status-reviewing', badge: 'spec-counter-review' },
    implementing:                     { icon: '●', label: 'Implementing',         cls: 'status-running' },
    code_review_in_progress:          { icon: '●', label: 'Reviewing code',       cls: 'status-reviewing', badge: 'code-review' },
    code_counter_review_in_progress:  { icon: '●', label: 'Addressing review',   cls: 'status-reviewing', badge: 'code-counter-review' },
    submitted:                        { icon: '✓', label: 'Submitted',            cls: 'status-submitted' },
    evaluating:                       { icon: '●', label: 'Evaluating',          cls: 'status-running' },
    paused:                           { icon: '⏸', label: 'Paused',              cls: 'status-ended' },
    done:                             { icon: '✓', label: 'Done',                cls: 'status-submitted' },
};
```

The dashboard API response would include `stateRenderMeta: STATE_RENDER_META[currentSpecState]` alongside each feature row. The frontend renders from this metadata, eliminating string comparisons to specific state names.

### What Cannot Be a Simple Map

The compound conditions in `buildAgentStatusHtml` (tmux-running override, solo drive mode, session-ended detection) require triangulation of multiple signals. These stay as a **function** that consults `STATE_RENDER_META` as a baseline and overrides when needed:

```js
function buildAgentStatusHtml(agent, options) {
    const base = STATE_RENDER_META[agent.status] || { icon: '○', label: agent.status, cls: 'status-idle' };
    if (agent.tmuxRunning && !['submitted', 'waiting'].includes(agent.status)) {
        return { icon: '●', label: 'Running', cls: 'status-running' };
    }
    // ... other compound overrides ...
    return base;
}
```

### Eliminated Frontend Logic

With `STATE_RENDER_META`, these specific frontend checks become unnecessary:
- `pipeline.js:321` — `status === 'addressing-review'` → `STATE_RENDER_META` provides label/class
- `pipeline.js:323` — `status === 'feedback-addressed'` → `STATE_RENDER_META` provides label/class
- `utils.js:93-110` — `buildSpecReviewBadgeHtml()` → server provides `stateRenderMeta` with badge info
- `index.html:85` — `feature.stage === 'in-evaluation'` → stage derived from `STATE_RENDER_META` + stage map

---

## Q8: `agent:` Frontmatter Field

### Current State: Does Not Exist

No code in the codebase reads or writes an `agent:` frontmatter field in spec files:

- **`feature-create`** (`lib/entity.js:117-181`): Writes `complexity:` and optionally `set:`. Does NOT write `agent:`.
- **`feature-start`** (`lib/feature-start.js:51`): Agent IDs come from CLI positional args only. No spec-frontmatter reading.
- **`aigon doctor`** (`lib/commands/setup.js:2243-2259`): Validates `defaultAgent` in config files, not in specs.
- **Spec template** (`templates/specs/feature-template.md`): Only defines `complexity: medium`.

### Proposed Format

```yaml
---
complexity: medium
agent: cc
---
```

Plain YAML scalar. No nesting, no structured object. The value is a single agent ID string (e.g., `cc`, `gg`, `cx`, `cu`, `op`).

### Resolution Precedence

| Context | Priority 1 | Priority 2 | Priority 3 | Priority 4 |
|---------|-----------|-----------|-----------|-----------|
| Spec counter-review | Event payload `nextReviewerId` | `agent:` frontmatter | Configured `defaultAgent` | First registered agent |
| Feature-start default | CLI arg `--agent` | `agent:` frontmatter | Configured `defaultAgent` | First registered agent |
| Code counter-review | Implementing agent from `context.agents` | — | — | — |

### Where `agent:` Is Written

| Command | Behavior |
|---------|----------|
| `feature-create --agent cc` | Writes `agent: cc` to spec frontmatter |
| `feature-create` (no `--agent`) | Does NOT write `agent:` field. Defaults resolved at start time. |
| `feature-create --agent cc` (draft mode) | Draft agent may edit the field interactively |

### Where `agent:` Is Read

| Module | Function | Purpose |
|--------|----------|---------|
| `lib/feature-workflow-rules.js` | Spec counter-review action candidate | Resolve owning agent for counter-review |
| `lib/feature-start.js` | Default agent resolution | When no CLI agent is provided, use spec's `agent:` as default |
| `lib/spec-crud.js` | `readSpecSection()` | Parse frontmatter, expose `agent` field |
| `lib/commands/setup.js` | `aigon doctor` | Validate `agent:` is a registered agent ID |

### Validation in `aigon doctor`

Add a check alongside the existing `checkDefaultAgentConfig()`:

```js
// For each spec with an agent: field
const specAgent = data.agent;
if (specAgent && !agentRegistry.getAllAgentIds().includes(specAgent)) {
    console.log(`  ⚠️  Feature ${id} spec agent is '${specAgent}' but that agent is not registered`);
}
```

---

## Q9: Migration for Existing Snapshots with `specReview` Context

### Snapshot Migration Strategy

**Phase 1 — Dual-read (transition period)**

Both `specReview` context properties AND new `reviewCycles[]` + machine states are projected. The projector accepts both old and new events. The snapshot includes both `specReview` (legacy) and `reviewCycles` (new). Dashboard reads from `reviewCycles` if present, falls back to `specReview`.

**Phase 2 — Versioned migration** (`lib/migration.js`)

```js
registerMigration('<version>', async ({ repoPath, log }) => {
    // For every feature snapshot:
    // 1. If specReview.activeReviewers.length > 0 → set currentSpecState = 'spec_review_in_progress'
    // 2. If specReview.pendingCount > 0 and no activeReviewers → set currentSpecState = 'spec_counter_review_in_progress'
    // 3. If lifecycle === 'reviewing' → set lifecycle = 'code_review_in_progress'
    // 4. Synthesize reviewCycles[] from review-state.json history
    // 5. Write review-state.json entries as engine events in events.jsonl
    // 6. Remove specReview from snapshot (or mark as migrated)
});
```

**Phase 3 — Legacy removal**

After the migration has run across all repos:
- Remove `specReview` from `snapshotFromContext()`
- Remove `createSpecReviewState()`, `refreshSpecReviewState()`, `applySpecReviewEventToContext()`
- Remove legacy projector handlers for `spec_review.*` events
- Delete `lib/feature-review-state.js` and `lib/research-review-state.js`

### Test Invariants

| Test File | What It Pins |
|-----------|-------------|
| `tests/integration/spec-review-status.test.js` | `specReview.pendingCount` → `reviewCycles[]` derivation; `validActions` filtering for spec-review states |
| `tests/integration/dashboard-review-statuses.test.js` | `reviewSessions` / `specReviewSessions` shape from engine state |
| `tests/integration/migration-255.test.js` | Migration idempotency; re-running doesn't corrupt |
| New: `tests/integration/review-cycle-loopback.test.js` | Loop-back transition: `code_counter_review_complete` → `code_review_in_progress` with `anotherCycleRequested` |
| New: `tests/integration/missing-migration-detection.test.js` | Snapshot with `specReview` but no `reviewCycles` → `MISSING_MIGRATION` tag, fail-loudly |
| New: `tests/integration/agent-frontmatter-resolution.test.js` | `agent:` field → counter-review agent resolution precedence |

Each test includes a `// REGRESSION: ...` comment naming the specific regression it prevents.

---

## Q10: Implementation Sequence — Phased Features

### Dependency Graph

```
Phase 1: agent-frontmatter-field
    ↓
Phase 2: spec-review-engine-states  (depends on Phase 1 for owning-agent resolution)
    ↓
Phase 3: spec-counter-review-state  (depends on Phase 2)
    ↓
Phase 4: code-review-cycle-states   (depends on Phase 2 for transient pattern)
    ↓
Phase 5: code-counter-review-state  (depends on Phase 4)
    ↓
Phase 6: review-cycle-loopback      (depends on Phase 4 + 5)
    ↓
Phase 7: dashboard-data-driven      (depends on Phase 2 + 6)
```

### Phase Details

**Phase 1: `agent-frontmatter-field`**
- Files: `lib/spec-crud.js`, `lib/entity.js`, `lib/feature-start.js`, `lib/commands/setup.js`, `templates/specs/feature-template.md`
- Changes: Add `agent:` to template; write in `feature-create --agent`; read in `feature-start` as default; validate in `aigon doctor`
- Test: `tests/integration/agent-frontmatter-resolution.test.js`
- Boundary: No engine changes. Purely additive frontmatter field.

**Phase 2: `spec-review-engine-states`**
- Files: `lib/feature-workflow-rules.js`, `lib/research-workflow-rules.js`, `lib/workflow-core/machine.js`, `lib/workflow-core/projector.js`, `lib/workflow-core/engine.js`, `lib/workflow-core/paths.js`, `lib/workflow-snapshot-adapter.js`, `lib/spec-review-state.js`
- Changes: Add `backlog`, `spec_review_in_progress`, `spec_review_complete` to XState machine. Extend `buildStateConfig()` for transient states. Convert `FEATURE_SPEC_REVIEW` from `bypassMachine: true` to machine-governed. Add migration.
- Test: `tests/integration/spec-review-status.test.js` (update), `tests/integration/missing-migration-detection.test.js` (new)
- Boundary: Spec review is now first-class; spec counter-review NOT yet added. Actions for spec counter-review appear in `validActions` but the states don't exist yet.

**Phase 3: `spec-counter-review-state`**
- Files: `lib/feature-workflow-rules.js`, `lib/workflow-core/projector.js`, `lib/workflow-core/engine.js`, `lib/feature-workflow-rules.js` (action candidates)
- Changes: Add `spec_counter_review_in_progress`, `spec_counter_review_complete`. Add `FEATURE_SPEC_COUNTER_REVIEW` action candidate with `requiresInput: 'agentPicker'` resolved from `agent:` frontmatter. Wire `spec_review_complete` → `spec_counter_review_in_progress` (default) or `backlog` (if no pending counter-review).
- Test: Extend `tests/integration/spec-review-status.test.js`
- Boundary: Full spec review cycle works end-to-end.

**Phase 4: `code-review-cycle-states`**
- Files: `lib/feature-workflow-rules.js`, `lib/research-workflow-rules.js`, `lib/workflow-core/machine.js`, `lib/workflow-core/projector.js`, `lib/workflow-core/engine.js`, `lib/workflow-core/paths.js`, `lib/workflow-snapshot-adapter.js`
- Changes: Rename `reviewing` → `code_review_in_progress`. Add `code_review_complete` (transient). Migrate `review-state.json` sidecar data into engine events/context. Add `reviewCycles[]` context field.
- Test: `tests/integration/dashboard-review-statuses.test.js` (update)
- Boundary: Code review is now first-class with cycle tracking. Counter-review NOT yet added.

**Phase 5: `code-counter-review-state`**
- Files: `lib/feature-workflow-rules.js`, `lib/workflow-core/projector.js`, `lib/workflow-core/engine.js`
- Changes: Add `code_counter_review_in_progress`, `code_counter_review_complete`. Add `FEATURE_CODE_COUNTER_REVIEW` action candidate. Wire `code_review_complete` → `code_counter_review_in_progress` (default).
- Test: `tests/integration/review-cycle-loopback.test.js` (new)
- Boundary: Single code review + counter-review works. No loop-back yet.

**Phase 6: `review-cycle-loopback`**
- Files: `lib/feature-workflow-rules.js`, `lib/workflow-core/machine.js`, `lib/workflow-core/engine.js`
- Changes: Add `anotherCycleRequested` guard, `recordNextCycle` effect. `code_counter_review_complete` → `always:` with two targets. Add `FEATURE_CODE_REVIEW_CYCLE` and `FEATURE_PROCEED_AFTER_REVIEW` action candidates. Update AutoConductor to support multiple review cycles.
- Test: `tests/integration/review-cycle-loopback.test.js` (extend)
- Boundary: Full review cycle loop works for both spec and code.

**Phase 7: `dashboard-data-driven`**
- Files: `lib/workflow-snapshot-adapter.js`, `lib/dashboard-status-collector.js`, `lib/workflow-read-model.js`, `templates/dashboard/js/pipeline.js`, `templates/dashboard/js/utils.js`, `templates/dashboard/js/actions.js`, `templates/dashboard/index.html`
- Changes: Add `STATE_RENDER_META` map. Refactor `buildAgentStatusHtml` to consult it. Remove `buildSpecReviewBadgeHtml` / `buildSpecCheckBadgeHtml` — badges come from `stateRenderMeta`. Simplify `applySpecReviewFromSnapshots()`. Delete legacy `lib/spec-review-state.js` (after migration completes).
- Test: Visual verification with Playwright screenshot
- Boundary: All bespoke per-sub-state rendering eliminated. Dashboard renders purely from engine-derived metadata.

---

## Sources

- `lib/feature-workflow-rules.js` — State transition rules, action candidates
- `lib/research-workflow-rules.js` — Research state transition rules
- `lib/workflow-core/machine.js` — XState machine construction, guards, actions
- `lib/workflow-core/projector.js` — Event projection, lifecycle tracking
- `lib/workflow-core/engine.js` — Event append, snapshot projection, `canCloseFeature()`, `recordSpecReview*()`
- `lib/workflow-core/actions.js` — Action derivation pipeline
- `lib/workflow-core/types.js` — Type definitions, `ManualActionKind` enum
- `lib/workflow-core/paths.js` — Lifecycle-to-directory mapping
- `lib/workflow-snapshot-adapter.js` — Lifecycle-to-stage mapping, action descriptors
- `lib/dashboard-status-collector.js` — Spec review data flow, API response assembly
- `lib/workflow-read-model.js` — Read-side assembly of review sessions and status
- `lib/spec-review-state.js` — `buildSpecReviewSummary()` (context-property helper)
- `lib/feature-review-state.js` — Code review sidecar file (`review-state.json`)
- `lib/feature-autonomous.js` — AutoConductor review cycle logic
- `lib/commands/entity-commands.js` — Spec review CLI handlers, `resolveReviewAgentFromOptions()`
- `lib/commands/feature.js` — `feature-code-review` handler
- `lib/entity.js` — `entityCreate()` frontmatter handling
- `lib/feature-start.js` — Agent resolution at start time
- `lib/agent-launch.js` — `resolveLaunchTriplet()`, `buildAgentLaunchInvocation()`
- `lib/agent-prompt-resolver.js` — Agent prompt resolution
- `lib/config.js` — `getDefaultAgent()` resolution chain
- `lib/migration.js` — Migration framework, `2.52.1` and `2.55.0` migrations
- `templates/dashboard/js/pipeline.js` — Card rendering, `buildAgentStatusHtml`
- `templates/dashboard/js/utils.js` — `buildSpecReviewBadgeHtml`, `buildSpecCheckBadgeHtml`
- `templates/dashboard/js/actions.js` — Action dispatch, spec/code review handlers
- `templates/dashboard/index.html` — Alpine templates with state class bindings
- `templates/specs/feature-template.md` — Spec template (only `complexity:` field)
- [XState docs: Transient states](https://stately.ai/docs/xstate/transient-states)
- [XState docs: Guarded transitions](https://stately.ai/docs/xstate/guarded-transitions)
- [Harel statecharts: Original paper](https://www.sciencedirect.com/science/article/pii/0167642387900359)

---

## Recommendation

### Preferred State Model

Adopt the full state table from the research spec (Section "Agreed State Design"), implementing all 14 non-hydrating states across Backlog, In Progress, In Evaluation, Paused, and Done stages. All `*_complete` states are XState transients using `always` transitions. The `backlog` state becomes a genuine XState state (not just a projector-set value), enabling the machine to govern spec review transitions.

### Migration Strategy

Three-phase migration: (1) dual-read compatibility, (2) versioned migration with backup/restore, (3) legacy removal. Never degrade silently — missing migration data produces `MISSING_MIGRATION` tag and directs to `aigon doctor --fix`. Pin each phase with a test that proves the invariant.

### Deletion/Simplification List

| Module | Action |
|--------|--------|
| `lib/spec-review-state.js` | Delete after Phase 7 (dashboard no longer reads from it) |
| `lib/feature-review-state.js` | Delete after Phase 4 (sidecar data migrated into engine) |
| `lib/research-review-state.js` | Delete after Phase 4 |
| `lib/workflow-core/projector.js:createSpecReviewState()` | Delete after Phase 2 |
| `lib/workflow-core/projector.js:refreshSpecReviewState()` | Delete after Phase 2 |
| `lib/workflow-core/engine.js:applySpecReviewEventToContext()` | Delete after Phase 3 |
| `templates/dashboard/js/utils.js:buildSpecReviewBadgeHtml()` | Delete in Phase 7 (replaced by STATE_RENDER_META) |
| `templates/dashboard/js/utils.js:buildSpecCheckBadgeHtml()` | Delete in Phase 7 |

### Ordered Implementation Phases

7 phases with clear dependencies. Each phase has a test boundary and named files. See Phase Details above for specifics. Critical path: **Phase 1 → 2 → 3** (spec review complete), **Phase 4 → 5 → 6** (code review complete), then **Phase 7** (dashboard unified, depends on 3 + 6). Phases 1-3 and 4-6 can proceed in parallel after Phase 2 ships the transient-state idiom.

---

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| `agent-frontmatter-field` | Add `agent:` YAML scalar to spec frontmatter; `feature-create --agent` writes it; `feature-start` and counter-review read it as default; `aigon doctor` validates | high | none |
| `spec-review-engine-states` | Promote spec review from context properties to first-class XState states (`backlog`, `spec_review_in_progress`, `spec_review_complete`); extend `buildStateConfig()` for transient states; add migration | high | agent-frontmatter-field |
| `spec-counter-review-state` | Add `spec_counter_review_in_progress` and `spec_counter_review_complete` states; owning agent resolved from `agent:` frontmatter → default config; wire transient loop-back to `backlog` or `spec_counter_review_in_progress` | high | spec-review-engine-states |
| `code-review-cycle-states` | Rename `reviewing` → `code_review_in_progress`; add `code_review_complete` transient; add `reviewCycles[]` context field; migrate `review-state.json` sidecar into engine events | high | spec-review-engine-states |
| `code-counter-review-state` | Add `code_counter_review_in_progress` and `code_counter_review_complete` states; owning agent is implementing agent from `context.agents`; wire transient loop-back | high | code-review-cycle-states |
| `review-cycle-loopback` | `always` guard `anotherCycleRequested` on `code_counter_review_complete` → `code_review_in_progress`; `recordNextCycle` effect; `FEATURE_CODE_REVIEW_CYCLE` and `FEATURE_PROCEED_AFTER_REVIEW` action candidates; AutoConductor multi-cycle support | medium | code-counter-review-state, spec-counter-review-state |
| `dashboard-data-driven-rendering` | Centralized `STATE_RENDER_META` map; refactor `buildAgentStatusHtml` to consult it; eliminate `buildSpecReviewBadgeHtml`/`buildSpecCheckBadgeHtml`; delete `lib/spec-review-state.js` | medium | spec-counter-review-state, review-cycle-loopback |
