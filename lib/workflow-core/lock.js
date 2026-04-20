'use strict';

/**
 * File-based exclusive locking.
 *
 * Ported from aigon-next/src/workflow/lock.ts.
 * Uses exclusive file creation (wx flag) — not advisory locking.
 */

const fs = require('fs/promises');
const path = require('path');

const DEFAULT_RETRY_OPTIONS = Object.freeze({
  retries: 6,
  baseDelayMs: 100,
  maxDelayMs: 2000,
  jitterRatio: 0.2,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeRetryDelay(attempt, options) {
  const capped = Math.min(options.baseDelayMs * (2 ** attempt), options.maxDelayMs);
  const jitter = capped * options.jitterRatio * Math.random();
  return Math.round(capped + jitter);
}

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
 * Acquire an exclusive lock with bounded retries on lock contention.
 * Non-lock errors still fail immediately.
 *
 * @template T
 * @param {string} lockPath
 * @param {() => Promise<T>} work
 * @param {{ retries?: number, baseDelayMs?: number, maxDelayMs?: number, jitterRatio?: number }} [options]
 * @returns {Promise<T>}
 */
async function withFeatureLockRetry(lockPath, work, options = {}) {
  const retryOptions = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let attempt = 0;

  for (;;) {
    try {
      return await withFeatureLock(lockPath, work);
    } catch (error) {
      if (error.code !== 'EEXIST' || attempt >= retryOptions.retries) {
        throw error;
      }
      await sleep(computeRetryDelay(attempt, retryOptions));
      attempt += 1;
    }
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

module.exports = { withFeatureLock, withFeatureLockRetry, tryWithFeatureLock };
