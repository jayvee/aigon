'use strict';

const fs = require('fs');
const path = require('path');
const { loadProjectConfig, saveProjectConfig } = require('../config');
const { resolveStorageConfig, DEFAULT_REF_PREFIX } = require('./storage-config');
const { createSpecStore } = require('./index');
const { listNumericProjectionRefs, readProjectionEventsSync } = require('./projection');
const {
  runGit,
  fetchRemoteRefs,
  refExists,
  writeRefPayload,
} = require('./git-plumbing');
const { serializeEventsPayload } = require('./event-merge');

const ROLLBACK_HINT = 'To rollback, set storage.backend to "local" in .aigon/config.json (existing git refs are not deleted).';

function isAigonRepo(repoPath) {
  return (
    fs.existsSync(path.join(repoPath, '.aigon')) ||
    fs.existsSync(path.join(repoPath, 'docs', 'specs', 'features'))
  );
}

function isDirectRemote(remote) {
  return (
    remote.includes('://') ||
    remote.startsWith('/') ||
    remote.startsWith('./') ||
    remote.startsWith('../')
  );
}

function remoteExists(repoPath, remote) {
  if (isDirectRemote(remote)) {
    try {
      runGit(repoPath, ['ls-remote', remote]);
      return true;
    } catch (_) {
      return false;
    }
  }
  try {
    runGit(repoPath, ['remote', 'get-url', remote]);
    return true;
  } catch (_) {
    return false;
  }
}

function getRemoteUrl(repoPath, remote) {
  if (isDirectRemote(remote)) return remote;
  return runGit(repoPath, ['remote', 'get-url', remote]);
}

function listImportableProjectionKeys(repoPath) {
  return listNumericProjectionRefs(repoPath)
    .filter((ref) => ref.key && readProjectionEventsSync(repoPath, ref.entityType, ref.entityId).length > 0)
    .map((ref) => ({ key: ref.key, entityType: ref.entityType, entityId: ref.entityId }));
}

function buildPlannedStorageConfig(remote, refPrefix) {
  return {
    backend: 'git-ref',
    git: { remote, refPrefix },
  };
}

function storageConfigMatches(existing, remote, refPrefix) {
  return (
    existing.backend === 'git-ref' &&
    existing.git.remote === remote &&
    existing.git.refPrefix === refPrefix
  );
}

function validatePushAccess(repoPath, remote, refPrefix) {
  const probeRef = `${refPrefix}/convert-probe/events`;
  const hadProbe = refExists(repoPath, probeRef);
  if (!hadProbe) {
    writeRefPayload(repoPath, probeRef, serializeEventsPayload([]));
  }
  try {
    runGit(repoPath, ['push', '--dry-run', remote, probeRef]);
  } finally {
    if (!hadProbe) {
      try {
        runGit(repoPath, ['update-ref', '-d', probeRef]);
      } catch (_) { /* ignore */ }
    }
  }
}

function validateRemoteAccess(repoPath, remote, refPrefix) {
  getRemoteUrl(repoPath, remote);
  fetchRemoteRefs(repoPath, remote, refPrefix);
  validatePushAccess(repoPath, remote, refPrefix);
}

/**
 * Convert a local SpecStore repo to git-ref storage.
 *
 * @param {string} repoPath
 * @param {{ backend?: string, remote?: string, refPrefix?: string, dryRun?: boolean }} [options]
 */
async function runStorageConvert(repoPath, options = {}) {
  const backend = options.backend || 'git-ref';
  const remote = options.remote || 'origin';
  const refPrefix = String(options.refPrefix || DEFAULT_REF_PREFIX).replace(/\/+$/, '');
  const dryRun = options.dryRun === true;

  if (!isAigonRepo(repoPath)) {
    return { ok: false, error: 'Not an Aigon repository (.aigon/ or docs/specs/features/ required)' };
  }

  if (backend !== 'git-ref') {
    return { ok: false, error: 'Only --backend=git-ref is supported' };
  }

  const current = resolveStorageConfig(repoPath);
  const importKeys = listImportableProjectionKeys(repoPath);
  const planned = buildPlannedStorageConfig(remote, refPrefix);

  if (storageConfigMatches(current, remote, refPrefix)) {
    const store = createSpecStore({ repoPath, storage: current });
    const syncResult = await store.sync();
    if (!syncResult.ok) {
      return { ok: false, error: syncResult.error || 'storage sync failed' };
    }
    return {
      ok: true,
      alreadyConfigured: true,
      importKeys,
      importCount: importKeys.length,
      mergedKeys: syncResult.mergedKeys || 0,
      remote,
      refPrefix,
      rollbackHint: ROLLBACK_HINT,
    };
  }

  if (current.backend === 'git-ref') {
    return {
      ok: false,
      error: `Already using git-ref storage with remote=${current.git.remote || '(unset)'} refPrefix=${current.git.refPrefix}. Edit .aigon/config.json manually to change.`,
    };
  }

  if (!remoteExists(repoPath, remote)) {
    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        planned,
        importKeys,
        remote,
        refPrefix,
        remoteWarning: `Git remote "${remote}" not found`,
      };
    }
    return { ok: false, error: `Git remote "${remote}" not found` };
  }

  try {
    validateRemoteAccess(repoPath, remote, refPrefix);
  } catch (error) {
    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        planned,
        importKeys,
        remote,
        refPrefix,
        remoteUrl: getRemoteUrl(repoPath, remote),
        remoteWarning: error.message,
      };
    }
    return { ok: false, error: error.message };
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      planned,
      importKeys,
      remote,
      refPrefix,
      remoteUrl: getRemoteUrl(repoPath, remote),
    };
  }

  const project = loadProjectConfig(repoPath) || {};
  project.storage = planned;
  saveProjectConfig(project, repoPath);

  const storage = resolveStorageConfig(repoPath);
  const store = createSpecStore({ repoPath, storage });
  const syncResult = await store.sync();
  if (!syncResult.ok) {
    return { ok: false, error: syncResult.error || 'storage sync failed after convert' };
  }

  return {
    ok: true,
    converted: true,
    importCount: importKeys.length,
    mergedKeys: syncResult.mergedKeys || 0,
    remote,
    refPrefix,
    rollbackHint: ROLLBACK_HINT,
  };
}

module.exports = {
  runStorageConvert,
  ROLLBACK_HINT,
  listImportableProjectionKeys,
  isAigonRepo,
};
