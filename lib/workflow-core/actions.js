'use strict';

/**
 * Action derivation — computes available manual actions from machine state.
 *
 * Ported from aigon-next/src/workflow/actions.ts.
 * Key innovation: uses XState's snapshot.can() so the machine is the
 * single source of truth for which actions are valid.
 */

const { createActor } = require('xstate');
const { featureMachine } = require('./machine');
const { ManualActionKind } = require('./types');

/**
 * Build all candidate actions for a given context.
 * @param {object} context - FeatureContext
 * @returns {object[]} ActionCandidate[]
 */
function buildCandidates(context) {
  const isFleet = context.mode === 'fleet';
  const candidates = [
    {
      kind: 'pause-feature',
      label: 'Pause feature',
      event: { type: 'feature.pause', at: context.updatedAt },
      recommendedOrder: 40,
    },
    {
      kind: 'resume-feature',
      label: 'Resume feature',
      event: { type: 'feature.resume', at: context.updatedAt },
      recommendedOrder: 40,
    },
    // Eval is Fleet-only — solo features close directly, no comparison needed
    ...(isFleet ? [{
      kind: 'feature-eval',
      label: 'Start evaluation',
      event: { type: 'feature.eval', at: context.updatedAt },
      recommendedOrder: 50,
    }] : []),
    {
      kind: 'feature-close',
      label: 'Close feature',
      event: { type: 'feature.close', at: context.updatedAt },
      recommendedOrder: 70,
    },
  ];

  // Solo review: optional step before close
  if (!isFleet) {
    candidates.push({
      kind: ManualActionKind.FEATURE_REVIEW,
      label: 'Review',
      event: { type: 'feature.review', at: context.updatedAt },
      recommendedOrder: 55,
    });
  }

  for (const agentId of Object.keys(context.agents)) {
    candidates.push(
      {
        kind: 'restart-agent',
        label: `Restart agent ${agentId}`,
        event: { type: 'restart-agent', agentId, at: context.updatedAt },
        recommendedOrder: 10,
        agentId,
      },
      {
        kind: 'force-agent-ready',
        label: `Force agent ${agentId} ready`,
        event: { type: 'force-agent-ready', agentId, at: context.updatedAt },
        recommendedOrder: 20,
        agentId,
      },
      {
        kind: 'drop-agent',
        label: `Drop agent ${agentId}`,
        event: { type: 'drop-agent', agentId, at: context.updatedAt },
        recommendedOrder: 30,
        agentId,
      },
      {
        kind: 'select-winner',
        label: `Select winner ${agentId}`,
        event: { type: 'select-winner', agentId, at: context.updatedAt },
        recommendedOrder: 60,
        agentId,
      },
    );
  }

  return candidates;
}

/**
 * Derive available actions by testing each candidate against the machine.
 *
 * @param {object} context - FeatureContext
 * @returns {object[]} AvailableAction[]
 */
function deriveAvailableActions(context) {
  const actor = createActor(featureMachine, { input: context });
  actor.start();
  const snapshot = actor.getSnapshot();

  return buildCandidates(context)
    .filter((candidate) => snapshot.can(candidate.event))
    .sort((left, right) => left.recommendedOrder - right.recommendedOrder || left.label.localeCompare(right.label))
    .map((candidate) => ({
      kind: candidate.kind,
      label: candidate.label,
      eventType: candidate.event.type,
      recommendedOrder: candidate.recommendedOrder,
      agentId: candidate.agentId,
    }));
}

module.exports = { deriveAvailableActions };
