'use strict';

const crypto = require('crypto');

const FORMAT_VERSION = 1;

/**
 * Stable event identity for append idempotency and cross-machine merge.
 *
 * @param {object} event
 * @returns {string}
 */
function getEventId(event) {
  if (event && event.id != null && String(event.id).trim()) {
    return String(event.id);
  }
  const payload = {
    type: event.type,
    at: event.at,
    featureId: event.featureId,
    researchId: event.researchId,
    agentId: event.agentId,
    effectId: event.effectId,
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24);
}

/**
 * Union-merge event logs, dedupe by event ID, preserve stable order (local first, then remote-only).
 *
 * @param {object[]} localEvents
 * @param {object[]} remoteEvents
 * @returns {object[]}
 */
function mergeEventsById(localEvents, remoteEvents) {
  const merged = [];
  const seen = new Set();
  for (const source of [localEvents, remoteEvents]) {
    for (const event of source) {
      const id = getEventId(event);
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(event.id ? event : { ...event, id });
    }
  }
  return merged;
}

/**
 * @param {object[]} events
 * @returns {string}
 */
function serializeEventsPayload(events) {
  return JSON.stringify({
    formatVersion: FORMAT_VERSION,
    events,
  });
}

/**
 * @param {string} raw
 * @returns {object[]}
 */
function parseEventsPayload(raw) {
  if (!raw || !String(raw).trim()) return [];
  const trimmed = String(raw).trim();
  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed.events)) return parsed.events;
    return [];
  }
  return trimmed
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

module.exports = {
  FORMAT_VERSION,
  getEventId,
  mergeEventsById,
  serializeEventsPayload,
  parseEventsPayload,
};
