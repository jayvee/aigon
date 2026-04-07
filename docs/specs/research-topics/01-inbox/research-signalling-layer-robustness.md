# Research: signalling-layer-robustness

## Context

On 2026-04-06 a "dashboard Open Eval doesn't show the eval session" bug
surfaced for fleet feature 04 in brewboard. The investigation traced it to
`feature-eval --setup-only` returning early *before* reaching the
workflow-core state-transition code (a misplaced `return` that has existed
since 2026-03-19, commit `0542cccc`). The bug was latent for 17 days and
became observable only when commit `14335af5` (2026-04-03) removed
`feature-autopilot` — the one call path that happened to emit
`feature.eval_requested` synchronously because it ran inside a tmux session
and bypassed the broken early-return.

A point-fix landed the same day (`feature-eval --setup-only` now actually
does the state transition; `feature-autonomous-start __run-loop` calls it
before spawning the eval tmux session; a regression test in
`tests/integration/lifecycle.test.js` guards Pattern A — synchronous
state-transition-before-spawn).

This research is about the **class** of bug, not the specific instance.
The point-fix is a band-aid; the underlying shape of the signalling layer
makes recurrence very likely. The investigation surfaced six different
entry points that can drive a feature into "evaluating", each with a
slightly different ordering of state change vs side effect, plus ten
different filesystem locations the dashboard reconciles to render a single
feature card. The next refactor that touches `dashboard-server.js`,
`feature.js`, or the autonomous conductor has a non-zero chance of
reintroducing a sibling bug.

This research evaluates how to make the signalling layer structurally
robust so the bug class can't recur — and recommends a phased path that
preserves the parts of the architecture that already work well.

## Questions to Answer

