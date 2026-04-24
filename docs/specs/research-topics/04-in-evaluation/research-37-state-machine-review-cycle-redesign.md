---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-23T01:31:31.417Z", actor: "cli/research-prioritise" }
---

# Research: State Machine & Review Cycle Redesign

## Context

The Aigon workflow engine uses XState with a flat set of named engine states. Two review-related concerns have surfaced:

1. **Inconsistency**: Code review (`reviewing`) is a first-class engine state. Spec review is NOT — it is implemented as context properties (`specReview.pendingCount`, `activeReviewers`, etc.) bolted onto the `backlog` state, with bespoke dashboard rendering. This inconsistency will compound as review features grow.

2. **Missing cycles**: The engine has no model for Counter-Review (the owning agent's adversarial response to a reviewer's changes) or for multiple review cycles. These are needed for both spec and code review workflows.

This research designs the complete state map, migration path, and implementation sequence.

---

## Terminology — mandatory, do not deviate

These terms were settled through design sessions grounded in UML statechart theory (Harel), Fagan inspection methodology, and XState architecture.

| Term | Definition |
|---|---|
| **Stage** | One of 4 progression positions on the board: Backlog, In Progress, In Evaluation, Done. A compound state containing multiple engine states. |
| **Bucket** | A holding area outside the progression: **Inbox** (no engine state, pre-bootstrap) and **Paused** (has engine state). Neither is a stage. |
| **State** | The fine-grained XState engine position (`currentSpecState`). What the feature IS right now. One active state per hierarchy level at a time. |
| **Activity** | An ongoing process while in a state — an agent is running. UML `do /` semantics. |
| **Action** | An instantaneous operation the user or automation triggers, causing a transition. |
| **Transition** | The move from one state to another, driven by an event or completion. |
| **Completion event** | Automatic event fired when an activity finishes — no user input needed. |
| **Extended state / Context** | Accumulated facts that travel with the feature across all states (cycle history, agent assignments). Not the current state — historical. |
| **Review** | Agent-driven activity in which a reviewer agent inspects and commits changes to the spec or code. |
| **Counter-Review** | Adversarial activity in which the owning agent responds to the reviewer's changes — accepting, rejecting, or fixing them. The owning agent has full authority to override. |
| **Review cycle** | One full pass of Review → Counter-Review. Multiple cycles may occur; each is recorded in extended state/context. |
| **Owning agent** | The agent responsible for the feature. For code: implementing agent (from workflow snapshot). For spec: `agent:` frontmatter field → fallback to default agent. |

---

## Questions to Answer

- [ ] How should the new states be added to the centralized workflow definition (`lib/feature-workflow-rules.js` and any matching machine/config owner)? Identify the exact write paths and read paths that must change together so state production and consumption stay aligned.
- [ ] How are internal transient states (`spec_review_complete`, `code_review_complete` etc.) best modelled in XState — `always` transitions or ephemeral events?
- [ ] What is the migration path from the current context-property spec review approach to first-class engine states, including event-log compatibility, snapshot migration, and the failure mode when legacy state is encountered mid-transition?
- [ ] Which current producers and consumers of spec-review state become obsolete once spec review is a proper engine state? Name the exact modules and whether each should be deleted, simplified, or kept as an adapter.
- [ ] How does the `code_counter_review_complete` → `code_review_in_progress` loop-back transition work in XState? What guard distinguishes "another cycle" from "proceed"?
- [ ] How is the next reviewer agent passed into a loop-back transition?
- [ ] Can the dashboard derive all stage, activity, and action data purely from workflow snapshot state plus a centralized state definition map — eliminating all bespoke per-sub-state rendering logic without adding frontend-only eligibility logic?
- [ ] What is the exact spec frontmatter `agent:` field format? Does `feature-create` write it? Does `feature-start` respect it as a default implementor? Does `aigon doctor` flag missing values?
- [ ] What migration is needed for existing workflow snapshots carrying `specReview` context properties, and what tests pin the producer/consumer invariants so snapshotless or half-migrated entities fail loudly instead of degrading silently?
- [ ] What is the correct implementation sequence? Recommend a phased set of features.

## Evidence Expectations

The findings document must answer each question above with repository-specific evidence, not just preferred architecture. For each claim, cite the exact module(s), command path(s), and workflow state/data shape involved.

Minimum evidence required:

