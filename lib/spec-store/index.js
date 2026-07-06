'use strict';

/**
 * SpecStore — durable storage protocol for Aigon specs.
 *
 * Specs are the top-level durable work objects. Feature and research are spec
 * kinds addressed by keys such as `F42` and `R43`. This module exposes a
 * backend-selectable façade; the local backend thin-wraps workflow-core helpers;
 * the git-ref backend (F577) stores canonical events in Git refs with a local
 * `.aigon/workflows` projection cache.
 */

const { createLocalBackend } = require('./local-backend');
const { createGitRefBackend } = require('./git-ref-backend');
const { createGitBranchBackend } = require('./git-branch-backend');
const { assertSpecStoreInterface, SPEC_STORE_METHODS } = require('./interface');
const { resolveStorageConfig } = require('./storage-config');
const specKey = require('./spec-key');

/**
 * @param {{ repoPath: string, backend?: 'local'|'git-ref'|'git-branch', storage?: ReturnType<typeof resolveStorageConfig> }} options
 * @returns {object} SpecStore instance
 */
function createSpecStore(options = {}) {
  const { repoPath } = options;
  if (!repoPath) {
    throw new Error('createSpecStore requires repoPath');
  }
  const resolved = options.storage || resolveStorageConfig(repoPath);
  const backend = options.backend || resolved.backend;
  let store;
  if (backend === 'local') {
    store = createLocalBackend(repoPath);
  } else if (backend === 'git-ref') {
    store = createGitRefBackend(repoPath, resolved.git);
  } else if (backend === 'git-branch') {
    store = createGitBranchBackend(repoPath, resolved.git);
  } else {
    throw new Error(`Unknown SpecStore backend: ${backend}`);
  }
  assertSpecStoreInterface(store);
  return store;
}

module.exports = {
  createSpecStore,
  assertSpecStoreInterface,
  SPEC_STORE_METHODS,
  resolveStorageConfig,
  ...specKey,
};
