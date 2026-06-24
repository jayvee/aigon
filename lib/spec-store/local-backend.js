'use strict';

const fs = require('fs/promises');
const path = require('path');
const {
  CANONICAL_STAGE_DIRS,
  getEventsPathForEntity,
  getSnapshotPathForEntity,
  getLockPathForEntity,
  getSpecPathForEntity,
} = require('../workflow-core/paths');
const { readEvents, appendEvent } = require('../workflow-core/event-store');
const { readSnapshot, writeSnapshot } = require('../workflow-core/snapshot-store');
const { withFeatureLockRetry } = require('../workflow-core/lock');
const { parseSpecKey, formatSpecKey, entityTypeFromKind } = require('./spec-key');

const KIND_CONFIG = Object.freeze({
  feature: { prefix: 'feature', docsDir: 'features' },
  research: { prefix: 'research', docsDir: 'research-topics' },
});

function keyToEntity(key) {
  const parsed = parseSpecKey(key);
  return {
    parsed,
    entityType: entityTypeFromKind(parsed.kind),
    entityId: String(parsed.number),
  };
}

/**
 * @param {string} repoPath
 * @returns {import('./interface').SpecStore}
 */
function createLocalBackend(repoPath) {
  return {
  async listSpecs() {
    const specs = [];
    for (const kind of ['feature', 'research']) {
      const cfg = KIND_CONFIG[kind];
      const visibleRoot = path.join(repoPath, 'docs', 'specs', cfg.docsDir);
      for (const stageDir of CANONICAL_STAGE_DIRS) {
        const stagePath = path.join(visibleRoot, stageDir);
        let files;
        try {
          files = await fs.readdir(stagePath);
        } catch (error) {
          if (error.code === 'ENOENT') {
            continue;
          }
          throw error;
        }
        for (const file of files) {
          if (!file.endsWith('.md')) {
            continue;
          }
          const idMatch = file.match(new RegExp(`^${cfg.prefix}-(\\d+)(?:-|$)`));
          if (!idMatch) {
            continue;
          }
          const number = parseInt(idMatch[1], 10);
          specs.push({
            key: formatSpecKey({ kind, number }),
            kind,
            number,
            path: path.join(stagePath, file),
            stageDir,
          });
        }
      }
    }
    return specs;
  },

  async readSpec(key) {
    const { parsed, entityType, entityId } = keyToEntity(key);
    const snapshotPath = getSnapshotPathForEntity(repoPath, entityType, entityId);
    const snapshot = await readSnapshot(snapshotPath);
    const lifecycle = snapshot && (snapshot.lifecycle || snapshot.currentSpecState);
    if (lifecycle) {
      const specPath = getSpecPathForEntity(repoPath, entityType, entityId, lifecycle, { snapshot });
      return fs.readFile(specPath, 'utf8');
    }
    const listed = await this.listSpecs();
    const match = listed.find((entry) => entry.key === formatSpecKey(parsed));
    if (!match) {
      throw new Error(`Spec not found for key ${parsed.key}`);
    }
    return fs.readFile(match.path, 'utf8');
  },

  async readEvents(key) {
    const { entityType, entityId } = keyToEntity(key);
    return readEvents(getEventsPathForEntity(repoPath, entityType, entityId));
  },

  async appendEvent(key, event) {
    const { entityType, entityId } = keyToEntity(key);
    return appendEvent(getEventsPathForEntity(repoPath, entityType, entityId), event);
  },

  async readSnapshot(key) {
    const { entityType, entityId } = keyToEntity(key);
    return readSnapshot(getSnapshotPathForEntity(repoPath, entityType, entityId));
  },

  async writeSnapshot(key, snapshot) {
    const { entityType, entityId } = keyToEntity(key);
    return writeSnapshot(getSnapshotPathForEntity(repoPath, entityType, entityId), snapshot);
  },

  async lock(key, work) {
    const { entityType, entityId } = keyToEntity(key);
    return withFeatureLockRetry(getLockPathForEntity(repoPath, entityType, entityId), work);
  },

  async sync() {
    return { ok: true, backend: 'local' };
  },

  async health() {
    return { ok: true, backend: 'local' };
  },
  };
}

module.exports = { createLocalBackend };
