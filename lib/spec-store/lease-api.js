'use strict';

const {
  DEFAULT_LEASE_TTL_MS,
  DEFAULT_RENEW_INTERVAL_MS,
  LeaseConflictError,
  refToLeaseKey,
  resolveHolderId,
  deriveActiveLease,
  deriveAllLeases,
  isLeaseExpired,
  buildLeaseEvent,
  computeExpiresAt,
  shouldRenewCheckpoint,
} = require('./leases');

/**
 * Shared lease CRUD — used by local and git-ref backends.
 *
 * @param {object} store — SpecStore with readEvents/appendEvent/sync
 */
function createLeaseApi(store) {
  async function readLeaseEvents(ref) {
    const events = await store.readEvents(ref);
    const key = refToLeaseKey(ref);
    return events.filter((e) => e.leaseKey === key || (e.type && e.type.startsWith('lease.')));
  }

  async function readLeases(ref) {
    const events = await store.readEvents(ref);
    const key = refToLeaseKey(ref);
    return deriveAllLeases(events, key);
  }

  async function appendLease(ref, event) {
    await store.appendEvent(ref, event);
    const syncResult = await store.sync();
    if (syncResult && syncResult.ok === false) {
      throw new Error(syncResult.error || 'SpecStore sync failed after lease write');
    }
  }

  async function acquireLease(ref, options = {}) {
    const key = refToLeaseKey(ref);
    const role = options.role || 'impl';
    const holderId = options.holderId || resolveHolderId();
    const agentId = options.agentId || process.env.AIGON_AGENT_ID || null;
    const ttlMs = options.ttlMs || DEFAULT_LEASE_TTL_MS;
    const events = await store.readEvents(ref);
    const active = deriveActiveLease(events, key, role);

    if (active && !isLeaseExpired(active) && active.holderId !== holderId) {
      if (!options.takeover) {
        throw new LeaseConflictError(
          `Active ${role} lease on ${key} held by ${active.holderId} (agent ${active.agentId || 'unknown'}) until ${active.expiresAt}. Use --takeover to record an auditable takeover.`,
          active,
        );
      }
      const takeoverEvent = buildLeaseEvent('lease.taken_over', {
        key,
        role,
        holderId,
        agentId,
        acquiredAt: new Date().toISOString(),
        expiresAt: computeExpiresAt(ttlMs),
        renewCount: 0,
        priorHolderId: active.holderId,
        priorAgentId: active.agentId,
      });
      await appendLease(ref, takeoverEvent);
      return { ok: true, action: 'taken_over', expiresAt: takeoverEvent.expiresAt };
    }

    if (active && !isLeaseExpired(active) && active.holderId === holderId) {
      return renewLease(ref, { ...options, role, holderId, agentId, ttlMs });
    }

    const acquiredAt = new Date().toISOString();
    const event = buildLeaseEvent('lease.acquired', {
      key,
      role,
      holderId,
      agentId,
      acquiredAt,
      expiresAt: computeExpiresAt(ttlMs),
      renewCount: 0,
    });
    await appendLease(ref, event);
    return { ok: true, action: 'acquired', expiresAt: event.expiresAt };
  }

  async function renewLease(ref, options = {}) {
    const key = refToLeaseKey(ref);
    const role = options.role || 'impl';
    const holderId = options.holderId || resolveHolderId();
    const agentId = options.agentId || process.env.AIGON_AGENT_ID || null;
    const ttlMs = options.ttlMs || DEFAULT_LEASE_TTL_MS;
    const renewIntervalMs = options.renewIntervalMs || DEFAULT_RENEW_INTERVAL_MS;
    const events = await store.readEvents(ref);
    const active = deriveActiveLease(events, key, role);

    if (!active || isLeaseExpired(active)) {
      return acquireLease(ref, options);
    }
    if (active.holderId !== holderId && !options.takeover) {
      throw new LeaseConflictError(
        `Cannot renew ${role} lease on ${key}: held by ${active.holderId} until ${active.expiresAt}.`,
        active,
      );
    }
    if (!shouldRenewCheckpoint(active, renewIntervalMs)) {
      return { ok: true, action: 'skipped', expiresAt: active.expiresAt };
    }

    const renewCount = (active.renewCount || 0) + 1;
    const event = buildLeaseEvent('lease.renewed', {
      key,
      role,
      holderId,
      agentId,
      acquiredAt: active.acquiredAt,
      expiresAt: computeExpiresAt(ttlMs),
      renewCount,
    });
    await appendLease(ref, event);
    return { ok: true, action: 'renewed', expiresAt: event.expiresAt, renewCount };
  }

  async function releaseLease(ref, options = {}) {
    const key = refToLeaseKey(ref);
    const role = options.role || 'impl';
    const holderId = options.holderId || resolveHolderId();
    const agentId = options.agentId || process.env.AIGON_AGENT_ID || null;
    const events = await store.readEvents(ref);
    const active = deriveActiveLease(events, key, role);
    if (!active || isLeaseExpired(active)) {
      return { ok: true, action: 'none' };
    }
    if (active.holderId !== holderId && !options.force) {
      return { ok: false, action: 'not_holder' };
    }
    const event = buildLeaseEvent('lease.released', {
      key,
      role,
      holderId: active.holderId,
      agentId,
      acquiredAt: active.acquiredAt,
      expiresAt: active.expiresAt,
      renewCount: active.renewCount || 0,
    });
    await appendLease(ref, event);
    return { ok: true, action: 'released' };
  }

  async function assertLeaseAllowed(ref, options = {}) {
    const key = refToLeaseKey(ref);
    const role = options.role || 'impl';
    const holderId = options.holderId || resolveHolderId();
    const events = await store.readEvents(ref);
    const active = deriveActiveLease(events, key, role);
    if (!active || isLeaseExpired(active)) return { ok: true };
    if (active.holderId === holderId || options.takeover) return { ok: true, active };
    throw new LeaseConflictError(
      `Blocked: ${role} lease on ${key} held by ${active.holderId} (agent ${active.agentId || 'unknown'}) until ${active.expiresAt}. Re-run with --takeover to append lease.taken_over.`,
      active,
    );
  }

  return {
    readLeases,
    acquireLease,
    renewLease,
    releaseLease,
    assertLeaseAllowed,
    readLeaseEvents,
  };
}

module.exports = { createLeaseApi };
