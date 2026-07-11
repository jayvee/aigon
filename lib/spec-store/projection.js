'use strict';

const fsSync = require('fs');
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
  const snapshotPath = getSnapshotPathForEntity(repoPath, entityType, entityId);

  if (!Array.isArray(events) || events.length === 0) {
    await fs.rm(path.dirname(eventsPath), { recursive: true, force: true });
    await fs.rm(snapshotPath, { force: true });
    return;
  }

  await fs.mkdir(path.dirname(eventsPath), { recursive: true });
  const body = `${events.map((e) => JSON.stringify(e)).join('\n')}\n`;
  await fs.writeFile(eventsPath, body, 'utf8');

  let snapshot = null;
  const engine = require('../workflow-core/engine');
  if (entityType === 'research') {
    snapshot = await engine.showResearchOrNull(repoPath, entityId);
  } else {
    snapshot = await engine.showFeatureOrNull(repoPath, entityId);
  }
  if (snapshot) {
    await writeSnapshot(snapshotPath, snapshot);
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

function tryRefKeyFromEntityRef(ref) {
  const { entityType, entityId } = normalizeEntityRef(ref);
  if (!/^\d+$/.test(String(entityId))) {
    return null;
  }
  const number = parseInt(entityId, 10);
  if (!Number.isSafeInteger(number) || number <= 0) {
    return null;
  }
  const kind = entityType === 'research' ? 'research' : 'feature';
  return formatSpecKey({ kind, number });
}

function readProjectionEventsSync(repoPath, entityType, entityId) {
  const eventsPath = getEventsPathForEntity(repoPath, entityType, entityId);
  try {
    return fsSync.readFileSync(eventsPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (_) {
    return [];
  }
}

function listNumericProjectionRefs(repoPath) {
  const configs = [
    { entityType: 'feature', workflowDir: 'features' },
    { entityType: 'research', workflowDir: 'research' },
  ];
  const refs = [];
  for (const cfg of configs) {
    const root = path.join(repoPath, '.aigon', 'workflows', cfg.workflowDir);
    let entries;
    try {
      entries = fsSync.readdirSync(root, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name) || parseInt(entry.name, 10) <= 0) continue;
      refs.push({
        entityType: cfg.entityType,
        entityId: entry.name,
        key: tryRefKeyFromEntityRef({ entityType: cfg.entityType, entityId: entry.name }),
      });
    }
  }
  return refs;
}

module.exports = {
  rebuildLocalProjection,
  refKeyFromEntityRef,
  tryRefKeyFromEntityRef,
  readProjectionEventsSync,
  listNumericProjectionRefs,
};
