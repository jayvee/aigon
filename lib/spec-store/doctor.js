'use strict';

const { getDefaultBranch } = require('../git');
const { createSpecStore, resolveStorageConfig } = require('./index');
const { readRawStorageConfig, GIT_REF_CONVERT_HINT } = require('./storage-config');
const {
  refExists,
  fetchStateBranch,
  stateTrackingRef,
  runGit,
  readFileFromCommit,
  listTreeFiles,
  isAncestor,
} = require('./git-plumbing');
const { getEventId } = require('./event-merge');
const { readProjectionEventsSync } = require('./projection');
const {
  deriveAllLeases,
  isLeaseEvent,
  parseLeaseFile,
  isLeaseRecordExpired,
  leasesPathForKey,
} = require('./leases');
const {
  isStatsEvent,
  detectStatsProjectionDrift,
  rebuildStatsProjectionFromEvents,
  invalidateStatsAggregateCache,
} = require('./stats-canonical');
const { DEFAULT_STATE_BRANCH } = require('./storage-config');

function parseEventsJsonl(raw) {
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function specKeysFromBranchTip(repoPath, tip) {
  if (!tip) return [];
  return listTreeFiles(repoPath, tip, 'specs')
    .map((file) => {
      const match = /^specs\/([^/]+)\/events\.jsonl$/.exec(file);
      return match ? match[1] : null;
    })
    .filter(Boolean);
}

function leaseKeysFromBranchTip(repoPath, tip) {
  if (!tip) return [];
  return listTreeFiles(repoPath, tip, 'leases')
    .map((file) => {
      const match = /^leases\/([^/]+)\.json$/.exec(file);
      return match ? match[1] : null;
    })
    .filter(Boolean);
}

function readGitBranchEvents(repoPath, tip, key) {
  return parseEventsJsonl(readFileFromCommit(repoPath, tip, `specs/${key}/events.jsonl`));
}

async function auditGitBranchKeys(repoPath, store, options, issues, fixes) {
  const storage = resolveStorageConfig(repoPath);
  const { remote, branch } = storage.git;
  const branchRef = `refs/heads/${branch || DEFAULT_STATE_BRANCH}`;
  const trackingRef = stateTrackingRef(branch || DEFAULT_STATE_BRANCH, DEFAULT_STATE_BRANCH);
  const localTip = refExists(repoPath, branchRef) ? runGit(repoPath, ['rev-parse', branchRef]) : null;
  const remoteTip = refExists(repoPath, trackingRef) ? runGit(repoPath, ['rev-parse', trackingRef]) : null;
  const tip = localTip || remoteTip;
  const keys = new Set([
    ...specKeysFromBranchTip(repoPath, localTip),
    ...specKeysFromBranchTip(repoPath, remoteTip),
    ...leaseKeysFromBranchTip(repoPath, localTip),
    ...leaseKeysFromBranchTip(repoPath, remoteTip),
  ]);
  const clearedKeys = new Set();

  for (const key of keys) {
    let events = [];
    try {
      events = store._readCanonicalEvents ? store._readCanonicalEvents(key) : readGitBranchEvents(repoPath, tip, key);
    } catch (error) {
      issues.push({ severity: 'error', code: 'events_read_failed', key, message: error.message });
      continue;
    }

    const ids = new Map();
    for (const event of events) {
      const id = getEventId(event);
      if (ids.has(id)) {
        issues.push({
          severity: 'error',
          code: 'duplicate_event_id',
          key,
          eventId: id,
          message: `Duplicate event id ${id} in canonical log for ${key}`,
        });
      }
      ids.set(id, (ids.get(id) || 0) + 1);
    }

    const match = key.match(/^([FR])(\d+)$/);
    if (match) {
      const entityType = match[1] === 'R' ? 'research' : 'feature';
      const entityId = match[2];
      const projectionEvents = readProjectionEventsSync(repoPath, entityType, entityId);
      const workflowCanonical = events.filter((e) => !isLeaseEvent(e) && !isStatsEvent(e));
      if (projectionEvents.length > 0 && workflowCanonical.length === 0) {
        issues.push({
          severity: 'warn',
          code: 'stale_projection',
          key,
          message: `Local projection has events but canonical log for ${key} has none`,
        });
      }

      const statsDrift = detectStatsProjectionDrift(repoPath, entityType, entityId, events);
      if (statsDrift) {
        issues.push({
          severity: 'warn',
          code: statsDrift.code,
          key,
          message: statsDrift.code === 'missing_local_stats_projection'
            ? `Canonical stats exist for ${key} but local stats.json is missing`
            : `Local stats.json for ${key} disagrees with canonical stats.recorded event`,
        });
        if (options.fix) {
          rebuildStatsProjectionFromEvents(repoPath, entityType, entityId, events);
          invalidateStatsAggregateCache(repoPath);
          fixes.push(`rebuilt stats projection for ${key}`);
        }
      }
    }

    const leaseFile = parseLeaseFile(readFileFromCommit(repoPath, tip, leasesPathForKey(key)));
    const derivedLeases = deriveAllLeases(events, key);
    for (const [role, record] of Object.entries(leaseFile)) {
      const derived = derivedLeases[role];
      const fileActive = record && !isLeaseRecordExpired(record);
      const derivedActive = derived && !derived.expired;
      if (fileActive && derivedActive && derived.holderId !== record.holderId) {
        issues.push({
          severity: 'error',
          code: 'lease_file_audit_mismatch',
          key,
          role,
          message: `Lease file holder for ${key}/${role} (${record.holderId}) disagrees with audit events (${derived.holderId})`,
        });
      }
      if (isLeaseRecordExpired(record)) {
        issues.push({
          severity: 'warn',
          code: 'expired_unreleased_lease',
          key,
          role,
          holderId: record.holderId,
          expiresAt: record.expiresAt,
          message: `Expired but unreleased ${role} lease on ${key} (holder ${record.holderId})`,
        });
        if (options.fix && typeof store.clearExpiredLeasesForKey === 'function' && !clearedKeys.has(key)) {
          clearedKeys.add(key);
          const cleared = await store.clearExpiredLeasesForKey(key);
          if (cleared && cleared.cleared > 0) {
            fixes.push(`cleared ${cleared.cleared} expired lease role(s) on ${key}`);
          }
        }
      }
    }

    for (const [role, lease] of Object.entries(derivedLeases)) {
      if (lease.expired && lease.lastEventType !== 'lease.released' && !leaseFile[role]) {
        issues.push({
          severity: 'warn',
          code: 'expired_unreleased_lease',
          key,
          role,
          holderId: lease.holderId,
          expiresAt: lease.expiresAt,
          message: `Expired audit lease on ${key}/${role} with no lease file entry`,
        });
      }
    }
  }
}

/**
 * Read-only SpecStore diagnostics (mutates only with --fix).
 *
 * @param {string} repoPath
 * @param {{ fix?: boolean }} [options]
 */
async function runStorageDoctor(repoPath, options = {}) {
  const raw = readRawStorageConfig(repoPath);
  const issues = [];
  const fixes = [];

  if (raw.backend === 'git-ref') {
    issues.push({
      severity: 'error',
      code: 'git_ref_removed',
      message: `storage.backend "git-ref" is no longer supported. Run: ${GIT_REF_CONVERT_HINT}`,
    });
    return { ok: false, issues, fixes, health: null, backend: 'git-ref' };
  }

  const storage = resolveStorageConfig(repoPath);
  const store = createSpecStore({ repoPath, storage });

  if (storage.backend === 'git-branch') {
    const { remote, branch } = storage.git;
    const branchName = branch || DEFAULT_STATE_BRANCH;
    const trackingRef = stateTrackingRef(branchName, DEFAULT_STATE_BRANCH);
    try {
      if (!storage.git.offline) {
        fetchStateBranch(repoPath, remote, branchName, trackingRef);
      }
    } catch (error) {
      issues.push({ severity: 'error', code: 'remote_unreachable', message: error.message });
    }

    const branchRef = `refs/heads/${branchName}`;
    const stateTip = refExists(repoPath, branchRef) ? runGit(repoPath, ['rev-parse', branchRef]) : null;
    if (stateTip) {
      try {
        const defaultBranch = getDefaultBranch();
        const defaultTip = runGit(repoPath, ['rev-parse', defaultBranch]);
        if (defaultTip && isAncestor(repoPath, defaultTip, stateTip)) {
          issues.push({
            severity: 'warn',
            code: 'state_branch_not_orphan',
            message: `State branch ${branchName} shares history with ${defaultBranch} — expected an orphan branch`,
          });
        }
      } catch (_) { /* default branch may not exist in bare fixtures */ }
    }

    if (options.fix && typeof store.fetchRemoteProjection === 'function' && !storage.git.offline) {
      try {
        await store.fetchRemoteProjection();
        fixes.push('fetched and merged remote state branch');
      } catch (error) {
        issues.push({ severity: 'error', code: 'fetch_merge_failed', message: error.message });
      }
    }

    await auditGitBranchKeys(repoPath, store, options, issues, fixes);
  } else {
    const specs = await store.listSpecs();
    for (const spec of specs) {
      if (!spec.number) continue;
      const ref = { entityType: spec.kind === 'research' ? 'research' : 'feature', entityId: String(spec.number) };
      const events = await store.readEvents(ref);
      const key = spec.key;
      const leases = deriveAllLeases(events, key);
      for (const [role, lease] of Object.entries(leases)) {
        if (lease.expired && lease.lastEventType !== 'lease.released') {
          issues.push({
            severity: 'warn',
            code: 'expired_unreleased_lease',
            key,
            role,
            holderId: lease.holderId,
            expiresAt: lease.expiresAt,
            message: `Expired but unreleased ${role} lease on ${key}`,
          });
        }
      }
    }
  }

  const health = await store.health();
  return { ok: issues.every((i) => i.severity !== 'error'), issues, fixes, health, backend: storage.backend };
}

module.exports = { runStorageDoctor };
