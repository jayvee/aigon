'use strict';

const { loadProjectConfig } = require('./config');
const { createSpecStore, resolveStorageConfig } = require('./spec-store');
const { readSyncState } = require('./spec-store/sync-state');
const {
  runGit,
  refExists,
  readFileFromCommit,
  stateTrackingRef,
} = require('./spec-store/git-plumbing');
const {
  deriveAllLeases,
  refToLeaseKey,
  resolveHolderId,
  parseLeaseFile,
  isLeaseRecordExpired,
  leasesPathForKey,
} = require('./spec-store/leases');
const { DEFAULT_STATE_BRANCH, GIT_REF_CONVERT_HINT } = require('./spec-store/storage-config');
const { DEFAULT_POLL_SEC, MIN_POLL_SEC, MAX_POLL_SEC } = require('./storage-poller');

function resolvePollIntervalSec(repoPath) {
  const project = loadProjectConfig(repoPath) || {};
  const git = (project.storage && project.storage.git) || {};
  const raw = Number(git.pollIntervalSec);
  const sec = Number.isFinite(raw) ? raw : DEFAULT_POLL_SEC;
  return Math.max(MIN_POLL_SEC, Math.min(MAX_POLL_SEC, sec));
}

function computeAheadBehind(repoPath, localTip, remoteTip) {
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
  return { ahead, behind };
}

function computeLeaseDataStale(syncState, pollIntervalSec) {
  if (syncState.lastFetchError) return true;
  const refreshedAt = syncState.lastFetchAt || syncState.lastSyncAt;
  if (!refreshedAt) return true;
  const ageMs = Date.now() - Date.parse(refreshedAt);
  return !Number.isFinite(ageMs) || ageMs > pollIntervalSec * 2 * 1000;
}

/**
 * Server-owned storage status DTO for dashboard repo/settings payloads.
 *
 * @param {string} repoPath
 * @returns {object}
 */
function buildRepoStorageStatus(repoPath) {
  let storage;
  try {
    storage = resolveStorageConfig(repoPath);
  } catch (error) {
    if (error.code === 'git_ref_removed') {
      return {
        backend: 'git-ref-removed',
        health: 'degraded',
        lastError: error.message,
        convertHint: GIT_REF_CONVERT_HINT,
      };
    }
    throw error;
  }

  if (storage.backend === 'local') {
    return { backend: 'local', health: 'ok' };
  }

  const syncState = readSyncState(repoPath);
  const { remote, offline } = storage.git;
  const pollIntervalSec = resolvePollIntervalSec(repoPath);
  const branch = storage.git.branch || DEFAULT_STATE_BRANCH;
  const branchRef = `refs/heads/${branch}`;
  const trackingRef = stateTrackingRef(branch, DEFAULT_STATE_BRANCH);
  const localTip = refExists(repoPath, branchRef) ? runGit(repoPath, ['rev-parse', branchRef]) : null;
  const remoteTip = refExists(repoPath, trackingRef) ? runGit(repoPath, ['rev-parse', trackingRef]) : null;
  const { ahead, behind } = computeAheadBehind(repoPath, localTip, remoteTip);

  const health = syncState.lastError || syncState.lastFetchError
    ? 'degraded'
    : (behind > 0 ? 'behind' : (ahead > 0 ? 'ahead' : 'ok'));
  const lastLeaseRefreshAt = syncState.lastFetchAt || syncState.lastSyncAt || null;
  const leaseDataStale = computeLeaseDataStale(syncState, pollIntervalSec);

  return {
    backend: storage.backend,
    remote,
    branch,
    offline: Boolean(offline),
    lastSyncAt: syncState.lastSyncAt || null,
    lastLeaseRefreshAt,
    leaseDataStale,
    staleSince: leaseDataStale ? lastLeaseRefreshAt : null,
    pollIntervalSec,
    ahead,
    behind,
    health,
    lastError: syncState.lastError || syncState.lastFetchError || null,
    localHolderId: resolveHolderId(),
  };
}

/**
 * @param {object} lease
 * @returns {object}
 */
