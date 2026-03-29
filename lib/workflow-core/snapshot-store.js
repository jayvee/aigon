'use strict';

/**
 * Point-in-time snapshot persistence (JSON format).
 *
 * Ported from aigon-next/src/workflow/snapshot-store.ts.
 */

const fs = require('fs/promises');
const path = require('path');

/**
 * @param {string} snapshotPath
 * @returns {Promise<object|null>}
 */
async function readSnapshot(snapshotPath) {
  try {
    const content = await fs.readFile(snapshotPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * @param {string} snapshotPath
 * @param {object} snapshot
 * @returns {Promise<void>}
 */
async function writeSnapshot(snapshotPath, snapshot) {
  await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
  await fs.writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

module.exports = { readSnapshot, writeSnapshot };
