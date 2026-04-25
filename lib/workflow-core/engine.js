'use strict';

/**
 * Workflow engine — command dispatcher, effect orchestration, state persistence.
 *
 * Ported from aigon-next/src/workflow/engine.ts.
 * This is the main orchestration layer that coordinates events, snapshots,
 * locking, and effects into a coherent workflow lifecycle.
 */

const fs = require('fs');
const path = require('path');
const { createActor } = require('xstate');
const { featureMachine, researchMachine } = require('./machine');
const { appendEvent, readEvents } = require('./event-store');
const { writeSnapshot } = require('./snapshot-store');
const { projectContext } = require('./projector');
const { deriveAvailableActions } = require('./actions');
const { withFeatureLock, withFeatureLockRetry, tryWithFeatureLock } = require('./lock');
const { runEffects, runFeatureEffect } = require('./effects');
const { buildSpecReviewSummary } = require('../spec-review-state');
const {
  getEntityWorkflowPaths,
  getSpecPath,
  getSpecPathForEntity,
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

function getEntityIdKey(entityType) {
  return entityType === 'research' ? 'researchId' : 'featureId';
}

function withEntityLockSync(lockPath, work) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const handle = fs.openSync(lockPath, 'wx');
  try {
    return work();
  } finally {
    fs.closeSync(handle);
    fs.rmSync(lockPath, { force: true });
  }
}

function createBootstrapEvent(entityType, entityId, lifecycle, options = {}) {
  const idKey = getEntityIdKey(entityType);
  return {
    type: entityType === 'research' ? 'research.bootstrapped' : 'feature.bootstrapped',
    [idKey]: entityId,
    stage: lifecycle,
    lifecycle,
    authorAgentId: options.authorAgentId || null,
    at: now(),
  };
}

