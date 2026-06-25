'use strict';

const fs = require('fs/promises');
const path = require('path');
const {
  getEventsPathForEntity,
  getSnapshotPathForEntity,
} = require('../workflow-core/paths');
const { writeSnapshot } = require('../workflow-core/snapshot-store');
const { normalizeEntityRef } = require('./entity-ref');
const { formatSpecKey } = require('./spec-key');

/**
 * Rebuild the local `.aigon/workflows` projection from merged canonical events.
 *
 * @param {string} repoPath
 * @param {{ entityType: string, entityId: string } | string} ref
 * @param {object[]} events
 */
async function rebuildLocalProjection(repoPath, ref, events) {
  const { entityType, entityId } = normalizeEntityRef(ref);
  const eventsPath = getEventsPathForEntity(repoPath, entityType, entityId);
  await fs.mkdir(path.dirname(eventsPath), { recursive: true });
  const body = events.length ? `${events.map((e) => JSON.stringify(e)).join('\n')}\n` : '';
  await fs.writeFile(eventsPath, body, 'utf8');

  const snapshotPath = getSnapshotPathForEntity(repoPath, entityType, entityId);
  let snapshot = null;
  const engine = require('../workflow-core/engine');
  if (entityType === 'research') {
    snapshot = await engine.showResearchOrNull(repoPath, entityId);
  } else {
    snapshot = await engine.showFeatureOrNull(repoPath, entityId);
  }
  if (snapshot) {
    await writeSnapshot(snapshotPath, snapshot);
  } else if (events.length === 0) {
    await fs.rm(snapshotPath, { force: true });
  }
}

/**
 * @param {{ entityType: string, entityId: string } | string} ref
 * @returns {string}
 */
function refKeyFromEntityRef(ref) {
  const { entityType, entityId } = normalizeEntityRef(ref);
  const kind = entityType === 'research' ? 'research' : 'feature';
  return formatSpecKey({ kind, number: parseInt(entityId, 10) });
}

module.exports = {
  rebuildLocalProjection,
  refKeyFromEntityRef,
};
