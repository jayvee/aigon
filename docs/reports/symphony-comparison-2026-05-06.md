# Aigon / Aigon Pro vs Symphony — 2026-05-06

Internal research note for later product planning.

## Sources

- Symphony repository: https://github.com/openai/symphony
- Symphony language-agnostic spec: https://github.com/openai/symphony/blob/main/SPEC.md
- Symphony Elixir reference implementation: https://github.com/openai/symphony/tree/main/elixir
- OpenAI announcement: https://openai.com/index/open-source-codex-orchestration-symphony/
- Local Aigon OSS inspected: `README.md`, `docs/architecture.md`, `lib/pro-bridge.js`, `lib/workflow-core/engine.js`, `lib/feature-autonomous.js`, `lib/set-conductor.js`, `lib/agent-launch.js`
- Local Aigon Pro inspected: `/Users/jviner/src/aigon-pro/index.js`, `lib/scheduled-kickoff.js`, `lib/recurring.js`, `lib/backup.js`, `lib/sync.js`, `lib/insights.js`

## Executive Summary

Aigon and Symphony are adjacent but not equivalent.

Aigon is a repo-native, spec-driven multi-agent workflow system. It treats committed Markdown specs plus workflow-core event logs as the product surface and lifecycle source of truth. It is strongest when the user wants local control, multiple agent vendors, explicit feature/research/review lifecycle states, Fleet evaluation, dashboard control, and git worktree isolation.

Symphony is a tracker-native autonomous runner. It treats Linear as the work queue, a repo-owned `WORKFLOW.md` as the runtime contract, and Codex app-server as the execution protocol. Its strongest contribution is not a UI or multi-agent model; it is a tight daemon specification for polling, claiming, dispatching, retrying, reconciling, and observing unattended implementation runs.

The main lesson for Aigon is: **make autonomous operation a first-class daemon contract, separate from feature lifecycle state, with explicit runtime policy, live reload, retry semantics, scheduler claims, and tracker reconciliation.**

## How They Compare

| Area | Aigon OSS | Aigon Pro | Symphony |
|------|-----------|-----------|----------|
| Primary work source | Markdown specs in `docs/specs` | Same, plus recurring/scheduled work | External tracker, currently Linear |
| Lifecycle authority | Event logs and snapshots in `.aigon/workflows` | Same | Tracker state plus in-memory orchestrator state |
| Execution isolation | Git worktrees under tmux | Same | Per-issue workspace directories |
| Agent support | Claude Code, Gemini CLI, Codex CLI, Cursor | Same | Codex app-server only |
| Autonomy shape | AutoConductor, set conductor, feature/research commands | Scheduled kickoff, recurring, failover, backup, insights | Long-running polling daemon |
| UI | Rich local dashboard and CLI/slash commands | Adds Pro dashboard panels/routes | Optional observability dashboard/API |
| Runtime policy | Distributed across config, templates, specs, agent JSON, commands | Same plus Pro engines | Repo-owned `WORKFLOW.md` frontmatter plus prompt |
| Tracker integration | Planned / feature specs exist for Jira and Linear sync | Some GitHub/PR-adjacent features planned | Core design centers tracker polling |
| Failure handling | Doctor, migrations, workflow locks, close recovery, supervisor/failover | Adds backup/sync/scheduler/recurring | Explicit retry queue, backoff, stall timeout, terminal cleanup |

## Important Differences

### 1. Aigon is workflow-rich; Symphony is orchestration-minimal

Aigon owns more of the software delivery workflow: feature specs, research topics, feedback, spec review, code review, evaluation, close recovery, Fleet mode, telemetry, and dashboard actions.

Symphony deliberately avoids becoming a rich workflow system. It is a scheduler/runner and tracker reader. Ticket writes, PR updates, comments, and handoff conventions are pushed into the workflow prompt and tools the agent can use.

This makes Symphony easier to specify and port. It also makes it less complete as a standalone product.

### 2. Aigon owns work state; Symphony reads work state

Aigon's event log is authoritative. Folder movement is an effect of engine transitions, and the dashboard is expected to read snapshots/read models rather than infer state from files.

