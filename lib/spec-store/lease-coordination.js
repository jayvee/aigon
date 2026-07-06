'use strict';

const { createSpecStore, resolveStorageConfig } = require('./index');
const { syncBeforeWrite, isOfflineMode } = require('./sync-guard');
const { LeaseConflictError, LeaseUnavailableError } = require('./leases');

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
  const offlineMode = isOfflineMode(storage, { offline });

  // Online-mandatory claims (single enforcement point): on the git-branch
  // backend a lease is authoritative mutual exclusion, so claiming it while
  // explicitly offline is refused up front. An unreachable-but-not-offline
  // remote is caught inside acquireLease's mandatory fetch. Release and event
  // writes keep today's offline tolerance and never reach this guard.
  if (acquire && storage.backend === 'git-branch' && offlineMode) {
    const key = `${entityType === 'research' ? 'R' : 'F'}${entityId}`;
    throw new LeaseUnavailableError(
      `Refusing to claim the ${role} lease on ${key} while offline — claiming requires reaching remote (${storage.git.remote || 'unset'}). `
      + 'A lock you can take offline is not a lock.',
      storage.git.remote,
    );
  }

  await syncBeforeWrite(repoPath, ref, { offline });

  const store = createSpecStore({ repoPath, storage });
  await store.assertLeaseAllowed(ref, { role, agentId, takeover });

  if (acquire) {
    await store.acquireLease(ref, { role, agentId, takeover });
  }

  return { store, ref, role, offline: offlineMode };
}

function formatLeaseConflict(error) {
  return error && error.message ? error.message : String(error);
}

/**
 * Sibling formatter for online-mandatory claim failures, so CLI output stays
 * consistent with lease conflicts. Callers already render `formatLeaseConflict`
 * for any thrown error, which surfaces the (descriptive) message either way.
 */
function formatLeaseUnavailable(error) {
  return error && error.message ? error.message : String(error);
}

module.exports = {
  coordinateMutatingCommand,
  formatLeaseConflict,
  formatLeaseUnavailable,
  LeaseConflictError,
  LeaseUnavailableError,
};
