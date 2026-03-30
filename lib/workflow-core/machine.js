'use strict';

/**
 * XState feature state machine.
 *
 * Ported from aigon-next/src/workflow/feature-machine.ts.
 * Defines the valid lifecycle transitions for a feature workflow.
 */

const { setup, assign } = require('xstate');

const featureMachine = setup({
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
    isPaused: ({ context }) => context.currentSpecState === 'paused',
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
}).createMachine({
  id: 'feature',
  initial: 'hydrating',
  context: ({ input }) => input,
  states: {
    hydrating: {
      always: [
        { target: 'done', guard: 'isDone' },
        { target: 'ready_for_review', guard: 'isReadyForReview' },
        { target: 'evaluating', guard: 'isEvaluating' },
        { target: 'closing', guard: 'isClosing' },
        { target: 'paused', guard: 'isPaused' },
        { target: 'implementing', guard: 'isImplementing' },
        { target: 'implementing' },
      ],
    },
    implementing: {
      on: {
        'feature.pause': { target: 'paused' },
        'feature.eval': { target: 'evaluating', guard: 'allAgentsReady' },
        // Solo close: skip eval/review, go straight to closing
        'feature.close': { target: 'closing', guard: 'soloAllReady', actions: 'autoSelectWinner' },
        'restart-agent': { actions: 'markRestarted', guard: 'agentRecoverable' },
        'force-agent-ready': { actions: 'markReady', guard: 'agentRecoverable' },
        'drop-agent': { actions: 'markDropped', guard: 'agentDroppable' },
        'needs-attention': { actions: 'markNeedsAttention', guard: 'agentNeedsAttention' },
      },
    },
    paused: {
      on: {
        'feature.resume': { target: 'implementing' },
      },
    },
    evaluating: {
      on: {
        'select-winner': { target: 'ready_for_review', guard: 'readyAgentSelected', actions: 'selectWinner' },
        'restart-agent': { actions: 'markRestarted', guard: 'agentRecoverable' },
        'force-agent-ready': { actions: 'markReady', guard: 'agentRecoverable' },
        'drop-agent': { actions: 'markDropped', guard: 'agentDroppable' },
        'needs-attention': { actions: 'markNeedsAttention', guard: 'agentNeedsAttention' },
      },
    },
    ready_for_review: {
      on: {
        'feature.close': { target: 'closing', guard: 'hasWinner', actions: 'requestCloseEffects' },
      },
    },
    closing: {
      on: {
        'feature.closed': {
          target: 'done',
        },
      },
    },
    done: {
      type: 'final',
    },
  },
});

module.exports = { featureMachine };