Symphony reads candidate work from Linear. Its own scheduler state decides whether an issue is claimed/running/retrying, but business state such as `Todo`, `In Progress`, `Human Review`, and `Done` lives in the tracker.

This distinction matters for tracker integration. Aigon should not simply make Linear authoritative. A better path is to link external tracker state to Aigon's authoritative engine state and reconcile conflicts explicitly.

### 3. Aigon is multi-agent; Symphony gets protocol depth

Aigon's agent registry and launch helpers support multiple CLIs and model providers. That is a major product advantage.

Symphony gets a simpler runtime because it targets Codex app-server only. It can stream structured events, track thread/turn IDs, continue multiple turns on the same thread, inject client-side tools, handle unsupported tool calls, and account for tokens from one protocol.

Aigon should keep multi-agent support, but it can adopt a richer Codex app-server path where available.

### 4. Symphony has a clearer daemon contract

Symphony's spec defines:

- poll interval and dynamic reload
- candidate selection and priority sorting
- global and per-state concurrency
- claim/running/retry/release scheduler state
- retry delay and exponential backoff
- stall timeout and active-run reconciliation
- startup cleanup for terminal tracker issues
- workspace path safety invariants
- structured observability and recommended API shapes

Aigon has many equivalent pieces, but they are distributed across AutoConductor, SetConductor, supervisor, scheduled kickoff, recurring tasks, workflow-core, dashboard polling, and tmux sidecars. The behavior is powerful but harder to reason about as one autonomous system.

### 5. Symphony's `WORKFLOW.md` is a strong portability idea

Symphony uses one repo-owned file for runtime config, hooks, and prompt template. The spec requires strict prompt rendering, typed config validation, environment indirection only when explicit, and live reload with last-known-good behavior.

Aigon has templates, agent rules, project config, spec frontmatter, and Pro schedulers, but no single versioned autonomy contract that tells a daemon how this repo should be run unattended.

## What Aigon Can Learn

### Separate scheduler state from lifecycle state

Aigon's workflow-core lifecycle is valuable and should stay authoritative. But autonomous scheduling needs its own state model:

- `unclaimed`
- `claimed`
- `running`
- `retry_queued`
- `released`

This state should answer: "Can the conductor dispatch this thing right now?" It should not be overloaded onto `currentSpecState`.

### Treat autonomous execution as a daemon, not just a command loop

`feature-autonomous-start` and `set-autonomous-start` currently behave like specialized conductors. Symphony suggests a general conductor process that polls all eligible work, reconciles active runs, handles retry timers, enforces limits, and exposes one status API.

The conductor can delegate to existing Aigon commands rather than replace them.

### Make retry behavior explicit and operator-visible

Aigon has recovery mechanisms, but no single visible retry queue equivalent to Symphony's `retry_attempts`.

Operators should be able to see:

- entity id and role
- attempt count
- next retry time
- last error
- selected agent/model/effort
- workspace/session reference
- whether retry is continuation, failure, stall, quota, or unavailable slots

### Make prompt rendering strict where automation depends on it

Symphony requires unknown template variables and filters to fail. This is worth adopting for:

- scheduled prompts
- recurring feature templates
- AutoConductor prompts
- tracker-linked issue prompts
- future `AIGON_WORKFLOW.md`

Silent placeholder drift is expensive in unattended runs.

### Make tracker reconciliation a first-class safety mechanism

If an external issue is linked and someone changes its state while Aigon is running, Aigon should not ignore it or silently overwrite it. It should reconcile:

- terminal tracker state: stop or pause Aigon run
- blocked/on-hold state: pause or mark conflict
- priority/status/label drift: update read model or require explicit resolution
- issue deleted or hidden: stop retrying and release scheduler claim

## What Aigon Could Adopt

### 1. `AIGON_WORKFLOW.md`

Add a repo-owned workflow contract inspired by Symphony's `WORKFLOW.md`.

Possible shape:

