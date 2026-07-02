'use strict';

const { createSpecStore, resolveStorageConfig } = require('./spec-store');
const { readSyncState } = require('./spec-store/sync-state');
const { remoteTrackingPrefix, listRefSpecKeys, countAheadBehind } = require('./spec-store/git-plumbing');
const { deriveAllLeases, refToLeaseKey } = require('./spec-store/leases');

/**
 * Server-owned storage status DTO for dashboard repo/settings payloads.
 *
 * @param {string} repoPath
 * @returns {object}
 */
function buildRepoStorageStatus(repoPath) {
    const storage = resolveStorageConfig(repoPath);
    if (storage.backend === 'local') {
        return { backend: 'local', health: 'ok' };
    }

    const { remote, refPrefix, offline } = storage.git;
    const syncState = readSyncState(repoPath);
    const trackingPrefix = remoteTrackingPrefix(remote, refPrefix);
    const keys = new Set([
        ...listRefSpecKeys(repoPath, refPrefix),
        ...listRefSpecKeys(repoPath, trackingPrefix),
    ]);
    let ahead = 0;
    let behind = 0;
    for (const key of keys) {
        const counts = countAheadBehind(
            repoPath,
            `${refPrefix}/${key}/events`,
            `${trackingPrefix}/${key}/events`,
        );
        ahead += counts.ahead;
        behind += counts.behind;
    }
    const health = syncState.lastError
        ? 'degraded'
        : (behind > 0 ? 'behind' : (ahead > 0 ? 'ahead' : 'ok'));

    return {
        backend: 'git-ref',
        remote,
        refPrefix,
        offline: Boolean(offline),
        lastSyncAt: syncState.lastSyncAt || null,
        ahead,
        behind,
        health,
        lastError: syncState.lastError || null,
    };
}

/**
 * @param {object} lease
 * @returns {object}
 */
function formatLeaseEntry(lease) {
    return {
        specKey: lease.key,
        role: lease.role,
        holderId: lease.holderId,
        agentId: lease.agentId || null,
        acquiredAt: lease.acquiredAt,
        expiresAt: lease.expiresAt,
        expired: Boolean(lease.expired),
    };
}

/**
 * Active (non-expired) leases for a feature/research row.
 *
 * @param {string} repoPath
 * @param {'feature'|'research'} entityType
 * @param {string|number} entityId
 * @returns {object[]}
 */
function buildEntityActiveLeases(repoPath, entityType, entityId) {
    if (!entityId || !/^\d+$/.test(String(entityId))) return [];
    try {
        const storage = resolveStorageConfig(repoPath);
        const store = createSpecStore({ repoPath, storage });
        const ref = { entityType, entityId: String(entityId) };
        const events = store.readEventsSync(ref);
        const key = refToLeaseKey(ref);
        const all = deriveAllLeases(events, key);
        return Object.values(all)
            .filter(Boolean)
            .map(formatLeaseEntry)
            .filter((lease) => !lease.expired);
    } catch (_) {
        return [];
    }
}

/**
 * @param {object} storageStatus
 * @returns {object[]}
 */
function buildRepoStorageActions(storageStatus) {
    const actions = [
        { action: 'storage', args: ['doctor'], label: 'Storage doctor', type: 'infra' },
        { action: 'storage', args: ['report'], label: 'Storage report', type: 'infra' },
    ];
    if (storageStatus && storageStatus.backend === 'git-ref') {
        actions.unshift({ action: 'storage', args: ['sync'], label: 'Sync storage', type: 'infra' });
    }
    return actions;
}

/**
 * @param {string} repoPath
 * @param {object[]} entities
 * @param {'feature'|'research'} entityType
 */
function attachActiveLeasesToEntities(repoPath, entities, entityType) {
    if (!Array.isArray(entities)) return;
    entities.forEach((item) => {
        if (!item || item.stage === 'done' || !/^\d+$/.test(String(item.id || ''))) return;
        const leases = buildEntityActiveLeases(repoPath, entityType, item.id);
        if (leases.length > 0) item.activeLeases = leases;
    });
}

module.exports = {
    buildRepoStorageStatus,
    buildEntityActiveLeases,
    buildRepoStorageActions,
    formatLeaseEntry,
    attachActiveLeasesToEntities,
};
