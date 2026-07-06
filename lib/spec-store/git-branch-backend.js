'use strict';

/**
 * git-branch SpecStore backend (F609).
 *
 * Successor to the git-ref backend: same durability model (canonical
 * append-only events, local `.aigon/workflows/**` projection cache), but state
 * lives as a *file tree on an orphan branch* (default `aigon-state`) rather than
 * one custom ref per spec. The branch is browsable in the forge UI, immune to
 * custom-ref namespace rulesets, and shaped so a follow-on feature can add
 * per-spec CAS lease files.
 *
 * Tree layout (never checked out — all I/O via git plumbing):
 *   meta.json                    { schemaVersion, backend, branch, remote }
 *   specs/<KEY>/events.jsonl     canonical event log (workflow + lease + stats)
 *   leases/<KEY>.json            authoritative current lease per key (F610 CAS)
 *
 * Snapshots / locks stay local-projection-only (delegate to the local backend).
 */

const { createLocalBackend } = require('./local-backend');
const {
  getEventId,
  mergeEventsById,
} = require('./event-merge');
const {
  runGit,
  refExists,
  readFileFromCommit,
  treeBlobSha,
  listTreeFiles,
  commitTreeWithFiles,
  isAncestor,
  fetchStateBranch,
  pushStateBranch,
  stateTrackingRef,
} = require('./git-plumbing');
const {
  rebuildLocalProjection,
  tryRefKeyFromEntityRef,
  readProjectionEventsSync,
  listNumericProjectionRefs,
} = require('./projection');
const { readSyncState, writeSyncState } = require('./sync-state');
const { createGitBranchLeaseApi } = require('./git-branch-leases');
const { leasesPathForKey } = require('./leases');
const { rebuildStatsProjectionForKey } = require('./stats-canonical');
const { DEFAULT_STATE_BRANCH } = require('./storage-config');

const MAX_PUSH_RETRIES = 3;
const SCHEMA_VERSION = 1;

/**
 * Serialize events as JSONL (one event per line) so the branch stays browsable
 * as ordinary files in the forge UI.
 * @param {object[]} events
 * @returns {string}
 */
function serializeEventsJsonl(events) {
  return events.length ? `${events.map((e) => JSON.stringify(e)).join('\n')}\n` : '';
}

/**
 * Parse a per-spec `events.jsonl` (one JSON event object per line). Unlike the
 * git-ref wrapped `{ formatVersion, events }` payload, git-branch stores raw
 * JSONL so the branch is browsable in the forge UI.
 * @param {string|null} raw
 * @returns {object[]}
 */
