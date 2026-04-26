'use strict';

/**
 * Engine-first lifecycle predicates with explicit folder fallback.
 *
 * The workflow-core engine (snapshot.lifecycle) is the source of truth for
 * entity lifecycle state. Spec folder position is a user-visible projection
 * — only valid as a fallback when no engine state exists (pre-start
 * inbox/backlog entities, or pre-engine legacy done features).
 *
 * Callers must pass `folderFallback` explicitly so the precedence rule is
 * visible at the call site. See feature-397.
 */

const fs = require('fs');
const { getEntityRoot, getSnapshotPathForEntity } = require('./paths');

function readSnapshotSync(repoPath, entityType, entityId) {
  const snapshotPath = getSnapshotPathForEntity(repoPath, entityType, entityId);
  try {
    const content = fs.readFileSync(snapshotPath, 'utf8');
    return JSON.parse(content);
  } catch (_) {
    return null;
  }
}

function engineDirExists(repoPath, entityType, entityId) {
  try {
    return fs.existsSync(getEntityRoot(repoPath, entityType, entityId));
  } catch (_) {
    return false;
  }
}

/**
 * Returns true when the entity's lifecycle is `done`.
 *
 * Precedence:
 *   1. Engine snapshot present → use snapshot.lifecycle === 'done'
 *   2. No snapshot, folder fallback === '05-done' → legacy pre-engine done
 *   3. Otherwise → false
 *
 * @param {string} repoPath
 * @param {string} entityType - 'feature' or 'research'
 * @param {string} entityId
 * @param {string|null} folderFallback - the folder name found by a folder
 *   scan, or null if not scanned. Required to be passed explicitly so the
 *   call site documents what fallback applies.
 * @returns {boolean}
 */
function isEntityDone(repoPath, entityType, entityId, folderFallback) {
  const snapshot = readSnapshotSync(repoPath, entityType, entityId);
  if (snapshot) {
    const lifecycle = String(snapshot.currentSpecState || snapshot.lifecycle || '').toLowerCase();
    return lifecycle === 'done';
  }
  // No engine state: fall back to folder only when there is no engine dir
  // (pre-engine legacy entity). An engine dir without a snapshot is drift,
  // not legacy — do not trust the folder.
  if (engineDirExists(repoPath, entityType, entityId)) return false;
  return folderFallback === '05-done';
}

module.exports = {
  isEntityDone,
  engineDirExists,
  readSnapshotSync,
};