- A current-state inventory covering engine state, workflow snapshot fields, status files, dashboard read models, and any review-specific helper modules that participate in spec review or code review today
- A proposed target state table that names the source of truth for stage, state, activity, actions, cycle history, and owning-agent resolution
- A transition inventory for every new review and counter-review state, including who triggers it, what event is appended, and what durable artifact changes
- A migration plan for existing snapshots and event logs, including the expected repair path if legacy state is encountered
- A test plan that names the commands or test files that should prove the new invariants

## Scope

### In Scope
- Complete engine state map for feature spec and code review cycles
- Promotion of spec review from context properties to first-class engine states
- Counter-Review states for both spec and code (owning agent responds adversarially)
- Review cycle loop design (same states visited multiple times, context records history)
- Owning agent resolution (`agent:` frontmatter field + fallback)
- Dashboard consumption: data-driven from state definition, not bespoke per sub-state
- Migration path for existing workflow snapshots
- Implementation sequence: phased feature recommendations
- Required producer/read-path audit so any new state model has one clear source of truth

### Out of Scope
- Autonomous multi-cycle configuration (multiple reviewers declared upfront at feature-start) — future feature
- Research entity review cycles — same pattern applies but separate concern
- Feedback entity lifecycle
- `agent:` frontmatter driving automatic agent selection beyond counter-review resolution
- Rewriting unrelated dashboard or workflow infrastructure that is not necessary for review-cycle support

---

## Agreed State Design

The following is settled and must not be re-litigated. The research validates implementation approach, not the design.

### Buckets (not stages)

| State | Notes |
|---|---|
| *(none)* | Inbox has no engine state — pre-bootstrap |
| `paused` | Suspension bucket; resumes to `implementing` |

### Backlog stage

| State | Type | Activity? |
|---|---|---|
| `backlog` | stable | no |
| `spec_review_in_progress` | active | yes — reviewer agent |
| `spec_review_complete` | internal transient | no |
| `spec_counter_review_in_progress` | active | yes — owning agent |
| `spec_counter_review_complete` | internal transient | no |

### In Progress stage

| State | Type | Activity? |
|---|---|---|
| `implementing` | active | yes — owning agent |
| `submitted` | stable | no |
| `code_review_in_progress` | active | yes — reviewer agent |
| `code_review_complete` | internal transient | no |
| `code_counter_review_in_progress` | active | yes — owning agent |
| `code_counter_review_complete` | internal transient | no |

### In Evaluation stage

| State | Type | Activity? |
|---|---|---|
| `evaluating` | active | yes — eval agent |
| `winner_selected` | internal transient | no |
| `ready_for_review` | stable | no |
| `closing` | internal transient | no |

### Done

| State | Type |
|---|---|
| `done` | final |

### Review cycle loop

States are reused across cycles — they do not multiply. Extended state context records history:

```js
reviewCycles: [
  { type: 'spec' | 'code', cycle: 1, reviewer: 'cx', startedAt, completedAt, counterStartedAt, counterCompletedAt },
  { type: 'code', cycle: 2, reviewer: 'cu', ... }
]
```

After `code_counter_review_complete`, available actions:
- **Another Review Cycle** → `code_review_in_progress` (with next reviewer agent)
- **Proceed** → `submitted`

Subsequent reviewers infer prior cycle history from the feature's git log — not from the engine. The engine records facts; the git log records changes.

### Owning agent resolution

| Context | Resolution order |
|---|---|
| Code counter-review | Implementing agent from workflow snapshot `agents` map |
| Spec counter-review | `agent:` frontmatter field → configured default agent |

---

## Findings

Three agents (cc, gg, op) submitted findings — see `docs/specs/research-topics/logs/research-37-{cc,gg,op}-findings.md`. Synthesis below.

