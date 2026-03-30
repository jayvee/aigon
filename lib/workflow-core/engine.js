'use strict';

/**
 * Workflow engine — command dispatcher, effect orchestration, state persistence.
 *
 * Ported from aigon-next/src/workflow/engine.ts.
 * This is the main orchestration layer that coordinates events, snapshots,
 * locking, and effects into a coherent workflow lifecycle.
 */

const { createActor } = require('xstate');
const { featureMachine } = require('./machine');
const { appendEvent, readEvents } = require('./event-store');
const { writeSnapshot } = require('./snapshot-store');
const { projectContext } = require('./projector');
const { deriveAvailableActions } = require('./actions');
const { withFeatureLock, tryWithFeatureLock } = require('./lock');
const { runEffects, runFeatureEffect } = require('./effects');
const {
  getEventsPath,
  getSnapshotPath,
  getLockPath,
  getSpecPath,
} = require('./paths');

const DEFAULT_CLAIM_TIMEOUT_MS = 30_000;

class EffectExecutionInterruptedError extends Error {
  constructor(message = 'Effect execution interrupted') {
    super(message);
    this.name = 'EffectExecutionInterruptedError';
  }
}

function now() {
  return new Date().toISOString();
}

function requireContext(context, featureId) {
  if (context === null) {
    throw new Error(`Feature ${featureId} does not exist`);
  }
  return context;
}

function isEffectPending(effect) {
  return effect.status !== 'succeeded';
}

function isEffectClaimHealthy(effect, claimTimeoutMs, currentTimeMs) {
  return (
    effect.status === 'claimed' &&
    effect.claimedAt !== null &&
    currentTimeMs - new Date(effect.claimedAt).getTime() < claimTimeoutMs
  );
}

function isBusyExecutionResult(value) {
  return value && value.kind === 'busy';
}

function snapshotFromContext(context, eventCount) {
  return {
    featureId: context.featureId,
    lifecycle: context.currentSpecState,
    mode: context.mode,
    winnerAgentId: context.winnerAgentId,
    agents: context.agents,
    currentSpecState: context.currentSpecState,
    specPath: context.specPath,
    effects: context.effects,
    lastEffectError: context.lastEffectError,
    availableActions: deriveAvailableActions(context),
    eventCount,
    createdAt: context.createdAt,
    updatedAt: context.updatedAt,
  };
}

function computeSpecPath(repoPath, featureId, lifecycle) {
  return getSpecPath(repoPath, featureId, lifecycle);
}

function buildEffects(repoPath, previous, next, event) {
  const effects = [];

  if (event.type === 'feature.started') {
    effects.push({
      id: 'feature.start.ensure_layout',
      type: 'ensure_feature_layout',
      payload: {
        lifecycle: next.currentSpecState,
        mode: next.mode,
        agents: Object.keys(next.agents).join(','),
      },
    });
  }

  const previousState = previous ? previous.currentSpecState : 'backlog';
  if (
    previous !== null &&
    previousState !== next.currentSpecState &&
    event.type !== 'feature.close_requested' &&
    event.type !== 'feature.closed'
  ) {
    effects.push({
      id: `spec.move.${previousState}.to.${next.currentSpecState}`,
      type: 'move_spec',
      payload: {
        fromPath: previous.specPath,
        toPath: computeSpecPath(repoPath, next.featureId, next.currentSpecState),
      },
    });
  }

  if (event.type === 'feature.eval_requested') {
    effects.push({
      id: 'feature.eval.write_stub',
      type: 'write_eval_stub',
      payload: {},
    });
  }

  return effects;
}

function materializeContext(repoPath, context) {
  const hasPendingDoneMove = context.effects.some(
    (effect) => effect.id === 'close.move_spec_to_done' && effect.status !== 'succeeded',
  );
  const resolvedSpecLifecycle =
    context.currentSpecState === 'closing'
      ? hasPendingDoneMove
        ? 'ready_for_review'
        : 'done'
      : context.currentSpecState;

  return {
    ...context,
    specPath: computeSpecPath(repoPath, context.featureId, resolvedSpecLifecycle),
  };
}

function materializePendingEffects(repoPath, context) {
  return {
    ...context,
    effects: context.effects.map((effect) => {
      if (effect.id === 'close.move_spec_to_done') {
        return {
          ...effect,
          payload: {
            fromPath: context.specPath,
            toPath: computeSpecPath(repoPath, context.featureId, 'done'),
          },
        };
      }
      if (effect.id === 'close.write_close_note') {
        return {
          ...effect,
          payload: {
            winnerAgentId: context.winnerAgentId || '',
          },
        };
      }
      return effect;
    }),
  };
}

