'use strict';

const { createSpecStore, resolveStorageConfig } = require('./index');
const { listRefSpecKeys, fetchRemoteRefs, refExists, readRefPayload, remoteTrackingPrefix } = require('./git-plumbing');
const { parseEventsPayload, getEventId } = require('./event-merge');
const { readProjectionEventsSync } = require('./projection');
const {
  deriveActiveLease,
  deriveAllLeases,
  isLeaseExpired,
  isLeaseEvent,
  filterLeaseEvents,
} = require('./leases');
const {
  isStatsEvent,
  detectStatsProjectionDrift,
  rebuildStatsProjectionFromEvents,
  invalidateStatsAggregateCache,
} = require('./stats-canonical');

/**
 * Read-only SpecStore diagnostics (mutates only with --fix).
 *
 * @param {string} repoPath
 * @param {{ fix?: boolean }} [options]
 */
async function runStorageDoctor(repoPath, options = {}) {
  const storage = resolveStorageConfig(repoPath);
  const store = createSpecStore({ repoPath, storage });
  const issues = [];
  const fixes = [];

  if (storage.backend === 'git-ref') {
    const { remote, refPrefix } = storage.git;
    try {
      if (!storage.git.offline) {
        fetchRemoteRefs(repoPath, remote, refPrefix);
      }
    } catch (error) {
      issues.push({ severity: 'error', code: 'remote_unreachable', message: error.message });
    }

    const trackingPrefix = remoteTrackingPrefix(remote, refPrefix);
    const keys = new Set([
      ...listRefSpecKeys(repoPath, refPrefix),
      ...listRefSpecKeys(repoPath, trackingPrefix),
    ]);

    for (const key of keys) {
      const localRef = `${refPrefix}/${key}/events`;
      const remoteRef = `${trackingPrefix}/${key}/events`;
      let events = [];
      try {
        events = store._readCanonicalEvents ? store._readCanonicalEvents(key) : parseEventsPayload(readRefPayload(repoPath, localRef));
      } catch (error) {
        issues.push({ severity: 'error', code: 'events_read_failed', key, message: error.message });
        continue;
      }

      const ids = new Map();
      for (const event of events) {
        const id = getEventId(event);
        if (ids.has(id)) {
          issues.push({
            severity: 'error',
            code: 'duplicate_event_id',
            key,
            eventId: id,
            message: `Duplicate event id ${id} in canonical log for ${key}`,
          });
        }
        ids.set(id, (ids.get(id) || 0) + 1);
      }

      if (!refExists(repoPath, localRef) && refExists(repoPath, remoteRef)) {
        issues.push({
          severity: 'warn',
          code: 'missing_local_projection',
          key,
          message: `Remote ref exists for ${key} but local canonical ref is missing`,
        });
        if (options.fix && typeof store._mergeRefKey === 'function') {
          await store._mergeRefKey(key);
          fixes.push(`merged ${key} from remote`);
        }
      }

      const match = key.match(/^([FR])(\d+)$/);
      if (match) {
        const entityType = match[1] === 'R' ? 'research' : 'feature';
        const entityId = match[2];
        const projectionEvents = readProjectionEventsSync(repoPath, entityType, entityId);
        const workflowCanonical = events.filter((e) => !isLeaseEvent(e) && !isStatsEvent(e));
        if (projectionEvents.length > 0 && workflowCanonical.length === 0) {
          issues.push({
            severity: 'warn',
            code: 'stale_projection',
            key,
            message: `Local projection has events but canonical log for ${key} has none`,
          });
        }

        const statsDrift = detectStatsProjectionDrift(repoPath, entityType, entityId, events);
        if (statsDrift) {
          issues.push({
            severity: 'warn',
            code: statsDrift.code,
            key,
            message: statsDrift.code === 'missing_local_stats_projection'
              ? `Canonical stats exist for ${key} but local stats.json is missing`
              : `Local stats.json for ${key} disagrees with canonical stats.recorded event`,
          });
          if (options.fix) {
            rebuildStatsProjectionFromEvents(repoPath, entityType, entityId, events);
            invalidateStatsAggregateCache(repoPath);
            fixes.push(`rebuilt stats projection for ${key}`);
          }
        }
      }

      const leases = deriveAllLeases(events, key);
      for (const [role, lease] of Object.entries(leases)) {
        if (lease.expired && lease.lastEventType !== 'lease.released') {
          issues.push({
            severity: 'warn',
            code: 'expired_unreleased_lease',
            key,
            role,
            holderId: lease.holderId,
            expiresAt: lease.expiresAt,
            message: `Expired but unreleased ${role} lease on ${key} (holder ${lease.holderId})`,
          });
        }
      }

      const leaseEvents = filterLeaseEvents(events).filter((e) => e.leaseKey === key);
      const activeByRole = {};
      for (const event of leaseEvents) {
        if (!event.leaseRole) continue;
        const active = deriveActiveLease(events, key, event.leaseRole);
        if (active && !isLeaseExpired(active)) {
          if (activeByRole[event.leaseRole] && activeByRole[event.leaseRole].holderId !== active.holderId) {
            issues.push({
              severity: 'error',
              code: 'conflicting_lease_holders',
              key,
              role: event.leaseRole,
              message: `Conflicting active holders for ${key}/${event.leaseRole}`,
            });
          }
          activeByRole[event.leaseRole] = active;
        }
      }
    }
  } else {
    const specs = await store.listSpecs();
    for (const spec of specs) {
      if (!spec.number) continue;
      const ref = { entityType: spec.kind === 'research' ? 'research' : 'feature', entityId: String(spec.number) };
      const events = await store.readEvents(ref);
      const key = spec.key;
      const leases = deriveAllLeases(events, key);
      for (const [role, lease] of Object.entries(leases)) {
        if (lease.expired && lease.lastEventType !== 'lease.released') {
          issues.push({
            severity: 'warn',
            code: 'expired_unreleased_lease',
            key,
            role,
            holderId: lease.holderId,
            expiresAt: lease.expiresAt,
            message: `Expired but unreleased ${role} lease on ${key}`,
          });
        }
      }
    }
  }

  const health = await store.health();
  return { ok: issues.every((i) => i.severity !== 'error'), issues, fixes, health, backend: storage.backend };
}

module.exports = { runStorageDoctor };
