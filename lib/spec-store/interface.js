'use strict';

/**
 * Documented SpecStore surface — every backend must implement these methods.
 *
 * Thin wrappers in the local backend delegate to workflow-core helpers:
 * - listSpecs / readSpec → lib/workflow-core/paths.js
 * - readEvents / appendEvent → lib/workflow-core/event-store.js
 * - readSnapshot / writeSnapshot → lib/workflow-core/snapshot-store.js
 * - lock → lib/workflow-core/lock.js
 * - sync / health → no-op stubs (interface pins only in feature 573)
 */

const SPEC_STORE_METHODS = Object.freeze([
  'listSpecs',
  'readSpec',
  'readEvents',
  'appendEvent',
  'readSnapshot',
  'writeSnapshot',
  'lock',
  'sync',
  'health',
]);

/**
 * @param {object} store
 */
function assertSpecStoreInterface(store) {
  for (const name of SPEC_STORE_METHODS) {
    if (typeof store[name] !== 'function') {
      throw new Error(`SpecStore missing method: ${name}`);
    }
  }
}

module.exports = {
  SPEC_STORE_METHODS,
  assertSpecStoreInterface,
};
