'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { readConductorReposFromGlobalConfig } = require('../config');
const { createSpecStore, resolveStorageConfig } = require('./index');
const { fetchStateBranch, stateTrackingRef, runGit, refExists, readFileFromCommit, listTreeFiles } = require('./git-plumbing');
const { deriveAllLeases, parseLeaseFile, isLeaseRecordExpired, leasesPathForKey } = require('./leases');
const { DEFAULT_STATE_BRANCH } = require('./storage-config');

const GIT_SAFE_ENV = Object.freeze({
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
});

const REMOTES_DIR = path.join(os.homedir(), '.aigon', 'remotes');

function loadRepoStorageConfig(repoPath) {
  try {
    const configPath = path.join(repoPath, '.aigon', 'config.json');
    if (!fs.existsSync(configPath)) return null;
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (raw.storage && raw.storage.backend === 'git-branch') {
      return resolveStorageConfig(repoPath);
    }
  } catch (_) { /* skip */ }
  return null;
}

function parseEventsJsonl(raw) {
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function leasesFromGitBranchTip(repoPath, tip, key) {
  const map = parseLeaseFile(readFileFromCommit(repoPath, tip, leasesPathForKey(key)));
  const out = {};
  for (const [role, record] of Object.entries(map)) {
    out[role] = {
      key,
      role,
      holderId: record.holderId,
      user: record.user || null,
      agentId: record.agentId || null,
      acquiredAt: record.acquiredAt,
      expiresAt: record.expiresAt,
      expired: isLeaseRecordExpired(record),
    };
  }
  return out;
}

function readSpecsFromGitBranchCheckout(repoPath) {
  const storage = loadRepoStorageConfig(repoPath);
  if (!storage || storage.backend !== 'git-branch') return [];
  const { remote, branch } = storage.git;
  const branchName = branch || DEFAULT_STATE_BRANCH;
  const trackingRef = stateTrackingRef(branchName, DEFAULT_STATE_BRANCH);
  try {
    fetchStateBranch(repoPath, remote, branchName, trackingRef);
  } catch (_) { /* best effort */ }
  const branchRef = `refs/heads/${branchName}`;
  const tip = refExists(repoPath, trackingRef)
    ? runGit(repoPath, ['rev-parse', trackingRef])
    : (refExists(repoPath, branchRef) ? runGit(repoPath, ['rev-parse', branchRef]) : null);
  if (!tip) return [];
  const keys = listTreeFiles(repoPath, tip, 'specs')
    .map((file) => {
      const match = /^specs\/([^/]+)\/events\.jsonl$/.exec(file);
      return match ? match[1] : null;
    })
    .filter(Boolean);
  return keys.map((key) => {
    let events = [];
    try {
      events = parseEventsJsonl(readFileFromCommit(repoPath, tip, `specs/${key}/events.jsonl`));
    } catch (_) {
      events = [];
    }
    const leases = leasesFromGitBranchTip(repoPath, tip, key);
    const lifecycleEvent = [...events].reverse().find((e) => e.lifecycle || e.stage);
    return {
      key,
      eventCount: events.length,
      lifecycle: lifecycleEvent ? (lifecycleEvent.lifecycle || lifecycleEvent.stage) : null,
      leases,
    };
  });
}

/**
 * Build a merged cross-repo report from git-branch specstore state.
 *
 * @param {{ repos?: string[], json?: boolean }} [options]
 */
async function runStorageReport(options = {}) {
  const cwd = process.cwd();
  const repoPaths = (options.repos && options.repos.length > 0)
    ? options.repos
    : [...new Set([cwd, ...readConductorReposFromGlobalConfig()])];

  const report = {
    generatedAt: new Date().toISOString(),
    repos: [],
    specs: [],
  };

  for (const repoPath of repoPaths) {
    if (!repoPath || !fs.existsSync(repoPath)) continue;
    const storage = loadRepoStorageConfig(repoPath);
    const repoEntry = { path: repoPath, backend: storage ? storage.backend : 'local', specs: [] };
    if (storage && storage.backend === 'git-branch') {
      repoEntry.specs = readSpecsFromGitBranchCheckout(repoPath);
    } else {
      try {
        const store = createSpecStore({ repoPath });
        const listed = await store.listSpecs();
        repoEntry.specs = listed
          .filter((s) => s.number)
          .map((s) => ({ key: s.key, eventCount: null, lifecycle: s.stageDir, leases: {} }));
      } catch (_) {
        repoEntry.specs = [];
      }
    }
    report.repos.push(repoEntry);
    for (const spec of repoEntry.specs) {
      report.specs.push({ repo: repoPath, ...spec });
    }
  }

  report.specs.sort((a, b) => a.key.localeCompare(b.key) || a.repo.localeCompare(b.repo));
  return report;
}

module.exports = {
  runStorageReport,
  REMOTES_DIR,
};
