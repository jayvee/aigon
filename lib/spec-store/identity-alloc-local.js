'use strict';

const fs = require('fs');
const path = require('path');
const {
  SEQUENCES_LOCAL_REL,
  parseSequences,
  serializeSequences,
  mergeSeededHighWater,
  reserveNextInDoc,
  markMaterializedInDoc,
  listPendingReservations,
} = require('./identity-sequences');

function sequencesPath(repoPath) {
  return path.join(repoPath, SEQUENCES_LOCAL_REL);
}

function withIdentityLockSync(lockPath, work) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const handle = fs.openSync(lockPath, 'wx');
  try {
    return work();
  } finally {
    fs.closeSync(handle);
    fs.rmSync(lockPath, { force: true });
  }
}

function readLocalSequences(repoPath) {
  const filePath = sequencesPath(repoPath);
  try {
    return parseSequences(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      const doc = parseSequences(null);
      mergeSeededHighWater(doc, repoPath);
      return doc;
    }
    throw error;
  }
}

function writeLocalSequences(repoPath, doc) {
  const filePath = sequencesPath(repoPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, serializeSequences(doc), 'utf8');
}

/**
 * @param {string} repoPath
 * @returns {{ reserveIdentitySync, markIdentityMaterializedSync, readIdentityPending }}
 */
function createLocalIdentityAlloc(repoPath) {
  const lockPath = path.join(repoPath, '.aigon', 'state', 'identity-sequences.lock');

  function withIdentityLock(work) {
    return withIdentityLockSync(lockPath, work);
  }

  return {
    reserveIdentitySync(kind) {
      return withIdentityLock(() => {
        const doc = readLocalSequences(repoPath);
        mergeSeededHighWater(doc, repoPath);
        const reserved = reserveNextInDoc(doc, kind);
        writeLocalSequences(repoPath, doc);
        return reserved;
      });
    },

    markIdentityMaterializedSync(kind, number) {
      return withIdentityLock(() => {
        const doc = readLocalSequences(repoPath);
        markMaterializedInDoc(doc, kind, number);
        writeLocalSequences(repoPath, doc);
        return { ok: true };
      });
    },

    readIdentityPending() {
      const doc = readLocalSequences(repoPath);
      return listPendingReservations(doc);
    },
  };
}

module.exports = { createLocalIdentityAlloc };
