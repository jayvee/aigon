'use strict';

/**
 * Background git-branch state fetcher (F611).
 *
 * Polls the configured remote state branch on an interval, fetch+merge only
 * (no push), and records freshness in `.aigon/state/storage-sync.json`.
 * Dashboard lease DTOs read the updated local branch tip / projections.
 */

const { resolveStorageConfig } = require('./spec-store/storage-config');
const { createSpecStore } = require('./spec-store');
const { loadProjectConfig } = require('./config');
const { writeSyncState } = require('./spec-store/sync-state');

const DEFAULT_POLL_SEC = 45;
const MIN_POLL_SEC = 15;
const MAX_POLL_SEC = 120;

function getPollIntervalMs(repoPath = process.cwd()) {
  const project = loadProjectConfig(repoPath) || {};
  const git = (project.storage && project.storage.git) || {};
  const raw = Number(git.pollIntervalSec);
  const sec = Number.isFinite(raw) ? raw : DEFAULT_POLL_SEC;
  return Math.max(MIN_POLL_SEC, Math.min(MAX_POLL_SEC, sec)) * 1000;
}

/**
 * @param {{ repoPath?: string, log?: Function }} [options]
 */
async function pollOnce({ repoPath = process.cwd(), log } = {}) {
  const storage = resolveStorageConfig(repoPath);
  if (storage.backend !== 'git-branch' || storage.git.offline) {
    return { skipped: true };
  }
  const logger = log || (() => {});
  const store = createSpecStore({ repoPath, storage });
  if (typeof store.fetchRemoteProjection !== 'function') {
    return { skipped: true };
  }
  try {
    const result = await store.fetchRemoteProjection();
    writeSyncState(repoPath, {
      lastFetchAt: new Date().toISOString(),
      lastFetchError: null,
    });
    return result;
  } catch (error) {
    const message = error && error.message ? error.message : 'storage fetch failed';
    writeSyncState(repoPath, { lastFetchError: message });
    logger(`[storage-poller] ${message}`);
    return { ok: false, error: message };
  }
}

let _timer = null;
let _inflight = null;

function startStoragePoller({ repoPath = process.cwd(), intervalMs, log } = {}) {
  const interval = intervalMs || getPollIntervalMs(repoPath);
  const logger = log || (() => {});

  async function tick() {
    if (_inflight) return _inflight;
    _inflight = pollOnce({ repoPath, log: logger })
      .catch((e) => { logger(`[storage-poller] tick error: ${e && e.message}`); return null; })
      .finally(() => { _inflight = null; });
    return _inflight;
  }

  tick();
  _timer = setInterval(tick, interval);
  if (typeof _timer.unref === 'function') _timer.unref();

  return {
    stop() {
      if (_timer) { clearInterval(_timer); _timer = null; }
    },
    refresh: tick,
  };
}

function triggerRefresh({ repoPath = process.cwd(), log } = {}) {
  if (_inflight) return _inflight;
  _inflight = pollOnce({ repoPath, log: log || (() => {}) })
    .catch(() => null)
    .finally(() => { _inflight = null; });
  return _inflight;
}

module.exports = {
  startStoragePoller,
  triggerRefresh,
  pollOnce,
  getPollIntervalMs,
  DEFAULT_POLL_SEC,
  MIN_POLL_SEC,
  MAX_POLL_SEC,
};
