'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { readConductorReposFromGlobalConfig } = require('../config');
const { createSpecStore, resolveStorageConfig } = require('./index');
const { fetchRemoteRefs, listRefSpecKeys, readRefPayload, remoteTrackingPrefix } = require('./git-plumbing');
const { parseEventsPayload } = require('./event-merge');
const { deriveAllLeases } = require('./leases');

const GIT_SAFE_ENV = Object.freeze({
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
});

const REMOTES_DIR = path.join(os.homedir(), '.aigon', 'remotes');

function gitRefPrefix(repoPath) {
  return resolveStorageConfig(repoPath).git.refPrefix || 'refs/aigon/specs';
}

function loadRepoStorageConfig(repoPath) {
  try {
    const configPath = path.join(repoPath, '.aigon', 'config.json');
    if (!fs.existsSync(configPath)) return null;
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (raw.storage && raw.storage.backend === 'git-ref') {
      return resolveStorageConfig(repoPath);
    }
  } catch (_) { /* skip */ }
  return null;
}

/**
 * Resolve a storage remote (which is conventionally a git *remote name* such as
 * `origin`, per 577's fetch/push path) to a cloneable URL. Already-URL/path
 * values pass through unchanged.
 */
function resolveRemoteUrl(repoPath, remote) {
  if (/^[a-z]+:\/\//i.test(remote) || /^[^/]+@[^/]+:/.test(remote) || remote.startsWith('/') || remote.startsWith('.')) {
    return remote;
  }
  try {
    return execSync(`git remote get-url "${remote}"`, {
      cwd: repoPath,
      env: { ...process.env, ...GIT_SAFE_ENV },
      encoding: 'utf8',
    }).trim() || remote;
  } catch (_) {
    return remote;
  }
}

function ensureBareMirror(repoPath, remote, mirrorName) {
  const mirrorPath = path.join(REMOTES_DIR, mirrorName);
  fs.mkdirSync(REMOTES_DIR, { recursive: true });
  if (!fs.existsSync(mirrorPath)) {
    const url = resolveRemoteUrl(repoPath, remote);
    execSync(`git clone --mirror "${url}" "${mirrorPath}"`, {
      env: { ...process.env, ...GIT_SAFE_ENV },
      stdio: 'ignore',
    });
  } else {
    execSync('git fetch --prune', { cwd: mirrorPath, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'ignore' });
  }
  return mirrorPath;
}

/**
 * Read an events ref payload from a bare mirror. 577 stores events as a commit
 * whose tree holds `events.json` (see git-plumbing writeRefPayload), so a plain
 * `cat-file blob <ref>` fails — resolve the object type the same way readRefPayload does.
 */
function readMirrorRefPayload(mirrorPath, refName) {
  const run = (args) => execSync(`git ${args}`, {
    cwd: mirrorPath,
    env: { ...process.env, ...GIT_SAFE_ENV },
    encoding: 'utf8',
  });
  const sha = run(`rev-parse "${refName}"`).trim();
  const type = run(`cat-file -t ${sha}`).trim();
  if (type === 'blob') return run(`cat-file -p ${sha}`);
  if (type === 'commit') {
    try {
      return run(`cat-file -p ${sha}:events.json`);
    } catch (_) {
      return run(`cat-file -p ${sha}:events.jsonl`);
    }
  }
  return null;
}

function readSpecsFromMirror(mirrorPath, refPrefix) {
  const prefix = `${refPrefix}/`;
  let refsOutput = '';
  try {
    refsOutput = execSync(`git for-each-ref --format="%(refname)" "${prefix}"`, {
      cwd: mirrorPath,
      env: { ...process.env, ...GIT_SAFE_ENV },
      encoding: 'utf8',
    });
  } catch (_) {
    return [];
  }
  const keys = new Set();
  for (const line of refsOutput.split('\n')) {
    const ref = line.trim();
    if (!ref.endsWith('/events')) continue;
    const key = ref.slice(prefix.length).replace(/\/events$/, '');
    if (key) keys.add(key);
  }
  const rows = [];
  for (const key of keys) {
    let events = [];
    try {
      const payload = readMirrorRefPayload(mirrorPath, `${refPrefix}/${key}/events`);
      events = payload ? parseEventsPayload(payload) : [];
    } catch (_) {
      events = [];
    }
    const leases = deriveAllLeases(events, key);
    const lifecycleEvent = [...events].reverse().find((e) => e.lifecycle || e.stage);
    rows.push({
      key,
      eventCount: events.length,
      lifecycle: lifecycleEvent ? (lifecycleEvent.lifecycle || lifecycleEvent.stage) : null,
      leases,
    });
  }
  return rows;
}

function readSpecsFromCheckout(repoPath) {
  const storage = loadRepoStorageConfig(repoPath);
  if (!storage) return [];
  const { remote, refPrefix } = storage.git;
  try {
    fetchRemoteRefs(repoPath, remote, refPrefix);
  } catch (_) { /* best effort */ }
  const trackingPrefix = remoteTrackingPrefix(remote, refPrefix);
  const keys = new Set([
    ...listRefSpecKeys(repoPath, refPrefix),
    ...listRefSpecKeys(repoPath, trackingPrefix),
  ]);
  return [...keys].map((key) => {
    let events = [];
    try {
      events = parseEventsPayload(readRefPayload(repoPath, `${refPrefix}/${key}/events`));
    } catch (_) {
      events = [];
    }
    return {
      key,
      eventCount: events.length,
      lifecycle: null,
      leases: deriveAllLeases(events, key),
    };
  });
}

/**
 * Build a merged cross-repo report from git-ref specstore refs.
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
    if (storage && storage.backend === 'git-ref') {
      const mirrorName = path.basename(repoPath).replace(/[^\w.-]+/g, '-');
      try {
        const mirrorPath = ensureBareMirror(repoPath, storage.git.remote, mirrorName);
        repoEntry.specs = readSpecsFromMirror(mirrorPath, storage.git.refPrefix);
      } catch (_) {
        repoEntry.specs = readSpecsFromCheckout(repoPath);
      }
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