### Consensus
- Spec review must move from context properties (`context.specReview`, `bypassMachine: true`) to first-class XState states; the inconsistency with code review's `reviewing` state is the root cause of compounding bolt-ons.
- `*_complete` states should be implemented as XState `always:` transients (same precedent as `hydrating`). The proceed-vs-loop-back decision is encoded in the **entering event's payload**, never a follow-up event.
- `reviewCycles[]` projected context array stores cycle history (history, not current state).
- `agent:` frontmatter field does not exist today — needs producer (`feature-create --agent`), readers (`feature-start`, revision-agent resolver), and `aigon doctor --fix` validator. Plain YAML scalar `agent: cc`.
- Sidecar `lib/feature-review-state.js` (and research mirror) should be deleted after a one-shot migration replays `review-state.json` history into engine events; AutoConductor retargets from `review-complete` status-file polling to snapshot/event polling.
- Dashboard collapses to a server-side `STATE_RENDER_META` map keyed by `currentSpecState`; eliminates `buildSpecReviewBadgeHtml`, `buildSpecCheckBadgeHtml`, and the three bespoke rendering sites.
- Migration rule (per AGENTS.md §Write-Path Contract): dual-read window → versioned migration → legacy delete. Never silently degrade — partial state becomes `MISSING_MIGRATION` and cites `aigon doctor --fix`.
- Renaming `reviewing` → `code_review_in_progress` is the riskiest rename; touches AutoConductor, projector, `LIFECYCLE_TO_STAGE`, `LIFECYCLE_TO_FEATURE_DIR`, action registry.

### Divergent views
- **`backlog` as XState state**: op argues yes — make it real so the machine governs spec review from the root. cc argues no — keep `currentSpecState='backlog'` as projector output and let `hydrating` gain transitions to the new review states. gg silent. **Resolution: deferred to feature 1's spec-review phase**; default to cc's path (less invasive) unless spec review pushes back.
- **Phase ordering for `agent:` frontmatter**: op puts it first (Phase 1) so spec-revision can land with owning-agent resolution wired. cc puts it second. **Resolution: bundled into feature 1** — agent frontmatter, spec_review states, and spec_revision states all land together to avoid two migration windows over the same context shape.
- **Sidecar retention window**: cc keeps the sidecar in read-only mode for one release; op deletes in the same phase as cycle migration. **Resolution: feature 2 deprecates writers (read-only); feature 3 deletes outright after migration.**
- **Transient state mechanism**: op proposes a `TRANSIENT_STATES` set in the rules file (Option A); cc/gg do not specify. **Resolution: adopt op's `TRANSIENT_STATES` set.**

## Recommendation

Adopt the full state design from §Agreed State Design as the target, implementing it in **4 features** that consolidate the 8 candidates from agent findings. Combinations chosen to maximize per-feature context windows and to avoid two migration passes over the same context shape:

- **Feature 1 (`spec-review-and-revision-states`)** — combines agent-frontmatter, spec_review first-class states, and spec_revision states. Agent frontmatter is a hard prereq for spec-revision owning-agent resolution; the three sub-changes share the same projector cases, action candidates, and migration window.
- **Feature 2 (`code-review-and-revision-states`)** — combines the `reviewing` rename + `code_review_complete` transient + `code_revision_*` states + AutoConductor retarget. Renaming `reviewing` already touches every consumer of that string; adding code_revision in the same PR avoids a second drive-by edit. Sidecar enters read-only mode here.
- **Feature 3 (`loop-and-sidecar`)** — combines the `always:` cycle loop-back + `reviewCycles[]` projection + sidecar deletion. Cycle history is fed by replayed sidecar events; deleting the sidecar is the natural endpoint of cycle migration.
- **Feature 4 (`dashboard`)** — collapses the three bespoke rendering sites behind `STATE_RENDER_META`. Frontend-only, kept separate because it touches a different file set (Playwright verification required).

**Migration strategy:**
1. **Dual-read** (features 1 & 2) — projector accepts both legacy (`spec_review.*`, `feature.review_requested`) and new (`feature.spec_review.*`, `feature.code_review.*`) events for one release; legacy events emit `console.warn`.
2. **Versioned migration** (features 1, 2, 3) — backup → rewrite snapshots (`reviewing` → `code_review_in_progress`, `specReview.activeReviewers` → `currentSpecState='spec_review_in_progress'`) → synthesize sidecar history into engine events → validate. Idempotent.
3. **Legacy delete** (feature 3 + 4) — sidecar files deleted; `createSpecReviewState`/`refreshSpecReviewState`/`applySpecReviewEventToContext` removed; `buildSpecReviewBadgeHtml`/`buildSpecCheckBadgeHtml` removed.
4. **Failure mode** — any snapshot the projector cannot fully rebuild gets `readModelSource: WORKFLOW_SOURCE.MISSING_MIGRATION` + dashboard banner citing `aigon doctor --fix`. Never silent fallback.

**Deletion list (terminal state after feature 3 + 4):**

