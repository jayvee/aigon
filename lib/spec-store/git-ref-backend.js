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
const {
  rebuildLocalProjection,
  tryRefKeyFromEntityRef,
  readProjectionEventsSync,
  listNumericProjectionRefs,
} = require('./projection');
const { readSyncState, writeSyncState } = require('./sync-state');
const { createLeaseApi } = require('./lease-api');
const { rebuildStatsProjectionForKey } = require('./stats-canonical');

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
  const { remote, refPrefix, offline } = gitConfig;
  const trackingPrefix = remoteTrackingPrefix(remote, refPrefix);

  function eventsRefForKey(key) {
    return `${refPrefix}/${key}/events`;
  }

  function readCanonicalEvents(key) {
    const payload = readRefPayload(repoPath, eventsRefForKey(key));
    return parseEventsPayload(payload);
  }

  async function writeCanonicalEvents(key, events, parentRefs = [], projectionRef = key) {
    writeRefPayload(repoPath, eventsRefForKey(key), serializeEventsPayload(events), { parents: parentRefs });
    await rebuildLocalProjection(repoPath, projectionRef, events);
    rebuildStatsProjectionForKey(repoPath, key, events);
  }

  function projectionRefForKey(key) {
    const existing = listNumericProjectionRefs(repoPath).find((ref) => ref.key === key);
    if (existing) {
      return { entityType: existing.entityType, entityId: existing.entityId };
    }
    return key;
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
      await writeCanonicalEvents(key, merged, parents, projectionRefForKey(key));
    } else {
      await rebuildLocalProjection(repoPath, projectionRefForKey(key), merged);
      rebuildStatsProjectionForKey(repoPath, key, merged);
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

  async function importLocalProjectionRefs() {
    let imported = 0;
    for (const ref of listNumericProjectionRefs(repoPath)) {
      const localEvents = readProjectionEventsSync(repoPath, ref.entityType, ref.entityId);
      if (localEvents.length === 0) continue;
      const canonicalEvents = readCanonicalEvents(ref.key);
      const merged = mergeEventsById(canonicalEvents, localEvents);
      const changed = merged.length !== canonicalEvents.length
        || merged.some((event, index) => getEventId(event) !== getEventId(canonicalEvents[index]));
      if (!changed) continue;
      await writeCanonicalEvents(ref.key, merged, [], ref);
      imported += 1;
    }
    return imported;
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

  async function runSyncBeforeWrite(ref) {
    if (offline) return { ok: true, skipped: true, reason: 'offline' };
    fetchRemoteRefs(repoPath, remote, refPrefix);
    const key = ref && tryRefKeyFromEntityRef(ref);
    if (key) {
      await mergeRefKey(key);
    } else {
      await mergeAllRefs();
    }
    return { ok: true, backend: 'git-ref' };
  }

  const coreStore = {
    listSpecs: () => local.listSpecs(),
    readSpec: (key) => local.readSpec(key),
    readEvents: (ref) => local.readEvents(ref),
    readEventsSync: (ref) => local.readEventsSync(ref),
    readSnapshot: (ref) => local.readSnapshot(ref),
    readSnapshotSync: (ref) => local.readSnapshotSync(ref),

    async appendEvent(ref, event) {
      const key = tryRefKeyFromEntityRef(ref);
      if (!key) {
        return local.appendEvent(ref, event);
      }
      await runSyncBeforeWrite(ref);
      const existing = readCanonicalEvents(key);
      const eventId = getEventId(event);
      if (existing.some((entry) => getEventId(entry) === eventId)) {
        return;
      }
      const next = [...existing, event.id ? event : { ...event, id: eventId }];
      await writeCanonicalEvents(key, next, [], ref);
    },

    async writeSnapshot(ref, snapshot) {
      return local.writeSnapshot(ref, snapshot);
    },

    lock: (ref, work, options) => local.lock(ref, work, options),

    async sync() {
      if (offline) return { ok: true, backend: 'git-ref', skipped: true, reason: 'offline' };
      await importLocalProjectionRefs();
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

    async syncBeforeWrite(ref) {
      return runSyncBeforeWrite(ref);
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

  return Object.assign(coreStore, createLeaseApi(coreStore));
}

module.exports = { createGitRefBackend, MAX_PUSH_RETRIES };
