---
complexity: very-high
# planning_context: (optional) link if a separate plan file was used
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-28T05:48:13.646Z", actor: "cli/feature-prioritise" }
---

# Feature: workflow close-recovery state for close-with-agent

## Summary

Today, when `aigon feature-close` fails, **F338** persists structured failure on the workflow snapshot as `lastCloseFailure`, and the dashboard offers **“Close with agent” / “Resolve & close”**, which spawns a **tmux session** with role `close` via `handleLaunchCloseResolve` in `lib/dashboard-server.js`. That session **does write** a normal entity sidecar under `.aigon/sessions/`, but the dashboard **never surfaces it** on the feature card: `safeTmuxSessionExists` in `lib/dashboard-status-helpers.js` only matches **`role === 'do'`**, and `parseTmuxSessionName` in `lib/worktree.js` does not classify the **`close`** role in the structured name pattern. Operators experience a **dislocated session**: work is still tied to the feature on disk, but the **authoritative workflow UI** shows no lifecycle stage for “recovering from a failed close.”

This feature introduces a **first-class `currentSpecState`** for that recovery window—**Option C** from planning—so that **XState**, the **projector**, **`state-render-meta`**, and **`feature-workflow-rules`** all agree the feature is in **close recovery**. The dashboard then inherits badges, spinners, and action eligibility from the same pipeline as spec review and code review, instead of bolting visibility onto tmux heuristics alone.

**Companion work (same feature, not optional):** extend tmux naming/parsing and the status collector so **`close`** sessions contribute `tmuxRunning` / `attachCommand` (or a dedicated `recoverySession` field) while the feature is in this state—otherwise “Closing recovery” is visible in the state pill but operators still cannot attach without reading tmux manually.

## Background and rationale

### Problem statement

- **Close-with-agent** is semantically part of the **close lifecycle**, but it is not the same as engine state **`closing`** (`feature.close_requested` → merge/effects). **`closing`** means “close pipeline is running”; **close recovery** means “close failed; a human or agent is repairing the repo so close can be retried.”
- **`feature_close.failed`** (projector) updates **`lastCloseFailure`** but **does not change** `lifecycle` / `currentSpecState`. The feature often remains **`submitted`** (or **`implementing`** in solo paths). That is correct as far as “implementation is done,” but it is **wrong for operator mental model**: the world is now in a **distinct recovery mode** with an active or expected agent session.
- Relying only on **`lastCloseFailure`** plus UI swaps (`snapshotToDashboardActions` merge-conflict branch) spreads logic across adapter guards and leaves **session liveness** unsolved.

### Why a new machine state (not only tmux fixes)

- Aigon’s product contract is: **`currentSpecState` is the spine** the dashboard renders (`lib/state-render-meta.js`), AutoConductor/set logic consults, and CLI gates reason about.
- Adding **`close_recovery_in_progress`** makes recovery **eligible for the same discipline** as other stages: explicit transitions, explicit exit, audit via `events.jsonl`, and a single place to answer “what is this feature doing?”
- Tmux visibility (**Option A** alone) fixes attach/peek but **does not** give you lifecycle analytics, blocking rules, or consistent badges after server restart.

### Relationship to existing work

| Piece | Role today |
|--------|------------|
| **F338** `feature_close.failed` | Persists `lastCloseFailure`; does not move lifecycle |
| **`closing`** | In-flight successful close pipeline |
| **`handleLaunchCloseResolve`** | Spawns `role: 'close'` session; **no engine event** |
| **`snapshotToDashboardActions`** | Swaps close CTA when merge-conflict + `implementing` only |

This feature **does not replace** `lastCloseFailure`; failure detail remains the forensic payload. The **new state** answers “we are actively recovering from that failure” and should typically require **`lastCloseFailure !== null`** to enter (guard), so the two fields reinforce each other.

## User stories

