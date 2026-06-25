'use strict';

const crypto = require('crypto');
const os = require('os');
const { loadGlobalConfig } = require('../config');
const { formatSpecKey } = require('./spec-key');
const { normalizeEntityRef } = require('./entity-ref');

/** Default lease TTL — active work visible; dead machines expire within one window. */
const DEFAULT_LEASE_TTL_MS = 30 * 60 * 1000;
/** Minimum interval between `lease.renewed` checkpoints (not heartbeat cadence). */
const DEFAULT_RENEW_INTERVAL_MS = 10 * 60 * 1000;

const LEASE_EVENT_TYPES = Object.freeze([
  'lease.acquired',
  'lease.renewed',
  'lease.released',
  'lease.taken_over',
]);

const LEASE_ROLES = Object.freeze(['impl', 'research', 'eval', 'close']);

class LeaseConflictError extends Error {
  constructor(message, activeLease) {
    super(message);
    this.name = 'LeaseConflictError';
    this.activeLease = activeLease;
  }
}

function isLeaseEvent(event) {
  return Boolean(event && typeof event.type === 'string' && event.type.startsWith('lease.'));
}

function refToLeaseKey(ref) {
  const { entityType, entityId } = normalizeEntityRef(ref);
  const kind = entityType === 'research' ? 'research' : 'feature';
  return formatSpecKey({ kind, number: parseInt(entityId, 10) });
}

function resolveHolderId() {
  if (process.env.AIGON_MACHINE_ID && String(process.env.AIGON_MACHINE_ID).trim()) {
    return String(process.env.AIGON_MACHINE_ID).trim();
  }
  try {
    const global = loadGlobalConfig();
    if (global && global.machineId && String(global.machineId).trim()) {
      return String(global.machineId).trim();
    }
  } catch (_) { /* fall through */ }
  return os.hostname();
}

function buildLeaseEventId(key, role, type, at) {
  const hash = crypto.createHash('sha256')
    .update(`${key}|${role}|${type}|${at}`)
    .digest('hex')
    .slice(0, 16);
  return `lease-${key}-${role}-${hash}`;
}

function parseTime(value) {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Derive active lease for key+role from append-only lease events.
 * Expiry uses latest unreleased event's expiresAt vs wall clock.
 *
 * @param {object[]} events
 * @param {string} key
 * @param {string} role
 * @returns {object|null}
 */
function deriveActiveLease(events, key, role) {
  let active = null;
  for (const event of events) {
    if (!isLeaseEvent(event)) continue;
    if (event.leaseKey !== key || event.leaseRole !== role) continue;
    switch (event.type) {
      case 'lease.acquired':
      case 'lease.taken_over':
        active = {
          key,
          role,
          holderId: event.holderId,
          agentId: event.agentId,
          acquiredAt: event.acquiredAt || event.at,
          expiresAt: event.expiresAt,
          renewCount: event.renewCount || 0,
          lastEventType: event.type,
          priorHolderId: event.priorHolderId || null,
        };
        break;
      case 'lease.renewed':
        if (active && active.holderId === event.holderId) {
          active = {
            ...active,
            expiresAt: event.expiresAt || active.expiresAt,
            renewCount: event.renewCount != null ? event.renewCount : (active.renewCount + 1),
            lastEventType: event.type,
          };
        }
        break;
      case 'lease.released':
        if (active && (!event.holderId || active.holderId === event.holderId)) {
          active = null;
        }
        break;
      default:
        break;
    }
  }
  return active;
}

function isLeaseExpired(lease, nowMs = Date.now()) {
  if (!lease) return true;
  const expiresMs = parseTime(lease.expiresAt);
  if (expiresMs == null) return true;
  return expiresMs <= nowMs;
}

function deriveAllLeases(events, key) {
  const roles = new Set();
  for (const event of events) {
    if (isLeaseEvent(event) && event.leaseKey === key && event.leaseRole) {
      roles.add(event.leaseRole);
    }
  }
  const out = {};
  for (const role of roles) {
    const active = deriveActiveLease(events, key, role);
    if (active) {
      out[role] = { ...active, expired: isLeaseExpired(active) };
    }
  }
  return out;
}

function filterLeaseEvents(events) {
  return events.filter(isLeaseEvent);
}

function buildLeaseEvent(type, { key, role, holderId, agentId, acquiredAt, expiresAt, renewCount, priorHolderId, priorAgentId }) {
  const at = new Date().toISOString();
  const event = {
    id: buildLeaseEventId(key, role, type, at),
    type,
    at,
    leaseKey: key,
    leaseRole: role,
    holderId,
    agentId: agentId || null,
    acquiredAt: acquiredAt || at,
    expiresAt,
    renewCount: renewCount || 0,
  };
  if (type === 'lease.taken_over') {
    event.priorHolderId = priorHolderId || null;
    event.priorAgentId = priorAgentId || null;
  }
  return event;
}

function computeExpiresAt(ttlMs = DEFAULT_LEASE_TTL_MS) {
  return new Date(Date.now() + ttlMs).toISOString();
}

function shouldRenewCheckpoint(active, renewIntervalMs = DEFAULT_RENEW_INTERVAL_MS) {
  if (!active || isLeaseExpired(active)) return true;
  const expiresMs = parseTime(active.expiresAt);
  if (expiresMs == null) return true;
  const remaining = expiresMs - Date.now();
  if (remaining <= renewIntervalMs) return true;
  const acquiredMs = parseTime(active.acquiredAt);
  const lastRenewMs = active.lastEventType === 'lease.renewed' ? parseTime(active.expiresAt) - DEFAULT_LEASE_TTL_MS : acquiredMs;
  if (lastRenewMs == null) return true;
  return (Date.now() - lastRenewMs) >= renewIntervalMs;
}

module.exports = {
  DEFAULT_LEASE_TTL_MS,
  DEFAULT_RENEW_INTERVAL_MS,
  LEASE_EVENT_TYPES,
  LEASE_ROLES,
  LeaseConflictError,
  isLeaseEvent,
  refToLeaseKey,
  resolveHolderId,
  deriveActiveLease,
  deriveAllLeases,
  isLeaseExpired,
  filterLeaseEvents,
  buildLeaseEvent,
  computeExpiresAt,
  shouldRenewCheckpoint,
};
