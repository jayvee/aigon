'use strict';

const { createSpecStore, resolveStorageConfig } = require('./index');
const { syncBeforeWrite, isOfflineMode } = require('./sync-guard');
const { LeaseConflictError } = require('./leases');

/**
 * Coordinate git-ref sync + advisory lease for mutating CLI commands.
 *
 * @param {string} repoPath
 * @param {{ entityType: 'feature'|'research', entityId: string, role?: string, agentId?: string, takeover?: boolean, offline?: boolean, acquire?: boolean }} options
 */
async function coordinateMutatingCommand(repoPath, options) {
  const {
    entityType,
    entityId,
    role = entityType === 'research' ? 'research' : 'impl',
    agentId,
    takeover = false,
    offline = false,
    acquire = true,
  } = options;
  const ref = { entityType, entityId: String(entityId) };
  const storage = resolveStorageConfig(repoPath);

  await syncBeforeWrite(repoPath, ref, { offline });

  const store = createSpecStore({ repoPath, storage });
  await store.assertLeaseAllowed(ref, { role, agentId, takeover });

  if (acquire) {
    await store.acquireLease(ref, { role, agentId, takeover });
  }

  return { store, ref, role, offline: isOfflineMode(storage, { offline }) };
}

function formatLeaseConflict(error) {
  if (!(error instanceof LeaseConflictError)) return error.message;
  return error.message;
}

module.exports = {
  coordinateMutatingCommand,
  formatLeaseConflict,
  LeaseConflictError,
};
