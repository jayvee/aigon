'use strict';

const { loadProjectConfig } = require('../config');

const DEFAULT_REF_PREFIX = 'refs/aigon/specs';
const DEFAULT_STATE_BRANCH = 'aigon-state';

const KNOWN_BACKENDS = new Set(['local', 'git-ref', 'git-branch']);

/**
 * Resolve SpecStore storage settings from `.aigon/config.json`.
 *
 * @param {string} [repoPath]
 * @returns {{ backend: 'local'|'git-ref'|'git-branch', git: { remote: string|null, refPrefix: string, branch: string, offline: boolean } }}
 */
function resolveStorageConfig(repoPath = process.cwd()) {
  const project = loadProjectConfig(repoPath) || {};
  const storage = project.storage || {};
  const backend = KNOWN_BACKENDS.has(storage.backend) ? storage.backend : 'local';
  const git = storage.git || {};
  const refPrefix = String(git.refPrefix || DEFAULT_REF_PREFIX).replace(/\/+$/, '');
  const branch = String(git.branch || DEFAULT_STATE_BRANCH).trim() || DEFAULT_STATE_BRANCH;
  const remote = git.remote != null && String(git.remote).trim() ? String(git.remote).trim() : null;
  const offline = git.offline === true || process.env.AIGON_STORAGE_OFFLINE === '1';
  return {
    backend,
    git: { remote, refPrefix, branch, offline },
  };
}

module.exports = {
  DEFAULT_REF_PREFIX,
  DEFAULT_STATE_BRANCH,
  resolveStorageConfig,
};
