'use strict';

/**
 * Event-sourcing projector — rebuilds FeatureContext from an event stream.
 *
 * Ported from aigon-next/src/workflow/projector.ts.
 */

const { AgentStatus } = require('./types');

/**
 * Create an agents map from an array of agent IDs.
 * @param {string[]} agentIds
 * @returns {Record<string, { id: string, status: string, lastHeartbeatAt: string|null }>}
 */
function createAgents(agentIds) {
  return Object.fromEntries(
    agentIds.map((agentId) => [
      agentId,
      { id: agentId, status: AgentStatus.RUNNING, lastHeartbeatAt: null },
    ]),
  );
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
    switch (event.type) {
      case 'feature.started':
        lifecycle = 'implementing';
        context = {
          featureId: event.featureId,
          mode: event.mode,
          agents: createAgents(event.agents),
          winnerAgentId: null,
          effects: [],
          lastEffectError: null,
          specPath: '',
          currentSpecState: 'backlog',
          createdAt: event.at,
          updatedAt: event.at,
        };
        for (const agent of Object.values(context.agents)) {
          agent.lastHeartbeatAt = event.at;
        }
        break;
      case 'feature.paused':
        if (context !== null) {
          lifecycle = 'paused';
          context.updatedAt = event.at;
        }
        break;
      case 'feature.resumed':
        if (context !== null) {
          lifecycle = 'implementing';
          context.updatedAt = event.at;
        }
        break;
      case 'feature.eval_requested':
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
      case 'agent.restarted':
        if (context !== null && context.agents[event.agentId] !== undefined) {
          if (context.agents[event.agentId].status !== 'ready') {
            context.agents[event.agentId].status = 'running';
          }
          context.agents[event.agentId].lastHeartbeatAt = event.at;
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
        if (context !== null && context.agents[event.agentId] !== undefined) {
          context.agents[event.agentId].status = 'lost';
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

  context.currentSpecState = lifecycle;
  return context;
}

module.exports = { projectContext };
