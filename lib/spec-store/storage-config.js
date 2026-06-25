'use strict';

const { loadProjectConfig } = require('../config');

const DEFAULT_REF_PREFIX = 'refs/aigon/specs';

/**
 * Resolve SpecStore storage settings from `.aigon/config.json`.
 *
 * @param {string} [repoPath]
 * @returns {{ backend: 'local'|'git-ref', git: { remote: string|null, refPrefix: string, offline: boolean } }}
 */
function resolveStorageConfig(repoPath = process.cwd()) {
  const project = loadProjectConfig(repoPath) || {};
  const storage = project.storage || {};
  const backend = storage.backend === 'git-ref' ? 'git-ref' : 'local';
  const git = storage.git || {};
  const refPrefix = String(git.refPrefix || DEFAULT_REF_PREFIX).replace(/\/+$/, '');
  const remote = git.remote != null && String(git.remote).trim() ? String(git.remote).trim() : null;
  const offline = git.offline === true || process.env.AIGON_STORAGE_OFFLINE === '1';
  return {
    backend,
    git: { remote, refPrefix, offline },
  };
}

module.exports = {
  DEFAULT_REF_PREFIX,
  resolveStorageConfig,
};
