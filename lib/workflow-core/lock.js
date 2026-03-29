'use strict';

/**
 * File-based exclusive locking.
 *
 * Ported from aigon-next/src/workflow/lock.ts.
 * Uses exclusive file creation (wx flag) — not advisory locking.
 */

const fs = require('fs/promises');
const path = require('path');

/**
 * Acquire an exclusive lock, run `work`, then release.
 * Throws if the lock file already exists (another process holds it).
 *
 * @template T
 * @param {string} lockPath
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
async function withFeatureLock(lockPath, work) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const handle = await fs.open(lockPath, 'wx');
  try {
    return await work();
  } finally {
    await handle.close();
    await fs.rm(lockPath, { force: true });
  }
}

/**
 * Non-blocking lock attempt. Returns `{ kind: 'busy' }` if the lock is held,
 * or `{ kind: 'ok', value }` on success.
 *
 * @template T
 * @param {string} lockPath
 * @param {() => Promise<T>} work
 * @returns {Promise<{ kind: 'busy' } | { kind: 'ok', value: T }>}
 */
async function tryWithFeatureLock(lockPath, work) {
  try {
    const value = await withFeatureLock(lockPath, work);
    return { kind: 'ok', value };
  } catch (error) {
    if (error.code === 'EEXIST') {
      return { kind: 'busy' };
    }
    throw error;
  }
}

module.exports = { withFeatureLock, tryWithFeatureLock };
