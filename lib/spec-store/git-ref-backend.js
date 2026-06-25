'use strict';

const { createLocalBackend } = require('./local-backend');
const { normalizeEntityRef } = require('./entity-ref');
const {
  getEventId,
  mergeEventsById,
  serializeEventsPayload,
  parseEventsPayload,
} = require('./event-merge');
const {
  readRefPayload,
  writeRefPayload,
  fetchRemoteRefs,
  pushLocalRefs,
  remoteTrackingPrefix,
  listRefSpecKeys,
  countAheadBehind,
  refExists,
  runGit,
} = require('./git-plumbing');
const { rebuildLocalProjection, refKeyFromEntityRef } = require('./projection');
const { readSyncState, writeSyncState } = require('./sync-state');

const MAX_PUSH_RETRIES = 3;

/**
 * @param {string} repoPath
 * @param {{ remote: string, refPrefix: string }} gitConfig
 * @returns {import('./interface').SpecStore}
 */
function createGitRefBackend(repoPath, gitConfig) {
  if (!gitConfig.remote) {
    throw new Error('storage.git.remote is required when storage.backend is git-ref');
  }
  const local = createLocalBackend(repoPath);
  const { remote, refPrefix } = gitConfig;
  const trackingPrefix = remoteTrackingPrefix(remote, refPrefix);

  function eventsRefForKey(key) {
    return `${refPrefix}/${key}/events`;
  }

  function readCanonicalEvents(key) {
    const payload = readRefPayload(repoPath, eventsRefForKey(key));
    return parseEventsPayload(payload);
  }

  async function writeCanonicalEvents(key, events, parentRefs = []) {
    writeRefPayload(repoPath, eventsRefForKey(key), serializeEventsPayload(events), { parents: parentRefs });
    await rebuildLocalProjection(repoPath, key, events);
  }

  async function mergeRefKey(key) {
    const localRef = eventsRefForKey(key);
    const remoteRef = `${trackingPrefix}/${key}/events`;
    const localEvents = readCanonicalEvents(key);
    const remotePayload = refExists(repoPath, remoteRef) ? readRefPayload(repoPath, remoteRef) : null;
    const remoteEvents = parseEventsPayload(remotePayload);
    const merged = mergeEventsById(localEvents, remoteEvents);
    const parents = [];
    if (refExists(repoPath, remoteRef)) parents.push(runGit(repoPath, ['rev-parse', remoteRef]));
    if (refExists(repoPath, localRef)) {
      const localSha = runGit(repoPath, ['rev-parse', localRef]);
      if (!parents.includes(localSha)) parents.push(localSha);
    }
    const changed = merged.length !== localEvents.length
      || merged.some((e, i) => getEventId(e) !== getEventId(localEvents[i]));
    if (changed || parents.length > 1) {
      await writeCanonicalEvents(key, merged, parents);
    } else {
      await rebuildLocalProjection(repoPath, key, merged);
    }
    return merged;
  }

  async function mergeAllRefs() {
    const keys = new Set([
      ...listRefSpecKeys(repoPath, refPrefix),
      ...listRefSpecKeys(repoPath, trackingPrefix),
    ]);
    for (const key of keys) {
      await mergeRefKey(key);
    }
    return keys.size;
  }

  async function pushWithRetry() {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_PUSH_RETRIES; attempt += 1) {
      try {
        fetchRemoteRefs(repoPath, remote, refPrefix);
        await mergeAllRefs();
        pushLocalRefs(repoPath, remote, refPrefix);
        writeSyncState(repoPath, { lastSyncAt: new Date().toISOString(), lastError: null });
        return { ok: true, attempts: attempt };
      } catch (error) {
        lastError = error;
        if (attempt === MAX_PUSH_RETRIES) break;
        fetchRemoteRefs(repoPath, remote, refPrefix);
        await mergeAllRefs();
      }
    }
    const message = `Git-ref push failed after ${MAX_PUSH_RETRIES} attempts: ${lastError && lastError.message ? lastError.message : 'unknown error'}. Run \`aigon storage sync\` after resolving remote conflicts.`;
    writeSyncState(repoPath, { lastError: message });
    throw new Error(message);
  }

  return {
    listSpecs: () => local.listSpecs(),
    readSpec: (key) => local.readSpec(key),
    readEvents: (ref) => local.readEvents(ref),
    readEventsSync: (ref) => local.readEventsSync(ref),
    readSnapshot: (ref) => local.readSnapshot(ref),
    readSnapshotSync: (ref) => local.readSnapshotSync(ref),

    async appendEvent(ref, event) {
      const key = refKeyFromEntityRef(ref);
      return local.lock(ref, async () => {
        const existing = readCanonicalEvents(key);
        const eventId = getEventId(event);
        if (existing.some((entry) => getEventId(entry) === eventId)) {
          return;
        }
        const next = [...existing, event.id ? event : { ...event, id: eventId }];
        await writeCanonicalEvents(key, next);
      });
    },

    async writeSnapshot(ref, snapshot) {
      return local.writeSnapshot(ref, snapshot);
    },

    lock: (ref, work, options) => local.lock(ref, work, options),

    async sync() {
      fetchRemoteRefs(repoPath, remote, refPrefix);
      const merged = await mergeAllRefs();
      try {
        pushLocalRefs(repoPath, remote, refPrefix);
        writeSyncState(repoPath, { lastSyncAt: new Date().toISOString(), lastError: null });
        return { ok: true, backend: 'git-ref', mergedKeys: merged };
      } catch (error) {
        try {
          const retried = await pushWithRetry();
          return { ok: true, backend: 'git-ref', mergedKeys: merged, ...retried };
        } catch (retryError) {
          return { ok: false, backend: 'git-ref', error: retryError.message };
        }
      }
    },

    async health() {
      const syncState = readSyncState(repoPath);
      const keys = new Set([
        ...listRefSpecKeys(repoPath, refPrefix),
        ...listRefSpecKeys(repoPath, trackingPrefix),
      ]);
      let ahead = 0;
      let behind = 0;
      for (const key of keys) {
        const counts = countAheadBehind(
          repoPath,
          eventsRefForKey(key),
          `${trackingPrefix}/${key}/events`,
        );
        ahead += counts.ahead;
        behind += counts.behind;
      }
      const healthState = syncState.lastError ? 'degraded' : (behind > 0 ? 'behind' : (ahead > 0 ? 'ahead' : 'ok'));
      return {
        ok: healthState === 'ok' || healthState === 'ahead',
        backend: 'git-ref',
        remote,
        refPrefix,
        lastSyncAt: syncState.lastSyncAt,
        ahead,
        behind,
        health: healthState,
        lastError: syncState.lastError,
      };
    },

    // Test / command hooks
    _mergeRefKey: mergeRefKey,
    _readCanonicalEvents: readCanonicalEvents,
    _eventsRefForKey: eventsRefForKey,
    _trackingPrefix: trackingPrefix,
  };
}

module.exports = { createGitRefBackend, MAX_PUSH_RETRIES };
