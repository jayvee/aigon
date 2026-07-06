'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadProjectConfig, saveProjectConfig } = require('../config');
const {
  readRawStorageConfig,
  resolveStorageConfig,
  DEFAULT_STATE_BRANCH,
  GIT_REF_CONVERT_HINT,
} = require('./storage-config');
const { createSpecStore } = require('./index');
const { listNumericProjectionRefs, readProjectionEventsSync } = require('./projection');
const {
  runGit,
  refExists,
  commitTreeWithFiles,
  fetchStateBranch,
  pushStateBranch,
  stateTrackingRef,
  readFileFromCommit,
  listTreeFiles,
} = require('./git-plumbing');
const { getEventId, mergeEventsById, parseEventsPayload } = require('./event-merge');
const {
  deriveAllLeases,
  isLeaseExpired,
  leasesPathForKey,
  serializeLeaseFile,
} = require('./leases');

const LEGACY_REF_PREFIX = 'refs/aigon/specs';
const SCHEMA_VERSION = 1;
const ROLLBACK_HINT = 'To rollback, set storage.backend to "local" in .aigon/config.json (legacy git refs are only deleted when --keep-refs is not set).';

// ---------------------------------------------------------------------------
// Import-only git-ref readers (F613). Retained here so the backend module can
// be deleted while conversion can still read legacy refs for the foreseeable future.
// ---------------------------------------------------------------------------

