'use strict';

/**
 * Workflow-core barrel export.
 *
 * This is the public API for the imported Aigon Next workflow engine.
 * Consumers should `require('./workflow-core')` and use only what's
 * exported here.
 */

const types = require('./types');
const paths = require('./paths');
const eventStore = require('./event-store');
const snapshotStore = require('./snapshot-store');
const lock = require('./lock');
const projector = require('./projector');
const actions = require('./actions');
const effects = require('./effects');
const engine = require('./engine');
const researchEngine = require('./research-engine');
const { featureMachine, researchMachine } = require('./machine');

module.exports = {
  // Type enums and factories
  ...types,

  // Path computation
  ...paths,

  // Persistence
  readEvents: eventStore.readEvents,
  appendEvent: eventStore.appendEvent,
  readSnapshot: snapshotStore.readSnapshot,
  writeSnapshot: snapshotStore.writeSnapshot,

  // Locking
  withFeatureLock: lock.withFeatureLock,
  tryWithFeatureLock: lock.tryWithFeatureLock,

  // Projector
  projectContext: projector.projectContext,

  // Action derivation
  deriveAvailableActions: actions.deriveAvailableActions,

  // Effects
  runEffects: effects.runEffects,
  runFeatureEffect: effects.runFeatureEffect,

  // State machine
  featureMachine,
  researchMachine,

  // Engine (full orchestration API)
  ...engine,
  ...researchEngine,

  // Re-export EffectExecutionInterruptedError for bridge modules
  EffectExecutionInterruptedError: engine.EffectExecutionInterruptedError,
};
