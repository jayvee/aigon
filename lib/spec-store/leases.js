'use strict';

const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { loadGlobalConfig, normalizeMachineId, getDefaultMachineId } = require('../config');
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

/**
 * Thrown when a claim (acquire/takeover) cannot reach the remote on a backend
 * where leases are authoritative (git-branch). A lock you can take offline is
 * not a lock, so claiming is online-mandatory. Event writes and lease *release*
 * retain offline tolerance and never raise this.
 */
class LeaseUnavailableError extends Error {
  constructor(message, remote) {
    super(message);
    this.name = 'LeaseUnavailableError';
    this.remote = remote || null;
  }
}

/**
 * Resolve the human owner recorded on a lease from git identity. Prefers
 * `user.email`, falls back to `user.name`, then null. Best-effort — a claim
 * must never fail because git identity is unset.
 * @param {string} repoPath
 * @returns {string|null}
 */
function resolveLeaseUser(repoPath) {
  const readConfig = (name) => {
    try {
      const result = spawnSync('git', ['config', '--get', name], {
        cwd: repoPath, encoding: 'utf8',
      });
      if (result.status !== 0) return null;
      const value = (result.stdout || '').trim();
      return value || null;
    } catch (_) {
      return null;
    }
  };
  return readConfig('user.email') || readConfig('user.name') || null;
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
  const envHolderId = normalizeMachineId(process.env.AIGON_MACHINE_ID);
  if (envHolderId) return envHolderId;
  try {
    const global = loadGlobalConfig();
    const configuredHolderId = normalizeMachineId(global && global.machineId);
    if (configuredHolderId) return configuredHolderId;
  } catch (_) { /* fall through */ }
  return getDefaultMachineId();
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

function isLeaseExpired(lease, nowMs = leaseNowMs()) {
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

function buildLeaseEvent(type, { key, role, holderId, user, agentId, acquiredAt, expiresAt, renewCount, priorHolderId, priorAgentId }) {
  const at = new Date().toISOString();
  const event = {
    id: buildLeaseEventId(key, role, type, at),
    type,
    at,
    leaseKey: key,
    leaseRole: role,
    holderId,
    user: user || null,
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

// ---------------------------------------------------------------------------
// CAS lease-file helpers (git-branch backend, F610).
//
// On the git-branch backend the *current* lease per key lives in a single file
// `leases/<KEY>.json` holding a roles map, written only via fast-forward-only
// push (compare-and-swap). Absent file or absent role key == no lease. These
// pure helpers keep parse/serialize/expiry shape in one place; the CAS protocol
// itself lives in `git-branch-leases.js`.
// ---------------------------------------------------------------------------

function leasesPathForKey(key) {
  return `leases/${key}.json`;
}

/**
 * Parse a `leases/<KEY>.json` blob into a roles map. Tolerates absent/empty
 * content and malformed JSON (treated as "no lease").
 * @param {string|null} raw
 * @returns {Record<string, object>}
 */
function parseLeaseFile(raw) {
  if (!raw || !String(raw).trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

/**
 * Serialize a roles map to stable, browsable JSON (sorted keys, trailing NL).
 * @param {Record<string, object>} map
 * @returns {string}
 */
function serializeLeaseFile(map) {
  const sorted = {};
  for (const role of Object.keys(map || {}).sort()) sorted[role] = map[role];
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

/**
 * Wall-clock expiry for a lease *file record* (documented clock-skew caveat).
 * @param {object|null} record
 * @param {number} [nowMs]
 * @returns {boolean}
 */
/** Injectable wall clock for lease TTL tests (F612 harness). */
let leaseNowOverrideMs = null;

function setLeaseNowForTests(value) {
  if (value == null) {
    leaseNowOverrideMs = null;
    return;
  }
  leaseNowOverrideMs = typeof value === 'number' ? value : Date.parse(String(value));
}

function clearLeaseNowForTests() {
  leaseNowOverrideMs = null;
}

function leaseNowMs() {
  return leaseNowOverrideMs != null ? leaseNowOverrideMs : Date.now();
}

function isLeaseRecordExpired(record, nowMs = leaseNowMs()) {
  if (!record) return true;
  const expiresMs = parseTime(record.expiresAt);
  if (expiresMs == null) return true;
  return expiresMs <= nowMs;
}

function computeExpiresAt(ttlMs = DEFAULT_LEASE_TTL_MS, nowMs = leaseNowMs()) {
  return new Date(nowMs + ttlMs).toISOString();
}

function shouldRenewCheckpoint(active, renewIntervalMs = DEFAULT_RENEW_INTERVAL_MS, nowMs = leaseNowMs()) {
  if (!active || isLeaseExpired(active, nowMs)) return true;
  const expiresMs = parseTime(active.expiresAt);
  if (expiresMs == null) return true;
  const remaining = expiresMs - nowMs;
  if (remaining <= renewIntervalMs) return true;
  const acquiredMs = parseTime(active.acquiredAt);
  const lastRenewMs = active.lastEventType === 'lease.renewed' ? parseTime(active.expiresAt) - DEFAULT_LEASE_TTL_MS : acquiredMs;
  if (lastRenewMs == null) return true;
  return (nowMs - lastRenewMs) >= renewIntervalMs;
}

module.exports = {
  DEFAULT_LEASE_TTL_MS,
  DEFAULT_RENEW_INTERVAL_MS,
  LEASE_EVENT_TYPES,
  LEASE_ROLES,
  LeaseConflictError,
  LeaseUnavailableError,
  isLeaseEvent,
  refToLeaseKey,
  resolveHolderId,
  resolveLeaseUser,
  deriveActiveLease,
  deriveAllLeases,
  isLeaseExpired,
  filterLeaseEvents,
  buildLeaseEvent,
  computeExpiresAt,
  shouldRenewCheckpoint,
  setLeaseNowForTests,
  clearLeaseNowForTests,
  leaseNowMs,
  leasesPathForKey,
  parseLeaseFile,
  serializeLeaseFile,
  isLeaseRecordExpired,
};
