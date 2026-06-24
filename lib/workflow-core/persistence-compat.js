'use strict';

/**
 * Compatibility barrel for workflow-core persistence helpers.
 *
 * Non-engine callers that have not migrated to SpecStore import from here
 * (re-exported by workflow-core/index.js). Engine paths must use SpecStore
 * directly — do not import this module from engine.js.
 */

const eventStore = require('./event-store');
const snapshotStore = require('./snapshot-store');
const lock = require('./lock');

module.exports = {
  readEvents: eventStore.readEvents,
  appendEvent: eventStore.appendEvent,
  readSnapshot: snapshotStore.readSnapshot,
  writeSnapshot: snapshotStore.writeSnapshot,
  withFeatureLock: lock.withFeatureLock,
  withFeatureLockRetry: lock.withFeatureLockRetry,
  tryWithFeatureLock: lock.tryWithFeatureLock,
};
