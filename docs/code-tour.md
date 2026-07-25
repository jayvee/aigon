# Code Tour — How Aigon Actually Works

A guided reading of ~22 real excerpts from this codebase, in the order the machinery
actually runs. Every code block is **verbatim** from the file named above it, with a
`path:line` anchor so you can jump to it. Commentary above each block explains what it
does, what pattern it demonstrates, and why it is shaped that way.

This document is for **understanding what Aigon does** — the domain logic, not a style
guide. Read top to bottom the first time; after that, use the table of contents.

> **Freshness:** excerpts drift as code changes. Line numbers are the first thing to rot.
> When you find a mismatch, fix it (see [Maintaining this document](#maintaining-this-document)).
> Last verified against `main` @ `9a0e89987` (2026-07-25).

---

## The one-paragraph version

Aigon is a spec-driven multi-agent harness. A unit of work (a **feature** or a **research
topic**) is a markdown spec plus an **append-only event log**. The log is folded into a
**context object** by a projector, and that context is fed into an **XState machine** that
decides which transitions are legal. Nothing in the system reads "what state is this
feature in?" from the filesystem — folders are a *generated view* of engine state, never
the source of it. Agents (Claude Code, Codex, Cursor…) run in git worktrees inside tmux
sessions, write heartbeat status files, and the dashboard renders a **server-computed UI
contract** — the browser never decides what a card is allowed to do.

Almost every design decision below follows from one rule: **there is exactly one place a
lifecycle decision is made, and it is the engine.**

---

## Contents

**Part 0 — Getting in the door**
1. [The CLI is a dispatch shim](#1-the-cli-is-a-dispatch-shim)
2. [The `ctx` pattern](#2-the-ctx-pattern)

**Part 1 — The engine**
3. [The lifecycle is a data table](#3-the-lifecycle-is-a-data-table)
4. [Compiling the table into a state machine](#4-compiling-the-table-into-a-state-machine)
5. [The event log](#5-the-event-log)
6. [The projector: events → context](#6-the-projector-events--context)
7. [The write path (the most important function in the repo)](#7-the-write-path-the-most-important-function-in-the-repo)
8. [Effects: how state changes touch the world](#8-effects-how-state-changes-touch-the-world)
9. [Available actions come from `snapshot.can()`](#9-available-actions-come-from-snapshotcan)
10. [Engine-first, folder-fallback](#10-engine-first-folder-fallback)

**Part 2 — Identity and storage**
11. [Reserve the ID before you write the file](#11-reserve-the-id-before-you-write-the-file)
12. [The SpecStore interface](#12-the-specstore-interface)
13. [Content-addressed event merge](#13-content-addressed-event-merge)
14. [Stage folders are a symlink projection](#14-stage-folders-are-a-symlink-projection)

**Part 3 — Agents and sessions**
15. [Session names are the join key](#15-session-names-are-the-join-key)
16. [One place resolves model + effort](#16-one-place-resolves-model--effort)
17. [The heartbeat](#17-the-heartbeat)
18. [The idle ladder](#18-the-idle-ladder)

**Part 4 — Orchestration**
19. [Topological order for feature sets](#19-topological-order-for-feature-sets)
20. [Close readiness is a blocker list](#20-close-readiness-is-a-blocker-list)

**Part 5 — The read side**
21. [Degrading loudly when state is missing](#21-degrading-loudly-when-state-is-missing)
22. [Server-owned UI contracts](#22-server-owned-ui-contracts)
23. [Fingerprint → version → ETag](#23-fingerprint--version--etag)
24. [Optimistic UI as overlays, never mutation](#24-optimistic-ui-as-overlays-never-mutation)

**Part 6 — Installing into other repos**
25. [Template rendering and the zero-opinion rule](#25-template-rendering-and-the-zero-opinion-rule)

---

# Part 0 — Getting in the door

## 1. The CLI is a dispatch shim

**`aigon-cli.js:81`**

Every `aigon <command>` you type lands here. The file is deliberately thin: it builds one
flat object mapping command name → handler function by spreading fifteen domain factories
together, then looks up `argv[2]` in it. There is no routing logic, no argument parsing,
no business rules — those live in `lib/commands/*.js`.

```js
const commands = {
    ...createFeatureCommands(),
    ...createResearchCommands(),
    ...createFeedbackCommands(),
    ...createSetupCommands(),
    ...createInfraCommands(),
    ...createMiscCommands(),
    ...createWorkflowCommands(),
    ...createSetCommands(),
    ...createRecurringCommands(),
    ...createScheduleCommands(),
    ...createAgentLaunchCommands(),
    ...createAgentCommands(),
    ...createSignalHealthCommands(),
    ...createSecurityScanCommands(),
    ...createProCommands(),
};

const args = process.argv.slice(2);
const commandName = args[0];
const commandArgs = args.slice(1);
const cleanCommand = commandName ? commandName.replace(/^aigon-/, '') : null;
const resolvedCommand = cleanCommand ? (COMMAND_ALIASES[cleanCommand] || cleanCommand) : cleanCommand;
```

**The pattern:** *flat command registry*. Adding a command is adding a key to an object
in a domain file — no registration ceremony, no switch statement to extend. The
`COMMAND_ALIASES` indirection is what lets `afc` and `feature-create` be the same thing.

One detail worth noting — the requires at the top of this file are wrapped in a
`try/catch` that reformats module-load failures (`aigon-cli.js:12`). A merge conflict or
syntax error in any `lib/*.js` would otherwise surface as an opaque
`Unexpected token '<<'` toast in the dashboard. Instead you get the offending file path
and a grep command. That is a small thing that has paid for itself.

---

## 2. The `ctx` pattern

**`lib/commands/shared.js:101`** and **`lib/commands/feature.js:216`**

Command modules do not `require()` their collaborators at call time. They are *factories*
that receive a `ctx` object holding every shared dependency, and return the handler map.

```js
function buildCtx(overrides = {}) {
    return {
        utils: { ...utils, ...overrides },
        hooks: { ...hooksLib, ...overrides },
        version: { ...versionLib, ...overrides },
        specCrud: { ...specCrud, ...overrides },
        git: { ...git, ...overrides },
        board: { ...board, ...overrides },
        feedback: { ...feedbackLib, ...overrides },
        validation: { ...validation, ...overrides },
    };
}

function createAllCommands(overrides = {}) {
    if (_cachedCommands && Object.keys(overrides).length === 0) return _cachedCommands;

    const ctx = buildCtx(overrides);

    const commands = {
        ...feedbackCommands(ctx),
        ...researchCommands(ctx),
        ...featureCommands(ctx),
        // …
    };
```

And the consuming side destructures once at the top of the factory:

```js
module.exports = function featureCommands(ctx) {
    const u = ctx.utils;
    const v = ctx.validation;
    const gitLib = ctx.git;
    const hooksLib = ctx.hooks;
    const sc = ctx.specCrud;
    const def = entity.FEATURE_DEF;
```

**The pattern:** *constructor injection without a DI framework*. `overrides` is spread
over every namespace, so a test can pass `{ getCurrentBranch: () => 'feature/42' }` and
every module that reads `ctx.git.getCurrentBranch` sees the fake — no `jest.mock`, no
global patching, no module-cache surgery. The `_cachedCommands` memo only applies when
there are no overrides, so production pays the build cost once and tests always get a
fresh graph.

This is why `AGENTS.md` insists new handlers preserve ctx-injection: a handler that
`require()`s `../git` directly is invisible to the override mechanism and silently
untestable.

---

# Part 1 — The engine

Everything in this part lives under `lib/workflow-core/`. This is the heart of Aigon.

## 3. The lifecycle is a data table

**`lib/feature-workflow-rules.js:53`**

The set of legal feature states and the transitions between them is not code — it is a
frozen object. Each key is a state; each entry is `{ event, to, guard?, effect? }`.

```js
const FEATURE_ENGINE_STATES = Object.freeze({
    hydrating: [
        { event: 'hydrate', to: 'done', guard: 'isDone' },
        { event: 'hydrate', to: 'ready_for_review', guard: 'isReadyForReview' },
        { event: 'hydrate', to: 'evaluating', guard: 'isEvaluating' },
        { event: 'hydrate', to: 'closing', guard: 'isClosing' },
        // …
        { event: 'hydrate', to: 'implementing', guard: 'default' },
    ],
    inbox: [
        { event: 'feature.spec_review.started', to: 'spec_review_in_progress', effect: 'captureSpecReviewReturnLifecycle' },
        { event: 'feature.spec_revision.started', to: 'spec_revision_in_progress', effect: 'captureSpecReviewReturnLifecycle' },
        { event: 'feature.pause', to: 'paused' },
    ],
    backlog: [
        { event: 'feature.spec_review.started', to: 'spec_review_in_progress', effect: 'captureSpecReviewReturnLifecycle' },
        { event: 'feature.spec_revision.started', to: 'spec_revision_in_progress', effect: 'captureSpecReviewReturnLifecycle' },
        { event: 'feature.pause', to: 'paused' },
    ],
    // …
    implementing: [
        { event: 'feature.pause', to: 'paused' },
        { event: 'feature.eval', to: 'evaluating', guard: 'allAgentsReady' },
        { event: 'feature.code_review.started', to: 'code_review_in_progress', guard: 'soloAllReady', effect: 'markCodeReviewStarted' },
        { event: 'feature.close', to: 'closing', guard: 'soloAllReady', effect: 'autoSelectWinner' },
        { event: 'feature.close_recovery.started', to: 'close_recovery_in_progress' },
        { event: 'restart-agent', to: 'implementing', guard: 'agentRecoverable', effect: 'markRestarted' },
        { event: 'force-agent-ready', to: 'implementing', guard: 'agentRecoverable', effect: 'markReady' },
        { event: 'drop-agent', to: 'implementing', guard: 'agentDroppable', effect: 'markDropped' },
        { event: 'needs-attention', to: 'implementing', guard: 'agentNeedsAttention', effect: 'markNeedsAttention' },
    ],
    paused: [
        { event: 'feature.resume', to: 'implementing' },
    ],
    // …
});
```

`hydrating` is the entry state: given a context loaded from disk, the machine runs the
guard list top-to-bottom and lands in the right resting state. This is how a process that
just started reconstitutes a feature's position without a stored "current state" string
being authoritative.

**The pattern:** *declarative state table*. Because the lifecycle is data, three different
consumers can read the *same* definition — the state machine (§4), the action deriver
(§9), and the workflow-diagram generator in `docs/generated/`. A transition that exists in
one but not the others is impossible by construction.

**Reading a diff here:** any change to this table changes what the dashboard offers,
what the CLI permits, and what the generated diagrams say — all at once. That is the
intended blast radius.

---

## 4. Compiling the table into a state machine

**`lib/workflow-core/machine.js:241`**

`buildStateConfig` turns each row of the table above into an XState state node. Most states
become a plain `on: { EVENT: {...} }` map. A few are special.

```js
function buildStateConfig(stateName, transitions, transientStates) {
  if (stateName === 'done') {
    return { type: 'final' };
  }

  if (stateName === 'hydrating') {
    return {
      always: transitions.map((transition) => ({
        target: transition.to,
        ...(transition.guard && transition.guard !== 'default' ? { guard: transition.guard } : {}),
      })),
    };
  }

  if (stateName === 'code_review_complete') {
    return {
      always: [
        { target: 'ready', guard: 'codeReviewDoesNotRequestRevision' },
        { target: 'code_revision_in_progress' },
      ],
    };
  }

  // …

  // Transient *_complete states: immediately re-route back to `backlog` via
  // an `always:` transition. The machine never observes these as resting
  // states; applyTransition returns the post-always value as currentSpecState.
  if (transientStates && transientStates.has(stateName)) {
    return { always: [{ target: 'backlog' }] };
  }

  const on = {};
  transitions.forEach((transition) => {
    const entry = {
      ...(transition.to ? { target: transition.to } : {}),
      ...(transition.guard ? { guard: transition.guard } : {}),
      ...(transition.effect ? { actions: transition.effect } : {}),
    };
    const ev = transition.event;
    if (Object.prototype.hasOwnProperty.call(on, ev)) {
      const prev = on[ev];
      on[ev] = Array.isArray(prev) ? [...prev, entry] : [prev, entry];
    } else {
      on[ev] = entry;
    }
  });
  return { on };
}

function createWorkflowMachine(entityType = 'feature') {
  const states = getEngineStateRules(entityType);
  const transientStates = getTransientStates(entityType);
  return machineSetup.createMachine({
    id: entityType,
    initial: 'hydrating',
    context: ({ input }) => input,
    states: Object.fromEntries(
      Object.entries(states).map(([stateName, transitions]) => [
        stateName,
        buildStateConfig(stateName, transitions, transientStates),
      ]),
    ),
  });
}
```

**Two ideas worth internalising:**

*Transient states.* `code_review_complete` is not somewhere a feature *sits* — it is a
decision point. XState's `always:` (eventless) transitions fire the instant the state is
entered, so the machine passes through it and settles on `ready` or
`code_revision_in_progress`. Callers never see the intermediate value. This is how
"review finished — now what?" branching stays in the machine instead of leaking into
whichever command happened to record the review.

*One machine definition, two entity types.* Features and research topics have different
tables but identical compilation. `createWorkflowMachine('research')` produces a machine
that speaks `research.*` events. Everything downstream — the projector, the action
deriver, the read model — is written against "entity", not "feature".

The guards and effects referenced by name in the table are defined in `machineSetup`
above this function (`lib/workflow-core/machine.js:21`), as XState `guards` and `actions`.

---

## 5. The event log

**`lib/workflow-core/event-store.js:17`**

The entire persistence primitive for lifecycle state. Two functions, JSONL, no database.

```js
async function readEvents(eventsPath) {
  try {
    const content = await fs.readFile(eventsPath, 'utf8');
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function appendEvent(eventsPath, event) {
  await fs.mkdir(path.dirname(eventsPath), { recursive: true });
  await fs.appendFile(eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
}
```

**The pattern:** *append-only log as the source of truth*. Missing file ≡ empty history —
a feature that has never had an event is indistinguishable from one whose log was never
created, which is exactly right. Nothing ever rewrites a line. Every state you can observe
is derivable by replaying from the top.

The consequence, which shows up everywhere else: **to change what a feature's state is,
you append an event.** There is no `setState`. If you find code writing `snapshot.json`
directly outside `applyEventsUnlocked` (§7), that is a bug.

---

## 6. The projector: events → context

**`lib/workflow-core/projector.js:134`**

`projectContext` folds the event array into a single `FeatureContext` object. This is the
only place that knows what each event *means*.

```js
function projectContext(events) {
  let context = null;
  let lifecycle = 'backlog';

  for (const event of events) {
    const isResearch = event.type.startsWith('research.');
    const entityType = isResearch ? 'research' : 'feature';

    switch (event.type) {
      case 'feature.bootstrapped':
      case 'research.bootstrapped': {
        // Bootstrapped from pre-engine state — initialise context from the event's lifecycle
        lifecycle = event.lifecycle || event.stage || 'backlog';
        const bootAuthor = mergeSpecAuthorFromEvent(context, event);
        context = {
          featureId: event.featureId || event.researchId,
          entityType,
          mode: event.mode || null,
          authorAgentId: bootAuthor.authorAgentId,
          specAuthor: bootAuthor.specAuthor,
          agents: createAgents(event.agents || [], {
            modelOverrides: event.modelOverrides,
            effortOverrides: event.effortOverrides,
          }),
          winnerAgentId: null,
          effects: [],
          // …
          createdAt: event.at,
          updatedAt: event.at,
        };
        break;
      }
```

The `feature.reset` case carries a comment that is worth reading in full, because it
explains the whole architecture in one paragraph:

```js
      case 'feature.reset':
      case 'research.reset': {
        // Merge-safe return to "never started". A reset re-seeds the context to
        // a fresh backlog state, discarding agents/effects/review state while
        // preserving identity and spec-author provenance. Replayed after
        // `*.started` it wins, and because it unions by id like every other
        // event it converges on every clone the log syncs to. The old reset
        // path only wiped the local `.aigon/workflows` dir, which never reached
        // the git-branch canonical log — so the next `storage sync` re-projected
        // `feature.started` and the feature snapped back to in-progress.
        lifecycle = 'backlog';
```

**The pattern:** *event sourcing with merge-safe semantics*. "Undo" is not deletion — it is
a new event that supersedes. This matters because event logs sync across machines via git
(§13); an operation implemented as "delete the local state directory" is invisible to
every other clone and gets silently reverted on the next sync. That bug is *why* the reset
event exists.

---

## 7. The write path (the most important function in the repo)

**`lib/workflow-core/engine.js:1117`**

If you read one function in Aigon, read this one. Every lifecycle mutation funnels through
it: append event → re-project → apply transition → run effects → write snapshot → refresh
the folder view.

```js
async function applyEventsUnlocked(repoPath, featureId, newEvents) {
  const store = getSpecStore(repoPath);
  const ref = entityRef('feature', featureId);
  const previousEvents = await store.readEvents(ref);
  const previous =
    previousEvents.length === 0 ? null : await loadFeatureContextFromEvents(repoPath, featureId, previousEvents);

  let next = previous;
  let priorForEffects = previous;

  const seenEvents = [...previousEvents];
  for (const event of newEvents) {
    if (event.type === 'feature.started' || event.type === 'feature.bootstrapped' || event.type === 'feature.reset') {
      // These events fully (re)seed the context via the projector — applyTransition's
      // xstate path can't recreate the agents map from an event payload, and has no
      // transition back to backlog for a reset.
      seenEvents.push(event);
      next = await loadFeatureContextFromEvents(repoPath, featureId, seenEvents);
    } else {
      seenEvents.push(event);
      next = applyTransition(requireContext(next, featureId), event);
      next = materializePendingEffects(repoPath, materializeContext(repoPath, next));
    }

    await store.appendEvent(ref, event);
    const immediateEffects = buildEffects(repoPath, priorForEffects, requireContext(next, featureId), event);
    await runEffects(repoPath, featureId, immediateEffects);
    priorForEffects = requireContext(next, featureId);
  }

  const snapshot = snapshotFromContext(requireContext(next, featureId), previousEvents.length + newEvents.length);
  await store.writeSnapshot(ref, snapshot);
  await syncSpecStoreAfterWrite(store);
  specLifecycle.refreshLifecycleView(repoPath, { warn: console.warn });
  return showFeature(repoPath, featureId);
}
```

And the locked public wrapper right below it:

```js
async function persistEvents(repoPath, featureId, newEvents) {
  const store = getSpecStore(repoPath);
  const ref = entityRef('feature', featureId);
  await syncBeforeWrite(repoPath, ref);
  return store.lock(ref, async () => applyEventsUnlocked(repoPath, featureId, newEvents));
}
```

**Read the sequence carefully — every step is load-bearing:**

- **Two paths, deliberately.** Seeding events (`started` / `bootstrapped` / `reset`) go
  through the *projector*, because they construct a context from an event payload — the
  state machine has no transition that can invent an agents map. Everything else goes
  through `applyTransition`, which enforces machine legality (`snapshot.can(...)` or throw).
- **Snapshot is a derived cache.** `snapshotFromContext(..., eventCount)` writes the fold
  result plus the event count it was computed from. It exists so read paths (dashboard,
  CLI listing) don't replay the log on every poll — not because it is authoritative.
- **Effects run between events, not at the end.** `buildEffects(previous, next, event)`
  diffs the two contexts to decide what has to happen in the world (move a spec, create a
  directory). Running them inside the loop means a two-event batch sees consistent
  intermediate state.
- **`refreshLifecycleView` closes the loop.** Engine state changed, so the visible folder
  symlinks are regenerated to match (§14). The view follows state, never the reverse.
- **The lock and the pre-sync are the wrapper's job.** `syncBeforeWrite` pulls remote
  events before we compute anything; `store.lock` serialises concurrent writers.
  `applyEventsUnlocked` is exported separately only for callers that already hold the lock.

**This is the "write-path contract" `AGENTS.md` keeps referring to:** *every write path
must produce the state its read path assumes*. Bypassing this function — writing a
snapshot, moving a spec file, or nudging a folder by hand — produces state the read side
was never designed to see.

---

## 8. Effects: how state changes touch the world

**`lib/workflow-core/effects.js:34`**

State transitions are pure. Anything that touches the filesystem is an **effect** — a
serialisable request the engine emits and an executor performs.

```js
async function runEffects(repoPath, featureId, effects, executeEffect = runFeatureEffect) {
  for (const effect of effects) {
    await executeEffect(repoPath, featureId, effect);
  }
}
```

```js
async function runFeatureEffect(repoPath, featureId, effect) {
  if (effect.type === 'ensure_feature_layout') {
    const lifecycle = effect.payload.lifecycle;
    const specDir = getSpecStateDir(repoPath, lifecycle);
    await fs.mkdir(specDir, { recursive: true });
    return;
  }

  if (effect.type === 'move_spec') {
    if (!specLifecycle.shouldMoveSpecFiles(repoPath)) {
      specLifecycle.refreshLifecycleView(repoPath, { warn: console.warn });
      return;
    }
    const entityType = effect.payload && effect.payload.entityType === 'research' ? 'research' : 'feature';
    const resolved = resolveMoveSpecPayload(repoPath, entityType, featureId, effect.payload || {}, {
      snapshot: effect.payload && effect.payload.snapshot,
    });
    const fromPath = resolved.fromPath;
    const toPath = resolved.toPath;
    if (!fromPath || !toPath) {
      throw new Error(`move_spec could not resolve paths for ${entityType} ${featureId}`);
    }
    await fs.mkdir(path.dirname(toPath), { recursive: true });
    const sourceExists = await pathExists(fromPath);
    const targetExists = await pathExists(toPath);
    if (targetExists && !sourceExists) {
      return;
    }
    if (sourceExists) {
      await fs.rename(fromPath, toPath);
    }
    return;
  }
```

**The pattern:** *effects as data + injectable executor*. `runEffects` takes the executor
as a default parameter, so tests pass a recorder and assert on the effect *requests*
without touching a disk. The `executeEffect` seam is also how `lib/commands/feature.js`
supplies a richer executor for commands that need to do more than the core knows about.

**Note the idempotency guard in `move_spec`.** Target exists and source doesn't → the move
already happened, return quietly. Replaying an event log must not fail on work already
done. And the `shouldMoveSpecFiles` check at the top is the **stable spec layout** switch:
under the newer layout, specs never move — the effect degrades to refreshing the symlink
view instead (§14).

---

## 9. Available actions come from `snapshot.can()`

**`lib/workflow-core/actions.js:114`**

Here is the single cleverest idea in the codebase. "Which buttons should this card show?"
is answered by asking the state machine whether each candidate event would be accepted.

```js
function deriveAvailableActions(context, entityTypeOverride) {
  const entityType = entityTypeOverride || context.entityType || 'feature';
  const machine = entityType === 'research' ? researchMachine : featureMachine;
  const actor = createActor(machine, { input: context });
  actor.start();
  const snapshot = actor.getSnapshot();

  return buildCandidates(context, entityType)
    .filter((candidate) => {
      // Bypass candidates already passed their guard in buildCandidates
      if (candidate.bypassMachine) return true;
      return candidate.event && snapshot.can(candidate.event);
    })
    .sort((left, right) => left.recommendedOrder - right.recommendedOrder || left.label.localeCompare(right.label))
    .map((candidate) => ({
      kind: candidate.kind,
      label: candidate.label,
      eventType: candidate.event ? candidate.event.type : null,
      recommendedOrder: candidate.recommendedOrder,
      agentId: candidate.agentId,
      mode: candidate.mode || null,
      category: classifyActionCategory(candidate),
      requiresInput: candidate.requiresInput || null,
      scope: candidate.scope || null,
      metadata: candidate.metadata || null,
      clientOnly: candidate.clientOnly || false,
    }));
}
```

**The pattern:** *the machine is the availability oracle*. There is no second list of
"which buttons appear when". If `feature.close` isn't a legal transition from the current
state, the Close button cannot render — not because someone wrote a `if (state === ...)`
in the UI, but because `snapshot.can({ type: 'feature.close' })` returned false. Add a
transition to the table in §3 and the button appears everywhere, for free.

`bypassMachine` is the escape hatch, and it is honest about being one. Some actions aren't
state transitions at all — "Open Terminal", "Nudge agent", "Push". Those declare
`bypassMachine: true` and supply their own `guard` function, which `buildCandidates`
(`lib/workflow-core/actions.js:21`) runs during construction. A candidate is either machine-governed or
guard-governed, never both, and never neither.

The candidate definitions themselves live back in `lib/feature-workflow-rules.js`, so the
transitions and the actions that trigger them are declared side by side:

```js
    {
        kind: ManualActionKind.FEATURE_PUSH,
        label: 'Push',
        eventType: null,
        recommendedOrder: 35,
        bypassMachine: true,
        modeFilter: 'solo',
        category: 'lifecycle',
        guard: ({ context }) => {
            if (context.currentSpecState !== 'implementing') return false;
            const agents = Object.values(context.agents || {});
            return agents.some(agent => agent.status === 'ready');
        },
        metadata: {
            confirmationMessage: 'Push feature branch to origin?',
        },
    },
```

There is a long comment above the `PAUSE_FEATURE` candidate (`lib/feature-workflow-rules.js:287`)
documenting an incident where two candidates fired for the same state and the browser
silently deduped them, hiding the producer bug for months. It is a good five-minute read on
why this codebase validates instead of papering over.

---

## 10. Engine-first, folder-fallback

**`lib/workflow-core/entity-lifecycle.js:52`**

A tiny function that encodes the precedence rule the whole system depends on.

```js
/**
 * Returns true when the entity's lifecycle is `done`.
 *
 * Precedence:
 *   1. Engine snapshot present → use snapshot.lifecycle === 'done'
 *   2. No snapshot, folder fallback is the done stage folder → legacy pre-engine done
 *   3. Otherwise → false
 *
 * @param {string|null} folderFallback - the folder name found by a folder
 *   scan, or null if not scanned. Required to be passed explicitly so the
 *   call site documents what fallback applies.
 */
function isEntityDone(repoPath, entityType, entityId, folderFallback) {
  const snapshot = readSnapshotSync(repoPath, entityType, entityId);
  if (snapshot) {
    const lifecycle = String(snapshot.currentSpecState || snapshot.lifecycle || '').toLowerCase();
    return lifecycle === 'done';
  }
  // No engine state: fall back to folder only when there is no engine dir
  // (pre-engine legacy entity). An engine dir without a snapshot is drift,
  // not legacy — do not trust the folder.
  if (engineDirExists(repoPath, entityType, entityId)) return false;
  return folderFallback === STAGE_FOLDERS.DONE;
}
```

**The pattern:** *one shared predicate instead of seven inlined ones*. Before this existed,
eight different call sites each had their own idea of "is this done?" — some checked the
folder, some the snapshot, some both in different orders. They disagreed, and the
disagreements showed up as features that were done on the board and not-done in the
dependency checker.

**The subtle part is the middle branch.** "No snapshot" has *two* meanings, and conflating
them is the actual bug this function fixes:

- **no engine directory at all** → genuinely pre-engine; the folder is a legitimate signal.
- **engine directory exists but snapshot is missing** → *drift*. Something wrote partial
  state. The folder must not be trusted, and the honest answer is "not done".

Note the API design: `folderFallback` is a **required positional parameter**. You cannot
call this function without stating, at the call site, what fallback you're authorising.
That is deliberate — it makes the precedence visible in every diff that uses it.

---

# Part 2 — Identity and storage

## 11. Reserve the ID before you write the file

**`lib/entity.js:134`**

Creating a feature reserves an immutable numeric identity *first*, then writes the spec at
that number, then bootstraps engine state at that same number.

```js
function reserveCreateIdentity(def) {
    const repoPath = process.cwd();
    const kind = def.type === 'research' ? 'research' : 'feature';
    const store = createSpecStore({ repoPath });
    try {
        return store.reserveIdentitySync(kind);
    } catch (error) {
        if (error instanceof IdentityUnavailableError || error.name === 'IdentityUnavailableError') {
            throw error;
        }
        throw new Error(`Failed to reserve ${kind} identity: ${error.message}`);
    }
}
```

The build/afterWrite pair inside `entityCreate`:

```js
            build: (value) => {
                const reserved = reserveCreateIdentity(def);
                const slug = cliParseLib.slugify(value);
                const filename = `${def.prefix}-${reserved.paddedId}-${slug}.md`;
                const filePath = path.join(createDir, filename);
                const template = u.readTemplate(templateName);
                let content = template.replace(/\{\{NAME\}\}/g, value);
                content = injectAigonIdFrontmatter(content, reserved.key);
                // …
            },
            afterWrite: (built) => {
                const entityId = built.reserved.paddedId;
                // …
                _wf().ensureEntityBootstrappedSync(process.cwd(), def.type, entityId, 'inbox', built.filePath, {
                    authorAgentId: agentId,
                    specAuthor,
                });
                built.entityId = entityId;
                built.originSession = entityContext.establishOriginSession(process.cwd(), def.type, entityId, {
                    authorAgentId: agentId,
                    aigonLaunched: Boolean(options.agent),
                    directNativeSession,
                });
                markCreateIdentityMaterialized(def, built.reserved.number);
            }
```

**The pattern:** *reserve → materialise → confirm*. Three separable steps with a
recoverable gap between each. If the process dies after `reserveIdentitySync` but before
`markIdentityMaterialized`, the number is left in a *pending* state — `aigon doctor`
reports it rather than the number being either lost or handed out twice.

**Why this ordering matters historically.** The old design assigned a number at
*prioritise* time (inbox specs were slug-named). That meant the transition
inbox → backlog had to *re-key* the workflow directory, rewrite the spec filename, and
patch the frontmatter — a multi-file rename that had to succeed atomically or leave the
entity split across two identities. Reserving at create time makes prioritise a pure
lifecycle event. The old re-keying path still exists as `legacySlugPrioritise` for specs
created before the change; that is why you'll see `migrateEntityWorkflowIdSync` around.

Also note `injectAigonIdFrontmatter` — the reserved key is stamped into the spec's YAML
frontmatter, so the file itself carries its identity independent of its filename or
location.

---

## 12. The SpecStore interface

**`lib/spec-store/interface.js:10`**

Aigon can persist state locally (`.aigon/workflows/`) or in an orphan git branch shared
across machines. Both back ends implement one explicit list.

```js
const SPEC_STORE_METHODS = Object.freeze([
  'listSpecs',
  'readSpec',
  'readEvents',
  'readEventsSync',
  'appendEvent',
  'readSnapshot',
  'readSnapshotSync',
  'writeSnapshot',
  'lock',
  'sync',
  'syncBeforeWrite',
  'health',
  'readLeases',
  'acquireLease',
  'renewLease',
  'releaseLease',
  'assertLeaseAllowed',
  'reserveIdentitySync',
  'markIdentityMaterializedSync',
  'readIdentityPending',
]);

function assertSpecStoreInterface(store) {
  for (const name of SPEC_STORE_METHODS) {
    if (typeof store[name] !== 'function') {
      throw new Error(`SpecStore missing method: ${name}`);
    }
  }
}
```

**The pattern:** *runtime-checked structural interface, in a language with no interfaces*.
A new back end fails loudly at construction with the name of the method it forgot, rather
than at 2am with `store.acquireLease is not a function`.

The header comment states a boundary rule that is easy to violate and hard to detect:

> Local backend delegates file I/O to workflow-core persistence helpers
> (event-store, snapshot-store, lock) — **only the local backend may import those.**

That is what stops a well-meaning `require('../workflow-core/event-store')` in a command
module from bypassing the git-branch back end and writing to a path nothing syncs.

---

## 13. Content-addressed event merge

**`lib/spec-store/event-merge.js:13`**

When the same feature's log exists on two machines, they must converge without a
coordinator. The answer: derive a stable ID from the event's content and union.

```js
function getEventId(event) {
  if (event && event.id != null && String(event.id).trim()) {
    return String(event.id);
  }
  const payload = {
    type: event.type,
    at: event.at,
    featureId: event.featureId,
    researchId: event.researchId,
    agentId: event.agentId,
    effectId: event.effectId,
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24);
}

function mergeEventsById(localEvents, remoteEvents) {
  const merged = [];
  const seen = new Set();
  for (const source of [localEvents, remoteEvents]) {
    for (const event of source) {
      const id = getEventId(event);
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(event.id ? event : { ...event, id });
    }
  }
  return merged;
}
```

**The pattern:** *CRDT-ish set union over content-addressed events*. Merge is commutative
and idempotent — sync twice, sync in either direction, get the same log. No vector clocks,
no last-write-wins, no conflict markers.

This is the property that makes §6's reset-as-event design necessary rather than merely
tidy: in a union-merge world, the only way to express "undo" is to add something, because
subtraction doesn't survive a merge with a peer who still has the original.

Note the back-compat in `parseEventsPayload` below it — logs are read as either a
`{formatVersion, events}` envelope or bare JSONL, detected by a leading `{`. Old on-disk
data keeps working.

---

## 14. Stage folders are a symlink projection

**`lib/spec-view.js:147`**

Under the stable layout, every spec lives permanently in `docs/specs/{features,research-topics}/00-specs/`.
The familiar `01-inbox/`, `02-backlog/`, … folders are *generated symlinks* pointing back
into `00-specs`.

```js
function computeDesiredView(repoPath) {
  const links = Object.create(null);
  const diagnostics = [];

  for (const entityType of ENTITY_TYPES) {
    const cfg = ENTITY_VIEW[entityType];
    const docsRoot = path.join(repoPath, 'docs', 'specs', cfg.docsDir);

    // Canonical identity index; flag duplicate numeric identities as blockers.
    const canonical = listCanonicalSpecs(repoPath, entityType);
    const byNum = new Map();
    const dupNums = new Set();
    for (const c of canonical) {
      if (byNum.has(c.number)) dupNums.add(c.number);
      byNum.set(c.number, c);
    }

    for (const id of listEntityIds(repoPath, entityType)) {
      const snap = readSnapshot(repoPath, entityType, id);
      if (!snap) continue;
      const lifecycle = snap.currentSpecState || snap.lifecycle;
      const stageFolder = cfg.lifecycleDirMap[lifecycle];
      if (!stageFolder) continue; // unmapped lifecycle → no view entry

      // …

      const linkPath = path.join(docsRoot, stageFolder, basename);
      const target = path.join('..', CANONICAL_SPEC_DIR, basename); // ../00-specs/<basename>
      links[linkPath] = { target, entityType, id: String(id), basename, broken, stageFolder };
    }
  }

  return { links, diagnostics };
}
```

And the reconciler's contract, stated in its own docblock:

```js
/**
 * Reconcile the on-disk view to the desired projection. Idempotent: correct
 * links are left untouched, obsolete managed links removed, missing links
 * created, wrong managed targets replaced. Unsafe collisions block that entity
 * and never overwrite anything.
 */
function reconcileView(repoPath, options = {}) {
```

**The pattern:** *desired-state reconciliation* (the Kubernetes model). `computeDesiredView`
is pure — snapshots in, a map of `linkPath → target` out. `reconcileView` diffs desired
against actual and applies the minimum change. Running it twice changes nothing the second
time.

**Why this exists.** When folders were authoritative, a lifecycle change meant a `git mv`,
which meant spec history was fragmented across paths, `git log --follow` was unreliable,
and two branches that moved the same spec differently produced a rename/rename conflict.
Now the file never moves. The view is regenerated from state (that
`refreshLifecycleView` call at the end of §7), tracked in a manifest, and added to
`.git/info/exclude` so the generated links never appear in `git status`.

Note the safety posture: duplicates and collisions produce *diagnostics that block that one
entity*, never an overwrite. A broken projection is recoverable; a clobbered spec is not.

---

# Part 3 — Agents and sessions

## 15. Session names are the join key

**`lib/agent-sessions/names.js:72`**

Aigon does not keep a database of running agents. The tmux session *name* encodes the
identity, and the name is parsed back when needed.

```js
/**
 * Build a tmux session name following the naming convention:
 *   {repo}-{typeChar}{num}-{role}-{agent}(-{desc})
 * The 'auto' role omits the agent suffix.
 */
function buildTmuxSessionName(entityId, agentId, options) {
    const repo = resolveTmuxRepoName(options);
    const num = toUnpaddedId(entityId);
    const typeChar = (options && options.entityType) || 'f';
    const role = (options && options.role) || 'do';
    const desc = options && options.desc;
    const noAgent = role === 'auto';
    const agent = noAgent ? null : (agentId || 'solo');
    const middle = noAgent ? role : `${role}-${agent}`;
    return desc
        ? `${repo}-${typeChar}${num}-${middle}-${desc}`
        : `${repo}-${typeChar}${num}-${middle}`;
}
```

```js
function parseTmuxSessionName(name) {
    // 0. Set autonomous orchestrator: {repo}-s{setSlug}-auto
    const setAutoMatch = name.match(/^(.+)-s([a-z0-9][a-z0-9-]*)-auto$/);
    if (setAutoMatch) return { repoPrefix: setAutoMatch[1], type: 'S', id: setAutoMatch[2], role: 'auto', agent: null };
    // 1. Auto sessions (no agent): {repo}-{type}{id}-auto(-desc)
    const autoMatch = name.match(/^(.+)-(f|r)(\d+)-auto(?:-|$)/);
    if (autoMatch) return { repoPrefix: autoMatch[1], type: autoMatch[2], id: autoMatch[3], role: 'auto', agent: null };
    // 2. Role+agent sessions: {repo}-{type}{id}-{role}-{agent}(-desc)
    const roleMatch = name.match(/^(.+)-(f|r)(\d+)-(spec-draft|do|eval|review|revise|spec-review|spec-revise|spec-check|close)-([a-z]{2})(?:-|$)/);
    if (roleMatch) return { repoPrefix: roleMatch[1], type: roleMatch[2], id: roleMatch[3], role: roleMatch[4], agent: roleMatch[5] };
    // 3. Legacy feature eval sessions omitted the agent segment: {repo}-f{id}-eval(-desc)
    const legacyFeatureEvalMatch = name.match(/^(.+)-f(\d+)-eval(?:-|$)/);
    if (legacyFeatureEvalMatch) return { repoPrefix: legacyFeatureEvalMatch[1], type: 'f', id: legacyFeatureEvalMatch[2], role: 'eval', agent: null };
    // 4. Legacy fallback (no role prefix): {repo}-{type}{id}-{agent}(-desc) → role 'do'
    const legacyMatch = name.match(/^(.+)-(f|r)(\d+)-([a-z]{2})(?:-|$)/);
    if (!legacyMatch) return null;
    return { repoPrefix: legacyMatch[1], type: legacyMatch[2], id: legacyMatch[3], role: 'do', agent: legacyMatch[4] };
}
```

**The pattern:** *the name is the record*. `tmux ls` is the query interface. Sessions
survive Aigon restarting, crashing, or being upgraded, because no in-memory registry has to
survive with them. The cost is paid in that ordered cascade of regexes — four generations of
naming convention, tried newest-first, each documented with the shape it matches.

The header comment also records a structural constraint: this module is **pure and
path-only**, extracted out of `lib/worktree.js` specifically so workflow-core, dashboard
routes, and commands can all use it without creating a require cycle. `lib/worktree.js`
re-exports it for back-compat.

---

## 16. One place resolves model + effort

**`lib/agent-launch.js:47`**

Which model an agent launches with is a four-level precedence question, and the docblock is
the specification.

```js
/**
 * Resolve the {model, effort} triplet that a spawn should use for a
 * specific agent on a specific feature.
 *
 * Precedence (highest wins):
 *   1. explicit launcher triplet (dashboard agent picker — one-shot spawn)
 *   2. event-log override (from snapshot.agents[id].modelOverride/effortOverride)
 *      — only when valid for the **runtime** agentId (failover must not inherit
 *      the previous agent's model, e.g. cc's opus on cx).
 *   3. caller-supplied default for the stage (e.g. cliConfig.models[taskType])
 *   4. null (caller decides whether to pass no flag or use a hard default)
 */
function resolveLaunchTriplet({ agentId, slotAgentId, snapshot, stageDefaultModel, launcherModel, launcherEffort }) {
    const agent = snapshot && snapshot.agents && snapshot.agents[slotAgentId || agentId];
    const modelOverride = agent && agent.modelOverride != null ? agent.modelOverride : null;
    const effortOverride = agent && agent.effortOverride != null ? agent.effortOverride : null;

    const launcherM = launcherModel != null && String(launcherModel).trim() !== '' ? String(launcherModel).trim() : null;
    const launcherE = launcherEffort != null && String(launcherEffort).trim() !== '' ? String(launcherEffort).trim() : null;

    let model = null;
    let modelSource = 'none';
    if (launcherM) {
        model = launcherM;
        modelSource = 'launcher';
    } else if (modelOverride && agentRegistry.isKnownModelValue(agentId, modelOverride)) {
        model = modelOverride;
        modelSource = 'event';
    } else if (stageDefaultModel && agentRegistry.isKnownModelValue(agentId, stageDefaultModel)) {
        model = stageDefaultModel;
        modelSource = 'config';
    }
```

The module header is unusually direct about why the function exists:

```js
 * Every spawn path (feature-start, autoconductor run-loop, dashboard
 * restart, feature-open, autopilot iterate retry) must route through
 * `resolveLaunchTriplet` so the per-feature override captured on
 * `feature.started` is honoured end-to-end. Bypassing this helper is what
 * caused the silent-revert bug that motivated feature 291 — if a new spawn
 * site reads `cliConfig.models[...]` directly, it will miss the override.
```

**The pattern:** *a chokepoint with a stated reason and a named incident*. Five call sites
need this decision; four of them getting it right is worse than useless, because the
symptom (a feature quietly running on the wrong model) is invisible until you check the
bill.

Two details worth noticing. `modelSource` / `effortSource` are returned alongside the
values — the dashboard shows *why* an agent got its model, which turns "that's wrong" into
a debuggable claim. And every override is validated against the **runtime** agent
(`isKnownModelValue(agentId, ...)`), so when a feature fails over from Claude to Codex it
does not try to pass `opus` to a CLI that has never heard of it.

`buildAgentLaunchInvocation` below (`lib/agent-launch.js:109`) turns the triplet into shell
tokens, and degrades gracefully: if an agent's CLI has no model flag, the flag is dropped
but the *intent* stays recorded on the event log for attribution.

---

## 17. The heartbeat

**`lib/agent-status.js:176`**

Agents report progress by writing a small JSON file. This is the write side.

```js
function writeAgentStatus(id, agent, data, prefix = 'feature', options) {
    const existing = readAgentStatus(id, agent, prefix, options) || {};
    const record = Object.assign({}, existing, data, {
        agent,
        updatedAt: new Date().toISOString(),
    });
    const nextAwaiting = mergeAwaitingInput(existing, data);
    if (nextAwaiting) record.awaitingInput = nextAwaiting;
    else delete record.awaitingInput;
    atomicWriteJSON(agentStatusPath(id, agent, prefix, options), record);
    const repoRoot = (options && options.mainRepoPath) || process.cwd();
    signalHealth.tryConsumeNudgeRecovery(repoRoot, prefix, id, agent, existing.status, record.status);
    signalHealth.recordSignalEvent({
        repoPath: options && options.mainRepoPath,
        kind: 'signal-emitted',
        agent,
        entityType: prefix === 'research' ? 'research' : 'feature',
        entityId: id,
        status: record.status,
```

**The pattern:** *read-merge-write with atomic replacement, plus observability on the write
itself*. Three things are happening at once:

- **Merge, don't replace.** A partial update (`{ status: 'ready' }`) preserves every other
  field. Callers never have to read-then-write by hand.
- **`atomicWriteJSON`** — write to a temp file, rename. The dashboard polls these files
  continuously; a non-atomic write means it will eventually read a half-written file.
- **Every write emits a signal-health event.** `signalHealth` is how Aigon knows whether
  the *signalling mechanism itself* is working — a nudge that never produced a status
  change is recorded as abandoned. That is the input to §18.

Note also the read side (`lib/agent-status.js:78`): `readAgentStatus` loops over
`candidateIds(id)` rather than formatting the id once, because `7`, `07`, and `007` all
have to find the same file. Padded/unpadded IDs are a running theme; assume any id you're
handed could be either.

---

## 18. The idle ladder

**`lib/auto-nudge.js:110`**

An agent sitting at its prompt might be thinking or might be stuck. This escalates over
time: *active* → *idle-visible* → *idle-nudged* → *needs-attention*.

```js
function computeIdleLadder(repoPath, input = {}, deps = {}) {
    const nowMs = deps.nowMs || Date.now();
    const cfg = resolveConfig(repoPath, input.agentId, deps);
    const sessionKey = keyFor({ repoPath, ...input });
    let state = sessionState.get(sessionKey);
    if (!state) {
        state = { nudged: false, escalated: false, visibleRecorded: false };
        sessionState.set(sessionKey, state);
    }

    if (isQuotaPaused(input)) {
        return { state: 'active', idleSec: 0, autoNudgeEnabled: cfg.enabled && cfg.agentEnabled, skipped: 'quota-paused' };
    }

    const idleSec = getIdleSec(input, nowMs);
    if (idleSec < cfg.idleVisibleSec) {
        return { state: 'active', idleSec, autoNudgeEnabled: cfg.enabled && cfg.agentEnabled };
    }

    recordOnce(state, 'visibleRecorded', {
        // …
    });

    if (idleSec >= cfg.idleEscalateSec) {
        recordOnce(state, 'escalated', {
            repoPath,
            kind: 'signal-abandoned',
            agent: input.agentId,
            entityType: input.entityType,
            entityId: input.entityId,
            sessionName: input.sessionName,
            source: 'auto-nudge-escalated',
            elapsedSec: idleSec,
            reason: state.nudged ? 'no-signal-after-auto-nudge' : 'idle-threshold-reached',
        });
        return { state: 'needs-attention', idleSec, autoNudgeEnabled: cfg.enabled && cfg.agentEnabled, nudged: state.nudged };
    }

    if (idleSec >= cfg.idleAutoNudgeSec) {
        maybeDispatchNudge(repoPath, input, cfg, state, deps);
        return { state: state.nudged ? 'idle-nudged' : 'idle-visible', idleSec, autoNudgeEnabled: cfg.enabled && cfg.agentEnabled, nudged: state.nudged };
    }

    return { state: 'idle-visible', idleSec, autoNudgeEnabled: cfg.enabled && cfg.agentEnabled };
}
```

And the definition of "idle", which is stricter than you'd guess:

```js
function getIdleSec(input, nowMs) {
    if (!input.tmuxRunning) return 0;
    // Only auto-nudge when the session host has positively detected the
    // agent's idle prompt. A negative/unknown idle signal means the pane may be
    // actively thinking, editing, or running a command; review sessions are not
    // special-cased because long reviews are normal active work.
    if (!input.idleAtPrompt) return 0;
    const statusMs = new Date(input.updatedAt || 0).getTime();
    const promptMs = new Date(input.idleAtPromptDetectedAt || 0).getTime();
    if (!Number.isFinite(statusMs) || statusMs <= 0) return 0;
    if (!Number.isFinite(promptMs) || promptMs <= 0) return 0;
```

**The pattern:** *time-threshold ladder with side effects fired exactly once*. Called on
every dashboard poll, so it must be idempotent per rung — `recordOnce` and the
`state.nudged` flag guarantee one nudge and one escalation per session, no matter how
often you poll.

**The judgement calls are the interesting part.** *Absence of evidence is not idleness*:
unknown/negative signals return `0`, so an agent whose pane can't be read is never nudged.
*Quota pause is not idleness*: an agent waiting on a rate limit is doing the right thing and
returns `active` with an explicit `skipped: 'quota-paused'` reason rather than silently.
And the failure path in `maybeDispatchNudge` **resets `state.nudged = false`** if the send
throws, so a failed nudge is retried rather than counted.

`deps.nowMs` and `deps.sendNudge` are injected — the whole ladder is testable without
sleeping.

---

# Part 4 — Orchestration

## 19. Topological order for feature sets

**`lib/set-conductor.js:147`**

A *set* is a group of features executed in dependency order. Kahn's algorithm, with one
addition.

```js
function topoSortSetMemberIds(memberIds, graph) {
    const memberIdSet = new Set(memberIds);
    const subGraph = new Map();
    for (const id of memberIds) {
        const deps = (graph.get(id) || []).filter(dep => memberIdSet.has(dep));
        subGraph.set(id, deps);
    }

    const cycle = detectCycle(subGraph);
    if (cycle) {
        throw new Error(`Dependency cycle inside set: ${cycle.join(' -> ')}`);
    }

    const indegree = new Map(memberIds.map(id => [id, 0]));
    const reverse = new Map();
    for (const [node, deps] of subGraph.entries()) {
        for (const dep of deps) {
            indegree.set(node, (indegree.get(node) || 0) + 1);
            if (!reverse.has(dep)) reverse.set(dep, []);
            reverse.get(dep).push(node);
        }
    }

    const ready = [...indegree.entries()]
        .filter(([, deg]) => deg === 0)
        .map(([id]) => id)
        .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    const order = [];
    while (ready.length > 0) {
        const node = ready.shift();
        order.push(node);
        for (const dependent of reverse.get(node) || []) {
            indegree.set(dependent, (indegree.get(dependent) || 0) - 1);
            if (indegree.get(dependent) === 0) {
                ready.push(dependent);
                ready.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
            }
        }
    }

    if (order.length !== memberIds.length) {
        throw new Error('Failed to resolve a complete topological order for set members.');
    }
    return order;
}
```

**The pattern:** *deterministic topological sort*. The `.sort()` on the ready queue is the
whole point — plain Kahn's is non-deterministic when several nodes are simultaneously
ready, and a set whose execution order shuffled between runs would be untestable and
unexplainable to the operator. Numeric tie-break means feature 12 always runs before
feature 15 when neither depends on the other.

Also note the **subgraph restriction**: dependencies on features *outside* the set are
filtered out. Cross-set dependencies are a separate gate (`checkUnmetDependencies`); this
function only orders what it owns. And the final length check is a belt-and-braces
assertion — unreachable given the cycle check above it, but a corrupted graph fails loudly
rather than silently executing a partial set.

---

## 20. Close readiness is a blocker list

**`lib/close-readiness.js:113`**

"Can this feature be closed?" is answered by accumulating reasons why not — not by a
boolean.

```js
function buildCloseReadiness(entity, snapshot, options) {
    const opts = options || {};
    snapshot = snapshot || (entity && entity.workflowSnapshot) || null;
    entity = entity || {};
    const featureId = opts.featureId || entity.id;
    const applicable = isCloseReadinessApplicable(snapshot, entity);
    const blockers = [];
    const policy = opts.integrityPolicy || resolveCloseIntegrityPolicy(opts.config || {});

    if (!applicable) {
        return {
            applicable: false,
            ready: false,
            blockers: [],
            primaryBlocker: null,
            phase: null,
            closeLogHint: null,
        };
    }

    if (opts.closingInProgress || (snapshot && snapshot.currentSpecState === 'closing')) {
        return {
            applicable: true,
            ready: false,
            blockers: [],
            primaryBlocker: makeBlocker('closing', 'Closing…', null),
            phase: 'closing',
            closeLogHint: 'Watch the close log panel for live progress',
        };
    }

    blockers.push(...buildOpenEscalationBlockers(snapshot, featureId, policy));

    // …

    const awaitAgent = (entity.agents || []).find(a => a && a.awaitingInput && a.awaitingInput.message);
    if (awaitAgent) {
        blockers.push(makeBlocker(
            'awaiting-input',
            'Needs input',
            awaitAgent.awaitingInput.message,
        ));
    }

    if (entity.stage === 'backlog' && Array.isArray(entity.blockedBy) && entity.blockedBy.length > 0) {
        const deps = entity.blockedBy.map(d => `#${String(d.id).padStart(2, '0')}`).join(', ');
        blockers.push(makeBlocker('dependency-blocked', 'Dependency blocked', `Waiting on ${deps}`));
    }
```

with each blocker carrying its own remedy:

```js
        blockers.push(makeBlocker(
            'autonomous-stopped',
            'Review escalation',
            controller.reasonLabel || 'Autonomous close paused for escalation disposition',
            'feature-escalation-accept',
            `aigon feature-escalation accept ${String(featureId || '').trim().padStart(2, '0')} 1`,
        ));
```

**The pattern:** *accumulate reasons, not verdicts*. `makeBlocker(kind, label, detail,
actionKind, actionCommand)` bundles **what's wrong, how to say it, and the exact command
that fixes it**. The UI renders `primaryBlocker` on the card and the full list on hover;
the CLI prints the command. Neither has to know what any individual blocker means.

**Three-valued, not two-valued.** `applicable: false` (this feature isn't at a stage where
closing is a question) is a distinct outcome from `ready: false` (it is, and here's what's
stopping you). Collapsing those two produces cards that show a greyed-out Close button on
an inbox item.

And note `policy` — whether a given finding *blocks* or merely *warns* is configurable
(`resolveCloseIntegrityPolicy`), so the same detection code serves a strict repo and a
permissive one.

---

# Part 5 — The read side

## 21. Degrading loudly when state is missing

**`lib/workflow-read-model.js:254`**

A spec file with no engine snapshot is a genuine possibility. This function decides what
the dashboard shows, and its comment is the clearest statement of the read-side philosophy
in the codebase.

```js
function buildMissingSnapshotState(currentStage, entityType, entityId, options = {}) {
    // A spec file exists but no workflow-core snapshot is on disk.
    //
    // F397 discriminator: there are two genuinely different "no snapshot"
    // states, and the previous code conflated them.
    //  (a) PRE-START — no engine dir at all. Inbox/backlog spec was created
    //      before workflow-core was bootstrapped (legacy seed repos, or pre
    //      F296 inbox specs). Folder position IS the legitimate signal here,
    //      and synthesising pre-engine actions (Prioritise/Start) is correct.
    //  (b) DRIFT/CORRUPTION — engine dir exists but snapshot.json is missing
    //      or unreadable. The entity has been started; folder position MUST
    //      NOT be trusted as lifecycle state. Card stays inert (no actions)
    //      until `aigon doctor --fix` resolves the underlying drift.
    //
    // Dashboard: return this shape (do not throw) so one bad row does not
    // 500 the whole grid. CLI/commands use console.error + non-zero exit.
    const isDrift = options.engineDirExists === true;
    const actionStage = (!isDrift && (currentStage === 'inbox' || currentStage === 'backlog'))
        ? currentStage
        : null;
    const stageActions = (entityType && actionStage)
        ? workflowSnapshotAdapter.snapshotToDashboardActions(entityType, entityId || null, null, actionStage)
        : { nextAction: null, nextActions: [], validActions: [] };
    return {
        stage: currentStage || null,
        // …
        readModelSource: WORKFLOW_SOURCE.MISSING_SNAPSHOT,
        // Surface the discriminator so dashboard/CLI consumers can render a
        // distinct "drift" badge without re-reading the filesystem.
        engineDirExists: isDrift,
    };
}
```

**The pattern:** *degrade differently per surface, and never silently repair*.

- **Dashboard: return a shape, don't throw.** One corrupt row must not 500 the whole grid.
  The row renders inert with a drift badge.
- **CLI: exit non-zero and name the fix.** An operator running `feature-list` gets a loud
  failure citing `aigon doctor --fix`.
- **Read paths never mutate.** The comment a few lines down at `lib/workflow-read-model.js:303`
  records exactly why: an earlier version made dashboard reads auto-reconcile folder drift,
  which turned every browser refresh into a silent filesystem mutation across every
  registered repo. Auto-heal now lives behind an explicit command and an opt-in env var.

That is the "dashboard is read-only" rule made concrete. The read model may *observe*
drift and *report* it; it may not fix it.

---

## 22. Server-owned UI contracts

**`lib/entity-ui-contract.js:32`**

Every interactive card on the dashboard receives a validated `uiContract` — identity,
actions, blockers, sessions — computed on the server. The browser renders it and derives
nothing.

```js
// F678: identity is server-owned. The renderer must never rebuild a display key,
// re-derive a machine slug, or infer set membership from an unrelated field.
function normalizeIdentity(entity) {
    const source = entity && typeof entity === 'object' ? entity : {};
    const kind = source.type || source.kind || null;
    if (!ENTITY_KINDS.has(kind)) {
        throw new Error(`UI contract entity requires a known kind (${[...ENTITY_KINDS].join(', ')}), received: ${JSON.stringify(kind)}`);
    }
    const id = source.id === 0 || source.id ? String(source.id) : '';
    if (!id) throw new Error(`UI contract entity requires an id (kind=${kind})`);

    // Numeric id is the operator-facing number (features/research). Sets are
    // keyed by slug and legitimately have none — null, never a coerced NaN.
    const numericSource = source.numericId !== undefined && source.numericId !== null
        ? source.numericId
        : (kind === 'feature-set' ? null : id);
    const parsedNumeric = numericSource === null ? null : Number.parseInt(String(numericSource), 10);
    const numericId = Number.isFinite(parsedNumeric) ? parsedNumeric : null;

    const set = source.set && typeof source.set === 'object'
        ? { slug: String(source.set.slug || ''), name: source.set.name || null }
        : (source.setSlug ? { slug: String(source.setSlug), name: source.setName || null } : null);
    if (set && !set.slug) throw new Error(`UI contract set membership requires a slug (kind=${kind}, id=${id})`);

    return {
        ...source,
        type: kind,
        kind,
        id,
        numericId,
        displayKey: source.displayKey || null,
        name: source.name || '',
        title: source.title || source.name || '',
        slug: source.slug ? String(source.slug) : null,
        set,
    };
}
```

**The pattern:** *validate-and-throw at the boundary, don't coerce*. Contrast with a
renderer doing `parseInt(entity.id) || 0` — that turns a missing id into feature #0 and
ships. Here a malformed entity throws at contract-build time, in the collector, with the
kind and id in the message. `Number.isFinite` guarding against `NaN` and the explicit
"sets legitimately have no number → `null`, never a coerced `NaN`" comment are the same
instinct: **absent and zero are different things.**

Note the `deepFreeze` helper at the top of the file — contracts are frozen before they go
out, so a view cannot patch one in place and have the mutation leak into the next render.
That is enforcement, not convention.

The full rules live in `docs/feature-interaction-contract.md`. The short version: if you
find yourself writing lifecycle logic in `templates/dashboard/js/`, the fix belongs in the
workflow definition or the projector instead.

---

## 23. Fingerprint → version → ETag

**`lib/dashboard-status-version.js:23`**

The dashboard polls `/api/status` constantly. To avoid re-rendering on unchanged data,
the server reduces the entire status payload to a fingerprint string.

```js
function computeStatusFingerprint(data) {
    if (!data) return '';
    const parts = [];
    const summary = data.summary || {};
    parts.push((summary.waiting || 0) + ',' + (summary.inProgress || 0) + ',' + (summary.inEval || 0));
    parts.push('monitor:' + monitorOperationalFingerprint(data.monitorOperational));
    // …
    (data.repos || []).forEach(repo => {
        const features = repo.features || [];
        // …
        features.forEach(f => {
            const agents = (f.agents || []).map(a => {
                const ladder = (a.idleLadder && a.idleLadder.state) || '';
                return a.id + ':' + a.status + ':' + ladder;
            }).join('|');
            const closeFail = f.lastCloseFailure ? '!' : '';
            const cr = f.closeReadiness;
            const crKey = cr && cr.applicable
                ? (cr.ready ? 'R' : (cr.primaryBlocker ? cr.primaryBlocker.kind : 'B'))
                : '';
            parts.push('F' + f.id + ':' + (f.stage || '') + ':' + (f.currentSpecState || '') + ':' + (f.startupPhase || '') + ':' + agents + closeFail + ':' + crKey + ':' + specReviewCycleFingerprint(f) + ':' + featureUiContractFingerprint(f.uiContract));
        });
```

```js
function createStatusSnapshotStore() {
    let latestStatus = null;
    let statusVersion = 0;
    let fingerprint = '';
    let serializeCache = { generatedAt: null, body: null };

    function replaceLatestStatus(nextStatus, _source) {
        if (!nextStatus) return latestStatus;
        const nextFp = computeStatusFingerprint(nextStatus);
        const bumped = nextFp !== fingerprint;
        if (bumped) {
            statusVersion += 1;
            fingerprint = nextFp;
        }
        nextStatus.statusVersion = statusVersion;
        latestStatus = nextStatus;
        if (bumped || serializeCache.generatedAt !== nextStatus.generatedAt) {
            serializeCache = {
                generatedAt: nextStatus.generatedAt,
                body: JSON.stringify(nextStatus),
            };
        }
        return latestStatus;
    }
```

**The pattern:** *semantic fingerprint as a change oracle*. `generatedAt` changes on every
poll and is useless as a validator. The fingerprint deliberately includes only what should
cause a **repaint** — stage, lifecycle, agent statuses, idle ladder, close-readiness
verdict, contract digest — and excludes timestamps and other churn. Version bumps only when
the fingerprint moves; that version becomes the ETag, so unchanged polls return `304` and
SSE clients skip the render.

**The trap, and it catches people:** add a field to `/api/status` and forget to add it here,
and the field arrives in the payload but **the card never repaints**, because the version
didn't bump and the client short-circuits. The symptom is "my new field works on hard
refresh but not on poll", which sends you hunting in the browser for a bug that is on the
server. `AGENTS.md` and `CLAUDE.md` both call this out; now you know why.

---

## 24. Optimistic UI as overlays, never mutation

**`templates/dashboard/js/store.js:301`**

The frontend needs a Start button to feel instant while the server catches up. It does this
without ever writing to the data it renders.

```js
function pruneOptimisticOverlays(raw) {
  const now = Date.now();
  for (const [key, overlay] of [..._optimisticOverlays.entries()]) {
    if (overlay.settled(raw)) _optimisticOverlays.delete(key);
  }
  for (const [key, overlay] of [..._optimisticOverlays.entries()]) {
    if (now - overlay.addedAt > overlay.ttlMs) _optimisticOverlays.delete(key);
  }
}

function assignDataFromRaw(rawNext, { evaluateSettled = true } = {}) {
  const raw = applyForceProOverride(rawNext);
  if (evaluateSettled) pruneOptimisticOverlays(raw);
  _lastRawData = raw;
  const draft = deepCloneData(raw);
  for (const overlay of _optimisticOverlays.values()) {
    overlay.patch(draft);
  }
  storeTarget().data = draft;
  notifyDataChange();
}

export function replaceData(rawNext, options) {
  assignDataFromRaw(rawNext, options);
}

export function addOptimistic({ key, patch, settled, ttlMs = DEFAULT_OPTIMISTIC_TTL_MS }) {
  _optimisticOverlays.set(key, { patch, settled, ttlMs, addedAt: Date.now() });
  assignDataFromRaw(_lastRawData ?? _rawState.data, { evaluateSettled: false });
}
```

**The pattern:** *server truth + replayable overlays*. `_lastRawData` holds exactly what the
server said. Rendered state is `deepClone(raw)` with every active overlay's `patch`
re-applied on top. Nothing ever mutates `raw`.

**Each overlay carries its own retirement conditions, both of them:**

- `settled(raw)` — a predicate over fresh server data. "The server now reports this feature
  as started" → the overlay's job is done, drop it.
- `ttlMs` — a wall-clock backstop. If the action silently failed and the server *never*
  reports what we predicted, the overlay expires anyway rather than lying forever.

Without the TTL, a failed action leaves a permanently wrong card. Without `settled`, the
overlay flickers off at expiry even when everything worked. You need both.

This is the enforcement mechanism behind CLAUDE.md's rule that data enters only via
`replaceData` — "optimism = overlays, never hand-mutation". A view that reaches in and sets
`data.repos[0].features[3].stage = 'implementing'` gets its change silently reverted on the
next poll, which is a genuinely miserable bug to chase.

---

# Part 6 — Installing into other repos

## 25. Template rendering and the zero-opinion rule

**`lib/templates.js:212`**

Aigon installs slash commands, docs, and agent instructions into *your* repo. Templates are
`{{PLACEHOLDER}}` files rendered per agent.

```js
// Replace placeholders in template content
function processTemplate(content, placeholders) {
    let result = content;
    const supportedAgents = agentRegistry.getSortedAgentIds();
    const supportedAgentConfigs = supportedAgents.map(agentId => agentRegistry.getAgent(agentId)).filter(Boolean);
    const { slashCommandAgentIds, skillAgentIds } = agentRegistry.getRegistryBackedAgentGroups();
    const builtins = {
        SPEC_REVIEW_RUBRIC: (() => {
            const rubricPath = path.join(TEMPLATES_ROOT, 'generic', 'prompts', 'spec-review-rubric.md');
            if (!fs.existsSync(rubricPath)) return '';
            return fs.readFileSync(rubricPath, 'utf8').trim();
        })(),
        SUPPORTED_AGENT_IDS: supportedAgents.join(', '),
        AGENT_IDS_SLASH_COMMAND: slashCommandAgentIds.join(', '),
        AGENT_IDS_SKILL: skillAgentIds.join(', '),
        // …
    };
    Object.entries({ ...builtins, ...(placeholders || {}) }).forEach(([key, value]) => {
        // Match {{KEY}} pattern (our placeholder syntax)
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        result = result.replace(regex, () => value);
    });
    // Collapse 3+ consecutive newlines to 2 so empty placeholders don't leave gaps
    result = result.replace(/\n{3,}/g, '\n\n');
    return result;
}
```

**Two small details that are load-bearing:**

- **`() => value`, not `value`.** `String.replace` interprets `$&`, `$1`, `` $` `` in a
  replacement *string*. A model name or a code snippet containing `$` would corrupt itself.
  The function form disables all substitution. This has bitten people.
- **The newline collapse.** Placeholders that render to `''` — because the feature they
  describe doesn't apply to this repo — leave a blank line behind. Collapsing `\n{3,}` to
  `\n\n` means one template serves every project profile and still reads cleanly.
  `stripLightOptionalBlocks` just below (`lib/templates.js:250`) does the same job at block
  granularity with HTML-comment markers.

**The rule to internalise before editing anything under `templates/`:** these files are
installed into repos Aigon knows nothing about — Python monorepos, Rust crates, static
sites. **Aigon has zero opinion about the target repo's language, package manager, test
command, build, or layout.** If a template sentence would be wrong in a Rust crate, it has
to be generalised or cut. `node scripts/check-template-leaks.js` enforces this; run it on
any template change.

The corollary trips people up regularly: Aigon's *own* tooling (release scripts, its own
test gates) goes in `scripts/` — **never** in `templates/generic/commands/`, because
anything there ships into strangers' repositories.

---

# Cross-cutting patterns

If you only remember five things:

1. **One source of truth, and it's the engine.** Lifecycle state comes from the event log
   via the projector. Folders, snapshots, and cards are all *derived*. Anything that reads
   the filesystem to decide "what state is this in?" is wrong (§7, §10, §14).

2. **Declare it as data, compile it into behaviour.** The state table (§3) feeds the
   machine, the action deriver, and the diagrams. The action registry feeds availability
   and the UI contract. One definition, many consumers, no drift possible.

3. **Inject the seam.** `ctx` for commands (§2), `executeEffect` for effects (§8),
   `deps.nowMs` / `deps.sendNudge` for the idle ladder (§18), `store` for persistence (§12).
   Nothing important is reachable only through a hardcoded `require`.

4. **Degrade loudly, never silently repair.** Missing state produces a distinct, visible,
   diagnosable outcome — an inert card and a badge on the dashboard, a non-zero exit and a
   named fix command on the CLI. Read paths never mutate to paper over a bad write (§21).

5. **Fix the producer, not the symptom.** Several comments in this codebase are post-mortems
   of bugs caused by patching the read side: the browser deduping duplicate actions (§9),
   reads auto-reconciling drift (§21), reset deleting a directory instead of appending an
   event (§6). When state is wrong, the bug is in whatever wrote it.

---

# Where to go next

| You're working on | Read |
|---|---|
| Module placement, install internals, full module map | [`architecture.md`](architecture.md) |
| Lifecycle states, events, snapshots, read models | [`architecture.md`](architecture.md) § Workflow State |
| Dashboard cards, actions, contracts | [`feature-interaction-contract.md`](feature-interaction-contract.md) |
| Spec storage, git-branch backend, stable layout | [`specstore-architecture.md`](specstore-architecture.md) |
| Autonomous runs and the conductor loop | [`autonomous-mode.md`](autonomous-mode.md) |
| Adding a new agent CLI | [`adding-agents.md`](adding-agents.md) |
| Test gates and authoring rules | [`testing.md`](testing.md) |
| Everything else under `docs/` | [`README.md`](README.md) |

---

# Maintaining this document

This file is part of the internal doc set and is kept current by agents, not by hand.

**Agents:** invoke the `code-tour` skill (`.claude/skills/code-tour/SKILL.md`) when you
change any file this tour quotes, or when you add a subsystem a new reader would need. The
skill defines the update contract — verbatim-excerpt rule, line-anchor verification, the
verification command, and when a new section is warranted. Non-Claude agents: read that
file directly; it is plain markdown and agent-agnostic.

**Quick line-anchor check** — reprints the first line at each anchor so you can eyeball drift:

```bash
node scripts/check-code-tour.js
```
