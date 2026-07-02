'use strict';

const crypto = require('crypto');
const fs = require('fs');
const { getEventId } = require('./event-merge');
const { resolveStorageConfig } = require('./storage-config');

const STATS_EVENT_TYPE = 'stats.recorded';
const STATS_VERSION = 1;

function readStatsLazy(repoPath, entityType, entityId) {
  return require('../feature-status').readStats(repoPath, entityType, entityId);
}

function writeStatsLazy(repoPath, entityType, entityId, data) {
  return require('../feature-status').writeStats(repoPath, entityType, entityId, data);
}

function isStatsEvent(event) {
  return Boolean(event && event.type === STATS_EVENT_TYPE);
}

/**
 * @param {object} stats
 * @returns {string}
 */
function stableStatsDigest(stats) {
  return crypto.createHash('sha256').update(JSON.stringify(stats)).digest('hex').slice(0, 16);
}

/**
 * @param {'feature'|'research'} entityType
 * @param {string|number} entityId
 * @param {object} stats
 * @returns {string}
 */
function buildStatsEventId(entityType, entityId, stats) {
  const key = entityType === 'research' ? `R${entityId}` : `F${entityId}`;
  const completedAt = stats.completedAt || stats.updatedAt || '';
  return crypto.createHash('sha256').update(JSON.stringify({
    key,
    statsVersion: STATS_VERSION,
    completedAt,
    digest: stableStatsDigest(stats),
  })).digest('hex').slice(0, 24);
}

/**
 * @param {'feature'|'research'} entityType
 * @param {string|number} entityId
 * @param {object} stats
 * @returns {object}
 */
function buildStatsRecordedEvent(entityType, entityId, stats) {
  const at = stats.completedAt || stats.updatedAt || new Date().toISOString();
  const event = {
    id: buildStatsEventId(entityType, entityId, stats),
    type: STATS_EVENT_TYPE,
    at,
    statsVersion: STATS_VERSION,
    stats: { ...stats },
  };
  if (entityType === 'research') {
    event.researchId = String(entityId);
  } else {
    event.featureId = String(entityId);
  }
  return event;
}

/**
 * @param {object[]} events
 * @returns {object|null}
 */
function extractLatestStatsFromEvents(events) {
  const statsEvents = (events || []).filter(isStatsEvent);
  if (statsEvents.length === 0) return null;
  statsEvents.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const latest = statsEvents[statsEvents.length - 1];
  return latest.stats && typeof latest.stats === 'object' ? { ...latest.stats } : null;
}

function statsPayloadsEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const strip = (obj) => {
    const copy = { ...obj };
    delete copy.updatedAt;
    return JSON.stringify(copy);
  };
  return strip(a) === strip(b);
}

/**
 * @param {string} repoPath
 * @param {'feature'|'research'} entityType
 * @param {string|number} entityId
 * @param {object} stats
 */
async function recordCanonicalStats(repoPath, entityType, entityId, stats) {
  const storage = resolveStorageConfig(repoPath);
  if (storage.backend !== 'git-ref' || !stats || typeof stats !== 'object') {
    return { recorded: false };
  }
  const { createSpecStore } = require('./index');
  const store = createSpecStore({ repoPath, storage });
  const ref = { entityType, entityId: String(entityId) };
  const event = buildStatsRecordedEvent(entityType, entityId, stats);
  await store.appendEvent(ref, event);
  return { recorded: true, eventId: getEventId(event) };
}

/**
 * @param {string} repoPath
 * @param {'feature'|'research'} entityType
 * @param {string|number} entityId
 * @param {object[]} events
 */
function rebuildStatsProjectionFromEvents(repoPath, entityType, entityId, events) {
  const canonical = extractLatestStatsFromEvents(events);
  if (!canonical) return { updated: false };
  const local = readStatsLazy(repoPath, entityType, entityId);
  const canonicalAt = canonical.completedAt || canonical.updatedAt || '';
  const localAt = local && (local.completedAt || local.updatedAt || '');
  if (localAt && canonicalAt && localAt > canonicalAt) {
    return { updated: false, skipped: true, reason: 'local_newer' };
  }
  if (local && statsPayloadsEqual(canonical, local)) {
    return { updated: false, reason: 'already_current' };
  }
  writeStatsLazy(repoPath, entityType, entityId, canonical);
  return { updated: true };
}

/**
 * @param {string} repoPath
 * @param {'feature'|'research'} entityType
 * @param {string|number} entityId
 * @param {object[]} events
 * @returns {object|null}
 */
function detectStatsProjectionDrift(repoPath, entityType, entityId, events) {
  const canonical = extractLatestStatsFromEvents(events);
  if (!canonical) return null;
  const local = readStatsLazy(repoPath, entityType, entityId);
  if (!local) {
    return {
      drift: true,
      code: 'missing_local_stats_projection',
      entityType,
      entityId,
    };
  }
  if (!statsPayloadsEqual(canonical, local)) {
    return {
      drift: true,
      code: 'stats_projection_drift',
      entityType,
      entityId,
    };
  }
  return null;
}

function invalidateStatsAggregateCache(repoPath) {
  try {
    fs.unlinkSync(require('../stats-aggregate').cachePath(repoPath));
  } catch (_) { /* cache may not exist */ }
}

/**
 * @param {string} repoPath
 * @param {string} key
 * @param {object[]} events
 */
function rebuildStatsProjectionForKey(repoPath, key, events) {
  const match = String(key).match(/^([FR])(\d+)$/);
  if (!match) return { updated: false };
  const entityType = match[1] === 'R' ? 'research' : 'feature';
  const entityId = match[2];
  const result = rebuildStatsProjectionFromEvents(repoPath, entityType, entityId, events);
  if (result.updated) invalidateStatsAggregateCache(repoPath);
  return result;
}

module.exports = {
  STATS_EVENT_TYPE,
  STATS_VERSION,
  isStatsEvent,
  buildStatsEventId,
  buildStatsRecordedEvent,
  extractLatestStatsFromEvents,
  statsPayloadsEqual,
  recordCanonicalStats,
  rebuildStatsProjectionFromEvents,
  rebuildStatsProjectionForKey,
  detectStatsProjectionDrift,
  invalidateStatsAggregateCache,
};