```md
---
conductor:
  enabled: true
  poll_interval_ms: 30000
  max_concurrent_runs: 4
  max_concurrent_by_role:
    implement: 2
    review: 1
    close: 1
tracker:
  kind: linear
  project_slug: "$LINEAR_PROJECT_SLUG"
  active_states: ["Todo", "In Progress", "Rework"]
  terminal_states: ["Done", "Closed", "Cancelled", "Duplicate"]
workspace:
  root: "../aigon-worktrees"
hooks:
  before_run: |
    npm install
  after_run: |
    npm test -- --runInBand
agents:
  default_implement: cx
  default_review: cc
safety:
  approval_policy: manual-close
  sandbox: worktree-only
---

You are working on Aigon entity {{ entity.id }}.

Title: {{ entity.title }}
Description:
{{ entity.description }}
```

This should not replace existing config immediately. It can start as a conductor-only optional file with strict validation.

### 2. Conductor runtime state

Create a small autonomous scheduler module, probably `lib/conductor/`, with durable event-sourced or JSONL state:

- claims
- running attempts
- retry queue
- dispatch decisions
- last reconciliation result

The conductor should use workflow-core for feature/research lifecycle transitions, not bypass it.

### 3. Per-state and per-role concurrency

Symphony supports global concurrency and per-tracker-state limits. Aigon should support role-aware limits:

- implementation slots
- review slots
- eval slots
- close/recovery slots
- research slots
- total agent slots

This matters more than simple global concurrency once Pro has scheduled work, recurring tasks, and failover.

### 4. Retry queue with backoff

Add a durable retry queue for autonomous actions:

- continuation retry: short fixed delay
- failure retry: exponential backoff
- quota retry: scheduled after quota reset if known
- unavailable slot retry: short delay
- tracker/config failure: skip dispatch but keep reconciliation alive

### 5. Tracker adapter boundary

Implement a normalized adapter interface before adding tracker-specific product logic:

```js
{
  fetchCandidateIssues(),
  fetchIssuesByStates(states),
  fetchIssueStatesByIds(ids),
  normalizeIssue(raw),
  maybeCreateComment(),
  maybeUpdateState()
}
```

Normalized issue model:

- `id`
- `identifier`
- `title`
- `description`
- `priority`
- `state`
- `branchName`
- `url`
- `labels`
- `blockedBy`
- `createdAt`
- `updatedAt`

For Aigon, writes should probably be outbox/effect-driven and optional, not agent-owned by default.

### 6. Codex app-server runner path

Add an optional Codex app-server backend for `cx` while keeping tmux Codex CLI support.

Potential benefits:

- thread and turn IDs
- structured event stream
- richer token accounting
- continuation turns on one thread
- dynamic tool injection
- explicit user-input-required handling
- better stall detection

This should be treated as a runner strategy in `agent-registry`, not a separate product path.

### 7. Dynamic tool injection

Symphony injects `linear_graphql` into Codex app-server sessions. Aigon could expose:

- `aigon_entity` or `aigon_state` for current feature/research read model
- `linear_graphql` or `jira_rest` when tracker configured
- `github_pr` helper for PR comments/checks/media
- `aigon_nudge` or `aigon_status` read-only tools where safe

Important constraint: tool calls must not become hidden state mutations outside workflow-core.

### 8. Minimal conductor API

Add a stable automation/debug API separate from the dashboard's rich read model:

- `GET /api/v1/conductor/state`
- `GET /api/v1/conductor/:entityType/:id`
- `POST /api/v1/conductor/refresh`
- `POST /api/v1/conductor/retry/:claimId`
- `POST /api/v1/conductor/release/:claimId`

This should be versioned and low churn.

### 9. Live reload with last-known-good config

For conductor config and `AIGON_WORKFLOW.md`, apply Symphony's rule:

- detect file changes
- validate before applying
- use new config for future dispatch/retry/hook execution
- do not kill in-flight sessions automatically
- invalid reload does not crash the service
- surface the error in CLI/dashboard/API

### 10. Explicit safety posture

Symphony requires implementations to document approval, sandbox, and operator-confirmation posture. Aigon should surface this per repo:

- can agents write outside worktrees?
- can autonomous close merge?
- is PR creation allowed?
- can tracker state be mutated?
- what happens on user-input-required?
- what happens on unsupported tool calls?