function formatLeaseEntry(lease) {
  return {
    specKey: lease.key,
    role: lease.role,
    holderId: lease.holderId,
    user: lease.user || null,
    agentId: lease.agentId || null,
    acquiredAt: lease.acquiredAt,
    expiresAt: lease.expiresAt,
    expired: Boolean(lease.expired),
  };
}

function readGitBranchLeasesSync(repoPath, key) {
  const storage = resolveStorageConfig(repoPath);
  const branch = storage.git.branch || DEFAULT_STATE_BRANCH;
  const branchRef = `refs/heads/${branch}`;
  const trackingRef = stateTrackingRef(branch, DEFAULT_STATE_BRANCH);
  const tip = refExists(repoPath, trackingRef)
    ? runGit(repoPath, ['rev-parse', trackingRef])
    : (refExists(repoPath, branchRef) ? runGit(repoPath, ['rev-parse', branchRef]) : null);
  const map = parseLeaseFile(readFileFromCommit(repoPath, tip, leasesPathForKey(key)));
  return Object.entries(map)
    .map(([role, record]) => ({
      key,
      role,
      holderId: record.holderId,
      user: record.user || null,
      agentId: record.agentId || null,
      acquiredAt: record.acquiredAt,
      expiresAt: record.expiresAt,
      expired: isLeaseRecordExpired(record),
    }))
    .filter((lease) => !lease.expired);
}

/**
 * Active (non-expired) leases for a feature/research row.
 *
 * @param {string} repoPath
 * @param {'feature'|'research'} entityType
 * @param {string|number} entityId
 * @returns {object[]}
 */
function buildEntityActiveLeases(repoPath, entityType, entityId) {
  if (!entityId || !/^\d+$/.test(String(entityId))) return [];
  try {
    const storage = resolveStorageConfig(repoPath);
    const ref = { entityType, entityId: String(entityId) };
    const key = refToLeaseKey(ref);
    if (storage.backend === 'git-branch') {
      return readGitBranchLeasesSync(repoPath, key).map(formatLeaseEntry);
    }
    const store = createSpecStore({ repoPath, storage });
    const events = store.readEventsSync(ref);
    const all = deriveAllLeases(events, key);
    return Object.values(all)
      .filter(Boolean)
      .map(formatLeaseEntry)
      .filter((lease) => !lease.expired);
  } catch (_) {
    return [];
  }
}

/**
 * @param {object} storageStatus
 * @returns {object[]}
 */
function buildRepoStorageActions(storageStatus) {
  const actions = [
    { action: 'storage', args: ['doctor'], label: 'Storage doctor', type: 'infra' },
    { action: 'storage', args: ['report'], label: 'Storage report', type: 'infra' },
  ];
  if (storageStatus && storageStatus.backend === 'git-branch') {
    actions.unshift({ action: 'storage', args: ['sync'], label: 'Sync storage', type: 'infra' });
  }
  return actions;
}

const FOREIGN_LEASE_BLOCKED_ACTIONS = Object.freeze({
  feature: new Set([
    'feature-close',
    'feature-resolve-and-close',
    'feature-reset',
    // Session affordances — tmux runs on the lease holder's machine only.
    'open-session',
    'feature-attach',
    'feature-open',
    'feature-focus',
    'feature-stop',
    'feature-nudge',
    'mark-submitted',
    'reopen-agent',
    'view-work',
    'open-eval-session',
    'feature-autonomous-start',
  ]),
  research: new Set([
    'research-close',
    'research-reset',
    'open-session',
    'research-attach',
    'research-open',
    'research-focus',
    'research-stop',
    'research-nudge',
    'mark-submitted',
    'reopen-agent',
    'view-work',
    'open-eval-session',
    'research-autonomous-start',
  ]),
});

function formatDashboardLeaseHolder(lease) {
  const user = lease && lease.user ? `${lease.user} @ ` : '';
  const holder = lease && lease.holderId ? lease.holderId : 'unknown';
  const agent = lease && lease.agentId ? ` (${String(lease.agentId).toUpperCase()})` : '';
  return `${user}${holder}${agent}`;
}

