'use strict';

/**
 * Action derivation — computes available manual actions from machine state.
 *
 * Ported from aigon-next/src/workflow/actions.ts.
 * Key innovation: uses XState's snapshot.can() so the machine is the
 * single source of truth for which actions are valid.
 */

const { createActor } = require('xstate');
const { featureMachine, researchMachine } = require('./machine');
const { getActionCandidates } = require('../workflow-rules');

/**
 * Build all candidate actions for a given context.
 * @param {object} context - FeatureContext
 * @returns {object[]} ActionCandidate[]
 */
function buildCandidates(context, entityType) {
  const isFleet = context.mode === 'fleet';
  const candidates = [];

  getActionCandidates(entityType).forEach((candidateDef) => {
    if (candidateDef.modeFilter === 'fleet' && !isFleet) return;
    if (candidateDef.modeFilter === 'solo' && isFleet) return;

    if (candidateDef.perAgent) {
      Object.keys(context.agents).forEach((agentId) => {
        candidates.push({
          kind: candidateDef.kind,
          label: typeof candidateDef.label === 'function'
            ? candidateDef.label({ agentId, context })
            : candidateDef.label,
          event: { type: candidateDef.eventType, agentId, at: context.updatedAt },
          recommendedOrder: candidateDef.recommendedOrder,
          agentId,
        });
      });
      return;
    }

    candidates.push({
      kind: candidateDef.kind,
      label: typeof candidateDef.label === 'function'
        ? candidateDef.label({ context })
        : candidateDef.label,
      event: { type: candidateDef.eventType, at: context.updatedAt },
      recommendedOrder: candidateDef.recommendedOrder,
    });
  });

  return candidates;
}

/**
 * Derive available actions by testing each candidate against the machine.
 *
 * @param {object} context - FeatureContext
 * @returns {object[]} AvailableAction[]
 */
function deriveAvailableActions(context, entityTypeOverride) {
  const entityType = entityTypeOverride || context.entityType || 'feature';
  const machine = entityType === 'research' ? researchMachine : featureMachine;
  const actor = createActor(machine, { input: context });
  actor.start();
  const snapshot = actor.getSnapshot();

  return buildCandidates(context, entityType)
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
