'use strict';

const fs = require('fs');
const fsPromises = require('fs/promises');
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
const { withFeatureLock, withFeatureLockRetry, tryWithFeatureLock } = require('../workflow-core/lock');
const { parseSpecKey, formatSpecKey, entityTypeFromKind } = require('./spec-key');
const { normalizeEntityRef } = require('./entity-ref');

const KIND_CONFIG = Object.freeze({
  feature: { prefix: 'feature', docsDir: 'features' },
  research: { prefix: 'research', docsDir: 'research-topics' },
});

function keyToEntity(key) {
  return normalizeEntityRef(key);
}

function readEventsSyncAtPath(eventsPath) {
  try {
    const content = fs.readFileSync(eventsPath, 'utf8');
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    return [];
  }
}

function readSnapshotSyncAtPath(snapshotPath) {
  try {
    const content = fs.readFileSync(snapshotPath, 'utf8');
    return JSON.parse(content);
  } catch (_) {
    return null;
  }
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
          files = await fsPromises.readdir(stagePath);
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
    const parsed = parseSpecKey(key);
    const { entityType, entityId } = keyToEntity(key);
    const snapshotPath = getSnapshotPathForEntity(repoPath, entityType, entityId);
    const snapshot = await readSnapshot(snapshotPath);
    const lifecycle = snapshot && (snapshot.lifecycle || snapshot.currentSpecState);
    if (lifecycle) {
      const specPath = getSpecPathForEntity(repoPath, entityType, entityId, lifecycle, { snapshot });
      return fsPromises.readFile(specPath, 'utf8');
    }
    const listed = await this.listSpecs();
    const match = listed.find((entry) => entry.key === formatSpecKey(parsed));
    if (!match) {
      throw new Error(`Spec not found for key ${parsed.key}`);
    }
    return fsPromises.readFile(match.path, 'utf8');
  },

  async readEvents(ref) {
    const { entityType, entityId } = normalizeEntityRef(ref);
    return readEvents(getEventsPathForEntity(repoPath, entityType, entityId));
  },

  readEventsSync(ref) {
    const { entityType, entityId } = normalizeEntityRef(ref);
    return readEventsSyncAtPath(getEventsPathForEntity(repoPath, entityType, entityId));
  },

  async appendEvent(ref, event) {
    const { entityType, entityId } = normalizeEntityRef(ref);
    return appendEvent(getEventsPathForEntity(repoPath, entityType, entityId), event);
  },

  async readSnapshot(ref) {
    const { entityType, entityId } = normalizeEntityRef(ref);
    return readSnapshot(getSnapshotPathForEntity(repoPath, entityType, entityId));
  },

  readSnapshotSync(ref) {
    const { entityType, entityId } = normalizeEntityRef(ref);
    return readSnapshotSyncAtPath(getSnapshotPathForEntity(repoPath, entityType, entityId));
  },

  async writeSnapshot(ref, snapshot) {
    const { entityType, entityId } = normalizeEntityRef(ref);
    return writeSnapshot(getSnapshotPathForEntity(repoPath, entityType, entityId), snapshot);
  },

  async lock(ref, work, options = {}) {
    const { entityType, entityId } = normalizeEntityRef(ref);
    const lockPath = getLockPathForEntity(repoPath, entityType, entityId);
    if (options.try) {
      return tryWithFeatureLock(lockPath, work);
    }
    if (options.retry === false) {
      return withFeatureLock(lockPath, work);
    }
    return withFeatureLockRetry(lockPath, work, options);
  },

  async sync() {
    return { ok: true, backend: 'local' };
  },

  async health() {
    return { ok: true, backend: 'local' };
  },
  };
}

module.exports = { createLocalBackend, readEventsSyncAtPath, readSnapshotSyncAtPath };
