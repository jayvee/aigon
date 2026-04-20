'use strict';

/**
 * Event-sourcing projector — rebuilds FeatureContext from an event stream.
 *
 * Ported from aigon-next/src/workflow/projector.ts.
 */

const { AgentStatus } = require('./types');
const { buildSpecReviewSummary } = require('../spec-review-state');

/**
 * Create an agents map from an array of agent IDs.
 * @param {string[]} agentIds
 * @returns {Record<string, { id: string, status: string, lastHeartbeatAt: string|null }>}
 */
function createAgents(agentIds, overrides) {
  const modelOverrides = (overrides && overrides.modelOverrides) || {};
  const effortOverrides = (overrides && overrides.effortOverrides) || {};
  return Object.fromEntries(
    agentIds.map((agentId) => [
      agentId,
      {
        id: agentId,
        status: AgentStatus.RUNNING,
        lastHeartbeatAt: null,
        restartCount: 0,
        modelOverride: modelOverrides[agentId] != null ? modelOverrides[agentId] : null,
        effortOverride: effortOverrides[agentId] != null ? effortOverrides[agentId] : null,
      },
    ]),
  );
}

function createSpecReviewState() {
  return {
    pendingReviews: [],
    pendingCount: 0,
    pendingAgents: [],
    pendingLabel: '',
  };
}

function refreshSpecReviewState(context) {
  const summary = buildSpecReviewSummary(context.specReview && context.specReview.pendingReviews);
  context.specReview = {
    pendingReviews: summary.pendingReviews,
    pendingCount: summary.pendingCount,
    pendingAgents: summary.pendingAgents,
    pendingLabel: summary.pendingLabel,
  };
}

/**
 * Replay an event stream to produce a FeatureContext.
 * Returns null if no `feature.started` event exists.
 *
 * @param {object[]} events
 * @returns {object|null} FeatureContext or null
 */
