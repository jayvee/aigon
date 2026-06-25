'use strict';

const fs = require('fs');
const path = require('path');

function syncStatePath(repoPath) {
  return path.join(repoPath, '.aigon', 'state', 'storage-sync.json');
}

/**
 * @param {string} repoPath
 * @returns {{ lastSyncAt: string|null, lastError: string|null }}
 */
function readSyncState(repoPath) {
  const filePath = syncStatePath(repoPath);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return { lastSyncAt: null, lastError: null };
  }
}

/**
 * @param {string} repoPath
 * @param {object} patch
 */
function writeSyncState(repoPath, patch) {
  const filePath = syncStatePath(repoPath);
  const current = readSyncState(repoPath);
  const next = { ...current, ...patch };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`);
}

module.exports = {
  readSyncState,
  writeSyncState,
};
