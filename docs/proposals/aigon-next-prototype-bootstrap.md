# Aigon Next Prototype Bootstrap

Use this document to bootstrap a new Codex session in a separate prototype repo such as `~/src/aigon-next`.

## Purpose

Build a proof of concept for a new Aigon workflow core using:

- `XState` for workflow/state modeling
- local file-backed persistence only
- no database
- no dashboard initially
- a narrow CLI-first vertical slice

The goal is to prove that a local, file-backed, XState-based workflow engine is simpler and more robust than the current Aigon workflow core.

## Important Context From Aigon

Current Aigon has become complex because workflow truth is spread across:

- spec file locations under `docs/specs/`
- manifest JSON files
- per-agent status files
- logs and eval files
- tmux session inspection
- dashboard polling heuristics
- command-specific recovery logic

The new prototype must avoid that split-brain model.

### Architectural Direction

The target shape is:

- `engine` = workflow authority
- `dashboard` = view/controller only
- `orchestrator` = optional background operator

The engine owns workflow truth.
Everything else sends commands/signals into the engine and reads snapshots back out.

## Prototype Goals

The prototype is successful if all of these are true:

1. A feature workflow can run in `solo_branch`, `solo_worktree`, and `fleet`.
2. Workflow truth is persisted to local files only.
3. Available manual actions are derived from machine state.
4. A silent or hung agent can be recovered through explicit actions.
5. Interrupted multi-step operations can resume cleanly.
6. An optional orchestrator can inject signals without becoming the source of truth.

## Non-Goals

- no dashboard initially
- no install-agent integration
- no prompt/template generation
- no backward compatibility with existing Aigon commands
- no research workflow yet
- no production packaging polish

## Repo / Run Model

Create a separate repo:

- repo: `~/src/aigon-next`
- binary: `a2` or `aigon-next`

The prototype should run **against** a target repo rather than being installed deeply into it on day one.

Example usage:

```bash
a2 --repo ~/src/seed-web-1 feature-start 42 --mode fleet --agents cc,cx,gg
```

The prototype stores its workflow state inside the target repo, for example:

```text
.a2/
  workflows/
    features/
      42/
        events.jsonl
        snapshot.json
        lock
```

Use 1-2 fresh seed repos as testbeds.

## Core Design

### Concepts

Use three concepts only:

1. `commands`
Intentional requests from user/UI/CLI.

2. `signals`
Asynchronous facts from agents, orchestrator, or environment watchers.

3. `events`
Durable facts persisted by the engine after validation.

The engine is event-driven.
The reducer consumes events.
Side effects are requested explicitly and their results come back as events.

### Workflow Layers

- `engine` accepts commands/signals
- `event store` appends JSONL facts
- `snapshot store` writes current state
- `effect runner` executes requested side effects
- optional `orchestrator` observes environment and emits signals

### State Model

For features, start with lifecycle states:

- `backlog`
- `implementing`
- `ready_for_review`
- `evaluating`
- `closing`
- `done`
- `paused`

Execution mode is a separate dimension:

- `solo_branch`
- `solo_worktree`
- `fleet`

Do **not** explode mode into top-level lifecycle states.
Lifecycle state and mode are different concerns.

### Agent Status Model

Per-agent status should start with:

- `idle`
- `running`
- `waiting`
- `ready`
- `failed`
- `lost`

Important: do not model this as “agent submitted the feature”.
Model it as agent-local readiness, not feature-level acceptance.

Preferred internal event/status naming:

- `agent_marked_ready`
- `ready`

## XState Guidance

Use XState to model the feature workflow.

Important modeling guidance:

- lifecycle should be the primary machine structure
- mode should live in context or nested implementation substates
- per-agent workflows should be modeled as child actors or tracked agent substate
- available manual actions should be derived from `snapshot.can(event)`

The dashboard must eventually render actions from machine-valid events, not from separate heuristic logic.

## Commands / Signals To Support First

### Commands

- `feature-start`
- `feature-pause`
- `feature-resume`
- `feature-eval`
- `feature-close`
- `restart-agent`
- `force-agent-ready`
- `drop-agent`
- `select-winner`

### Signals

- `agent-started`
- `agent-waiting`
- `agent-ready`
- `agent-failed`
- `session-lost`
- `heartbeat-expired`

## Effect Scope

Implement for real first:

- event append
- snapshot write
- file locking
- spec movement between state folders
- basic worktree creation
- basic log/eval file creation

Stub or simplify first:

- tmux startup
- merge/close flow
- security scan
- telemetry

The point of the prototype is to validate the engine model, not reproduce all of Aigon immediately.

## Suggested Repo Structure

```text
src/
  cli/
    index.ts
  workflow/
    engine.ts
    event-store.ts
    snapshot-store.ts
    lock.ts
    actions.ts
    feature-machine.ts
    feature-types.ts
    projector.ts
  effects/
    runner.ts
    feature-effects.ts
  orchestrator/
    index.ts
    watchers.ts
  adapters/
    git.ts
    worktree.ts
    tmux.ts
    fs.ts
```

## Initial CLI Surface

```bash
a2 --repo <path> feature-start 42 --mode fleet --agents cc,cx,gg
a2 --repo <path> signal agent-ready 42 cc
a2 --repo <path> signal session-lost 42 gg
a2 --repo <path> actions 42
a2 --repo <path> feature-eval 42
a2 --repo <path> select-winner 42 cc
a2 --repo <path> feature-close 42
a2 --repo <path> show 42
a2 --repo <path> events 42
```

## Required Scenario Tests

1. Fleet happy path
2. Solo branch happy path
3. Solo worktree happy path
4. Hung agent recovery
5. Lost session recovery
6. Interrupted close resume
7. No-orchestrator manual mode

## Rules For This Prototype

1. Do not let any read path mutate workflow state.
2. Do not infer workflow truth from tmux, logs, or folder layout at read time.
3. Do not let the orchestrator edit state files directly.
4. All workflow changes must go through engine commands/signals.
5. Keep the prototype narrow and representative.

## Aigon Background Reading

Read these from the current Aigon repo for background only:

1. `AGENTS.md`
2. `docs/architecture.md`
3. `docs/development_workflow.md`
4. `docs/proposals/aigon-next-prototype-bootstrap.md`

Pay special attention to the workflow/dashboard pain points in:

- `lib/state-machine.js`
- `lib/dashboard-server.js`
- `lib/commands/feature.js`

You are not porting Aigon wholesale.
You are proving a better core architecture.

## Recommended Codex Prompt

Paste this into the new Codex session:

```text
Build a proof-of-concept for a new Aigon workflow core in this repo.

Read the bootstrap document from the current Aigon repo:
/Users/jviner/src/aigon/docs/proposals/aigon-next-prototype-bootstrap.md

This prototype should:
- use XState
- use local file-backed persistence only
- avoid any database
- run as a standalone CLI against external target repos
- support a narrow feature workflow vertical slice only
- derive available actions from machine-valid events
- include an optional orchestrator concept, but no dashboard initially

Start with the smallest useful end-to-end implementation:
- feature-start
- agent-ready signal
- actions query
- feature-eval
- select-winner
- feature-close

Use seed repos as external test targets.
Keep the implementation intentionally narrow and architecturally clean.
```