- [ ] What is the **class** of bug, expressed in architectural terms? (Not
      "this one return statement was misplaced" but "what shape of code
      allows that mistake to be invisible for 17 days?")
- [ ] How many entry points currently exist for the same workflow
      transition (eval, review, implementation, close), and how do they
      differ in ordering?
- [ ] How many separate filesystem signal sources does the dashboard
      reconcile per feature card today, and which of them can drift?
- [ ] Which option (A–G below) gives the best ratio of bug-class-killed to
      refactor-cost, given that aigon is heading toward a public launch and
      the engine core is already well-shaped?
- [ ] Is there a phased path that lets us land the highest-value fix first
      without a big-bang refactor?
- [ ] What is the cost of doing nothing structural and relying solely on
      regression tests?

## Scope

### In Scope
- The signalling layer between workflow-core (events + effects) and the
  rest of the system (CLI, dashboard server, AutoConductor, agent shells,
  spec folders, tmux sessions)
- Read-side reconciliation in `lib/workflow-read-model.js` and
  `lib/dashboard-status-collector.js`
- Write-side fan-out: every place that calls `createDetachedTmuxSession`,
  every place that mutates `.aigon/state/*.json`, every place that touches
  spec folders directly
- The action-registry pattern in `lib/feature-workflow-rules.js` (existing
  consolidation surface that could be extended)
- Correlation/causal-chain debuggability across event log, effects, and
  external side effects

### Out of Scope
- Pro features (`@aigon/pro`) — Pro is a plugin and reads through the
  same engine; whatever shape we pick here, Pro will follow
- Replacing the workflow-core engine itself (it works; this research is
  about expanding its responsibility, not replacing it)
- Multi-machine / distributed concerns — aigon is single-host, single-user
- Telemetry pipeline (`lib/telemetry.js`) — separate concern
- Security gate / merge gate (`lib/security.js`) — separate concern

## Findings

### What the bug actually revealed

The observable bug was "dashboard Open Eval doesn't emit
`feature.eval_requested` synchronously". The **class of bug** it belongs
to is:

> *Multiple client paths reimplement the same workflow transition with
> slightly different ordering of state-change vs side-effect, and drift
> from each other over time.*

Concrete evidence the class is already alive in the codebase:

**Six entry points can currently push a feature into "evaluating":**

1. `aigon feature-eval <id>` from a user shell (not in tmux) → spawns
   agent → agent calls `--no-launch` from inside tmux → engine transitions
2. `aigon feature-eval <id> --no-launch` from inside tmux → engine
   transitions
3. `aigon feature-eval <id> --setup-only` from dashboard server → was
   broken until 2026-04-06
4. `aigon feature-eval <id> --force` from old `feature-autopilot` →
   engine transitions because autopilot ran inside tmux
5. Dashboard "Open Eval" button → `handleLaunchEval()` spawns tmux
   directly → relies on agent inside to eventually call path 2
6. `feature-autonomous-start __run-loop` →
   `createDetachedTmuxSession` directly → relies on agent inside to
   eventually call path 2

Each path has a different mental model of what "start evaluation" means:
transition state, spawn agent, move spec, write eval stub, update folder,
touch heartbeat, write agent status file, emit telemetry. Every path
picks a different subset and ordering of these.

The bug was latent for 17 days. It became observable only when
`14335af5` removed `feature-autopilot`, eliminating the one path that
happened to get the ordering right. **When a workflow rule depends on
which caller you came through, you have a leaky abstraction, and the next
refactor will regress it again.**

### The architectural smell

Aigon has an elegant core:

- `lib/workflow-core/engine.js` — event-sourced state with XState guards
- `lib/workflow-core/effects.js` — durable outbox for side effects
  (move_spec, write_eval_stub, write_close_note)
- `lib/workflow-core/projector.js` — derives snapshots from events
- Exclusive file locking, idempotent replay, strongly-typed lifecycle

But this core is **surrounded by hand-rolled client code that works
around it rather than through it:**

| Should be an engine effect | Is currently hand-rolled |
|---|---|
| Spawn eval agent tmux session | `handleLaunchEval()`, `__run-loop`, `buildAgentCommand()` in 3+ places |
| Spawn impl agent tmux session | `handleLaunchImplementation()`, `ensureAgentSessions()`, worktree setup |
| Spawn review agent tmux session | `handleLaunchReview()`, review-state writers |
| Kill agent sessions | `gracefullyCloseEntitySessions()`, `sessions-close` |
| Record agent status | `agent-status` CLI + shell trap + heartbeat sidecar |

None of these are engine effects. They're side-effects that happen
*beside* the engine, not *through* it. The engine has no idea they
happened. The dashboard reads a mix of engine state, tmux presence,
heartbeat files, and spec folder structure — and the bug is the gap
between those sources.

The "reads from N sources, writes to N sources, hopes they agree" pattern
is the fundamental fragility.

### Inventory of signalling mechanisms today

Ten different places the system can change state that affects the
dashboard:

1. `.aigon/workflows/features/{id}/events.jsonl` append (engine events)
2. `.aigon/workflows/features/{id}/snapshot.json` rewrite (engine
   projection)
3. `.aigon/state/feature-{id}-{agent}.json` write (per-agent legacy
   status)
4. `.aigon/state/heartbeat-{id}-{agent}` touch (liveness)
5. `.aigon/workflows/features/{id}/review-state.json` write
6. Spec folder moves (`02-backlog` → `03-in-progress` →
   `04-in-evaluation` → `05-done`)
7. Tmux session creation/destruction
8. Shell trap `EXIT` handlers that fire `aigon agent-status`
9. Log files in `docs/specs/features/logs/`
10. Eval files in `docs/specs/features/evaluations/`

Every dashboard read has to reconcile these. `lib/workflow-read-model.js`
is literally 300+ lines of reconciliation code that papers over the
divergences. This isn't bad code — it's a direct consequence of growing
the system feature by feature without a consolidation step.

### Options evaluated

#### Option A — Leave as is, lean on tests
- **Cost:** ~1–2 days. Add regression tests for every known entry-point
  combination. Ongoing: every new flow needs its own test.
- **Payoff:** Catches the same class of bug if you remember to write the
  test.
- **Risk:** High. The next refactor (or a new agent editing the code)
  bypasses the tests by adding a 7th entry point that nobody thought to
  test. Aigon is growing at ~50 features/month; the pattern will recur.
- **When to pick:** If aigon is about to freeze and not change for
  months. It isn't.

#### Option B — Single "intent" function, all callers converge
- **The move:** Extract one function
  `requestEvaluation(repoPath, featureId, { spawn, evalAgent? })` that
  does validate → engine transition → optional engine-tracked tmux
  spawn → return. Delete `--setup-only`, `--no-launch`, `--force` in
  their current shape. Every caller (dashboard handler, AutoConductor,
  CLI) calls this one function.
- **Cost:** ~2–3 days. Touches `feature.js`, `dashboard-server.js`,
  `feature-autonomous-start`, dashboard JS.
- **Payoff:** Kills the class for eval specifically. Simple mental
  model: one function, one transition.
- **Risk:** Low. Small surface area.
- **Downside:** Doesn't generalize. `requestReview()`,
  `requestImplementation()`, etc. each need their own consolidation.
  N rounds of this refactor.

#### Option C — First-class `spawn_agent_session` effect (recommended)
- **The move:** Add new effect type `spawn_agent_session` to
  `lib/workflow-core/effects.js`. When a workflow transitions, the
  engine emits both the existing effects (`eval.move_spec`,
  `eval.write_eval_stub`) and a new
  `eval.spawn_agent_session` effect. The effect runner (which already
  has durable outbox, exclusive locking, idempotent replay, exponential
  backoff) handles spawning. Dashboard/AutoConductor stop calling
  `createDetachedTmuxSession` directly — they call
  `wf.requestFeatureEval()`.
- **Cost:** ~1 week. Touches the effect system, removes hand-rolled
  spawning from 5–6 places.
- **Payoff:** *Huge.* Spawning becomes recoverable (server crash
  mid-spawn → effect retries on next poll). Agents become observable
  via events. The engine becomes the single authoritative place where
  state + side effects coordinate. **This is exactly what the engine was
  designed for — spawn sessions are just another side effect.**
- **Risk:** Medium. Subprocess spawning has historically been harder to
  make idempotent than file ops. Needs "has this tmux session already
  been spawned for this effect?" deduplication via effect ID.
- **Downside:** The effect runner currently runs inline during CLI
  commands — would need a background worker for server-side automatic
  spawn retry. That worker could be `aigon server`'s supervisor.

#### Option D — Event-sourced UI (CQRS separation)
- **The move:** Dashboard reads *only* from the event log / snapshot.
  Tmux presence, agent status files, heartbeat files — none read
  directly. The supervisor loop translates external state into events
  (`agent.tmux_started`, `agent.tmux_ended`, `agent.heartbeat_expired`)
  that flow through the engine. The dashboard becomes a projection of
  the event log, full stop.
- **Cost:** ~2 weeks. Big shift. Requires rewriting
  `lib/workflow-read-model.js` and `lib/dashboard-status-collector.js`.
- **Payoff:** *Massive long-term.* No more drift. No more "the
  dashboard shows stale because X". Debugging becomes event-log
  reading. Replay becomes trivial. Time-travel debugging for free.
- **Risk:** High in execution time, low in final outcome. You're
  essentially completing the CQRS pattern the engine half-implements.
- **Downside:** Events become chatty (heartbeats every 30s). Need event
  compaction or a "hot signal" channel that bypasses the log for
  high-frequency data.

#### Option E — Typed action registry with executors
- **The move:** `lib/feature-workflow-rules.js` already has an action
  table. Extend each entry with an `executor(context)` function that
  performs the action atomically. Register executors once, call them
  from everywhere. Dashboard action dispatcher becomes
  `executors[action.kind](ctx)`.
- **Cost:** ~3–4 days. Builds on existing structure.
- **Payoff:** Consolidates action dispatch. One place to audit "what
  happens when feature-eval fires". Covers every action, not just eval.
- **Risk:** Low. Incremental — migrate one action at a time.
- **Downside:** Doesn't fix the state-vs-side-effect split by itself.
  It just consolidates where the split happens. Works well *combined*
  with Option C.

#### Option F — Correlation IDs on every intent
- **The move:** Every workflow-changing call gets a UUID. The UUID
  propagates through events, effects, agent-status files, tmux session
  names, log files. Debugging becomes
  `grep <uuid> .aigon/workflows/**/*.jsonl`.
- **Cost:** ~2 days.
- **Payoff:** Doesn't fix bugs, but makes diagnosing them 10× faster.
  The "pinpoint when was the bug introduced" exercise on 2026-04-06
  took ~40 tool calls; with correlation IDs it would have been
  `grep`.
- **Risk:** Very low.
- **Downside:** Orthogonal to the main bug class. Worth doing
  regardless of which structural option ships.

#### Option G — Contract test for entry points
- **The move:** A single test that enumerates every *public* entry
  point capable of starting an evaluation and asserts each one ends
  with `snapshot.lifecycle === 'evaluating'` and
  `feature.eval_requested` in the event log. Same pattern for review,
  implementation, close.
- **Cost:** ~1 day.
- **Payoff:** Catches the same bug class for all entry points
  simultaneously, not just one. The regression test that landed today
  catches one entry point; this generalizes the pattern.
- **Risk:** Very low.
- **Downside:** Only catches *known* entry points. New entry points
  added later need to be added to the test enumeration.

## Recommendation

The core engine is good. It just needs its responsibility expanded so
clients can't easily work around it. Phased path:

### Phase 1 (now, ~2 days) — stop the bleeding
Build on what's already shipped (point-fix + single regression test).
- **Add Option F:** Correlation IDs. Cheap, immediately useful for the
  next investigation. Touches ~100 lines.
- **Add Option G:** Contract test enumerating every entry point capable
  of starting an evaluation, review, implementation, close. Would have
  caught the bug for all 6 eval entry points, not just one. ~1 day.

### Phase 2 (1–2 weeks) — promote tmux spawning to an engine effect
**Option C is the recommended structural fix.** Highest ratio of bug
class killed to refactor cost. Builds on the best part of the codebase
(the effect outbox) instead of around it.
- Add `spawn_agent_session` effect type with payload
  `{ sessionName, cwd, command, role, agentId }`.
- Refactor `handleLaunchEval`, `handleLaunchReview`,
  `handleLaunchImplementation`, and AutoConductor's `__run-loop` to
  emit events instead of calling `createDetachedTmuxSession` directly.
- Effect runner runs `createDetachedTmuxSession` once, with effect ID
  deduplication.
- Benefit compounds: crash-recovery for spawns, visibility of spawn
  attempts in the event log, single source of truth for "is this agent
  running". Kills the bug class for all 3 roles (do/eval/review)
  simultaneously.

### Phase 3 (separate, optional, 1–2 weeks) — CQRS cleanup
**Option D.** Once tmux spawning is an effect, convert the other 4–5
reads (agent status files, heartbeat files, spec folder scans,
review-state files) into events fed to the engine via a supervisor
translator. Dashboard read model becomes a pure projection — no
filesystem reads except the snapshot. This is the endgame. Can be
deferred 1–3 months without harm, but worth doing before commercial
launch hardens because users will see more edge cases.

### Phase 4 (eventually, small ongoing) — Option E consolidation
Typed executors in the action registry. Works best *after* Phase 2
because it can reference the effect types directly.

### What "leave as is" looks like
If we want to punt on structural refactoring and accept the class of
bug recurring every few weeks:
- **Do:** Phase 1 only (correlation IDs + contract test).
- **Skip:** Phases 2–4.
- **Expect:** Every refactor that touches `dashboard-server.js`,
  `feature.js`, or the AutoConductor has a non-zero chance of
  reintroducing a "5th caller forgot step 3" bug. The contract test
  catches them. Each costs a day to fix.
- **When fine:** Aigon is in maintenance mode. It isn't — Pro is
  coming, autonomous workflows are expanding, new agents being added.
  Leaving as-is bets the test suite catches what the architecture
  doesn't, which works until it doesn't.

### Honest answer to "might we regress again"
**Yes, almost certainly, and soon.** Not the specific `--setup-only`
bug (the test catches that), but the *shape* of it: a new caller, a new
flag combination, a new async boundary, and the state-vs-side-effect
pair drifts apart. The fix that landed today is a fine band-aid, but
the issue is that `createDetachedTmuxSession` is callable from 6
places, and nothing forces any of them to also transition state.

**Best long-term investment is Phase 2 (Option C):** make tmux
spawning an engine effect. Medium cost, high payoff, builds on the
best part of the codebase. Everything else is polish.

## Output

Based on the recommendation above, the expected feature breakdown is:

- [ ] Feature: **signalling-layer-phase-1-correlation-ids-and-contract-test**
      — adds correlation IDs to every workflow-changing call and a contract
      test that enumerates every public entry point for eval/review/
      implement/close. Cheap, immediately useful, lands the safety net
      before any structural work. (Phase 1, ~2 days)

- [ ] Feature: **signalling-layer-phase-2-spawn-agent-session-effect**
      — promotes tmux spawning to a first-class workflow-core effect
      (`spawn_agent_session`). Removes hand-rolled
      `createDetachedTmuxSession` calls from `handleLaunchEval`,
      `handleLaunchReview`, `handleLaunchImplementation`, and the
      AutoConductor `__run-loop`. Closes the bug class structurally.
      (Phase 2, ~1 week)

- [ ] Feature: **signalling-layer-phase-3-cqrs-supervisor-translator**
      *(optional)* — converts external state sources (agent status files,
      heartbeat files, spec folder scans, review-state files) into engine
      events via a supervisor translator. Dashboard read model becomes a
      pure projection with no filesystem reads except the snapshot.
      Endgame; defer until after Phase 2 stabilises. (Phase 3, ~1–2 weeks)

- [ ] Feature: **signalling-layer-phase-4-action-registry-executors**
      *(optional)* — extends `lib/feature-workflow-rules.js` action table
      with `executor(context)` functions so dashboard, CLI, and conductor
      all dispatch through the same code path. Best done after Phase 2
      because executors reference effect types. (Phase 4, ~3–4 days)

Phases 1 and 2 are the minimum to consider this research closed. Phases
3 and 4 are quality-of-life and can be picked up later when the surface
area justifies them.