function legacyRemoteTrackingPrefix(remote, refPrefix) {
  const suffix = refPrefix.replace(/^refs\//, '');
  const safeRemote = /^[A-Za-z0-9._-]+$/.test(remote)
    ? remote
    : `url-${crypto.createHash('sha1').update(remote).digest('hex').slice(0, 12)}`;
  return `refs/remotes/${safeRemote}/${suffix}`;
}

function legacyReadRefPayload(repoPath, refName) {
  if (!refExists(repoPath, refName)) return null;
  const sha = runGit(repoPath, ['rev-parse', refName]);
  const objectType = runGit(repoPath, ['cat-file', '-t', sha]);
  if (objectType === 'blob') {
    return runGit(repoPath, ['cat-file', '-p', sha]);
  }
  if (objectType === 'commit') {
    try {
      return runGit(repoPath, ['cat-file', '-p', `${sha}:events.json`]);
    } catch (_) {
      return runGit(repoPath, ['cat-file', '-p', `${sha}:events.jsonl`]);
    }
  }
  return null;
}

function legacyFetchRemoteRefs(repoPath, remote, refPrefix) {
  const trackingPrefix = legacyRemoteTrackingPrefix(remote, refPrefix);
  try {
    runGit(repoPath, ['fetch', remote, `+${refPrefix}/*:${trackingPrefix}/*`]);
  } catch (error) {
    if (/couldn't find remote ref|no matching remote/i.test(error.message || '')) {
      return;
    }
    throw error;
  }
}

function legacyListRefSpecKeys(repoPath, refPrefix) {
  try {
    const listed = runGit(repoPath, ['for-each-ref', '--format=%(refname)', `${refPrefix}/`]);
    return [...new Set(
      listed
        .split('\n')
        .filter((ref) => ref.endsWith('/events'))
        .map((ref) => ref.slice(`${refPrefix}/`.length, -'/events'.length)),
    )];
  } catch (_) {
    return [];
  }
}

function legacyEventsRefForKey(refPrefix, key) {
  return `${refPrefix}/${key}/events`;
}

function legacyReadGitRefEvents(repoPath, refPrefix, key) {
  const localRef = legacyEventsRefForKey(refPrefix, key);
  const payload = legacyReadRefPayload(repoPath, localRef);
  return parseEventsPayload(payload);
}

function collectGitRefSourceKeys(repoPath, remote, refPrefix) {
  legacyFetchRemoteRefs(repoPath, remote, refPrefix);
  const trackingPrefix = legacyRemoteTrackingPrefix(remote, refPrefix);
  return [...new Set([
    ...legacyListRefSpecKeys(repoPath, refPrefix),
    ...legacyListRefSpecKeys(repoPath, trackingPrefix),
  ])];
}

function readGitRefEventsMerged(repoPath, remote, refPrefix, key) {
  legacyFetchRemoteRefs(repoPath, remote, refPrefix);
  const trackingPrefix = legacyRemoteTrackingPrefix(remote, refPrefix);
  const localEvents = legacyReadGitRefEvents(repoPath, refPrefix, key);
  const remoteRef = `${trackingPrefix}/${key}/events`;
  const remotePayload = refExists(repoPath, remoteRef) ? legacyReadRefPayload(repoPath, remoteRef) : null;
  const remoteEvents = parseEventsPayload(remotePayload);
  return mergeEventsById(localEvents, remoteEvents);
}

// ---------------------------------------------------------------------------
// git-branch tree helpers for pre-config-flip writes during convert
// ---------------------------------------------------------------------------

function serializeEventsJsonl(events) {
  return events.length ? `${events.map((e) => JSON.stringify(e)).join('\n')}\n` : '';
}

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

function branchRefName(branch) {
  return `refs/heads/${branch}`;
}

function commitSha(repoPath, ref) {
  return refExists(repoPath, ref) ? runGit(repoPath, ['rev-parse', ref]) : null;
}

function specKeysFromTip(repoPath, tip) {
  if (!tip) return [];
  return listTreeFiles(repoPath, tip, 'specs')
    .map((file) => {
      const match = /^specs\/([^/]+)\/events\.jsonl$/.exec(file);
      return match ? match[1] : null;
    })
    .filter(Boolean);
}

function readBranchEvents(repoPath, tip, key) {
  return parseEventsJsonl(readFileFromCommit(repoPath, tip, eventsPathForKey(key)));
}

function metaContents(branch, remote) {
  return `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, backend: 'git-branch', branch, remote }, null, 2)}\n`;
}

function commitBranchUpdates(repoPath, branch, remote, updates, extraParents, message) {
  const branchRef = branchRefName(branch);
  const localTip = commitSha(repoPath, branchRef);
  const baseTip = localTip || (extraParents.find(Boolean) || null);
  const nextUpdates = { ...updates };
  if (!readFileFromCommit(repoPath, baseTip, 'meta.json')) {
    nextUpdates['meta.json'] = metaContents(branch, remote);
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

function buildLeaseFilesFromEvents(eventsByKey) {
  const leaseUpdates = {};
  for (const [key, events] of Object.entries(eventsByKey)) {
    const leases = deriveAllLeases(events, key);
    const map = {};
    for (const [role, lease] of Object.entries(leases)) {
      if (!lease || lease.expired || isLeaseExpired(lease)) continue;
      map[role] = {
        holderId: lease.holderId,
        user: lease.user || null,
        agentId: lease.agentId || null,
        acquiredAt: lease.acquiredAt,
        expiresAt: lease.expiresAt,
        renewCount: lease.renewCount || 0,
      };
    }
    if (Object.keys(map).length > 0) {
      leaseUpdates[leasesPathForKey(key)] = serializeLeaseFile(map);
    }
  }
  return leaseUpdates;
}

function isAigonRepo(repoPath) {
  return (
    fs.existsSync(path.join(repoPath, '.aigon')) ||
    fs.existsSync(path.join(repoPath, 'docs', 'specs', 'features'))
  );
}

function isDirectRemote(remote) {
  return (
    remote.includes('://') ||
    remote.startsWith('/') ||
    remote.startsWith('./') ||
    remote.startsWith('../')
  );
}

function remoteExists(repoPath, remote) {
  if (isDirectRemote(remote)) {
    try {
      runGit(repoPath, ['ls-remote', remote]);
      return true;
    } catch (_) {
      return false;
    }
  }
  try {
    runGit(repoPath, ['remote', 'get-url', remote]);
    return true;
  } catch (_) {
    return false;
  }
}

function getRemoteUrl(repoPath, remote) {
  if (isDirectRemote(remote)) return remote;
  return runGit(repoPath, ['remote', 'get-url', remote]);
}

function listImportableProjectionKeys(repoPath) {
  return listNumericProjectionRefs(repoPath)
    .filter((ref) => ref.key && readProjectionEventsSync(repoPath, ref.entityType, ref.entityId).length > 0)
    .map((ref) => ({ key: ref.key, entityType: ref.entityType, entityId: ref.entityId }));
}

function buildPlannedGitBranchConfig(remote, branch, offline = false) {
  return {
    backend: 'git-branch',
    git: { remote, branch, offline },
  };
}

function gitBranchConfigMatches(existing, remote, branch) {
  return (
    existing.backend === 'git-branch' &&
    existing.git.remote === remote &&
    existing.git.branch === branch
  );
}

function validateBranchPushAccess(repoPath, remote, branch) {
  const branchRef = branchRefName(branch);
  if (!refExists(repoPath, branchRef)) {
    commitBranchUpdates(repoPath, branch, remote, {
      'meta.json': metaContents(branch, remote),
    }, [], 'aigon-specstore: convert probe');
  }
  try {
    runGit(repoPath, ['push', '--dry-run', remote, `${branchRef}:${branchRef}`]);
  } finally {
    if (commitSha(repoPath, branchRef)) {
      const tip = commitSha(repoPath, branchRef);
      const files = listTreeFiles(repoPath, tip);
      if (files.length === 1 && files[0] === 'meta.json') {
        try { runGit(repoPath, ['update-ref', '-d', branchRef]); } catch (_) { /* ignore */ }
      }
    }
  }
}

function validateRemoteAccess(repoPath, remote, branch) {
  getRemoteUrl(repoPath, remote);
  const trackingRef = stateTrackingRef(branch, DEFAULT_STATE_BRANCH);
  fetchStateBranch(repoPath, remote, branch, trackingRef);
  validateBranchPushAccess(repoPath, remote, branch);
}

function collectSourcePlan(repoPath, sourceBackend, remote, refPrefix) {
  const specs = new Map();
  if (sourceBackend === 'git-ref') {
    for (const key of collectGitRefSourceKeys(repoPath, remote, refPrefix)) {
      const events = readGitRefEventsMerged(repoPath, remote, refPrefix, key);
      if (events.length > 0) specs.set(key, events);
    }
  }
  for (const entry of listImportableProjectionKeys(repoPath)) {
    const localEvents = readProjectionEventsSync(repoPath, entry.entityType, entry.entityId);
    const existing = specs.get(entry.key) || [];
    specs.set(entry.key, mergeEventsById(existing, localEvents));
  }
  return specs;
}

function verifyImportSuperset(sourceSpecs, repoPath, branch) {
  const branchRef = branchRefName(branch);
  const tip = commitSha(repoPath, branchRef);
  const mismatches = [];
  for (const [key, sourceEvents] of sourceSpecs) {
    const branchEvents = readBranchEvents(repoPath, tip, key);
    const branchIds = new Set(branchEvents.map(getEventId));
    const sourceIds = sourceEvents.map(getEventId);
    const missing = sourceIds.filter((id) => !branchIds.has(id));
    if (missing.length > 0) {
      mismatches.push({ key, missingCount: missing.length, sourceCount: sourceIds.length, branchCount: branchIds.size });
    }
  }
  return mismatches;
}

function importSpecsToBranch(repoPath, remote, branch, sourceSpecs, migrateLeases) {
  const updates = {};
  for (const [key, events] of sourceSpecs) {
    updates[eventsPathForKey(key)] = serializeEventsJsonl(events);
  }
  if (migrateLeases) {
    Object.assign(updates, buildLeaseFilesFromEvents(Object.fromEntries(sourceSpecs)));
  }
  if (Object.keys(updates).length === 0) {
    commitBranchUpdates(repoPath, branch, remote, {}, [], 'aigon-specstore: convert init');
    return;
  }
  commitBranchUpdates(repoPath, branch, remote, updates, [], 'aigon-specstore: convert import');
}

function deleteLegacyRefs(repoPath, remote, refPrefix, keepRefs) {
  const keys = collectGitRefSourceKeys(repoPath, remote, refPrefix);
  const deletedLocal = [];
  if (!keepRefs) {
    for (const key of keys) {
      const ref = legacyEventsRefForKey(refPrefix, key);
      if (refExists(repoPath, ref)) {
        try {
          runGit(repoPath, ['update-ref', '-d', ref]);
          deletedLocal.push(ref);
        } catch (_) { /* tolerate partial cleanup */ }
      }
    }
  }
  let deletedRemote = [];
  if (!keepRefs && remote && keys.length > 0) {
    const remoteRefs = keys.map((key) => legacyEventsRefForKey(refPrefix, key));
    const batchSize = 20;
    for (let i = 0; i < remoteRefs.length; i += batchSize) {
      const batch = remoteRefs.slice(i, i + batchSize);
      try {
        runGit(repoPath, ['push', remote, '--delete', ...batch]);
        deletedRemote = deletedRemote.concat(batch);
      } catch (_) { /* tolerate partially-deleted remotes on re-run */ }
    }
  }
  return { deletedLocal, deletedRemote, cleanupCommand: keepRefs
    ? `git push ${remote} --delete ${keys.map((k) => legacyEventsRefForKey(refPrefix, k)).join(' ')}`
    : null };
}

function flipConfigToGitBranch(repoPath, remote, branch) {
  const project = loadProjectConfig(repoPath) || {};
  project.storage = buildPlannedGitBranchConfig(remote, branch, false);
  saveProjectConfig(project, repoPath);
}

/**
 * Convert a SpecStore repo to git-branch storage (from local or legacy git-ref).
 *
 * @param {string} repoPath
 * @param {{ backend?: string, remote?: string, branch?: string, keepRefs?: boolean, dryRun?: boolean }} [options]
 */
async function runStorageConvert(repoPath, options = {}) {
  const backend = options.backend || 'git-branch';
  const remote = options.remote || 'origin';
  const branch = String(options.branch || DEFAULT_STATE_BRANCH).trim() || DEFAULT_STATE_BRANCH;
  const keepRefs = options.keepRefs === true;
  const dryRun = options.dryRun === true;

  if (!isAigonRepo(repoPath)) {
    return { ok: false, error: 'Not an Aigon repository (.aigon/ or docs/specs/features/ required)' };
  }

  if (backend !== 'git-branch') {
    return { ok: false, error: 'Only --backend=git-branch is supported' };
  }

  const raw = readRawStorageConfig(repoPath);
  const sourceBackend = raw.backend;
  const refPrefix = String(raw.git.refPrefix || LEGACY_REF_PREFIX).replace(/\/+$/, '');

  let current;
  try {
    current = resolveStorageConfig(repoPath);
  } catch (error) {
    if (sourceBackend !== 'git-ref') throw error;
    current = { backend: 'git-ref', git: { remote: raw.git.remote, refPrefix } };
  }

  const sourceSpecs = collectSourcePlan(repoPath, sourceBackend, remote, refPrefix);
  const importKeys = [...sourceSpecs.keys()].map((key) => {
    const numeric = listNumericProjectionRefs(repoPath).find((ref) => ref.key === key);
    return numeric || { key, entityType: null, entityId: null };
  });
  const eventCounts = Object.fromEntries([...sourceSpecs].map(([key, events]) => [key, events.length]));
  const refsToImport = sourceBackend === 'git-ref'
    ? collectGitRefSourceKeys(repoPath, remote, refPrefix).map((key) => legacyEventsRefForKey(refPrefix, key))
    : [];
  const planned = buildPlannedGitBranchConfig(remote, branch);

  if (gitBranchConfigMatches(current, remote, branch)) {
    const store = createSpecStore({ repoPath, storage: current });
    const syncResult = await store.sync();
    if (!syncResult.ok) {
      return { ok: false, error: syncResult.error || 'storage sync failed' };
    }
    return {
      ok: true,
      alreadyConfigured: true,
      importKeys,
      importCount: importKeys.length,
      mergedKeys: syncResult.mergedKeys || 0,
      remote,
      branch,
      rollbackHint: ROLLBACK_HINT,
    };
  }

  if (sourceBackend === 'git-branch' && !gitBranchConfigMatches(current, remote, branch)) {
    return {
      ok: false,
      error: `Already using git-branch storage with remote=${current.git.remote || '(unset)'} branch=${current.git.branch}. Edit .aigon/config.json manually to change.`,
    };
  }

  if (!remoteExists(repoPath, remote)) {
    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        planned,
        sourceBackend,
        importKeys,
        eventCounts,
        refsToImport,
        remote,
        branch,
        remoteWarning: `Git remote "${remote}" not found`,
      };
    }
    return { ok: false, error: `Git remote "${remote}" not found` };
  }

  try {
    validateRemoteAccess(repoPath, remote, branch);
  } catch (error) {
    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        planned,
        sourceBackend,
        importKeys,
        eventCounts,
        refsToImport,
        remote,
        branch,
        remoteUrl: getRemoteUrl(repoPath, remote),
        remoteWarning: error.message,
      };
    }
    return { ok: false, error: error.message };
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      planned,
      sourceBackend,
      importKeys,
      eventCounts,
      refsToImport,
      refsToDelete: keepRefs ? [] : refsToImport,
      remote,
      branch,
      remoteUrl: getRemoteUrl(repoPath, remote),
      keepRefs,
    };
  }

  importSpecsToBranch(repoPath, remote, branch, sourceSpecs, sourceBackend === 'git-ref');
  try {
    pushStateBranch(repoPath, remote, branch);
    const trackingRef = stateTrackingRef(branch, DEFAULT_STATE_BRANCH);
    const tip = commitSha(repoPath, branchRefName(branch));
    if (tip) runGit(repoPath, ['update-ref', trackingRef, tip]);
  } catch (error) {
    return { ok: false, error: `Push failed before config flip: ${error.message}` };
  }

  const mismatches = verifyImportSuperset(sourceSpecs, repoPath, branch);
  if (mismatches.length > 0) {
    const summary = mismatches.map((m) => `${m.key} (missing ${m.missingCount}/${m.sourceCount})`).join(', ');
    return {
      ok: false,
      error: `Import verification failed — branch events are not a superset of source ids: ${summary}. Config was not updated; re-run convert after resolving.`,
      mismatches,
    };
  }

  flipConfigToGitBranch(repoPath, remote, branch);

  let refCleanup = null;
  if (sourceBackend === 'git-ref') {
    refCleanup = deleteLegacyRefs(repoPath, remote, refPrefix, keepRefs);
  }

  const storage = resolveStorageConfig(repoPath);
  const store = createSpecStore({ repoPath, storage });
  const syncResult = await store.sync();
  if (!syncResult.ok) {
    return { ok: false, error: syncResult.error || 'storage sync failed after convert' };
  }

  return {
    ok: true,
    converted: true,
    sourceBackend,
    importCount: importKeys.length,
    eventCounts,
    mergedKeys: syncResult.mergedKeys || 0,
    remote,
    branch,
    refCleanup,
    rollbackHint: ROLLBACK_HINT,
  };
}

module.exports = {
  runStorageConvert,
  ROLLBACK_HINT,
  GIT_REF_CONVERT_HINT,
  listImportableProjectionKeys,
  isAigonRepo,
  LEGACY_REF_PREFIX,
};