| Module | Action |
|---|---|
| `lib/feature-review-state.js` | Delete entirely (feature 3) |
| `lib/research-review-state.js` | Delete entirely (feature 3) |
| `lib/workflow-read-model.js readFeatureReviewState`/`readResearchReviewState` | Delete (feature 3) |
| `lib/workflow-core/projector.js createSpecReviewState`/`refreshSpecReviewState` | Delete (feature 1) |
| `lib/workflow-core/engine.js applySpecReviewEventToContext` | Narrow then delete (feature 1 → 3) |
| `templates/dashboard/js/utils.js buildSpecReviewBadgeHtml`/`buildSpecCheckBadgeHtml` | Delete (feature 4) |
| `lib/spec-review-state.js buildSpecReviewSummary` | Reduce to projector-only helper (feature 1), delete after feature 4 if no callers remain |

**Ordered phases:** **1 → 2 → 3 → 4**. Strict serial — each feature relies on the migration window opened by its predecessor.

## Output
The final research output should be implementation-ready, not a general essay. It must contain:

- A concise target state diagram or state table for backlog, in-progress, evaluation, paused, and done
- A transition matrix covering review start, review completion, counter-review start, counter-review completion, loop-back, pause/resume, and close
- A module ownership table naming which layer owns machine definition, event append, snapshot projection, dashboard read model, and agent launch decisions
- A migration section naming required one-time migrations, compatibility rules, and explicit failure behavior for missing or partial state
- A phased feature list where each phase has a clear boundary, named files/modules, and a test expectation

### Set Decision

- Proposed Set Slug: `review-cycle-redesign`
- Chosen Set Slug: `review-cycle-redesign`

### Selected Features

| Feature Name | Description | Priority | Create Command |
|---|---|---|---|
| review-cycle-redesign-1-spec-states | Promote spec review to first-class XState states; add `agent:` frontmatter field; add spec_revision states + owning-agent resolution | high | `aigon feature-create "review-cycle-redesign-1-spec-states" --set review-cycle-redesign` |
| review-cycle-redesign-2-code-states | Rename `reviewing` → `code_review_in_progress`; add `code_review_complete` + `code_revision_*` states; retarget AutoConductor; deprecate sidecar writers | high | `aigon feature-create "review-cycle-redesign-2-code-states" --set review-cycle-redesign` |
| review-cycle-redesign-3-loop-and-sidecar | XState `always:` loop-back via `anotherCycleRequested` guard + `recordNextCycle` effect; project `reviewCycles[]`; delete sidecar files after replay migration | high | `aigon feature-create "review-cycle-redesign-3-loop-and-sidecar" --set review-cycle-redesign` |
| review-cycle-redesign-4-dashboard | Collapse three bespoke review-rendering sites behind server-driven `STATE_RENDER_META`; remove `buildSpecReviewBadgeHtml`/`buildSpecCheckBadgeHtml` and all `item.specReview.*` reads | medium | `aigon feature-create "review-cycle-redesign-4-dashboard" --set review-cycle-redesign` |

### Feature Dependencies

- review-cycle-redesign-2-code-states depends on review-cycle-redesign-1-spec-states (`depends_on: review-cycle-redesign-1-spec-states`)
- review-cycle-redesign-3-loop-and-sidecar depends on review-cycle-redesign-2-code-states (`depends_on: review-cycle-redesign-2-code-states`)
- review-cycle-redesign-4-dashboard depends on review-cycle-redesign-3-loop-and-sidecar (`depends_on: review-cycle-redesign-3-loop-and-sidecar`)

### Not Selected

- The "review sidecar deletion" candidate (cc's #8) was folded into feature 3 — keeping it separate would force an awkward sidecar-in-read-only middle release.
- Feature-count shrunk from 8 candidates to 4 by combining: (1+2+3) → feature 1, (4+5) → feature 2, (6+8) → feature 3, (7) → feature 4. Combinations chosen to co-locate shared files and to avoid multiple migration passes over the same context shape.

### Implementation Checklist

- [ ] Feature 1: spec-review-and-revision-states (incl. `agent:` frontmatter)
- [ ] Feature 2: code-review-and-revision-states (incl. `reviewing` rename + AutoConductor retarget)
- [ ] Feature 3: loop-and-sidecar (cycle loop-back + sidecar deletion)
- [ ] Feature 4: dashboard data-driven rendering