- [ ] As an operator, when I launch **Close with agent** after a failed close, the feature card shows a **clear lifecycle state** (e.g. “Close recovery”) consistent with other workflow stages—not a silent `submitted` row with a hidden tmux pane.
- [ ] As an operator, I can see whether the **recovery tmux session** is running and **attach** from the dashboard, same ergonomics as implementation sessions.
- [ ] As an operator, when recovery is abandoned or completes, the feature **leaves** close recovery predictably: either back to the prior resting state, or into **`closing`** when I retry `feature-close` successfully.
- [ ] As a developer adding workflow behaviour, I have a **checklist** (or reduced touchpoints) for introducing new `currentSpecState` values so this class of work does not miss a file.

## Acceptance criteria

### 1. Workflow events and projector

- [ ] New canonical event types (exact names to be chosen during implementation, e.g. `feature.close_recovery.started` and `feature.close_recovery.ended` / `feature.close_recovery.cancelled`) are appended to `.aigon/workflows/features/<id>/events.jsonl` through the **same write paths** as other engine events (dashboard launch + any CLI affordance if added later).
- [ ] **`feature.close_recovery.started`** payload includes at least: `agentId`, `at`, and **`returnSpecState`** (the `currentSpecState` immediately before entry—see Open Questions for alternatives). Optional: `sessionName`, `source` (`dashboard` | `cli`).
- [ ] **`lib/workflow-core/projector.js`** handles these events:
  - **Started:** set `lifecycle` (hence `currentSpecState`) to **`close_recovery_in_progress`**; persist a small context blob e.g. `closeRecovery: { agentId, startedAt, returnSpecState }`.
  - **Ended / cancelled:** restore `lifecycle` to **`returnSpecState`** from context; clear `closeRecovery`; do **not** clear `lastCloseFailure` unless a separate product decision says cancel implies dismiss failure (default: **keep** `lastCloseFailure` so operator still sees why recovery was needed).
  - **Successful retry:** when **`feature.close_requested`** fires (existing), transition to **`closing`** as today and **clear** `closeRecovery` auxiliary context; `lastCloseFailure` clearing remains tied to **`feature.closed`** as in F338.
- [ ] **REGRESSION test:** event sequence `feature_close.failed` → `close_recovery.started` → `feature.close_requested` → … → `feature.closed` leaves snapshot with `currentSpecState === 'done'`, `lastCloseFailure === null`, no stale `closeRecovery`.

### 2. XState machine and rules

- [ ] **`lib/feature-workflow-rules.js`** (`FEATURE_ENGINE_STATES`): new node **`close_recovery_in_progress`** with explicit **`on`** transitions:
  - **Enter** via `feature.close_recovery.started` from every **`currentSpecState`** where close-with-agent is currently allowed **and** `lastCloseFailure` is present (minimum: **`submitted`**, **`implementing`**; extend to other states if product audit shows valid failure + recovery paths—see Open Questions).
  - **Retry close:** `feature.close` transitions to **`closing`** with the **same guards/effects** as from **`submitted`** / **`implementing`** today (solo/fleet parity preserved—do not widen close eligibility accidentally).
  - **Exit without close:** `feature.close_recovery.ended` (or cancelled) returns to stored **`returnSpecState`**.
  - **Pause:** if **`feature.pause`** is meaningful from recovery, define it explicitly (allowed vs blocked); default recommendation: **allow pause** mapping same as `submitted` unless that complicates Fleet semantics.
- [ ] **`lib/workflow-core/machine.js`**: new guards **`isCloseRecovery`** for hydrate ordering; ensure **`hydrating`** transition list prefers **`close_recovery_in_progress`** when context indicates recovery (mirror pattern of `isClosing`, `isSubmitted`, etc.).
- [ ] **`FEATURE_TRANSIENT_STATES`:** recovery is **not** transient—no `always:` auto-bounce.
- [ ] **Research parity:** unless explicitly deferred, evaluate whether research has an analogous close failure path; if not, document **feature-only** in Out of Scope.

### 3. Write-path contract (dashboard + CLI)