This belongs in docs and in dashboard status.

## Immediate Feature Candidates

### 1. Conductor Runtime State

Add scheduler-owned state for autonomous runs, separate from feature/research lifecycle snapshots.

Acceptance shape:

- stores claim/running/retry/released records
- records entity id, role, agent, model/effort, attempt, last error, due time
- dashboard can render retrying/running conductor rows
- no lifecycle transitions are performed outside workflow-core

### 2. `AIGON_WORKFLOW.md` Foundation

Introduce optional repo-owned conductor config and prompt file.

Acceptance shape:

- YAML frontmatter plus Markdown prompt body
- strict parse errors
- typed getters/defaults
- explicit `$VAR` env indirection
- no global env override magic
- unknown keys ignored but preserved for forward compatibility

### 3. Strict Template Renderer

Create a shared strict renderer for automation templates.

Acceptance shape:

- unknown variables fail
- unknown filters fail
- recurring and scheduled prompts use it
- errors include file path and missing variable
- existing templates migrated or compatibility-gated

### 4. Unified Retry Queue

Implement visible retry/backoff records for autonomous conductor actions.

Acceptance shape:

- continuation retry fixed delay
- failure retry exponential backoff
- quota retry can use known reset time
- CLI command lists retry queue
- dashboard shows next retry and last error

### 5. Per-Role Concurrency Limits

Add role/state-aware concurrency control.

Acceptance shape:

- global max
- per-role max: implement/review/eval/close/research
- scheduler refuses or queues when slots unavailable
- dashboard explains "waiting for slot"

### 6. Tracker Adapter Foundation

Build the normalized tracker boundary without full bidirectional sync.

Acceptance shape:

- Linear adapter first or mock memory adapter first
- normalized issue model
- config validation
- candidate fetch and state refresh
- blocker normalization
- tests with fixture payloads

### 7. Tracker Conflict/Reconciliation Guard

Use linked issue state to pause/release active autonomous runs.

Acceptance shape:

- linked terminal state stops or releases conductor claim
- linked blocked/on-hold state pauses run or marks conflict
- conflict stored in read model
- no silent overwrite of Aigon lifecycle

### 8. Codex App-Server Runner Strategy

Add optional `cx` runner strategy using Codex app-server.

Acceptance shape:

- strategy selected from agent registry/config
- validates workspace cwd under worktree root
- streams session/turn events into existing telemetry
- handles user-input-required deterministically
- falls back to existing CLI strategy when unavailable

### 9. Conductor Observability API

Expose versioned conductor state for tools and debugging.

Acceptance shape:

- `/api/v1/conductor/state`
- `/api/v1/conductor/:entityType/:id`
- `/api/v1/conductor/refresh`
- JSON error envelope
- dashboard consumes API or can cross-check it

### 10. Safety Posture Surface

Document and display the active autonomy posture.

Acceptance shape:

- `aigon conductor posture` CLI
- dashboard panel/status badge
- docs page
- includes merge, tracker-write, filesystem, approval, sandbox, and user-input behavior

## Suggested Sequencing

1. Write the conductor spec before implementation.
2. Build `AIGON_WORKFLOW.md` parser/validator and strict renderer.
3. Add conductor runtime state and retry queue.
4. Move scheduled kickoff/recurring/autonomous entrypoints toward the conductor state model.
5. Add tracker adapter read side.
6. Add reconciliation guard.
7. Add Codex app-server runner as an optional strategy.

This sequence avoids starting with tracker integration or app-server complexity before Aigon has the scheduler contract to absorb it.

## Strategic Take

Do not copy Symphony as a product. Aigon's differentiator is broader: local spec-driven workflow, multiple agent vendors, explicit lifecycle state, Fleet evaluation, and a rich dashboard.

Copy Symphony's discipline:

- one daemon owns dispatch
- one scheduler state owns claims/retries
- one repo contract owns autonomy policy
- one strict renderer owns prompts
- one observability API explains what is happening
- tracker changes reconcile active work instead of being ignored

That would make Aigon Pro feel less like a collection of powerful autonomous features and more like a coherent autonomous operating layer for AI software delivery.
