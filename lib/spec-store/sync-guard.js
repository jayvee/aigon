'use strict';

const { createSpecStore, resolveStorageConfig } = require('./index');

function isOfflineMode(storage, options = {}) {
  if (options.offline) return true;
  if (process.env.AIGON_STORAGE_OFFLINE === '1') return true;
  return Boolean(storage && storage.git && storage.git.offline);
}

/**
 * Fetch+merge before mutating writes on git-ref backends (577 path).
 *
 * @param {string} repoPath
 * @param {{ entityType: string, entityId: string }|null} ref
 * @param {{ offline?: boolean }} [options]
 */
async function syncBeforeWrite(repoPath, ref, options = {}) {
  const storage = resolveStorageConfig(repoPath);
  if (storage.backend !== 'git-ref' || isOfflineMode(storage, options)) {
    return { ok: true, skipped: true };
  }
  const store = createSpecStore({ repoPath, storage });
  if (typeof store.syncBeforeWrite === 'function') {
    return store.syncBeforeWrite(ref);
  }
  const result = await store.sync();
  if (result && result.ok === false) {
    throw new Error(result.error || 'SpecStore sync failed');
  }
  return result;
}

module.exports = {
  isOfflineMode,
  syncBeforeWrite,
};
