'use strict';

/**
 * XState feature state machine.
 *
 * Ported from aigon-next/src/workflow/feature-machine.ts.
 * Defines the valid lifecycle transitions for a feature workflow.
 */

const { setup, assign } = require('xstate');
const { getEngineStateRules } = require('../workflow-rules');

const machineSetup = setup({
  types: {
    context: {},
    input: {},
    events: {},
  },
  guards: {
    allAgentsReady: ({ context }) =>
      Object.values(context.agents).length > 0 &&
      Object.values(context.agents).every((agent) => agent.status === 'ready'),
    // Solo close: one agent, it's ready, not fleet mode
    soloAllReady: ({ context }) =>
      context.mode !== 'fleet' &&
      Object.values(context.agents).length === 1 &&
      Object.values(context.agents).every((agent) => agent.status === 'ready'),
    hasWinner: ({ context }) => context.winnerAgentId !== null,
    agentExists: ({ context, event }) =>
      'agentId' in event && context.agents[event.agentId] !== undefined,
    agentRecoverable: ({ context, event }) => {
      if (!('agentId' in event) || context.agents[event.agentId] === undefined) {
        return false;
      }
      const status = context.agents[event.agentId].status;
      return status === 'lost' || status === 'failed' || status === 'needs_attention';
    },
    agentNeedsRecovery: ({ context, event }) => {
      if (!('agentId' in event) || context.agents[event.agentId] === undefined) {
        return false;
      }
      const status = context.agents[event.agentId].status;
      return status === 'lost' || status === 'failed';
    },
    agentDroppable: ({ context, event }) => {
      if (!('agentId' in event) || context.agents[event.agentId] === undefined) {
        return false;
      }
      const status = context.agents[event.agentId].status;
      return (
        Object.keys(context.agents).length > 1 &&
        (status === 'lost' || status === 'failed' || status === 'needs_attention')
      );
    },
    agentNeedsAttention: ({ context, event }) => {
      if (!('agentId' in event) || context.agents[event.agentId] === undefined) {
        return false;
      }
      const status = context.agents[event.agentId].status;
      return status === 'lost' || status === 'failed';
    },
    readyAgentSelected: ({ context, event }) => {
      if (!('agentId' in event) || context.agents[event.agentId] === undefined) {
        return false;
      }
      return context.agents[event.agentId].status === 'ready';
    },
    isImplementing: ({ context }) => context.currentSpecState === 'implementing',
    isBacklog: ({ context }) => context.currentSpecState === 'backlog',
    isPaused: ({ context }) => context.currentSpecState === 'paused',
    isReviewing: ({ context }) => context.currentSpecState === 'reviewing',
    isEvaluating: ({ context }) => context.currentSpecState === 'evaluating',
    isReadyForReview: ({ context }) => context.currentSpecState === 'ready_for_review',
    isClosing: ({ context }) => context.currentSpecState === 'closing',
    isDone: ({ context }) => context.currentSpecState === 'done',
  },
  actions: {
    markRestarted: assign({
      agents: ({ context, event }) => {
        if (!('agentId' in event) || context.agents[event.agentId] === undefined) {
          return context.agents;
        }
        return {
          ...context.agents,
          [event.agentId]: {
            ...context.agents[event.agentId],
            status: 'running',
            lastHeartbeatAt: event.at,
          },
        };
      },
    }),
    markReady: assign({
      agents: ({ context, event }) => {
        if (!('agentId' in event) || context.agents[event.agentId] === undefined) {
          return context.agents;
        }
        return {
          ...context.agents,
          [event.agentId]: {
            ...context.agents[event.agentId],
            status: 'ready',
            lastHeartbeatAt: event.at,
          },
        };
      },
    }),
    markNeedsAttention: assign({
      agents: ({ context, event }) => {
        if (!('agentId' in event) || context.agents[event.agentId] === undefined) {
          return context.agents;
        }
        return {
          ...context.agents,
          [event.agentId]: {
            ...context.agents[event.agentId],
            status: 'needs_attention',
          },
        };
      },
    }),
    markDropped: assign({
      agents: ({ context, event }) => {
        if (!('agentId' in event) || context.agents[event.agentId] === undefined) {
          return context.agents;
        }
        const nextAgents = { ...context.agents };
        delete nextAgents[event.agentId];
        return nextAgents;
      },
    }),
    selectWinner: assign({
      winnerAgentId: ({ event }) => ('agentId' in event ? event.agentId : null),
    }),
    // Solo close: auto-select the sole agent as winner
    autoSelectWinner: assign({
      winnerAgentId: ({ context }) => Object.keys(context.agents)[0] || null,
    }),
    requestCloseEffects: assign({
      lastEffectError: () => null,
    }),
  },
});

function buildStateConfig(stateName, transitions) {
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

  const on = {};
  transitions.forEach((transition) => {
    on[transition.event] = {
      ...(transition.to ? { target: transition.to } : {}),
      ...(transition.guard ? { guard: transition.guard } : {}),
      ...(transition.effect ? { actions: transition.effect } : {}),
    };
  });
  return { on };
}

function createWorkflowMachine(entityType = 'feature') {
  const states = getEngineStateRules(entityType);
  return machineSetup.createMachine({
    id: entityType,
    initial: 'hydrating',
    context: ({ input }) => input,
    states: Object.fromEntries(
      Object.entries(states).map(([stateName, transitions]) => [
        stateName,
        buildStateConfig(stateName, transitions),
      ]),
    ),
  });
}

const featureMachine = createWorkflowMachine('feature');
const researchMachine = createWorkflowMachine('research');

module.exports = { createWorkflowMachine, featureMachine, researchMachine };