function projectContext(events) {
  let context = null;
  let lifecycle = 'backlog';

  for (const event of events) {
    const isResearch = event.type.startsWith('research.');
    const entityType = isResearch ? 'research' : 'feature';

    switch (event.type) {
      case 'feature.bootstrapped':
      case 'research.bootstrapped':
        // Bootstrapped from pre-engine state — initialise context from the event's lifecycle
        lifecycle = event.lifecycle || event.stage || 'backlog';
        context = {
          featureId: event.featureId || event.researchId,
          entityType,
          mode: event.mode || null,
          agents: createAgents(event.agents || [], {
            modelOverrides: event.modelOverrides,
            effortOverrides: event.effortOverrides,
          }),
          winnerAgentId: null,
          effects: [],
          lastEffectError: null,
          specReview: createSpecReviewState(),
          specPath: '',
          createdAt: event.at,
          updatedAt: event.at,
        };
        break;
      case 'feature.started':
      case 'research.started':
        lifecycle = 'implementing';
        context = {
          featureId: event.featureId || event.researchId,
          entityType,
          mode: event.mode,
          agents: createAgents(event.agents, {
            modelOverrides: event.modelOverrides,
            effortOverrides: event.effortOverrides,
          }),
          winnerAgentId: null,
          effects: [],
          lastEffectError: null,
          specReview: createSpecReviewState(),
          specPath: '',
          createdAt: event.at,
          updatedAt: event.at,
        };
        for (const agent of Object.values(context.agents)) {
          agent.lastHeartbeatAt = event.at;
        }
        break;
      case 'feature.paused':
      case 'research.paused':
        if (context !== null) {
          lifecycle = 'paused';
          context.updatedAt = event.at;
        }
        break;
      case 'feature.resumed':
      case 'research.resumed':
        if (context !== null) {
          lifecycle = 'implementing';
          context.updatedAt = event.at;
        }
        break;
      case 'feature.review_requested':
      case 'research.review_requested':
        if (context !== null) {
          lifecycle = 'reviewing';
          context.updatedAt = event.at;
        }
        break;
      case 'feature.eval_requested':
      case 'research.eval_requested':
        if (context !== null) {
          lifecycle = 'evaluating';
          context.updatedAt = event.at;
        }
        break;
      case 'winner.selected':
        if (context !== null) {
          lifecycle = 'ready_for_review';
          context.winnerAgentId = event.agentId;
          context.updatedAt = event.at;
        }
        break;
      case 'feature.closed':
      case 'research.closed':
        if (context !== null) {
          lifecycle = 'done';
          context.effects = context.effects.map((effect) => ({
            ...effect,
            status: 'succeeded',
            claimedAt: null,
            claimExpiredAt: null,
            lastError: null,
          }));
          context.lastEffectError = null;
          context.updatedAt = event.at;
        }
        break;
      case 'feature.close_requested':
      case 'research.close_requested':
        if (context !== null) {
          lifecycle = 'closing';
          context.lastEffectError = null;
          context.updatedAt = event.at;
        }
        break;
      case 'effect.requested':
        if (context !== null) {
          context.effects = [
            ...context.effects.filter((e) => e.id !== event.effect.id),
            {
              ...event.effect,
              status: 'requested',
              claimedAt: null,
              claimExpiredAt: null,
              reclaimCount: 0,
              lastError: null,
            },
          ];
          context.lastEffectError = null;
          context.updatedAt = event.at;
        }
        break;
      case 'effect.claimed':
        if (context !== null) {
          context.effects = context.effects.map((e) =>
            e.id === event.effectId
              ? { ...e, status: 'claimed', claimedAt: event.at, claimExpiredAt: null, lastError: null }
              : e,
          );
          context.lastEffectError = null;
          context.updatedAt = event.at;
        }
        break;
      case 'effect.claim_expired':
        if (context !== null) {
          context.effects = context.effects.map((e) =>
            e.id === event.effectId
              ? { ...e, status: 'reclaimable', claimedAt: null, claimExpiredAt: event.at, lastError: null }
              : e,
          );
          context.lastEffectError = null;
          context.updatedAt = event.at;
        }
        break;
      case 'effect.reclaimed':
        if (context !== null) {
          context.effects = context.effects.map((e) =>
            e.id === event.effectId
              ? { ...e, status: 'claimed', claimedAt: event.at, claimExpiredAt: null, reclaimCount: e.reclaimCount + 1, lastError: null }
              : e,
          );
          context.lastEffectError = null;
          context.updatedAt = event.at;
        }
        break;
      case 'effect.succeeded':
        if (context !== null) {
          context.effects = context.effects.map((e) =>
            e.id === event.effectId
              ? { ...e, status: 'succeeded', claimedAt: null, claimExpiredAt: null, lastError: null }
              : e,
          );
          context.lastEffectError = null;
          context.updatedAt = event.at;
        }
        break;
      case 'effect.failed':
        if (context !== null) {
          context.effects = context.effects.map((e) =>
            e.id === event.effectId
              ? { ...e, status: 'failed', claimedAt: null, claimExpiredAt: null, lastError: event.error }
              : e,
          );
          context.lastEffectError = event.error;
          context.updatedAt = event.at;
        }
        break;
      case 'signal.agent_started':
        if (context !== null && context.agents[event.agentId] !== undefined) {
          if (context.agents[event.agentId].status !== 'ready') {
            context.agents[event.agentId].status = 'running';
          }
          context.agents[event.agentId].lastHeartbeatAt = event.at;
          context.updatedAt = event.at;
        }
        break;
      case 'agent.restarted':
        if (context !== null && context.agents[event.agentId] !== undefined) {
          if (context.agents[event.agentId].status !== 'ready') {
            context.agents[event.agentId].status = 'running';
          }
          context.agents[event.agentId].restartCount = (context.agents[event.agentId].restartCount || 0) + 1;
          context.agents[event.agentId].lastHeartbeatAt = event.at;
          context.updatedAt = event.at;
        }
        break;
      case 'agent.needs_attention':
        if (context !== null && context.agents[event.agentId] !== undefined) {
          context.agents[event.agentId].status = 'needs_attention';
          context.updatedAt = event.at;
        }
        break;
      case 'signal.agent_waiting':
        if (context !== null && context.agents[event.agentId] !== undefined) {
          context.agents[event.agentId].status = 'waiting';
          context.agents[event.agentId].lastHeartbeatAt = event.at;
          context.updatedAt = event.at;
        }
        break;
      case 'signal.agent_ready':
      case 'agent.marked_ready':
      case 'agent.force_ready':
        if (context !== null && context.agents[event.agentId] !== undefined) {
          context.agents[event.agentId].status = 'ready';
          context.agents[event.agentId].lastHeartbeatAt = event.at;
          context.updatedAt = event.at;
        }
        break;
      case 'signal.agent_submitted':
        if (context !== null && context.agents[event.agentId] !== undefined) {
          context.agents[event.agentId].status = 'ready';
          context.agents[event.agentId].lastHeartbeatAt = event.at;
          context.updatedAt = event.at;
        }
        break;
      case 'signal.agent_failed':
        if (context !== null && context.agents[event.agentId] !== undefined) {
          context.agents[event.agentId].status = 'failed';
          context.agents[event.agentId].lastHeartbeatAt = event.at;
          context.updatedAt = event.at;
        }
        break;
      case 'signal.heartbeat':
        if (context !== null && context.agents[event.agentId] !== undefined) {
          context.agents[event.agentId].lastHeartbeatAt = event.at;
          context.updatedAt = event.at;
        }
        break;
      case 'signal.session_lost':
      case 'signal.heartbeat_expired':
        // Display-only: record the event timestamp but do NOT change agent status.
        // Liveness is a dashboard concern, not an engine state concern.
        if (context !== null && context.agents[event.agentId] !== undefined) {
          context.agents[event.agentId].lastHeartbeatExpiredAt = event.at;
          context.updatedAt = event.at;
        }
        break;
      case 'spec_review.submitted':
        if (context !== null) {
          const pendingReviews = (context.specReview && context.specReview.pendingReviews) || [];
          context.specReview = {
            pendingReviews: [
              ...pendingReviews.filter((review) => review.reviewId !== event.reviewId),
              {
                reviewId: event.reviewId,
                reviewerId: event.reviewerId,
                summary: event.summary || '',
                submittedAt: event.at,
                commitSha: event.commitSha || null,
              },
            ],
          };
          refreshSpecReviewState(context);
          context.updatedAt = event.at;
        }
        break;
      case 'spec_review.acked':
        if (context !== null) {
          const pendingReviews = (context.specReview && context.specReview.pendingReviews) || [];
          const ackedIds = new Set(Array.isArray(event.reviewIds) ? event.reviewIds : []);
          context.specReview = {
            pendingReviews: ackedIds.size === 0
              ? []
              : pendingReviews.filter((review) => !ackedIds.has(review.reviewId)),
          };
          refreshSpecReviewState(context);
          context.updatedAt = event.at;
        }
        break;
      case 'agent.dropped':
        if (context !== null && context.agents[event.agentId] !== undefined) {
          delete context.agents[event.agentId];
          context.updatedAt = event.at;
        }
        break;
    }
  }

  if (context === null) {
    return null;
  }

  if (!context.specReview) {
    context.specReview = createSpecReviewState();
  } else {
    refreshSpecReviewState(context);
  }
  context.currentSpecState = lifecycle;
  return context;
}

module.exports = { projectContext };
