'use strict';

/**
 * Documented SpecStore surface — every backend must implement these methods.
 *
 * Local backend delegates file I/O to workflow-core persistence helpers
 * (event-store, snapshot-store, lock) — only the local backend may import those.
 */

const SPEC_STORE_METHODS = Object.freeze([
  'listSpecs',
  'readSpec',
  'readEvents',
  'readEventsSync',
  'appendEvent',
  'readSnapshot',
  'readSnapshotSync',
  'writeSnapshot',
  'lock',
  'sync',
  'syncBeforeWrite',
  'health',
  'readLeases',
  'acquireLease',
  'renewLease',
  'releaseLease',
  'assertLeaseAllowed',
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
