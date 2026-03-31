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
 * Candidates with `bypassMachine: true` skip XState and use their own guard.
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
        const agent = context.agents[agentId];

        // For bypass candidates, run the guard now and skip if it fails
        if (candidateDef.bypassMachine && candidateDef.guard) {
          if (!candidateDef.guard({ agent, agentId, context })) return;
        }

        candidates.push({
          kind: candidateDef.kind,
          label: typeof candidateDef.label === 'function'
            ? candidateDef.label({ agentId, context })
            : candidateDef.label,
          event: candidateDef.eventType
            ? { type: candidateDef.eventType, agentId, at: context.updatedAt }
            : null,
          recommendedOrder: candidateDef.recommendedOrder,
          agentId,
          bypassMachine: candidateDef.bypassMachine || false,
          category: candidateDef.category || null,
          requiresInput: candidateDef.requiresInput || null,
          scope: candidateDef.scope || null,
          metadata: candidateDef.metadata || null,
          clientOnly: candidateDef.clientOnly || false,
        });
      });
      return;
    }

    // For non-per-agent bypass candidates
    if (candidateDef.bypassMachine && candidateDef.guard) {
      if (!candidateDef.guard({ context })) return;
    }

    candidates.push({
      kind: candidateDef.kind,
      label: typeof candidateDef.label === 'function'
        ? candidateDef.label({ context })
        : candidateDef.label,
      event: candidateDef.eventType
        ? { type: candidateDef.eventType, at: context.updatedAt }
        : null,
      recommendedOrder: candidateDef.recommendedOrder,
      bypassMachine: candidateDef.bypassMachine || false,
      category: candidateDef.category || null,
      requiresInput: candidateDef.requiresInput || null,
      scope: candidateDef.scope || null,
      metadata: candidateDef.metadata || null,
      clientOnly: candidateDef.clientOnly || false,
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
/**
 * Classify an action kind into a category.
 */
function classifyActionCategory(candidate) {
  if (candidate.category) return candidate.category;
  if (candidate.kind === 'open-session') return 'session';
  const agentControlKinds = new Set(['restart-agent', 'force-agent-ready', 'drop-agent']);
  if (agentControlKinds.has(candidate.kind)) return 'agent-control';
  return 'lifecycle';
}

/**
 * Derive available actions by testing each candidate against the machine.
 * Bypass candidates (e.g. open-session) skip XState and were pre-filtered by guard.
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
      category: classifyActionCategory(candidate),
      requiresInput: candidate.requiresInput || null,
      scope: candidate.scope || null,
      metadata: candidate.metadata || null,
      clientOnly: candidate.clientOnly || false,
    }));
}

module.exports = { deriveAvailableActions };