function applyTransition(context, event) {
  const actor = createActor(featureMachine, { input: context });
  actor.start();
  const snapshot = actor.getSnapshot();

  function sendIfAllowed(machineEvent) {
    if (!snapshot.can(machineEvent)) {
      throw new Error(`Event ${machineEvent.type} is invalid for feature ${context.featureId}`);
    }
    actor.send(machineEvent);
  }

  switch (event.type) {
    case 'feature.paused':
      sendIfAllowed({ type: 'feature.pause', at: event.at });
      break;
    case 'feature.resumed':
      sendIfAllowed({ type: 'feature.resume', at: event.at });
      break;
    case 'feature.eval_requested':
      sendIfAllowed({ type: 'feature.eval', at: event.at });
      break;
    case 'winner.selected':
      sendIfAllowed({ type: 'select-winner', agentId: event.agentId, at: event.at });
      break;
    case 'feature.close_requested':
      sendIfAllowed({ type: 'feature.close', at: event.at });
      break;
    case 'effect.requested':
      return {
        ...context,
        effects: [
          ...context.effects.filter((e) => e.id !== event.effect.id),
          {
            ...event.effect,
            status: 'requested',
            claimedAt: null,
            claimExpiredAt: null,
            reclaimCount: 0,
            lastError: null,
          },
        ],
        lastEffectError: null,
        updatedAt: event.at,
      };
    case 'effect.claimed':
      return {
        ...context,
        effects: context.effects.map((e) =>
          e.id === event.effectId
            ? { ...e, status: 'claimed', claimedAt: event.at, claimExpiredAt: null, lastError: null }
            : e,
        ),
        lastEffectError: null,
        updatedAt: event.at,
      };
    case 'effect.claim_expired':
      return {
        ...context,
        effects: context.effects.map((e) =>
          e.id === event.effectId
            ? { ...e, status: 'reclaimable', claimedAt: null, claimExpiredAt: event.at, lastError: null }
            : e,
        ),
        lastEffectError: null,
        updatedAt: event.at,
      };
    case 'effect.reclaimed':
      return {
        ...context,
        effects: context.effects.map((e) =>
          e.id === event.effectId
            ? { ...e, status: 'claimed', claimedAt: event.at, claimExpiredAt: null, reclaimCount: e.reclaimCount + 1, lastError: null }
            : e,
        ),
        lastEffectError: null,
        updatedAt: event.at,
      };
    case 'feature.closed':
      sendIfAllowed({ type: 'feature.closed', at: event.at });
      break;
    case 'effect.succeeded':
      return {
        ...context,
        effects: context.effects.map((e) =>
          e.id === event.effectId
            ? { ...e, status: 'succeeded', claimedAt: null, claimExpiredAt: null, lastError: null }
            : e,
        ),
        lastEffectError: null,
        updatedAt: event.at,
      };
    case 'effect.failed':
      return {
        ...context,
        effects: context.effects.map((e) =>
          e.id === event.effectId
            ? { ...e, status: 'failed', claimedAt: null, claimExpiredAt: null, lastError: event.error }
            : e,
        ),
        lastEffectError: event.error,
        updatedAt: event.at,
      };
    case 'agent.restarted':
      sendIfAllowed({ type: 'restart-agent', agentId: event.agentId, at: event.at });
      break;
    case 'agent.force_ready':
      sendIfAllowed({ type: 'force-agent-ready', agentId: event.agentId, at: event.at });
      break;
    case 'agent.dropped':
      sendIfAllowed({ type: 'drop-agent', agentId: event.agentId, at: event.at });
      break;
    case 'agent.marked_ready':
    case 'signal.agent_ready':
      if (context.agents[event.agentId] === undefined) return context;
      return {
        ...context,
        agents: {
          ...context.agents,
          [event.agentId]: { ...context.agents[event.agentId], status: 'ready', lastHeartbeatAt: event.at },
        },
        updatedAt: event.at,
      };
    case 'signal.agent_started':
      if (context.agents[event.agentId] === undefined) return context;
      return {
        ...context,
        agents: {
          ...context.agents,
          [event.agentId]: {
            ...context.agents[event.agentId],
            status: context.agents[event.agentId].status === 'ready' ? 'ready' : 'running',
            lastHeartbeatAt: event.at,
          },
        },
        updatedAt: event.at,
      };
    case 'signal.agent_waiting':
      if (context.agents[event.agentId] === undefined) return context;
      return {
        ...context,
        agents: {
          ...context.agents,
          [event.agentId]: { ...context.agents[event.agentId], status: 'waiting', lastHeartbeatAt: event.at },
        },
        updatedAt: event.at,
      };
    case 'signal.agent_failed':
      if (context.agents[event.agentId] === undefined) return context;
      return {
        ...context,
        agents: {
          ...context.agents,
          [event.agentId]: { ...context.agents[event.agentId], status: 'failed', lastHeartbeatAt: event.at },
        },
        updatedAt: event.at,
      };
    case 'signal.heartbeat':
      if (context.agents[event.agentId] === undefined) return context;
      return {
        ...context,
        agents: {
          ...context.agents,
          [event.agentId]: { ...context.agents[event.agentId], lastHeartbeatAt: event.at },
        },
        updatedAt: event.at,
      };
    case 'signal.session_lost':
    case 'signal.heartbeat_expired':
      if (context.agents[event.agentId] === undefined) return context;
      return {
        ...context,
        agents: {
          ...context.agents,
          [event.agentId]: { ...context.agents[event.agentId], status: 'lost' },
        },
        updatedAt: event.at,
      };
    default:
      break;
  }

  const nextSnapshot = actor.getSnapshot();
  return {
    ...nextSnapshot.context,
    updatedAt: event.at,
    currentSpecState: nextSnapshot.value,
  };
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

async function loadFeatureContextFromEvents(repoPath, featureId, events) {
  const projected = projectContext(events);
  return materializePendingEffects(repoPath, materializeContext(repoPath, requireContext(projected, featureId)));
}

async function loadCurrentUnlocked(repoPath, featureId, eventsPath) {
  eventsPath = eventsPath || getEventsPath(repoPath, featureId);
  const events = await readEvents(eventsPath);
  const context = await loadFeatureContextFromEvents(repoPath, featureId, events);
  return { events, context };
}

async function applyEventsUnlocked(repoPath, featureId, newEvents, eventsPath, snapshotPath) {
  eventsPath = eventsPath || getEventsPath(repoPath, featureId);
  snapshotPath = snapshotPath || getSnapshotPath(repoPath, featureId);

  const previousEvents = await readEvents(eventsPath);
  const previous =
    previousEvents.length === 0 ? null : await loadFeatureContextFromEvents(repoPath, featureId, previousEvents);

  let next = previous;
  let priorForEffects = previous;

  for (const event of newEvents) {
    if (event.type === 'feature.started') {
      next = await loadFeatureContextFromEvents(repoPath, featureId, [...previousEvents, event]);
    } else {
      next = applyTransition(requireContext(next, featureId), event);
      next = materializePendingEffects(repoPath, materializeContext(repoPath, next));
    }

    await appendEvent(eventsPath, event);
    const immediateEffects = buildEffects(repoPath, priorForEffects, requireContext(next, featureId), event);
    await runEffects(repoPath, featureId, immediateEffects);
    priorForEffects = requireContext(next, featureId);
  }

  const snapshot = snapshotFromContext(requireContext(next, featureId), previousEvents.length + newEvents.length);
  await writeSnapshot(snapshotPath, snapshot);
  return snapshot;
}

async function persistEvent(repoPath, featureId, event) {
  return persistEvents(repoPath, featureId, [event]);
}

async function persistEvents(repoPath, featureId, newEvents) {
  const eventsPath = getEventsPath(repoPath, featureId);
  const snapshotPath = getSnapshotPath(repoPath, featureId);
  const lockPath = getLockPath(repoPath, featureId);

  return withFeatureLock(lockPath, async () =>
    applyEventsUnlocked(repoPath, featureId, newEvents, eventsPath, snapshotPath),
  );
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function buildCloseEffects(repoPath, context) {
  return [
    {
      id: 'close.move_spec_to_done',
      type: 'move_spec',
      payload: {
        fromPath: context.specPath,
        toPath: computeSpecPath(repoPath, context.featureId, 'done'),
      },
    },
    {
      id: 'close.write_close_note',
      type: 'write_close_note',
      payload: {
        winnerAgentId: context.winnerAgentId || '',
      },
    },
  ];
}

async function initializeCloseEffects(repoPath, featureId) {
  const snapshot = await showFeature(repoPath, featureId);

  if (snapshot.currentSpecState !== 'ready_for_review') {
    return snapshot;
  }

  const closeEffects = buildCloseEffects(repoPath, snapshot);
  const lockPath = getLockPath(repoPath, featureId);
  const eventsPath = getEventsPath(repoPath, featureId);
  const snapshotPath = getSnapshotPath(repoPath, featureId);
  const lockResult = await tryWithFeatureLock(lockPath, async () => {
    try {
      return await applyEventsUnlocked(
        repoPath,
        featureId,
        [
          { type: 'feature.close_requested', at: now() },
          ...closeEffects.map((effect) => ({
            type: 'effect.requested',
            effect,
            at: now(),
          })),
        ],
        eventsPath,
        snapshotPath,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('Event feature.close is invalid')) {
        return showFeature(repoPath, featureId);
      }
      throw error;
    }
  });

  return lockResult.kind === 'busy' ? { kind: 'busy' } : lockResult.value;
}

async function claimNextEffect(repoPath, featureId, claimTimeoutMs) {
  const lockPath = getLockPath(repoPath, featureId);
  const eventsPath = getEventsPath(repoPath, featureId);
  const snapshotPath = getSnapshotPath(repoPath, featureId);
  const lockResult = await tryWithFeatureLock(lockPath, async () => {
    const { context, events } = await loadCurrentUnlocked(repoPath, featureId, eventsPath);
    const snapshot = snapshotFromContext(context, events.length);

    const nowTime = Date.now();
    const claimedEffect = snapshot.effects.find((e) => isEffectClaimHealthy(e, claimTimeoutMs, nowTime));

    if (claimedEffect !== undefined) {
      return { kind: 'busy' };
    }

    const expiredClaim = snapshot.effects.find(
      (e) =>
        e.status === 'claimed' &&
        e.claimedAt !== null &&
        nowTime - new Date(e.claimedAt).getTime() >= claimTimeoutMs,
    );

    let workingSnapshot = snapshot;
    if (expiredClaim !== undefined) {
      workingSnapshot = await applyEventsUnlocked(
        repoPath,
        featureId,
        [{ type: 'effect.claim_expired', effectId: expiredClaim.id, claimedAt: expiredClaim.claimedAt, at: now() }],
        eventsPath,
        snapshotPath,
      );
    }

    const candidate = workingSnapshot.effects.find(
      (e) => e.status === 'requested' || e.status === 'failed' || e.status === 'reclaimable',
    );

    if (candidate === undefined) {
      if (workingSnapshot.currentSpecState !== 'closing') {
        return { kind: 'complete', snapshot: workingSnapshot };
      }
      const completed = await applyEventsUnlocked(
        repoPath, featureId, [{ type: 'feature.closed', at: now() }], eventsPath, snapshotPath,
      );
      return { kind: 'complete', snapshot: completed };
    }

    await applyEventsUnlocked(
      repoPath,
      featureId,
      [
        candidate.status === 'reclaimable'
          ? { type: 'effect.reclaimed', effectId: candidate.id, at: now() }
          : { type: 'effect.claimed', effectId: candidate.id, at: now() },
      ],
      eventsPath,
      snapshotPath,
    );

    const { context: refreshedContext, events: refreshedEvents } = await loadCurrentUnlocked(repoPath, featureId, eventsPath);
    const refreshed = snapshotFromContext(refreshedContext, refreshedEvents.length);
    const claimed = refreshed.effects.find((e) => e.id === candidate.id);
    if (claimed === undefined) {
      throw new Error(`Claimed effect ${candidate.id} disappeared for feature ${featureId}`);
    }

    return { kind: 'claimed', effect: claimed };
  });

  if (lockResult.kind === 'busy') {
    return { kind: 'busy' };
  }
  return lockResult.value;
}

async function completeClaimedEffect(repoPath, featureId, effectId, error) {
  const lockPath = getLockPath(repoPath, featureId);
  const eventsPath = getEventsPath(repoPath, featureId);
  const snapshotPath = getSnapshotPath(repoPath, featureId);
  const lockResult = await tryWithFeatureLock(lockPath, async () => {
    const { context, events } = await loadCurrentUnlocked(repoPath, featureId, eventsPath);
    const snapshot = snapshotFromContext(context, events.length);
    const effect = snapshot.effects.find((e) => e.id === effectId);

    if (effect === undefined || effect.status === 'succeeded') {
      return { kind: 'complete', snapshot };
    }

    const nextSnapshot =
      error === null
        ? await applyEventsUnlocked(repoPath, featureId, [{ type: 'effect.succeeded', effectId, at: now() }], eventsPath, snapshotPath)
        : await applyEventsUnlocked(repoPath, featureId, [{ type: 'effect.failed', effectId, error, at: now() }], eventsPath, snapshotPath);

    if (nextSnapshot.currentSpecState !== 'closing') {
      return { kind: 'complete', snapshot: nextSnapshot };
    }

    const remaining = nextSnapshot.effects.filter(isEffectPending);
    if (remaining.length === 0) {
      const closed = await applyEventsUnlocked(repoPath, featureId, [{ type: 'feature.closed', at: now() }], eventsPath, snapshotPath);
      return { kind: 'complete', snapshot: closed };
    }

    return { kind: 'complete', snapshot: nextSnapshot };
  });

  return lockResult.kind === 'busy' ? { kind: 'busy' } : lockResult.value;
}

async function runPendingEffects(repoPath, featureId, effectExecutor, options = {}) {
  const claimTimeoutMs = options.claimTimeoutMs || DEFAULT_CLAIM_TIMEOUT_MS;
  const lockRetryDelayMs = options.lockRetryDelayMs || 10;
  const maxBusyRetries = options.maxBusyRetries || 25;

  for (let busyAttempts = 0; ; ) {
    const claimed = await claimNextEffect(repoPath, featureId, claimTimeoutMs);

    if (claimed.kind === 'busy') {
      if (busyAttempts >= maxBusyRetries) {
        return { kind: 'busy' };
      }
      busyAttempts += 1;
      await sleep(lockRetryDelayMs);
      continue;
    }

    busyAttempts = 0;

    if (claimed.kind === 'complete') {
      return claimed;
    }

    try {
      await effectExecutor(repoPath, featureId, claimed.effect);
      const completed = await completeClaimedEffect(repoPath, featureId, claimed.effect.id, null);
      if (completed.kind === 'complete') {
        const hasRemainingEffects = completed.snapshot.effects.some(isEffectPending);
        if (!hasRemainingEffects && completed.snapshot.currentSpecState !== 'closing') {
          return completed;
        }
        if (!hasRemainingEffects && completed.snapshot.currentSpecState === 'done') {
          return completed;
        }
      }
    } catch (error) {
      if (error instanceof EffectExecutionInterruptedError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      const failed = await completeClaimedEffect(repoPath, featureId, claimed.effect.id, message);
      if (failed.kind === 'busy') {
        return failed;
      }
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function startFeature(repoPath, featureId, mode, agents) {
  return persistEvent(repoPath, featureId, {
    type: 'feature.started',
    featureId,
    mode,
    agents,
    at: now(),
  });
}

const SIGNAL_EVENT_MAP = {
  'agent-started': 'signal.agent_started',
  'agent-waiting': 'signal.agent_waiting',
  'agent-ready': 'signal.agent_ready',
  'agent-failed': 'signal.agent_failed',
  'session-lost': 'signal.session_lost',
  'heartbeat': 'signal.heartbeat',
  'heartbeat-expired': 'signal.heartbeat_expired',
};

const TERMINAL_STATES = new Set(['done', 'closing']);

const SIGNAL_TARGET_STATUS = {
  'signal.agent_ready': 'ready',
  'signal.agent_failed': 'failed',
  'signal.session_lost': 'lost',
  'signal.heartbeat_expired': 'lost',
};

function isSignalRedundant(snapshot, eventType, agentId) {
  if (TERMINAL_STATES.has(snapshot.currentSpecState)) {
    return true;
  }

  const targetStatus = SIGNAL_TARGET_STATUS[eventType];
  if (targetStatus !== undefined) {
    const agent = snapshot.agents && snapshot.agents[agentId];
    if (agent && agent.status === targetStatus) {
      return true;
    }
  }

  return false;
}

async function emitSignal(repoPath, featureId, signal, agentId) {
  const eventType = SIGNAL_EVENT_MAP[signal];
  const eventsPath = getEventsPath(repoPath, featureId);
  const snapshotPath = getSnapshotPath(repoPath, featureId);
  const lockPath = getLockPath(repoPath, featureId);

  return withFeatureLock(lockPath, async () => {
    const { context } = await loadCurrentUnlocked(repoPath, featureId, eventsPath);

    if (isSignalRedundant(context, eventType, agentId)) {
      return snapshotFromContext(context, (await readEvents(eventsPath)).length);
    }

    return applyEventsUnlocked(repoPath, featureId, [{ type: eventType, agentId, at: now() }], eventsPath, snapshotPath);
  });
}

async function signalAgentReady(repoPath, featureId, agentId) {
  return emitSignal(repoPath, featureId, 'agent-ready', agentId);
}

async function requestFeatureEval(repoPath, featureId) {
  return persistEvent(repoPath, featureId, { type: 'feature.eval_requested', at: now() });
}

async function selectWinner(repoPath, featureId, agentId) {
  return persistEvent(repoPath, featureId, { type: 'winner.selected', agentId, at: now() });
}

async function closeFeature(repoPath, featureId) {
  return closeFeatureWithEffects(repoPath, featureId, runFeatureEffect);
}

async function closeFeatureWithEffects(repoPath, featureId, effectExecutor, options = {}) {
  const result = await tryCloseFeatureWithEffects(repoPath, featureId, effectExecutor, options);
  if (result.kind === 'busy') {
    throw new Error(`Feature ${featureId} is busy`);
  }
  return result.snapshot;
}

async function tryCloseFeatureWithEffects(repoPath, featureId, effectExecutor, options = {}) {
  const initialized = await initializeCloseEffects(repoPath, featureId);
  if (isBusyExecutionResult(initialized)) {
    return initialized;
  }
  const snapshot = initialized;
  if (snapshot.currentSpecState === 'ready_for_review') {
    return { kind: 'complete', snapshot: await showFeature(repoPath, featureId) };
  }
  if (snapshot.currentSpecState === 'closing') {
    return runPendingEffects(repoPath, featureId, effectExecutor, options);
  }
  if (snapshot.currentSpecState === 'done') {
    return { kind: 'complete', snapshot };
  }
  throw new Error(`Feature ${featureId} cannot be closed from ${snapshot.currentSpecState}`);
}

async function showFeature(repoPath, featureId) {
  const events = await readEvents(getEventsPath(repoPath, featureId));
  const context = requireContext(projectContext(events), featureId);
  const materialized = materializePendingEffects(repoPath, materializeContext(repoPath, context));
  return snapshotFromContext(materialized, events.length);
}

async function listActions(repoPath, featureId) {
  const snapshot = await showFeature(repoPath, featureId);
  return snapshot.availableActions.map((action) =>
    action.agentId === undefined ? action.kind : `${action.kind}:${action.agentId}`,
  );
}

async function listEvents(repoPath, featureId) {
  return readEvents(getEventsPath(repoPath, featureId));
}

async function pauseFeature(repoPath, featureId) {
  return persistEvent(repoPath, featureId, { type: 'feature.paused', at: now() });
}

async function resumeFeature(repoPath, featureId) {
  return persistEvent(repoPath, featureId, { type: 'feature.resumed', at: now() });
}

async function restartAgent(repoPath, featureId, agentId) {
  return persistEvent(repoPath, featureId, { type: 'agent.restarted', agentId, at: now() });
}

async function forceAgentReady(repoPath, featureId, agentId) {
  return persistEvent(repoPath, featureId, { type: 'agent.force_ready', agentId, at: now() });
}

async function dropAgent(repoPath, featureId, agentId) {
  return persistEvent(repoPath, featureId, { type: 'agent.dropped', agentId, at: now() });
}

async function escalateAgent(repoPath, featureId, agentId) {
  return persistEvent(repoPath, featureId, { type: 'agent.needs_attention', agentId, at: now() });
}

module.exports = {
  DEFAULT_CLAIM_TIMEOUT_MS,
  EffectExecutionInterruptedError,
  startFeature,
  emitSignal,
  signalAgentReady,
  requestFeatureEval,
  selectWinner,
  closeFeature,
  closeFeatureWithEffects,
  tryCloseFeatureWithEffects,
  showFeature,
  listActions,
  listEvents,
  pauseFeature,
  resumeFeature,
  restartAgent,
  forceAgentReady,
  dropAgent,
  escalateAgent,
  // Lower-level primitives for bridge modules (e.g. workflow-close)
  persistEvents,
  runPendingEffects,
  // Exported for testing
  isSignalRedundant,
};