- [ ] **`POST /api/feature-open`** (mode **`close-resolve`**) **after** successful session creation (or atomically ordered with engine write—see Open Questions) calls the engine to append **`feature.close_recovery.started`**. If engine write fails, session behaviour is defined (rollback vs orphan prevention—must be loud; cite `aigon doctor --fix` if inconsistent).
- [ ] **`handleLaunchCloseResolve`** remains the single spawn implementation; no duplicate spawn paths.
- [ ] Optional: **`aigon feature-close-recovery-start <id> [--agent]`** CLI for terminal-only users—defer if time-constrained, but the **spec** should state whether CLI parity is in or out of scope for v1.

### 4. Dashboard read path and tmux

- [ ] **`lib/state-render-meta.js`:** new entry for **`close_recovery_in_progress`** (icon, label, css class—use **`Skill(frontend-design)`** before final copy).
- [ ] **`lib/worktree.js` `parseTmuxSessionName`:** add **`close`** to the structured role alternation so session names match **`buildTmuxSessionName(..., { role: 'close' })`**.
- [ ] **`lib/dashboard-status-helpers.js`:** when building per-agent rows for a feature whose snapshot `currentSpecState === 'close_recovery_in_progress'`, treat a live **`close`** session for the recovery **`agentId`** (from `closeRecovery` context) as **running** for attach/peek purposes—or expose a second field **`recoveryTmuxSession`** to avoid overloading **`do`** semantics.
- [ ] **Supervisor / idle / token exhaustion:** define whether recovery sessions participate in existing policies; minimum: **no silent auto-kill**; document “display-only vs actionable” for recovery heartbeats.

### 5. Actions and adapter

- [ ] **`lib/workflow-core/types.js`** / **`ManualActionKind`:** add kinds only if new dashboard HTTP verbs are needed; prefer reusing **`feature-open`** with mode **`close-resolve`** plus engine event, unless registry requires a distinct kind for telemetry.
- [ ] **`lib/workflow-snapshot-adapter.js`:** remove or narrow **special-case** swaps that key only on `lastCloseFailure` + `implementing` once state drives the primary CTA; **merge-conflict** UX should key off **`close_recovery_in_progress`** **or** `lastCloseFailure` + new state (implementation choice documented).
- [ ] **`lib/feature-workflow-rules.js` `FEATURE_ACTION_CANDIDATES`:** guards for **Close**, **Open session**, **Reset**, etc., include the new state explicitly—no default fall-through.

### 6. Docs and architecture

- [ ] **`docs/architecture.md`** (workflow event taxonomy): document **`feature.close_recovery.*`** and the new `currentSpecState`.
- [ ] **`AGENTS.md`** (if module map / state list is canonical there): add one line pointing to close recovery.
- [ ] **`CHANGELOG.md`:** user-facing note.

### 7. Validation

