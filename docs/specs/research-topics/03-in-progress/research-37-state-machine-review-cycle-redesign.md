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
<!-- Document discoveries, options evaluated, implementation constraints found.
Include:
- current-state inventory by module/write path/read path
- constraints or invariants the redesign must preserve
- options rejected and why
- exact legacy state/data that must be migrated or deleted
-->

## Recommendation
<!-- Concrete recommended approach for each research question above.
The recommendation should end with:
- preferred state model
- migration strategy
- deletion/simplification list for legacy code
- ordered implementation phases with dependency notes
-->

## Output
The final research output should be implementation-ready, not a general essay. It must contain:

- A concise target state diagram or state table for backlog, in-progress, evaluation, paused, and done
- A transition matrix covering review start, review completion, counter-review start, counter-review completion, loop-back, pause/resume, and close
- A module ownership table naming which layer owns machine definition, event append, snapshot projection, dashboard read model, and agent launch decisions
- A migration section naming required one-time migrations, compatibility rules, and explicit failure behavior for missing or partial state
- A phased feature list where each phase has a clear boundary, named files/modules, and a test expectation

Use the checklist below to capture the resulting implementation phases.
- [ ] Feature: promote spec review to first-class engine states
- [ ] Feature: add spec counter-review state + owning agent resolution
- [ ] Feature: add code review cycle states (code_review_in_progress / code_review_complete)
- [ ] Feature: add code counter-review state
- [ ] Feature: review cycle loop (loop-back transition, cycle history in context)
- [ ] Feature: dashboard data-driven state rendering (eliminate bespoke sub-stage logic)
- [ ] Feature: `agent:` frontmatter field + feature-create/start integration
