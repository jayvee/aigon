'use strict';

const { loadProjectConfig } = require('../config');

const DEFAULT_STATE_BRANCH = 'aigon-state';
const GIT_REF_CONVERT_HINT = 'aigon storage convert --backend=git-branch --remote=origin';

const KNOWN_BACKENDS = new Set(['local', 'git-branch']);

class GitRefRemovedError extends Error {
  constructor() {
    super(`storage.backend "git-ref" is no longer supported. Run: ${GIT_REF_CONVERT_HINT}`);
    this.name = 'GitRefRemovedError';
    this.code = 'git_ref_removed';
  }
}

/**
 * Read storage settings from disk without normalising or rejecting legacy backends.
 * Used by `aigon storage convert` while migrating off git-ref.
 *
 * @param {string} [repoPath]
 */
function readRawStorageConfig(repoPath = process.cwd()) {
  const project = loadProjectConfig(repoPath) || {};
  const storage = project.storage || {};
  const git = storage.git || {};
  return {
    backend: storage.backend || 'local',
    git: {
      remote: git.remote != null && String(git.remote).trim() ? String(git.remote).trim() : null,
      refPrefix: git.refPrefix != null ? String(git.refPrefix) : null,
      branch: git.branch != null ? String(git.branch) : null,
      offline: git.offline === true || process.env.AIGON_STORAGE_OFFLINE === '1',
    },
  };
}

/**
 * Resolve SpecStore storage settings from `.aigon/config.json`.
 *
 * @param {string} [repoPath]
 * @returns {{ backend: 'local'|'git-branch', git: { remote: string|null, branch: string, offline: boolean } }}
 */
function resolveStorageConfig(repoPath = process.cwd()) {
  const raw = readRawStorageConfig(repoPath);
  if (raw.backend === 'git-ref') {
    throw new GitRefRemovedError();
  }
  const backend = KNOWN_BACKENDS.has(raw.backend) ? raw.backend : 'local';
  const branch = String(raw.git.branch || DEFAULT_STATE_BRANCH).trim() || DEFAULT_STATE_BRANCH;
  return {
    backend,
    git: {
      remote: raw.git.remote,
      branch,
      offline: raw.git.offline,
    },
  };
}

module.exports = {
  DEFAULT_STATE_BRANCH,
  GIT_REF_CONVERT_HINT,
  GitRefRemovedError,
  readRawStorageConfig,
  resolveStorageConfig,
};
