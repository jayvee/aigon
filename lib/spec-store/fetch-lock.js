'use strict';

/** Serialize remote fetch/merge so the dashboard poller and CLI sync do not interleave. */
let _chain = Promise.resolve();

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withStorageFetchLock(fn) {
  const run = _chain.then(() => fn());
  _chain = run.then(() => {}, () => {});
  return run;
}

function resetStorageFetchLockForTests() {
  _chain = Promise.resolve();
}

module.exports = {
  withStorageFetchLock,
  resetStorageFetchLockForTests,
};
