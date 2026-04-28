'use strict';

/**
 * XState feature state machine.
 *
 * Ported from aigon-next/src/workflow/feature-machine.ts.
 * Defines the valid lifecycle transitions for a feature workflow.
 */

const { setup, assign } = require('xstate');
const { getEngineStateRules, getTransientStates } = require('../workflow-rules');

function resolveCodeRevisionAgent(context) {
  const agents = context && context.agents ? Object.keys(context.agents) : [];
  if (context && context.mode === 'fleet') {
    return context.winnerAgentId || context.authorAgentId || agents[0] || null;
  }
  return agents[0] || context.authorAgentId || null;
}

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
    isInbox: ({ context }) => context.currentSpecState === 'inbox',
    isPaused: ({ context }) => context.currentSpecState === 'paused',
    isSubmitted: ({ context }) => context.currentSpecState === 'submitted',
    isCodeReviewInProgress: ({ context }) => context.currentSpecState === 'code_review_in_progress',
    isCodeReviewComplete: ({ context }) => context.currentSpecState === 'code_review_complete',
    isCodeRevisionInProgress: ({ context }) => context.currentSpecState === 'code_revision_in_progress',
    isCodeRevisionComplete: ({ context }) => context.currentSpecState === 'code_revision_complete',
    isEvaluating: ({ context }) => context.currentSpecState === 'evaluating',
    isReadyForReview: ({ context }) => context.currentSpecState === 'ready_for_review',
    isClosing: ({ context }) => context.currentSpecState === 'closing',
    isCloseRecoveryInProgress: ({ context }) => context.currentSpecState === 'close_recovery_in_progress',
    isDone: ({ context }) => context.currentSpecState === 'done',
    isSpecReviewInProgress: ({ context }) => context.currentSpecState === 'spec_review_in_progress',
    isSpecRevisionInProgress: ({ context }) => context.currentSpecState === 'spec_revision_in_progress',
    codeReviewDoesNotRequestRevision: ({ context }) =>
      context.codeReview && context.codeReview.requestRevision === false,
    anotherCycleRequested: ({ event }) =>
      event.requestAnotherCycle === true && typeof event.nextReviewerId === 'string',
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
    markCodeReviewStarted: assign({
      codeReview: ({ context, event }) => ({
        ...(context.codeReview || {}),
        activeReviewerId: event.reviewerId || event.agentId || null,
        reviewStartedAt: event.at || null,
        reviewCompletedAt: null,
        requestRevision: null,
      }),
    }),
    markCodeReviewCompleted: assign({
      codeReview: ({ context, event }) => ({
        ...(context.codeReview || {}),
        activeReviewerId: null,
        reviewerId: event.reviewerId || event.agentId || (context.codeReview && context.codeReview.activeReviewerId) || null,
        reviewCompletedAt: event.at || null,
        requestRevision: event.requestRevision === false ? false : true,
        revisionAgentId: event.requestRevision === false ? null : resolveCodeRevisionAgent(context),
      }),
    }),
    markCodeRevisionStarted: assign({
      codeReview: ({ context, event }) => ({
        ...(context.codeReview || {}),
        revisionAgentId: event.revisionAgentId || resolveCodeRevisionAgent(context),
        revisionStartedAt: event.at || null,
        revisionCompletedAt: null,
      }),
    }),
    markCodeRevisionCompleted: assign({
      codeReview: ({ context, event }) => ({
        ...(context.codeReview || {}),
        revisionAgentId: event.revisionAgentId || (context.codeReview && context.codeReview.revisionAgentId) || resolveCodeRevisionAgent(context),
        revisionCompletedAt: event.at || null,
      }),
    }),
    recordNextCycle: assign(({ context, event }) => {
      const isSpec = event.type && event.type.includes('spec_revision');
      const cycles = Array.isArray(context.reviewCycles) ? context.reviewCycles : [];
      const cycleNumber = cycles.length + 1;
      const cr = context.codeReview || {};
      const entry = {
        type: isSpec ? 'spec' : 'code',
        cycle: cycleNumber,
        reviewer: cr.reviewerId || cr.activeReviewerId || null,
        startedAt: cr.reviewStartedAt || null,
        completedAt: cr.reviewCompletedAt || null,
        counterStartedAt: cr.revisionStartedAt || null,
        counterCompletedAt: cr.revisionCompletedAt || event.at || null,
      };
      return {
        reviewCycles: [...cycles, entry],
        pendingCodeReviewer: isSpec ? (context.pendingCodeReviewer || null) : (event.nextReviewerId || null),
        pendingSpecReviewer: isSpec ? (event.nextReviewerId || null) : (context.pendingSpecReviewer || null),
      };
    }),
  },
});

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
        { target: 'submitted', guard: 'codeReviewDoesNotRequestRevision' },
        { target: 'code_revision_in_progress' },
      ],
    };
  }

  if (stateName === 'code_revision_complete') {
    return {
      always: [
        { target: 'code_review_in_progress', guard: 'anotherCycleRequested', actions: 'recordNextCycle' },
        { target: 'submitted' },
      ],
    };
  }

  if (stateName === 'spec_revision_complete') {
    return {
      always: [
        { target: 'spec_review_in_progress', guard: 'anotherCycleRequested', actions: 'recordNextCycle' },
        { target: 'backlog' },
      ],
    };
  }

  // Transient *_complete states: immediately re-route back to `backlog` via
  // an `always:` transition. The machine never observes these as resting
  // states; applyTransition returns the post-always value as currentSpecState.
  if (transientStates && transientStates.has(stateName)) {
    return { always: [{ target: 'backlog' }] };
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

const featureMachine = createWorkflowMachine('feature');
const researchMachine = createWorkflowMachine('research');

module.exports = { createWorkflowMachine, featureMachine, researchMachine };