function parseEventsJsonl(raw) {
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function eventsPathForKey(key) {
  return `specs/${key}/events.jsonl`;
}

/**
 * @param {string} repoPath
 * @param {{ remote: string, branch: string, offline: boolean }} gitConfig
 * @returns {import('./interface').SpecStore}
 */
function createGitBranchBackend(repoPath, gitConfig) {
  if (!gitConfig.remote) {
    throw new Error('storage.git.remote is required when storage.backend is git-branch');
  }
  const local = createLocalBackend(repoPath);
  const { remote, offline } = gitConfig;
  const branch = gitConfig.branch || DEFAULT_STATE_BRANCH;
  const branchRef = `refs/heads/${branch}`;
  const trackingRef = stateTrackingRef(branch, DEFAULT_STATE_BRANCH);

  function commitSha(ref) {
    return refExists(repoPath, ref) ? runGit(repoPath, ['rev-parse', ref]) : null;
  }

  /**
   * Record that the remote now matches our branch tip after a successful push,
   * so `health()` reports ahead/behind honestly without a redundant fetch.
   */
  function advanceTrackingRefToTip() {
    const tip = commitSha(branchRef);
    if (tip) runGit(repoPath, ['update-ref', trackingRef, tip]);
  }

  function metaContents() {
    return `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, backend: 'git-branch', branch, remote }, null, 2)}\n`;
  }

  /**
   * Read `meta.json` from a commit, if present.
   * @param {string|null} tip
   * @returns {object|null}
   */
  function readMeta(tip) {
    const raw = readFileFromCommit(repoPath, tip, 'meta.json');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  function assertSchemaCompatible(tip) {
    const meta = readMeta(tip);
    if (meta && Number(meta.schemaVersion) > SCHEMA_VERSION) {
      throw new Error(
        `git-branch state on ${branch} is schemaVersion ${meta.schemaVersion}, but this aigon build understands ${SCHEMA_VERSION}. Upgrade aigon before syncing — refusing to downgrade.`,
      );
    }
  }

  function specKeysFromCommit(tip) {
    if (!tip) return [];
    return listTreeFiles(repoPath, tip, 'specs')
      .map((file) => {
        const match = /^specs\/([^/]+)\/events\.jsonl$/.exec(file);
        return match ? match[1] : null;
      })
      .filter(Boolean);
  }

  function leaseKeysFromCommit(tip) {
    if (!tip) return [];
    return listTreeFiles(repoPath, tip, 'leases')
      .map((file) => {
        const match = /^leases\/([^/]+)\.json$/.exec(file);
        return match ? match[1] : null;
      })
      .filter(Boolean);
  }

  function readEventsFromCommit(tip, key) {
    return parseEventsJsonl(readFileFromCommit(repoPath, tip, eventsPathForKey(key)));
  }

  function readCanonicalEvents(key) {
    return readEventsFromCommit(commitSha(branchRef), key);
  }

  function projectionRefForKey(key) {
    const existing = listNumericProjectionRefs(repoPath).find((ref) => ref.key === key);
    if (existing) {
      return { entityType: existing.entityType, entityId: existing.entityId };
    }
    return key;
  }

  async function rebuildProjectionForKey(key, events) {
    await rebuildLocalProjection(repoPath, projectionRefForKey(key), events);
    rebuildStatsProjectionForKey(repoPath, key, events);
  }

  /**
   * Commit a set of file updates onto the branch tip, creating the orphan branch
   * on first write and ensuring `meta.json` exists. `extraParents` folds in the
   * remote tracking tip when constructing a union-merge commit.
   * @param {Record<string,string>} updates
   * @param {string[]} extraParents
   * @param {string} message
   */
  function commitUpdates(updates, extraParents, message) {
    const localTip = commitSha(branchRef);
    const baseTip = localTip || (extraParents.find(Boolean) || null);
    const nextUpdates = { ...updates };
    if (!readMeta(baseTip)) {
      nextUpdates['meta.json'] = metaContents();
    }
    const parents = [];
    if (localTip) parents.push(localTip);
    for (const parent of extraParents.filter(Boolean)) {
      if (!parents.includes(parent)) parents.push(parent);
    }
    const commit = commitTreeWithFiles(repoPath, {
      baseCommit: baseTip,
      updates: nextUpdates,
      message,
      parents,
    });
    runGit(repoPath, ['update-ref', branchRef, commit]);
    return commit;
  }

  async function writeCanonicalEvents(key, events) {
    commitUpdates(
      { [eventsPathForKey(key)]: serializeEventsJsonl(events) },
      [],
      `aigon-specstore: ${key} events`,
    );
    await rebuildProjectionForKey(key, events);
  }

  /**
   * Union-merge the local branch tip with the fetched tracking tip: dedupe
   * events by id per spec, write a single merge commit incorporating both tips,
   * and rebuild the local projection + stats for every key. No network I/O.
   * @param {{ key?: string }} [options] optional single-spec scope for pre-write sync
   * @returns {Promise<number>} number of keys merged
   */
  async function mergeRemote(options = {}) {
    assertSchemaCompatible(commitSha(trackingRef));
    const localTip = commitSha(branchRef);
    const remoteTip = commitSha(trackingRef);
    const keys = options.key
      ? new Set([options.key])
      : new Set([
        ...specKeysFromCommit(localTip),
        ...specKeysFromCommit(remoteTip),
      ]);
    const mergedByKey = new Map();
    const updates = {};
    for (const key of keys) {
      const localEvents = readEventsFromCommit(localTip, key);
      const remoteEvents = readEventsFromCommit(remoteTip, key);
      const merged = mergeEventsById(localEvents, remoteEvents);
      mergedByKey.set(key, merged);
      const changed = merged.length !== localEvents.length
        || merged.some((e, i) => getEventId(e) !== getEventId(localEvents[i]));
      if (changed) {
        updates[eventsPathForKey(key)] = serializeEventsJsonl(merged);
      }
    }
    // Lease files (`leases/<KEY>.json`) are CAS-authoritative and written only
    // via FF-only push, so the remote tip is always at-or-ahead of local for
    // them. A union-merge (which bases the tree on localTip) would otherwise
    // silently drop or resurrect a lease an events push carried a stale copy of.
    // Carry each remote lease blob forward verbatim whenever it differs.
    if (remoteTip && remoteTip !== localTip) {
      for (const key of leaseKeysFromCommit(remoteTip)) {
        const leasePath = leasesPathForKey(key);
        const remoteBlob = treeBlobSha(repoPath, remoteTip, leasePath);
        const localBlob = treeBlobSha(repoPath, localTip, leasePath);
        if (remoteBlob && remoteBlob !== localBlob) {
          updates[leasePath] = readFileFromCommit(repoPath, remoteTip, leasePath);
        }
      }
    }

    const needMergeCommit = remoteTip && remoteTip !== localTip
      && !isAncestor(repoPath, remoteTip, localTip);
    if (Object.keys(updates).length > 0 || needMergeCommit) {
      commitUpdates(updates, [remoteTip], 'aigon-specstore: merge remote state');
    }
    for (const [key, merged] of mergedByKey) {
      await rebuildProjectionForKey(key, merged);
    }
    return keys.size;
  }

  /**
   * First-enable import: fold existing local `.aigon/workflows/**` events into
   * the branch before merging remote state (parity with git-ref first-sync).
   */
  async function importLocalProjections() {
    let imported = 0;
    for (const ref of listNumericProjectionRefs(repoPath)) {
      const localEvents = readProjectionEventsSync(repoPath, ref.entityType, ref.entityId);
      if (localEvents.length === 0) continue;
      const canonicalEvents = readCanonicalEvents(ref.key);
      const merged = mergeEventsById(canonicalEvents, localEvents);
      const changed = merged.length !== canonicalEvents.length
        || merged.some((event, index) => getEventId(event) !== getEventId(canonicalEvents[index]));
      if (!changed) continue;
      await writeCanonicalEvents(ref.key, merged);
      imported += 1;
    }
    return imported;
  }

  async function pushWithRetry(mergedKeys) {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_PUSH_RETRIES; attempt += 1) {
      try {
        fetchStateBranch(repoPath, remote, branch, trackingRef);
        await mergeRemote();
        pushStateBranch(repoPath, remote, branch);
        advanceTrackingRefToTip();
        writeSyncState(repoPath, { lastSyncAt: new Date().toISOString(), lastError: null });
        return { ok: true, attempts: attempt, mergedKeys };
      } catch (error) {
        lastError = error;
        if (attempt === MAX_PUSH_RETRIES) break;
        fetchStateBranch(repoPath, remote, branch, trackingRef);
        await mergeRemote();
      }
    }
    const message = `git-branch push failed after ${MAX_PUSH_RETRIES} attempts: ${lastError && lastError.message ? lastError.message : 'unknown error'}. Run \`aigon storage sync\` after resolving remote conflicts.`;
    writeSyncState(repoPath, { lastError: message });
    throw new Error(message);
  }

  async function runSyncBeforeWrite(ref) {
    if (offline) return { ok: true, skipped: true, reason: 'offline' };
    fetchStateBranch(repoPath, remote, branch, trackingRef);
    const key = ref && tryRefKeyFromEntityRef(ref);
    await mergeRemote(key ? { key } : {});
    return { ok: true, backend: 'git-branch' };
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
      await writeCanonicalEvents(key, next);
    },

    async writeSnapshot(ref, snapshot) {
      return local.writeSnapshot(ref, snapshot);
    },

    lock: (ref, work, options) => local.lock(ref, work, options),

    async sync() {
      if (offline) return { ok: true, backend: 'git-branch', skipped: true, reason: 'offline' };
      await importLocalProjections();
      fetchStateBranch(repoPath, remote, branch, trackingRef);
      const merged = await mergeRemote();
      try {
        pushStateBranch(repoPath, remote, branch);
        advanceTrackingRefToTip();
        writeSyncState(repoPath, { lastSyncAt: new Date().toISOString(), lastError: null });
        return { ok: true, backend: 'git-branch', mergedKeys: merged };
      } catch (error) {
        try {
          const retried = await pushWithRetry(merged);
          return { ok: true, backend: 'git-branch', ...retried };
        } catch (retryError) {
          return { ok: false, backend: 'git-branch', error: retryError.message };
        }
      }
    },

    async syncBeforeWrite(ref) {
      return runSyncBeforeWrite(ref);
    },

    async health() {
      const syncState = readSyncState(repoPath);
      const localTip = commitSha(branchRef);
      const remoteTip = commitSha(trackingRef);
      let remoteReachable = null;
      try {
        runGit(repoPath, ['ls-remote', '--exit-code', remote, `refs/heads/${branch}`]);
        remoteReachable = true;
      } catch (error) {
        // exit code 2 == remote reachable but branch absent (not yet pushed)
        remoteReachable = error.exitCode === 2 ? true : false;
      }
      let ahead = 0;
      let behind = 0;
      if (localTip && remoteTip && localTip !== remoteTip) {
        const out = runGit(repoPath, ['rev-list', '--left-right', '--count', `${remoteTip}...${localTip}`]);
        const [b, a] = out.split(/\s+/).map((n) => parseInt(n, 10) || 0);
        behind = b;
        ahead = a;
      } else if (localTip && !remoteTip) {
        ahead = 1;
      } else if (!localTip && remoteTip) {
        behind = 1;
      }
      const healthState = syncState.lastError
        ? 'degraded'
        : (behind > 0 ? 'behind' : (ahead > 0 ? 'ahead' : 'ok'));
      return {
        ok: healthState === 'ok' || healthState === 'ahead',
        backend: 'git-branch',
        remote,
        branch,
        remoteReachable,
        lastSyncAt: syncState.lastSyncAt,
        ahead,
        behind,
        health: healthState,
        lastError: syncState.lastError,
      };
    },

    // Test / command hooks
    _mergeRemote: mergeRemote,
    _readCanonicalEvents: readCanonicalEvents,
    _eventsPathForKey: eventsPathForKey,
    _branchRef: branchRef,
    _trackingRef: trackingRef,
    _readMeta: () => readMeta(commitSha(branchRef)),
  };

  // Leases on git-branch are authoritative mutual exclusion via per-key CAS
  // files, not advisory events — the backend supplies its own lease strategy
  // behind the same five-method surface (F610).
  const leaseApi = createGitBranchLeaseApi({
    repoPath,
    remote,
    offline,
    branchRef,
    trackingRef,
    commitSha,
    readFileFromCommit: (tip, filePath) => readFileFromCommit(repoPath, tip, filePath),
    treeBlobSha: (tip, filePath) => treeBlobSha(repoPath, tip, filePath),
    readEventsFromCommit,
    serializeEventsJsonl,
    commitUpdates,
    mergeRemote,
    fetchStateBranch: () => fetchStateBranch(repoPath, remote, branch, trackingRef),
    pushStateBranch: () => pushStateBranch(repoPath, remote, branch),
    resetBranchTo: (sha) => runGit(repoPath, ['update-ref', branchRef, sha]),
    rebuildProjectionForKey,
    advanceTrackingRefToTip,
    writeSyncState: (state) => writeSyncState(repoPath, state),
    eventsPathForKey,
    readCanonicalEvents,
  });

  return Object.assign(coreStore, leaseApi);
}

module.exports = { createGitBranchBackend, MAX_PUSH_RETRIES, SCHEMA_VERSION };
