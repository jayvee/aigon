'use strict';

/**
 * SpecStore — durable storage protocol for Aigon specs.
 *
 * Specs are the top-level durable work objects. Feature and research are spec
 * kinds addressed by keys such as `F42` and `R43`. This module exposes a
 * backend-selectable façade; feature 573 ships only the local backend, which
 * thin-wraps existing workflow-core persistence helpers.
 */

const { createLocalBackend } = require('./local-backend');
const { assertSpecStoreInterface, SPEC_STORE_METHODS } = require('./interface');
const specKey = require('./spec-key');

/**
 * @param {{ repoPath: string, backend?: 'local' }} options
 * @returns {object} SpecStore instance
 */
function createSpecStore(options = {}) {
  const { repoPath, backend = 'local' } = options;
  if (!repoPath) {
    throw new Error('createSpecStore requires repoPath');
  }
  if (backend !== 'local') {
    throw new Error(`Unknown SpecStore backend: ${backend}`);
  }
  const store = createLocalBackend(repoPath);
  assertSpecStoreInterface(store);
  return store;
}

module.exports = {
  createSpecStore,
  assertSpecStoreInterface,
  SPEC_STORE_METHODS,
  ...specKey,
};