```bash
node -c aigon-cli.js
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May restart the Aigon dashboard server after any `lib/*.js` edit.

## Technical approach

### State name

Use **`close_recovery_in_progress`** (snake_case, consistent with `code_revision_in_progress`). Alternatives considered: `closing_recovery` (too easy to confuse with `closing`), `post_close_failed` (not parallel naming).

### Enter / exit table (draft for implementers)

| Event | From | To | Side effects on context |
|--------|------|-----|-------------------------|
| `feature.close_recovery.started` | `submitted`, `implementing`, … | `close_recovery_in_progress` | Set `closeRecovery{ agentId, startedAt, returnSpecState }` |
| `feature.close_recovery.ended` | `close_recovery_in_progress` | `returnSpecState` | Clear `closeRecovery`; keep `lastCloseFailure` |
| `feature.close` | `close_recovery_in_progress` | `closing` | Same as today from `submitted` / `implementing` |
| `feature.close_requested` (projector) | (any) | sets lifecycle `closing` | Clear `closeRecovery` when projector applies close request |
| `feature.closed` | `closing` | `done` | Clear `lastCloseFailure` (existing F338) |

Order-sensitive cases (close fails mid-flight) must be walked in implementation with **integration tests**.

### Simplification opportunity: “new state checklist”

Implementers should add a short **`docs/` or `lib/workflow-core/README`** subsection: **“Adding a `currentSpecState`”** with a checkbox list derived from this feature’s audit:

1. **`lib/feature-workflow-rules.js`** — `FEATURE_ENGINE_STATES` transitions + `FEATURE_ACTION_CANDIDATES` guards.
2. **`lib/research-workflow-rules.js`** — only if applicable.
3. **`lib/workflow-core/machine.js`** — hydrate guards in `setup({ guards })` + ordering in `hydrating`.
4. **`lib/workflow-core/projector.js`** — event → `lifecycle` / context fields.
5. **`lib/state-render-meta.js`** — dashboard meta row.
6. **`lib/workflow-snapshot-adapter.js`** / read-model — any special swaps.
7. **`lib/dashboard-status-collector.js`** / helpers — liveness, `isWorking`, dev-server poke if relevant.
8. **Tests** — projector + at least one integration for write/read path.

Optional stretch: a **single exported array** `REGISTERED_SPEC_STATES` consumed by meta + tests for drift detection—only if low-controversy; avoid big-bang refactors in the same PR as behaviour change unless time allows.

## Dependencies

- **Builds on:** F338 **close-failure-event-and-resolve-action** (`feature_close.failed`, `lastCloseFailure`).
- **Touches same surfaces as:** F428 **live-log panel for feature-close** (verify no conflicting UX); F351 **session sidecars** / `tmuxId` routing.

## Out of scope (v1)

- Auto-start recovery agent without user click (policy-heavy).
- Changing **merge conflict detection** or **classification** in `feature-close`.
- **SetConductor** behaviour when a member enters close recovery (document “undefined in v1” or “outer loop waits” as a follow-up feature if needed).
- Research entity parity unless a concrete research close-failure path exists.

## Open questions (for spec review / agents)

1. **Eligible prior states:** Is recovery only from **`submitted`** and **`implementing`**, or also **`code_revision_in_progress`**, **`code_review_in_progress`**, **`evaluating`**, **`ready_for_review`**? Audit all **`feature-close`** entry points in CLI + dashboard.
2. **Return state restoration:** Is **`returnSpecState` on the event** sufficient, or should the machine infer return from **`lastCloseFailure.at` + event log** (heavier)?
3. **Engine write vs tmux spawn order:** Prefer **engine-first** (state shows recovery before attach opens) vs **session-first** (may flash wrong state for one poll). Write-path contract prefers **no half-state**.
4. **Cancelling recovery:** Do we need an explicit dashboard **“Exit recovery”** button that emits **`feature.close_recovery.ended`**, or is tmux-kill / `sessions-close` the only operator path?
5. **Fleet:** Which **`agentId`** is canonical on **`close_recovery.started`** when multiple agents exist?
6. **Naming:** Final event type strings must match **`lib/workflow-core/events.js`** conventions and avoid collision with `feature.close` family.

## Related

- **Prior:** F338 — close-failure-event-and-resolve-action  
- **Prior:** F299 area — close-with-agent / `close-resolve` mode (changelog naming)  
- **Code anchors:** `handleLaunchCloseResolve` (`lib/dashboard-server.js`), `safeTmuxSessionExists` (`lib/dashboard-status-helpers.js`), `FEATURE_ENGINE_STATES` (`lib/feature-workflow-rules.js`), `projectContext` (`lib/workflow-core/projector.js`)

## Implementation notes (non-normative)

- Prefer **one engine append** from the dashboard route layer that already has `repoPath` + `featureId` resolved—mirror how code review records **`recordCodeReviewStarted`** from `handleLaunchReview`.
- When extending **`parseTmuxSessionName`**, add a **REGRESSION** test that **`buildTmuxSessionName`** round-trips for **`close`** role.
- Complexity **`very-high`** reflects XState + projector + dashboard + tmux + tests; if reviewers split work, use **two features** with a hard dependency boundary (engine-only first, dashboard second)—only if it reduces merge risk without violating write-path contract.