function createBootstrapSnapshot(entityType, entityId, lifecycle, specPath, timestamp, options = {}) {
  const idKey = getEntityIdKey(entityType);
  return {
    entityType,
    [idKey]: entityId,
    lifecycle,
    mode: null,
    authorAgentId: options.authorAgentId || null,
    winnerAgentId: null,
    agents: {},
    currentSpecState: lifecycle,
    specPath,
    effects: [],
    nudges: [],
    lastEffectError: null,
    availableActions: [],
    eventCount: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function rewriteWorkflowIdentityPayload(entityType, payload, fromId, toId, specPath, lifecycle = null) {
  const idKey = getEntityIdKey(entityType);
  if (payload[idKey] === fromId) payload[idKey] = toId;
  if (payload.featureId === fromId) payload.featureId = toId;
  if (payload.researchId === fromId) payload.researchId = toId;
  if (payload.specPath !== undefined) payload.specPath = specPath;
  if (lifecycle && payload.lifecycle !== undefined) payload.lifecycle = lifecycle;
  if (lifecycle && payload.currentSpecState !== undefined) payload.currentSpecState = lifecycle;
  if (lifecycle && payload.stage !== undefined) payload.stage = lifecycle;
  return payload;
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
  const prev = context.specReview || {};
  const specReview = buildSpecReviewSummary(prev.pendingReviews, {
    activeReviewers: prev.activeReviewers,
    activeCheckers: prev.activeCheckers,
  });
  return {
    featureId: context.featureId,
    lifecycle: context.currentSpecState,
    mode: context.mode,
    authorAgentId: context.authorAgentId || null,
    winnerAgentId: context.winnerAgentId,
    agents: context.agents,
    agentFailover: context.agentFailover || null,
    pauseReason: context.pauseReason || null,
    currentSpecState: context.currentSpecState,
    specPath: context.specPath,
    specReview,
    codeReview: context.codeReview || null,
    pendingSpecReviews: specReview.pendingReviews,
    // Feature 341 introduces `reviewCycles[]` as a projected context array.
    // Populated by feature 3 in the review-cycle-redesign set (multi-cycle
    // history). Initialized empty here so consumers can safely read it.
    reviewCycles: Array.isArray(context.reviewCycles) ? context.reviewCycles.slice() : [],
    nudges: Array.isArray(context.nudges) ? context.nudges.slice() : [],
    effects: context.effects,
    lastEffectError: context.lastEffectError,
    lastCloseFailure: context.lastCloseFailure || null,
    availableActions: deriveAvailableActions(context),
    eventCount,
    createdAt: context.createdAt,
    updatedAt: context.updatedAt,
  };
}

function appendNudgeToContext(context, event) {
  return {
    ...context,
    nudges: [
      ...((Array.isArray(context.nudges) ? context.nudges : [])),
      {
        agentId: event.agentId,
        role: event.role || 'do',
        text: event.text || '',
        atISO: event.atISO || event.at,
      },
    ].slice(-20),
    updatedAt: event.atISO || event.at,
  };
}

function computeSpecPath(repoPath, featureId, lifecycle, snapshot) {
  return getSpecPath(repoPath, featureId, lifecycle, { snapshot });
}

function getFeatureWorkflowPaths(repoPath, featureId) {
  return getEntityWorkflowPaths(repoPath, 'feature', featureId);
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
        toPath: computeSpecPath(repoPath, next.featureId, next.currentSpecState, next),
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
    specPath: computeSpecPath(repoPath, context.featureId, resolvedSpecLifecycle, context),
  };
}

function materializePendingEffects(repoPath, context) {
  return {
    ...context,
    effects: context.effects.map((effect) => {
      if (effect.id === 'close.move_spec_to_done') {
        // Preserve the fromPath stored when buildCloseEffects ran (before the closing
        // transition). Re-computing from context.specPath is wrong here because
        // materializeContext maps 'closing'-with-pending-move to 'ready_for_review'
        // (04-in-evaluation), but the spec may actually be at 03-in-progress when
        // the feature was closed from an in-progress code state.
        const fromPath = (effect.payload && effect.payload.fromPath) || context.specPath;
        return {
          ...effect,
          payload: {
            fromPath,
            toPath: computeSpecPath(repoPath, context.featureId, 'done', context),
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

function applySpecReviewEventToContext(context, event) {
  const prev = context.specReview || {};
  const pendingReviews = prev.pendingReviews || [];
  const activeReviewers = Array.isArray(prev.activeReviewers) ? prev.activeReviewers : [];
  const activeCheckers = Array.isArray(prev.activeCheckers) ? prev.activeCheckers : [];

  if (event.type === 'spec_review.started') {
    const reviewerId = String(event.reviewerId || '').trim();
    if (!reviewerId) return context;
    return {
      ...context,
      specReview: buildSpecReviewSummary(pendingReviews, {
        activeReviewers: [
          ...activeReviewers.filter((entry) => entry.agentId !== reviewerId),
          { agentId: reviewerId, startedAt: event.at },
        ],
        activeCheckers,
      }),
      updatedAt: event.at,
    };
  }

  if (event.type === 'spec_review.check_started') {
    const checkerId = String(event.checkerId || '').trim();
    if (!checkerId) return context;
    return {
      ...context,
      specReview: buildSpecReviewSummary(pendingReviews, {
        activeReviewers,
        activeCheckers: [
          ...activeCheckers.filter((entry) => entry.agentId !== checkerId),
          { agentId: checkerId, startedAt: event.at },
        ],
      }),
      updatedAt: event.at,
    };
  }

  if (event.type === 'spec_review.submitted') {
    return {
      ...context,
      specReview: buildSpecReviewSummary(
        [
          ...pendingReviews.filter((review) => review.reviewId !== event.reviewId),
          {
            reviewId: event.reviewId,
            reviewerId: event.reviewerId,
            summary: event.summary || '',
            submittedAt: event.at,
            commitSha: event.commitSha || null,
          },
        ],
        {
          activeReviewers: activeReviewers.filter((entry) => entry.agentId !== event.reviewerId),
          activeCheckers,
        },
      ),
      updatedAt: event.at,
    };
  }

  // spec_review.acked
  const ackedIds = new Set(Array.isArray(event.reviewIds) ? event.reviewIds : []);
  return {
    ...context,
    specReview: buildSpecReviewSummary(
      ackedIds.size === 0
        ? []
        : pendingReviews.filter((review) => !ackedIds.has(review.reviewId)),
      {
        activeReviewers,
        activeCheckers: [],
      },
    ),
    updatedAt: event.at,
  };
}

function resolveCodeRevisionAgent(context) {
  const agents = context && context.agents ? Object.keys(context.agents) : [];
  if (context && context.mode === 'fleet') {
    return context.winnerAgentId || context.authorAgentId || agents[0] || null;
  }
  return agents[0] || context.authorAgentId || null;
}

function applyCodeReviewEventToContext(context, event) {
  if (event.type.endsWith('code_review.started')) {
    return {
      ...context,
      codeReview: {
        ...(context.codeReview || {}),
        activeReviewerId: event.reviewerId || event.agentId || null,
        reviewStartedAt: event.at,
        reviewCompletedAt: null,
        requestRevision: null,
      },
      updatedAt: event.at,
    };
  }

  if (event.type.endsWith('code_review.completed')) {
    const requestRevision = event.requestRevision === false ? false : true;
    return {
      ...context,
      codeReview: {
        ...(context.codeReview || {}),
        activeReviewerId: null,
        reviewerId: event.reviewerId || event.agentId || (context.codeReview && context.codeReview.activeReviewerId) || null,
        reviewCompletedAt: event.at,
        requestRevision,
        revisionAgentId: requestRevision ? resolveCodeRevisionAgent(context) : null,
      },
      updatedAt: event.at,
    };
  }

  if (event.type.endsWith('code_revision.started')) {
    return {
      ...context,
      codeReview: {
        ...(context.codeReview || {}),
        revisionAgentId: event.revisionAgentId || resolveCodeRevisionAgent(context),
        revisionStartedAt: event.at,
        revisionCompletedAt: null,
      },
      updatedAt: event.at,
    };
  }

  return {
    ...context,
    codeReview: {
      ...(context.codeReview || {}),
      revisionAgentId: event.revisionAgentId || (context.codeReview && context.codeReview.revisionAgentId) || resolveCodeRevisionAgent(context),
      revisionCompletedAt: event.at,
    },
    updatedAt: event.at,
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
      return {
        ...actor.getSnapshot().context,
        pauseReason: event.reason || null,
        updatedAt: event.at,
        currentSpecState: actor.getSnapshot().value,
      };
    case 'feature.resumed':
      sendIfAllowed({ type: 'feature.resume', at: event.at });
      return {
        ...actor.getSnapshot().context,
        pauseReason: null,
        updatedAt: event.at,
        currentSpecState: actor.getSnapshot().value,
      };
    case 'feature.eval_requested':
      sendIfAllowed({ type: 'feature.eval', at: event.at });
      break;
    case 'feature.review_requested':
      sendIfAllowed({ type: 'feature.code_review.started', reviewerId: event.reviewerId || event.agentId, at: event.at });
      return {
        ...applyCodeReviewEventToContext(actor.getSnapshot().context, {
          type: 'feature.code_review.started',
          reviewerId: event.reviewerId || event.agentId,
          at: event.at,
        }),
        currentSpecState: actor.getSnapshot().value,
      };
    case 'feature.code_review.started':
      sendIfAllowed({ type: 'feature.code_review.started', reviewerId: event.reviewerId || event.agentId, at: event.at });
      return {
        ...applyCodeReviewEventToContext(actor.getSnapshot().context, event),
        currentSpecState: actor.getSnapshot().value,
      };
    case 'feature.code_review.completed':
      sendIfAllowed({
        type: 'feature.code_review.completed',
        reviewerId: event.reviewerId || event.agentId,
        requestRevision: event.requestRevision,
        at: event.at,
      });
      return {
        ...applyCodeReviewEventToContext(actor.getSnapshot().context, event),
        currentSpecState: actor.getSnapshot().value,
      };
    case 'feature.code_revision.started':
      sendIfAllowed({ type: 'feature.code_revision.started', revisionAgentId: event.revisionAgentId, at: event.at });
      return {
        ...applyCodeReviewEventToContext(actor.getSnapshot().context, event),
        currentSpecState: actor.getSnapshot().value,
      };
    case 'feature.code_revision.completed':
      sendIfAllowed({ type: 'feature.code_revision.completed', revisionAgentId: event.revisionAgentId, at: event.at });
      return {
        ...applyCodeReviewEventToContext(actor.getSnapshot().context, event),
        currentSpecState: actor.getSnapshot().value,
      };
    case 'winner.selected':
      sendIfAllowed({ type: 'select-winner', agentId: event.agentId, at: event.at });
      break;
    case 'feature.close_requested':
      sendIfAllowed({ type: 'feature.close', at: event.at });
      break;
    case 'operator.nudge_sent':
      return appendNudgeToContext(context, event);
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
      return {
        ...actor.getSnapshot().context,
        lastCloseFailure: null,
        updatedAt: event.at,
        currentSpecState: actor.getSnapshot().value,
      };
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
    case 'agent.token_exhausted':
      if (context.agents[event.agentId] === undefined) return context;
      return {
        ...context,
        agents: {
          ...context.agents,
          [event.agentId]: {
            ...context.agents[event.agentId],
            status: 'needs_attention',
            tokenExhausted: {
              role: event.role || 'do',
              lastCommit: event.lastCommit || null,
              tokensConsumed: event.tokensConsumed != null ? Number(event.tokensConsumed) : null,
              limit: event.limit != null ? Number(event.limit) : null,
              source: event.source || null,
              currentAgentId: event.currentAgentId || context.agents[event.agentId].currentAgentId || event.agentId,
              at: event.at,
            },
          },
        },
        updatedAt: event.at,
      };
    case 'agent.failover_switched':
      if (context.agents[event.agentId] === undefined) return context;
      return {
        ...context,
        agents: {
          ...context.agents,
          [event.agentId]: {
            ...context.agents[event.agentId],
            status: 'running',
            previousAgentId: context.agents[event.agentId].currentAgentId || event.agentId,
            resumedFromAgentId: event.previousAgentId || context.agents[event.agentId].currentAgentId || event.agentId,
            currentAgentId: event.replacementAgentId || context.agents[event.agentId].currentAgentId || event.agentId,
            tokenExhausted: null,
            lastHeartbeatAt: event.at,
          },
        },
        updatedAt: event.at,
      };
    case 'agent.marked_ready':
    case 'signal.agent_submitted':
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
      // Display-only: record the event timestamp but do NOT change agent status.
      // Liveness is a dashboard concern, not an engine state concern.
      if (context.agents[event.agentId] === undefined) return context;
      return {
        ...context,
        agents: {
          ...context.agents,
          [event.agentId]: { ...context.agents[event.agentId], lastHeartbeatExpiredAt: event.at },
        },
        updatedAt: event.at,
      };
    case 'feature_close.failed':
      return {
        ...context,
        lastCloseFailure: {
          kind: event.kind || 'other',
          conflictFiles: Array.isArray(event.conflictFiles) ? event.conflictFiles : [],
          stderrTail: event.stderrTail || '',
          at: event.at,
        },
        updatedAt: event.at,
      };
    case 'spec_review.started':
    case 'spec_review.check_started':
    case 'spec_review.submitted':
    case 'spec_review.acked':
      return applySpecReviewEventToContext(context, event);
    case 'feature.spec_review.started':
      sendIfAllowed({ type: 'feature.spec_review.started', at: event.at });
      return {
        ...applySpecReviewEventToContext(actor.getSnapshot().context, { type: 'spec_review.started', reviewerId: event.reviewerId, at: event.at }),
        updatedAt: event.at,
        currentSpecState: actor.getSnapshot().value,
      };
    case 'feature.spec_review.completed':
      if (snapshot.can({ type: 'feature.spec_review.completed', at: event.at })) {
        actor.send({ type: 'feature.spec_review.completed', at: event.at });
      }
      return {
        ...actor.getSnapshot().context,
        specReview: {
          ...(context.specReview || {}),
          activeReviewers: (context.specReview && context.specReview.activeReviewers || [])
            .filter((entry) => entry.agentId !== event.reviewerId),
        },
        updatedAt: event.at,
        currentSpecState: actor.getSnapshot().value,
      };
    case 'feature.spec_revision.started':
      sendIfAllowed({ type: 'feature.spec_revision.started', at: event.at });
      return {
        ...applySpecReviewEventToContext(actor.getSnapshot().context, { type: 'spec_review.check_started', checkerId: event.checkerId || event.reviewerId, at: event.at }),
        updatedAt: event.at,
        currentSpecState: actor.getSnapshot().value,
      };
    case 'feature.spec_revision.completed':
      if (snapshot.can({ type: 'feature.spec_revision.completed', at: event.at })) {
        actor.send({ type: 'feature.spec_revision.completed', at: event.at });
      }
      return {
        ...actor.getSnapshot().context,
        specReview: {
          ...(context.specReview || {}),
          activeCheckers: [],
        },
        updatedAt: event.at,
        currentSpecState: actor.getSnapshot().value,
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
  if (projected === null) return null;
  return materializePendingEffects(repoPath, materializeContext(repoPath, projected));
}

async function loadCurrentUnlocked(repoPath, featureId, eventsPath) {
  eventsPath = eventsPath || getFeatureWorkflowPaths(repoPath, featureId).eventsPath;
  const events = await readEvents(eventsPath);
  const context = await loadFeatureContextFromEvents(repoPath, featureId, events);
  return { events, context };
}

async function applyEventsUnlocked(repoPath, featureId, newEvents, eventsPath, snapshotPath) {
  if (!eventsPath || !snapshotPath) {
    const paths = getFeatureWorkflowPaths(repoPath, featureId);
    eventsPath = eventsPath || paths.eventsPath;
    snapshotPath = snapshotPath || paths.snapshotPath;
  }

  const previousEvents = await readEvents(eventsPath);
  const previous =
    previousEvents.length === 0 ? null : await loadFeatureContextFromEvents(repoPath, featureId, previousEvents);

  let next = previous;
  let priorForEffects = previous;

  const seenEvents = [...previousEvents];
  for (const event of newEvents) {
    if (event.type === 'feature.started' || event.type === 'feature.bootstrapped') {
      // Both events fully (re)seed the context via the projector — applyTransition's
      // xstate path can't recreate the agents map from an event payload.
      seenEvents.push(event);
      next = await loadFeatureContextFromEvents(repoPath, featureId, seenEvents);
    } else {
      seenEvents.push(event);
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
  const { eventsPath, snapshotPath, lockPath } = getFeatureWorkflowPaths(repoPath, featureId);

  return withFeatureLock(lockPath, async () =>
    applyEventsUnlocked(repoPath, featureId, newEvents, eventsPath, snapshotPath),
  );
}

async function persistEntityEvents(repoPath, entityType, entityId, newEvents) {
  return entityType === 'research'
    ? persistResearchEvents(repoPath, entityId, newEvents)
    : persistEvents(repoPath, entityId, newEvents);
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
        toPath: computeSpecPath(repoPath, context.featureId, 'done', context),
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

  if (snapshot.currentSpecState === 'closing' || snapshot.currentSpecState === 'done') {
    return snapshot;
  }

  const closeEffects = buildCloseEffects(repoPath, snapshot);
  const { lockPath, eventsPath, snapshotPath } = getFeatureWorkflowPaths(repoPath, featureId);
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
  const { lockPath, eventsPath, snapshotPath } = getFeatureWorkflowPaths(repoPath, featureId);
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
  const { lockPath, eventsPath, snapshotPath } = getFeatureWorkflowPaths(repoPath, featureId);
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

async function startFeature(repoPath, featureId, mode, agents, options = {}) {
  const event = {
    type: 'feature.started',
    featureId,
    mode,
    agents,
    at: now(),
  };
  if (options.authorAgentId) {
    event.authorAgentId = String(options.authorAgentId).trim() || null;
  }
  // Per-agent model/effort overrides captured at start time. Empty or
  // missing objects mean "no overrides" — unchanged behaviour from before
  // this feature. Persisting the overrides on the started event (rather
  // than a follow-up event) is what lets every respawn path read them
  // back from the projected snapshot.
  const modelOverrides = options.modelOverrides || null;
  const effortOverrides = options.effortOverrides || null;
  if (modelOverrides && Object.keys(modelOverrides).length > 0) {
    event.modelOverrides = { ...modelOverrides };
  }
  if (effortOverrides && Object.keys(effortOverrides).length > 0) {
    event.effortOverrides = { ...effortOverrides };
  }
  if (options.agentFailover && typeof options.agentFailover === 'object') {
    event.agentFailover = { ...options.agentFailover };
  }
  return persistEvent(repoPath, featureId, event);
}

const SIGNAL_EVENT_MAP = {
  'agent-started': 'signal.agent_started',
  'agent-waiting': 'signal.agent_waiting',
  'agent-ready': 'signal.agent_ready',
  'agent-failed': 'signal.agent_failed',
  'session-lost': 'signal.session_lost',
  'heartbeat': 'signal.heartbeat',
  'heartbeat-expired': 'signal.heartbeat_expired',
  'agent-submitted': 'signal.agent_submitted',
};

const TERMINAL_STATES = new Set(['done', 'closing']);

const SIGNAL_TARGET_STATUS = {
  'signal.agent_ready': 'ready',
  'signal.agent_failed': 'failed',
  // session_lost and heartbeat_expired no longer transition to 'lost' —
  // they are display-only signals that record timestamps without changing agent status.
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

async function emitSignal(repoPath, featureId, signal, agentId, options = {}) {
  if (options.entityType === 'research') {
    return emitResearchSignal(repoPath, featureId, signal, agentId);
  }
  const eventType = SIGNAL_EVENT_MAP[signal];
  const { eventsPath, snapshotPath, lockPath } = getFeatureWorkflowPaths(repoPath, featureId);

  return withFeatureLockRetry(lockPath, async () => {
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

async function recordCodeReviewStarted(repoPath, entityType, entityId, payload = {}) {
  const prefix = entityType === 'research' ? 'research' : 'feature';
  return persistEntityEvents(repoPath, entityType, entityId, [{
    type: `${prefix}.code_review.started`,
    reviewerId: payload.reviewerId || payload.agentId || null,
    at: payload.at || now(),
    source: payload.source || null,
  }]);
}

async function recordCodeReviewCompleted(repoPath, entityType, entityId, payload = {}) {
  const prefix = entityType === 'research' ? 'research' : 'feature';
  return persistEntityEvents(repoPath, entityType, entityId, [{
    type: `${prefix}.code_review.completed`,
    reviewerId: payload.reviewerId || payload.agentId || null,
    requestRevision: payload.requestRevision === false ? false : true,
    at: payload.at || now(),
    source: payload.source || null,
  }]);
}

async function recordCodeRevisionStarted(repoPath, entityType, entityId, payload = {}) {
  const prefix = entityType === 'research' ? 'research' : 'feature';
  return persistEntityEvents(repoPath, entityType, entityId, [{
    type: `${prefix}.code_revision.started`,
    revisionAgentId: payload.revisionAgentId || null,
    at: payload.at || now(),
    source: payload.source || null,
  }]);
}

async function recordCodeRevisionCompleted(repoPath, entityType, entityId, payload = {}) {
  const prefix = entityType === 'research' ? 'research' : 'feature';
  return persistEntityEvents(repoPath, entityType, entityId, [{
    type: `${prefix}.code_revision.completed`,
    revisionAgentId: payload.revisionAgentId || null,
    at: payload.at || now(),
    source: payload.source || null,
  }]);
}

async function selectWinner(repoPath, featureId, agentId) {
  return persistEvent(repoPath, featureId, { type: 'winner.selected', agentId, at: now() });
}

async function closeFeature(repoPath, featureId) {
  return closeFeatureWithEffects(repoPath, featureId, runFeatureEffect);
}

/**
 * Destructively remove all workflow-core state for a feature.
 * Used by `aigon feature-reset` to return a feature to the "never started"
 * state. Out-of-band: this does NOT emit an event — it wipes the event log.
 * Idempotent: silent no-op when the feature root does not exist.
 */
async function resetFeature(repoPath, featureId) {
  const { root } = getFeatureWorkflowPaths(repoPath, featureId);
  if (!fs.existsSync(root)) {
    return { removed: false, path: root };
  }
  fs.rmSync(root, { recursive: true, force: true });
  return { removed: true, path: root };
}

/**
 * Destructively remove all workflow-core state for a research topic.
 * Used by `aigon research-reset` to return research to a fresh backlog state.
 * Out-of-band: this does NOT emit an event — it wipes the event log.
 * Idempotent: silent no-op when the research root does not exist.
 */
async function resetResearch(repoPath, researchId) {
  const { root } = getResearchWorkflowPaths(repoPath, researchId);
  if (!fs.existsSync(root)) {
    return { removed: false, path: root };
  }
  fs.rmSync(root, { recursive: true, force: true });
  return { removed: true, path: root };
}

/**
 * Pre-validate whether a feature can transition from its current state into `closing`.
 * Pure read — no events persisted, no side effects. Used by feature-close to abort
 * BEFORE git side-effects (auto-commit, push, merge) when the engine would reject the
 * transition, preventing the half-closed state where the branch is merged but the
 * snapshot stays at `implementing`.
 *
 * Returns { ok: true, snapshot } when closable, or { ok: false, snapshot, reason } otherwise.
 */
async function canCloseFeature(repoPath, featureId) {
  const snapshot = await showFeatureOrNull(repoPath, featureId);
  if (!snapshot) {
    return { ok: false, snapshot: null, reason: `Feature ${featureId} has no workflow state.` };
  }
  if (snapshot.specReview && snapshot.specReview.pendingCount > 0 && snapshot.currentSpecState !== 'closing' && snapshot.currentSpecState !== 'done') {
    const pendingAgents = (snapshot.specReview.pendingAgents || []).join(', ') || 'unknown reviewer';
    return {
      ok: false,
      snapshot,
      reason: `Feature ${featureId} has ${snapshot.specReview.pendingCount} pending spec review(s) from ${pendingAgents}. Run \`aigon feature-spec-revise ${featureId}\` before closing.`,
    };
  }
  // States that the normal close path handles itself (resume / select-winner / etc).
  // We only block the specific failure mode that left the repo half-closed: stuck
  // in `implementing` (or earlier) with no ready agent.
  const passThroughStates = new Set(['closing', 'done', 'evaluating', 'ready_for_review', 'submitted', 'code_review_in_progress', 'code_revision_in_progress']);
  if (passThroughStates.has(snapshot.currentSpecState)) {
    return { ok: true, snapshot };
  }
  const actor = createActor(featureMachine, { input: snapshot });
  actor.start();
  const xstate = actor.getSnapshot();
  if (xstate.can({ type: 'feature.close', at: now() })) {
    return { ok: true, snapshot };
  }
  const agentSummary = Object.entries(snapshot.agents || {})
    .map(([id, a]) => `${id}=${a.status}`)
    .join(', ') || '<none>';
  return {
    ok: false,
    snapshot,
    reason: `Feature ${featureId} is not ready to close (state=${snapshot.currentSpecState}, agents=${agentSummary}).`,
  };
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
  const events = await readEvents(getFeatureWorkflowPaths(repoPath, featureId).eventsPath);
  const context = requireContext(projectContext(events), featureId);
  const materialized = materializePendingEffects(repoPath, materializeContext(repoPath, context));
  return snapshotFromContext(materialized, events.length);
}

async function showFeatureOrNull(repoPath, featureId) {
  const events = await readEvents(getFeatureWorkflowPaths(repoPath, featureId).eventsPath);
  const context = projectContext(events);
  if (context === null) return null;
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
  return readEvents(getFeatureWorkflowPaths(repoPath, featureId).eventsPath);
}

async function pauseFeature(repoPath, featureId) {
  return persistEvent(repoPath, featureId, { type: 'feature.paused', at: now() });
}

async function pauseFeatureForReason(repoPath, featureId, reason) {
  return persistEvent(repoPath, featureId, { type: 'feature.paused', reason: reason || null, at: now() });
}

async function resumeFeature(repoPath, featureId) {
  return persistEvent(repoPath, featureId, { type: 'feature.resumed', at: now() });
}

async function restartAgent(repoPath, featureId, agentId) {
  return persistEvent(repoPath, featureId, { type: 'agent.restarted', agentId, at: now() });
}

async function restartResearchAgent(repoPath, researchId, agentId) {
  return persistResearchEvents(repoPath, researchId, [{ type: 'agent.restarted', agentId, at: now() }]);
}

async function forceResearchAgentReady(repoPath, researchId, agentId) {
  return persistResearchEvents(repoPath, researchId, [{ type: 'agent.force_ready', agentId, at: now() }]);
}

async function dropResearchAgent(repoPath, researchId, agentId) {
  return persistResearchEvents(repoPath, researchId, [{ type: 'agent.dropped', agentId, at: now() }]);
}

async function escalateResearchAgent(repoPath, researchId, agentId) {
  return persistResearchEvents(repoPath, researchId, [{ type: 'agent.needs_attention', agentId, at: now() }]);
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

async function recordAgentTokenExhausted(repoPath, featureId, payload) {
  return persistEvent(repoPath, featureId, {
    type: 'agent.token_exhausted',
    agentId: payload.agentId,
    role: payload.role || 'do',
    lastCommit: payload.lastCommit || null,
    tokensConsumed: payload.tokensConsumed != null ? payload.tokensConsumed : null,
    limit: payload.limit != null ? payload.limit : null,
    source: payload.source || null,
    currentAgentId: payload.currentAgentId || payload.agentId,
    at: payload.at || now(),
  });
}

async function recordAgentFailoverSwitch(repoPath, featureId, payload) {
  return persistEvent(repoPath, featureId, {
    type: 'agent.failover_switched',
    agentId: payload.agentId,
    previousAgentId: payload.previousAgentId || null,
    replacementAgentId: payload.replacementAgentId,
    source: payload.source || null,
    lastCommit: payload.lastCommit || null,
    at: payload.at || now(),
  });
}

function getResearchWorkflowPaths(repoPath, researchId) {
  return getEntityWorkflowPaths(repoPath, 'research', researchId);
}

function requireResearchContext(context, researchId) {
  if (context === null) {
    throw new Error(`Research ${researchId} does not exist`);
  }
  return context;
}

function computeResearchSpecPath(repoPath, researchId, lifecycle, snapshot) {
  return getSpecPathForEntity(repoPath, 'research', researchId, lifecycle, { snapshot });
}

function snapshotFromResearchContext(context, eventCount) {
  const prev = context.specReview || {};
  const specReview = buildSpecReviewSummary(prev.pendingReviews, {
    activeReviewers: prev.activeReviewers,
    activeCheckers: prev.activeCheckers,
  });
  return {
    researchId: context.featureId,
    entityType: 'research',
    lifecycle: context.currentSpecState,
    mode: context.mode,
    authorAgentId: context.authorAgentId || null,
    agents: context.agents,
    currentSpecState: context.currentSpecState,
    specPath: context.specPath,
    specReview,
    codeReview: context.codeReview || null,
    pendingSpecReviews: specReview.pendingReviews,
    nudges: Array.isArray(context.nudges) ? context.nudges.slice() : [],
    effects: context.effects,
    lastEffectError: context.lastEffectError,
    availableActions: deriveAvailableActions(context, 'research'),
    eventCount,
    createdAt: context.createdAt,
    updatedAt: context.updatedAt,
  };
}

function materializeResearchContext(repoPath, context) {
  const hasPendingDoneMove = context.effects.some(
    (effect) => effect.id === 'close.move_spec_to_done' && effect.status !== 'succeeded',
  );
  const resolvedSpecLifecycle =
    context.currentSpecState === 'closing'
      ? hasPendingDoneMove
        ? 'evaluating'
        : 'done'
      : context.currentSpecState;

  return {
    ...context,
    entityType: 'research',
    specPath: computeResearchSpecPath(repoPath, context.featureId, resolvedSpecLifecycle, context),
  };
}

function materializeResearchPendingEffects(repoPath, context) {
  return {
    ...context,
    effects: context.effects.map((effect) => {
      if (effect.id === 'close.move_spec_to_done') {
        const fromPath = (effect.payload && effect.payload.fromPath) || context.specPath;
        return {
          ...effect,
          payload: {
            fromPath,
            toPath: computeResearchSpecPath(repoPath, context.featureId, 'done', context),
          },
        };
      }
      return effect;
    }),
  };
}

function applyResearchTransition(context, event) {
  const actor = createActor(researchMachine, { input: context });
  actor.start();
  const snapshot = actor.getSnapshot();

  function sendIfAllowed(machineEvent) {
    if (!snapshot.can(machineEvent)) {
      throw new Error(`Event ${machineEvent.type} is invalid for research ${context.featureId}`);
    }
    actor.send(machineEvent);
  }

  switch (event.type) {
    case 'research.paused':
      sendIfAllowed({ type: 'research.pause', at: event.at });
      break;
    case 'research.resumed':
      sendIfAllowed({ type: 'research.resume', at: event.at });
      break;
    case 'research.review_requested':
      sendIfAllowed({ type: 'research.code_review.started', reviewerId: event.reviewerId || event.agentId, at: event.at });
      return {
        ...applyCodeReviewEventToContext(actor.getSnapshot().context, {
          type: 'research.code_review.started',
          reviewerId: event.reviewerId || event.agentId,
          at: event.at,
        }),
        entityType: 'research',
        currentSpecState: actor.getSnapshot().value,
      };
    case 'research.code_review.started':
      sendIfAllowed({ type: 'research.code_review.started', reviewerId: event.reviewerId || event.agentId, at: event.at });
      return {
        ...applyCodeReviewEventToContext(actor.getSnapshot().context, event),
        entityType: 'research',
        currentSpecState: actor.getSnapshot().value,
      };
    case 'research.code_review.completed':
      sendIfAllowed({
        type: 'research.code_review.completed',
        reviewerId: event.reviewerId || event.agentId,
        requestRevision: event.requestRevision,
        at: event.at,
      });
      return {
        ...applyCodeReviewEventToContext(actor.getSnapshot().context, event),
        entityType: 'research',
        currentSpecState: actor.getSnapshot().value,
      };
    case 'research.code_revision.started':
      sendIfAllowed({ type: 'research.code_revision.started', revisionAgentId: event.revisionAgentId, at: event.at });
      return {
        ...applyCodeReviewEventToContext(actor.getSnapshot().context, event),
        entityType: 'research',
        currentSpecState: actor.getSnapshot().value,
      };
    case 'research.code_revision.completed':
      sendIfAllowed({ type: 'research.code_revision.completed', revisionAgentId: event.revisionAgentId, at: event.at });
      return {
        ...applyCodeReviewEventToContext(actor.getSnapshot().context, event),
        entityType: 'research',
        currentSpecState: actor.getSnapshot().value,
      };
    case 'research.eval_requested':
      sendIfAllowed({ type: 'research.eval', at: event.at });
      break;
    case 'research.close_requested':
      sendIfAllowed({ type: 'research.close', at: event.at });
      break;
    case 'operator.nudge_sent':
      return appendNudgeToContext(context, event);
    case 'research.closed':
      sendIfAllowed({ type: 'research.closed', at: event.at });
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
    case 'signal.agent_submitted':
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
      // Display-only: record the event timestamp but do NOT change agent status.
      // Liveness is a dashboard concern, not an engine state concern.
      if (context.agents[event.agentId] === undefined) return context;
      return {
        ...context,
        agents: {
          ...context.agents,
          [event.agentId]: { ...context.agents[event.agentId], lastHeartbeatExpiredAt: event.at },
        },
        updatedAt: event.at,
      };
    case 'spec_review.started':
    case 'spec_review.check_started':
    case 'spec_review.submitted':
    case 'spec_review.acked':
      return applySpecReviewEventToContext(context, event);
    case 'research.spec_review.started':
      sendIfAllowed({ type: 'research.spec_review.started', at: event.at });
      return {
        ...applySpecReviewEventToContext(actor.getSnapshot().context, { type: 'spec_review.started', reviewerId: event.reviewerId, at: event.at }),
        entityType: 'research',
        updatedAt: event.at,
        currentSpecState: actor.getSnapshot().value,
      };
    case 'research.spec_review.completed':
      if (snapshot.can({ type: 'research.spec_review.completed', at: event.at })) {
        actor.send({ type: 'research.spec_review.completed', at: event.at });
      }
      return {
        ...actor.getSnapshot().context,
        entityType: 'research',
        specReview: {
          ...(context.specReview || {}),
          activeReviewers: (context.specReview && context.specReview.activeReviewers || [])
            .filter((entry) => entry.agentId !== event.reviewerId),
        },
        updatedAt: event.at,
        currentSpecState: actor.getSnapshot().value,
      };
    case 'research.spec_revision.started':
      sendIfAllowed({ type: 'research.spec_revision.started', at: event.at });
      return {
        ...applySpecReviewEventToContext(actor.getSnapshot().context, { type: 'spec_review.check_started', checkerId: event.checkerId || event.reviewerId, at: event.at }),
        entityType: 'research',
        updatedAt: event.at,
        currentSpecState: actor.getSnapshot().value,
      };
    case 'research.spec_revision.completed':
      if (snapshot.can({ type: 'research.spec_revision.completed', at: event.at })) {
        actor.send({ type: 'research.spec_revision.completed', at: event.at });
      }
      return {
        ...actor.getSnapshot().context,
        entityType: 'research',
        specReview: {
          ...(context.specReview || {}),
          activeCheckers: [],
        },
        updatedAt: event.at,
        currentSpecState: actor.getSnapshot().value,
      };
    default:
      break;
  }

  const nextSnapshot = actor.getSnapshot();
  return {
    ...nextSnapshot.context,
    entityType: 'research',
    updatedAt: event.at,
    currentSpecState: nextSnapshot.value,
  };
}

function buildResearchEffects(repoPath, previous, next, event) {
  const effects = [];
  const previousState = previous ? previous.currentSpecState : 'backlog';

  if (event.type === 'research.started') {
    effects.push({
      id: 'research.start.move_spec',
      type: 'move_spec',
      payload: {
        fromPath: computeResearchSpecPath(repoPath, next.featureId, 'backlog', next),
        toPath: computeResearchSpecPath(repoPath, next.featureId, next.currentSpecState, next),
      },
    });
  }

  if (
    previous !== null &&
    previousState !== next.currentSpecState &&
    event.type !== 'research.close_requested' &&
    event.type !== 'research.closed'
  ) {
    effects.push({
      id: `spec.move.${previousState}.to.${next.currentSpecState}`,
      type: 'move_spec',
      payload: {
        fromPath: previous.specPath,
        toPath: computeResearchSpecPath(repoPath, next.featureId, next.currentSpecState, next),
      },
    });
  }

  return effects;
}

async function loadResearchContextFromEvents(repoPath, researchId, events) {
  const projected = projectContext(events);
  return materializeResearchPendingEffects(
    repoPath,
    materializeResearchContext(repoPath, requireResearchContext(projected, researchId)),
  );
}

async function loadCurrentResearchUnlocked(repoPath, researchId, eventsPath) {
  eventsPath = eventsPath || getResearchWorkflowPaths(repoPath, researchId).eventsPath;
  const events = await readEvents(eventsPath);
  const context = await loadResearchContextFromEvents(repoPath, researchId, events);
  return { events, context };
}

async function applyResearchEventsUnlocked(repoPath, researchId, newEvents, eventsPath, snapshotPath) {
  if (!eventsPath || !snapshotPath) {
    const paths = getResearchWorkflowPaths(repoPath, researchId);
    eventsPath = eventsPath || paths.eventsPath;
    snapshotPath = snapshotPath || paths.snapshotPath;
  }

  const previousEvents = await readEvents(eventsPath);
  const previous =
    previousEvents.length === 0 ? null : await loadResearchContextFromEvents(repoPath, researchId, previousEvents);

  let next = previous;
  let priorForEffects = previous;

  for (const event of newEvents) {
    if (event.type === 'research.started' || event.type === 'research.bootstrapped') {
      next = await loadResearchContextFromEvents(repoPath, researchId, [...previousEvents, event]);
    } else {
      next = applyResearchTransition(requireResearchContext(next, researchId), event);
      next = materializeResearchPendingEffects(repoPath, materializeResearchContext(repoPath, next));
    }

    await appendEvent(eventsPath, event);
    const immediateEffects = buildResearchEffects(repoPath, priorForEffects, requireResearchContext(next, researchId), event);
    await runEffects(repoPath, researchId, immediateEffects);
    priorForEffects = requireResearchContext(next, researchId);
  }

  const snapshot = snapshotFromResearchContext(
    requireResearchContext(next, researchId),
    previousEvents.length + newEvents.length,
  );
  await writeSnapshot(snapshotPath, snapshot);
  return snapshot;
}

async function persistResearchEvents(repoPath, researchId, newEvents) {
  const { eventsPath, snapshotPath, lockPath } = getResearchWorkflowPaths(repoPath, researchId);
  return withFeatureLock(lockPath, async () =>
    applyResearchEventsUnlocked(repoPath, researchId, newEvents, eventsPath, snapshotPath),
  );
}

async function startResearch(repoPath, researchId, mode, agents = []) {
  const { eventsPath, snapshotPath, lockPath } = getResearchWorkflowPaths(repoPath, researchId);
  return withFeatureLockRetry(lockPath, async () => {
    const existing = await readEvents(eventsPath);
    // If already started (past backlog), return current state without re-starting
    if (existing.length > 0) {
      const context = projectContext(existing);
      if (context && context.currentSpecState !== 'backlog') {
        return showResearch(repoPath, researchId);
      }
    }
    return applyResearchEventsUnlocked(repoPath, researchId, [{
      type: 'research.started',
      researchId,
      mode,
      agents,
      at: now(),
    }], eventsPath, snapshotPath);
  });
}

async function requestResearchReview(repoPath, researchId) {
  return persistResearchEvents(repoPath, researchId, [{ type: 'research.code_review.started', at: now() }]);
}

async function requestResearchEval(repoPath, researchId) {
  return persistResearchEvents(repoPath, researchId, [{ type: 'research.eval_requested', at: now() }]);
}

async function closeResearch(repoPath, researchId) {
  const { lockPath, eventsPath, snapshotPath } = getResearchWorkflowPaths(repoPath, researchId);
  return withFeatureLock(lockPath, async () => {
    const existing = await readEvents(eventsPath);
    if (existing.length === 0) {
      throw new Error(`Research ${researchId} has no engine events`);
    }

    const current = await showResearch(repoPath, researchId);
    if (current.currentSpecState === 'done') return current;

    const closeEvents = [];
    if (current.currentSpecState !== 'closing') {
      closeEvents.push({ type: 'research.close_requested', at: now() });
      closeEvents.push({
        type: 'effect.requested',
        effect: {
          id: 'close.move_spec_to_done',
          type: 'move_spec',
          payload: {
            fromPath: current.specPath,
            toPath: computeResearchSpecPath(repoPath, researchId, 'done', current),
          },
        },
        at: now(),
      });
    }

    if (closeEvents.length > 0) {
      await applyResearchEventsUnlocked(repoPath, researchId, closeEvents, eventsPath, snapshotPath);
    }

    const pending = await showResearch(repoPath, researchId);
    const moveEffect = pending.effects.find((effect) => effect.id === 'close.move_spec_to_done' && effect.status !== 'succeeded');
    if (moveEffect) {
      await runEffects(repoPath, researchId, [moveEffect], runFeatureEffect);
      await applyResearchEventsUnlocked(
        repoPath,
        researchId,
        [{ type: 'effect.succeeded', effectId: moveEffect.id, at: now() }],
        eventsPath,
        snapshotPath,
      );
    }

    return applyResearchEventsUnlocked(
      repoPath,
      researchId,
      [{ type: 'research.closed', at: now() }],
      eventsPath,
      snapshotPath,
    );
  });
}

async function showResearch(repoPath, researchId) {
  const events = await readEvents(getResearchWorkflowPaths(repoPath, researchId).eventsPath);
  const context = requireResearchContext(projectContext(events), researchId);
  const materialized = materializeResearchPendingEffects(repoPath, materializeResearchContext(repoPath, context));
  return snapshotFromResearchContext(materialized, events.length);
}

async function showResearchOrNull(repoPath, researchId) {
  const events = await readEvents(getResearchWorkflowPaths(repoPath, researchId).eventsPath);
  const context = projectContext(events);
  if (context === null) return null;
  const materialized = materializeResearchPendingEffects(repoPath, materializeResearchContext(repoPath, context));
  return snapshotFromResearchContext(materialized, events.length);
}

async function showEntityOrNull(repoPath, entityType, entityId) {
  if (entityType === 'research') return showResearchOrNull(repoPath, entityId);
  return showFeatureOrNull(repoPath, entityId);
}

async function emitResearchSignal(repoPath, researchId, signal, agentId) {
  const eventType = SIGNAL_EVENT_MAP[signal];
  const { eventsPath, snapshotPath, lockPath } = getResearchWorkflowPaths(repoPath, researchId);

  return withFeatureLockRetry(lockPath, async () => {
    const { context, events } = await loadCurrentResearchUnlocked(repoPath, researchId, eventsPath);
    if (isSignalRedundant(context, eventType, agentId)) {
      return snapshotFromResearchContext(context, events.length);
    }
    return applyResearchEventsUnlocked(
      repoPath,
      researchId,
      [{ type: eventType, agentId, at: now() }],
      eventsPath,
      snapshotPath,
    );
  });
}

async function ensureEntityBootstrapped(repoPath, entityType, entityId, lifecycle = 'backlog') {
  const existing = await showEntityOrNull(repoPath, entityType, entityId);
  if (existing) return existing;

  const event = createBootstrapEvent(entityType, entityId, lifecycle);

  if (entityType === 'research') {
    const { eventsPath, snapshotPath, lockPath } = getResearchWorkflowPaths(repoPath, entityId);
    return withFeatureLockRetry(lockPath, async () => {
      const existingEvents = await readEvents(eventsPath);
      if (existingEvents.length > 0) return showResearch(repoPath, entityId);
      return applyResearchEventsUnlocked(repoPath, entityId, [event], eventsPath, snapshotPath);
    });
  }

  const { eventsPath, snapshotPath, lockPath } = getFeatureWorkflowPaths(repoPath, entityId);
  return withFeatureLockRetry(lockPath, async () => {
    const existingEvents = await readEvents(eventsPath);
    if (existingEvents.length > 0) return showFeature(repoPath, entityId);
    return applyEventsUnlocked(repoPath, entityId, [event], eventsPath, snapshotPath);
  });
}

function ensureEntityBootstrappedSync(repoPath, entityType, entityId, lifecycle = 'backlog', specPath = null, options = {}) {
  const paths = getEntityWorkflowPaths(repoPath, entityType, entityId);
  const resolvedSpecPath = specPath || getSpecPathForEntity(repoPath, entityType, entityId, lifecycle);
  return withEntityLockSync(paths.lockPath, () => {
    if (fs.existsSync(paths.snapshotPath)) return JSON.parse(fs.readFileSync(paths.snapshotPath, 'utf8'));
    const timestamp = now();
    const event = createBootstrapEvent(entityType, entityId, lifecycle, options);
    const snapshot = createBootstrapSnapshot(entityType, entityId, lifecycle, resolvedSpecPath, timestamp, options);
    fs.mkdirSync(paths.root, { recursive: true });
    if (!fs.existsSync(paths.eventsPath) || fs.readFileSync(paths.eventsPath, 'utf8').trim() === '') {
      fs.writeFileSync(paths.eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
    }
    fs.writeFileSync(paths.snapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
    return snapshot;
  });
}

function migrateEntityWorkflowIdSync(repoPath, entityType, fromId, toId, specPath, lifecycle = 'backlog') {
  const fromPaths = getEntityWorkflowPaths(repoPath, entityType, fromId);
  const toPaths = getEntityWorkflowPaths(repoPath, entityType, toId);
  const targetLockPath = path.join(path.dirname(toPaths.root), `${path.basename(toPaths.root)}.migration.lock`);
  const tempRoot = `${toPaths.root}.tmp-${process.pid}-${Date.now()}`;
  const tempEventsPath = path.join(tempRoot, 'events.jsonl');
  const tempSnapshotPath = path.join(tempRoot, 'snapshot.json');

  return withEntityLockSync(fromPaths.lockPath, () => withEntityLockSync(targetLockPath, () => {
    if (!fs.existsSync(fromPaths.root) || !fs.existsSync(fromPaths.snapshotPath)) {
      throw new Error(`Missing workflow snapshot for ${entityType} ${fromId}. Run \`aigon doctor --fix\` to migrate inbox entities, then retry.`);
    }
    if (fs.existsSync(toPaths.root)) {
      throw new Error(`Workflow state for ${entityType} ${toId} already exists.`);
    }

    let renameCompleted = false;
    try {
      fs.cpSync(fromPaths.root, tempRoot, { recursive: true, force: true });
      fs.rmSync(path.join(tempRoot, 'lock'), { force: true });

      if (fs.existsSync(tempEventsPath)) {
        const migratedEvents = fs.readFileSync(tempEventsPath, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.stringify(rewriteWorkflowIdentityPayload(entityType, JSON.parse(line), fromId, toId, specPath, lifecycle)))
          .join('\n');
        fs.writeFileSync(tempEventsPath, migratedEvents ? `${migratedEvents}\n` : '', 'utf8');
      }

      const snapshot = JSON.parse(fs.readFileSync(tempSnapshotPath, 'utf8'));
      rewriteWorkflowIdentityPayload(entityType, snapshot, fromId, toId, specPath, lifecycle);
      fs.writeFileSync(tempSnapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

      fs.renameSync(tempRoot, toPaths.root);
      renameCompleted = true;
      fs.rmSync(fromPaths.root, { recursive: true, force: true });
      return JSON.parse(fs.readFileSync(toPaths.snapshotPath, 'utf8'));
    } catch (error) {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch (_) { /* ignore */ }
      // After rename, `toPaths.root` is the migrated state — never delete it on cleanup
      // or a failure while removing `fromPaths` would drop the only good copy.
      if (!renameCompleted) {
        try {
          fs.rmSync(toPaths.root, { recursive: true, force: true });
        } catch (_) { /* ignore */ }
      }
      throw error;
    }
  }));
}

async function recordSpecReviewStarted(repoPath, entityType, entityId, payload = {}) {
  await ensureEntityBootstrapped(repoPath, entityType, entityId, 'backlog');
  const reviewerId = String(payload.reviewerId || '').trim();
  if (!reviewerId) throw new Error('recordSpecReviewStarted requires reviewerId');
  const event = {
    type: entityType === 'research' ? 'research.spec_review.started' : 'feature.spec_review.started',
    reviewerId,
    at: payload.at || now(),
  };
  return entityType === 'research'
    ? persistResearchEvents(repoPath, entityId, [event])
    : persistEvents(repoPath, entityId, [event]);
}

async function recordSpecReviewCompleted(repoPath, entityType, entityId, payload = {}) {
  await ensureEntityBootstrapped(repoPath, entityType, entityId, 'backlog');
  const reviewerId = String(payload.reviewerId || '').trim();
  const event = {
    type: entityType === 'research' ? 'research.spec_review.completed' : 'feature.spec_review.completed',
    reviewerId: reviewerId || null,
    at: payload.at || now(),
  };
  return entityType === 'research'
    ? persistResearchEvents(repoPath, entityId, [event])
    : persistEvents(repoPath, entityId, [event]);
}

async function recordSpecReviewCheckStarted(repoPath, entityType, entityId, payload = {}) {
  await ensureEntityBootstrapped(repoPath, entityType, entityId, 'backlog');
  const checkerId = String(payload.checkerId || '').trim();
  if (!checkerId) throw new Error('recordSpecReviewCheckStarted requires checkerId');
  const event = {
    type: entityType === 'research' ? 'research.spec_revision.started' : 'feature.spec_revision.started',
    checkerId,
    at: payload.at || now(),
  };
  return entityType === 'research'
    ? persistResearchEvents(repoPath, entityId, [event])
    : persistEvents(repoPath, entityId, [event]);
}

async function recordSpecRevisionCompleted(repoPath, entityType, entityId, payload = {}) {
  await ensureEntityBootstrapped(repoPath, entityType, entityId, 'backlog');
  const event = {
    type: entityType === 'research' ? 'research.spec_revision.completed' : 'feature.spec_revision.completed',
    ackedBy: payload.ackedBy || null,
    at: payload.at || now(),
  };
  return entityType === 'research'
    ? persistResearchEvents(repoPath, entityId, [event])
    : persistEvents(repoPath, entityId, [event]);
}

async function recordSpecReviewSubmitted(repoPath, entityType, entityId, payload) {
  await ensureEntityBootstrapped(repoPath, entityType, entityId, 'backlog');
  const submittedAt = payload.at || now();
  const events = [
    {
      type: 'spec_review.submitted',
      reviewId: payload.reviewId || payload.commitSha || `${payload.reviewerId}-${Date.now()}`,
      reviewerId: payload.reviewerId,
      summary: payload.summary || '',
      commitSha: payload.commitSha || null,
      at: submittedAt,
    },
    {
      type: entityType === 'research' ? 'research.spec_review.completed' : 'feature.spec_review.completed',
      reviewerId: payload.reviewerId || null,
      at: submittedAt,
    },
  ];
  return entityType === 'research'
    ? persistResearchEvents(repoPath, entityId, events)
    : persistEvents(repoPath, entityId, events);
}

async function recordSpecReviewAcknowledged(repoPath, entityType, entityId, payload = {}) {
  const snapshot = await ensureEntityBootstrapped(repoPath, entityType, entityId, 'backlog');
  const pendingReviewIds = (snapshot.specReview && snapshot.specReview.pendingReviews || []).map((review) => review.reviewId);
  const ackedAt = payload.at || now();
  const events = [
    {
      type: 'spec_review.acked',
      reviewIds: Array.isArray(payload.reviewIds) && payload.reviewIds.length > 0 ? payload.reviewIds : pendingReviewIds,
      ackedBy: payload.ackedBy || null,
      commitSha: payload.commitSha || null,
      at: ackedAt,
    },
    {
      type: entityType === 'research' ? 'research.spec_revision.completed' : 'feature.spec_revision.completed',
      ackedBy: payload.ackedBy || null,
      at: ackedAt,
    },
  ];
  return entityType === 'research'
    ? persistResearchEvents(repoPath, entityId, events)
    : persistEvents(repoPath, entityId, events);
}

async function startEntity(repoPath, entityType, entityId, mode, agents = []) {
  return entityType === 'research'
    ? startResearch(repoPath, entityId, mode, agents)
    : startFeature(repoPath, entityId, mode, agents);
}

async function showEntity(repoPath, entityType, entityId) {
  return entityType === 'research'
    ? showResearch(repoPath, entityId)
    : showFeature(repoPath, entityId);
}

async function requestEntityEval(repoPath, entityType, entityId) {
  return entityType === 'research'
    ? requestResearchEval(repoPath, entityId)
    : requestFeatureEval(repoPath, entityId);
}

async function closeEntity(repoPath, entityType, entityId) {
  return entityType === 'research'
    ? closeResearch(repoPath, entityId)
    : closeFeature(repoPath, entityId);
}

async function restartEntityAgent(repoPath, entityType, entityId, agentId) {
  return entityType === 'research'
    ? restartResearchAgent(repoPath, entityId, agentId)
    : restartAgent(repoPath, entityId, agentId);
}

async function forceEntityAgentReady(repoPath, entityType, entityId, agentId) {
  return entityType === 'research'
    ? forceResearchAgentReady(repoPath, entityId, agentId)
    : forceAgentReady(repoPath, entityId, agentId);
}

async function dropEntityAgent(repoPath, entityType, entityId, agentId) {
  return entityType === 'research'
    ? dropResearchAgent(repoPath, entityId, agentId)
    : dropAgent(repoPath, entityId, agentId);
}

async function escalateEntityAgent(repoPath, entityType, entityId, agentId) {
  return entityType === 'research'
    ? escalateResearchAgent(repoPath, entityId, agentId)
    : escalateAgent(repoPath, entityId, agentId);
}

module.exports = {
  DEFAULT_CLAIM_TIMEOUT_MS,
  EffectExecutionInterruptedError,
  startEntity,
  showEntity,
  showEntityOrNull,
  requestEntityEval,
  closeEntity,
  startFeature,
  startResearch,
  emitSignal,
  emitResearchSignal,
  ensureEntityBootstrapped,
  ensureEntityBootstrappedSync,
  migrateEntityWorkflowIdSync,
  recordSpecReviewStarted,
  recordSpecReviewCompleted,
  recordSpecReviewCheckStarted,
  recordSpecReviewSubmitted,
  recordSpecReviewAcknowledged,
  recordSpecRevisionCompleted,
  recordCodeReviewStarted,
  recordCodeReviewCompleted,
  recordCodeRevisionStarted,
  recordCodeRevisionCompleted,
  signalAgentReady,
  requestFeatureEval,
  requestResearchReview,
  requestResearchEval,
  selectWinner,
  closeFeature,
  resetFeature,
  resetResearch,
  closeResearch,
  closeFeatureWithEffects,
  tryCloseFeatureWithEffects,
  canCloseFeature,
  showFeature,
  showFeatureOrNull,
  showResearch,
  showResearchOrNull,
  listActions,
  listEvents,
  pauseFeature,
  pauseFeatureForReason,
  resumeFeature,
  restartAgent,
  restartResearchAgent,
  restartEntityAgent,
  forceAgentReady,
  forceResearchAgentReady,
  forceEntityAgentReady,
  dropAgent,
  dropResearchAgent,
  dropEntityAgent,
  escalateAgent,
  recordAgentTokenExhausted,
  recordAgentFailoverSwitch,
  escalateResearchAgent,
  escalateEntityAgent,
  // Lower-level primitives for bridge modules (e.g. workflow-close)
  persistEvents,
  persistEntityEvents,
  runPendingEffects,
  // Exported for testing
  isSignalRedundant,
};