function firstForeignLease(leases, localHolderId) {
  const local = String(localHolderId || resolveHolderId());
  return (Array.isArray(leases) ? leases : []).find((lease) => (
    lease
      && !lease.expired
      && lease.holderId
      && String(lease.holderId) !== local
  )) || null;
}

function applyForeignLeaseActionBlocks(item, entityType, leases, localHolderId) {
  if (!item || !Array.isArray(item.validActions)) return;
  const foreign = firstForeignLease(leases, localHolderId);
  if (!foreign) return;
  const blockedActions = FOREIGN_LEASE_BLOCKED_ACTIONS[entityType];
  if (!blockedActions) return;
  const reason = `Blocked by active ${foreign.role || 'work'} lease held by ${formatDashboardLeaseHolder(foreign)}`;
  item.validActions = item.validActions.map((action) => {
    if (!action || !blockedActions.has(action.action)) return action;
    return {
      ...action,
      disabled: true,
      disabledReason: reason,
      metadata: {
        ...(action.metadata || {}),
        blockedByForeignLease: true,
        lease: foreign,
      },
    };
  });
}

function stripRunningSessionFields(session) {
  if (!session || typeof session !== 'object') return session;
  return {
    ...session,
    running: false,
    sessionRunning: false,
  };
}

/**
 * Remove local tmux/session affordances when another machine holds the work lease.
 * Synced sidecars and engine state can make a remote run look local; this keeps
 * peek, attach, and session actions honest on git-branch clones.
 *
 * @param {object} item
 * @param {object[]} leases
 * @param {string} [localHolderId]
 */
function sanitizeForeignLeaseSessionAffordances(item, leases, localHolderId) {
  if (!item) return;
  const foreign = firstForeignLease(leases, localHolderId);
  if (!foreign) return;

  item.heldByForeignLease = true;

  if (Array.isArray(item.agents)) {
    item.agents = item.agents.map((agent) => ({
      ...agent,
      tmuxSession: null,
      tmuxRunning: false,
      attachCommand: null,
      isWorking: false,
      idleLadder: null,
    }));
  }

  if (item.autonomousSession) {
    item.autonomousSession = stripRunningSessionFields(item.autonomousSession);
  }
  if (item.autonomousController) {
    item.autonomousController = stripRunningSessionFields(item.autonomousController);
  }
  if (item.evalSession) {
    item.evalSession = stripRunningSessionFields(item.evalSession);
  }

  for (const key of [
    'reviewSessions',
    'specReviewSessions',
    'specRevisionSessions',
    'specCheckSessions',
  ]) {
    if (Array.isArray(item[key])) {
      item[key] = item[key].map(stripRunningSessionFields);
    }
  }
}

/**
 * @param {string} repoPath
 * @param {object[]} entities
 * @param {'feature'|'research'} entityType
 */
function attachActiveLeasesToEntities(repoPath, entities, entityType) {
  if (!Array.isArray(entities)) return;
  let storage;
  let localHolderId = resolveHolderId();
  try {
    storage = resolveStorageConfig(repoPath);
  } catch (_) {
    return;
  }
  const stale = storage.backend !== 'local'
    ? computeLeaseDataStale(readSyncState(repoPath), resolvePollIntervalSec(repoPath))
    : false;
  entities.forEach((item) => {
    if (!item || item.stage === 'done' || !/^\d+$/.test(String(item.id || ''))) return;
    const leases = buildEntityActiveLeases(repoPath, entityType, item.id);
    if (leases.length > 0) {
      item.activeLeases = leases;
      if (stale) item.leaseDataStale = true;
      sanitizeForeignLeaseSessionAffordances(item, leases, localHolderId);
      applyForeignLeaseActionBlocks(item, entityType, leases, localHolderId);
    }
  });
}

module.exports = {
  buildRepoStorageStatus,
  buildEntityActiveLeases,
  buildRepoStorageActions,
  formatLeaseEntry,
  attachActiveLeasesToEntities,
  applyForeignLeaseActionBlocks,
  sanitizeForeignLeaseSessionAffordances,
  firstForeignLease,
  readGitBranchLeasesSync,
  computeLeaseDataStale,
};
