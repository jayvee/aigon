'use strict';

const { createSpecStore, resolveStorageConfig } = require('./index');
const { syncBeforeWrite, isOfflineMode } = require('./sync-guard');
const {
  LeaseConflictError,
  LeaseUnavailableError,
  refToLeaseKey,
  resolveHolderId,
} = require('./leases');

function findForeignActiveLease(activeLeases, localHolderId) {
  const holder = localHolderId != null ? String(localHolderId) : '';
  return (Array.isArray(activeLeases) ? activeLeases : []).find((lease) => {
    if (!lease || lease.expired) return false;
    if (!lease.holderId) return false;
    return String(lease.holderId) !== holder;
  }) || null;
}

function formatLeaseHolder(lease) {
  if (!lease) return 'unknown';
  const holderId = lease.holderId || 'unknown';
  const agentId = lease.agentId ? String(lease.agentId).toUpperCase() : null;
  return agentId ? `${holderId} (${agentId})` : holderId;
}

function formatForeignLeaseConflictMessage(ref, lease, localHolderId) {
  const key = refToLeaseKey(ref);
  const holder = formatLeaseHolder(lease);
  const role = lease && lease.role ? `${lease.role} ` : '';
  const suffix = lease && lease.expiresAt ? ` until ${lease.expiresAt}` : '';
  if (localHolderId && lease && String(lease.holderId) === String(localHolderId)) {
    return `Blocked: ${role}lease on ${key} is still held by this machine (${holder})${suffix}.`;
  }
  return `Blocked: ${role}lease on ${key} is held by ${holder}${suffix}. Wait for that machine to release it before mutating this item.`;
}

/**
 * Coordinate storage sync + advisory lease for mutating CLI commands.
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

/**
 * Ensure an entity has no active lease held by a different machine before a
 * destructive or merge-like command proceeds.
 */
async function assertNoForeignActiveLeases(repoPath, ref, options = {}) {
  const storage = resolveStorageConfig(repoPath);
  const offline = isOfflineMode(storage, options);
  await syncBeforeWrite(repoPath, ref, { offline });

  const store = createSpecStore({ repoPath, storage });
  const localHolderId = options.holderId || resolveHolderId();
  if (typeof store.readLeases !== 'function') {
    return { ok: true, store, ref, localHolderId };
  }

  const activeLeases = await store.readLeases(ref);
  const foreign = findForeignActiveLease(Object.values(activeLeases || {}), localHolderId);
  if (foreign) {
    throw new LeaseConflictError(formatForeignLeaseConflictMessage(ref, foreign, localHolderId), foreign);
  }

  return { ok: true, store, ref, localHolderId, activeLeases };
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

/**
 * Release one or more lease roles after close/reset/pause. Never throws;
 * warnings and not_holder results are printed only.
 *
 * @param {object} store - SpecStore from coordinateMutatingCommand
 * @param {{ entityType: string, entityId: string }} ref
 * @param {string[]} roles
 * @param {{ agentId?: string }} [options]
 */
async function releaseEntityLeases(store, ref, roles, options = {}) {
  if (!store || typeof store.releaseLease !== 'function') return;
  const agentId = options.agentId || process.env.AIGON_AGENT_ID || null;
  for (const role of roles) {
    try {
      const result = await store.releaseLease(ref, { role, agentId });
      if (result && result.warning) {
        console.warn(`⚠️  ${result.warning}`);
      } else if (result && result.action === 'not_holder') {
        console.log(`ℹ️  ${role} lease not held by this machine — not released`);
      }
    } catch (error) {
      console.warn(`⚠️  Could not release ${role} lease: ${error.message}`);
    }
  }
}

/**
 * Work-role lease for an entity type (impl for features, research for research).
 */
function workLeaseRole(entityType) {
  return entityType === 'research' ? 'research' : 'impl';
}

/**
 * Release work + close leases after a successful entity close.
 */
async function releaseLeasesAfterClose(store, ref, entityType, agentId) {
  const workRole = workLeaseRole(entityType);
  await releaseEntityLeases(store, ref, [workRole, 'close'], { agentId });
}

/**
 * Release the work-role lease after reset or pause.
 */
async function releaseLeasesAfterResetOrPause(store, ref, entityType, agentId) {
  await releaseEntityLeases(store, ref, [workLeaseRole(entityType)], { agentId });
}

module.exports = {
  coordinateMutatingCommand,
  assertNoForeignActiveLeases,
  formatLeaseConflict,
  formatLeaseUnavailable,
  findForeignActiveLease,
  releaseEntityLeases,
  releaseLeasesAfterClose,
  releaseLeasesAfterResetOrPause,
  workLeaseRole,
  LeaseConflictError,
  LeaseUnavailableError,
};
