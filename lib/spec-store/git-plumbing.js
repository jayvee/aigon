'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

/**
 * @param {string} repoPath
 * @param {string[]} args
 * @param {{ input?: string, env?: object }} [options]
 * @returns {string}
 */
function runGit(repoPath, args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: repoPath,
    encoding: 'utf8',
    input: options.input,
    env: { ...process.env, ...options.env },
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    const err = new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
    err.exitCode = result.status;
    throw err;
  }
  return (result.stdout || '').trim();
}

function refExists(repoPath, refName) {
  try {
    runGit(repoPath, ['rev-parse', '--verify', refName]);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * @param {string} repoPath
 * @param {string} refName
 * @returns {string|null}
 */
function readRefPayload(repoPath, refName) {
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

/**
 * @param {string} repoPath
 * @param {string} refName
 * @param {string} payload
 * @param {{ parents?: string[] }} [options]
 * @returns {string} new commit sha
 */
function writeRefPayload(repoPath, refName, payload, options = {}) {
  const blobSha = runGit(repoPath, ['hash-object', '-w', '--stdin'], { input: payload });
  const treeSha = runGit(repoPath, ['mktree'], {
    input: `100644 blob ${blobSha}\tevents.json\n`,
  });
  const parents = Array.isArray(options.parents) ? options.parents.filter(Boolean) : [];
  if (parents.length === 0 && refExists(repoPath, refName)) {
    parents.push(runGit(repoPath, ['rev-parse', refName]));
  }
  const commitArgs = ['commit-tree', treeSha, '-m', 'aigon-specstore: events'];
  for (const parent of parents) commitArgs.push('-p', parent);
  const commitSha = runGit(repoPath, commitArgs);
  runGit(repoPath, ['update-ref', refName, commitSha]);
  return commitSha;
}

/**
 * @param {string} repoPath
 * @param {string} remote
 * @param {string} refPrefix
 */
function fetchRemoteRefs(repoPath, remote, refPrefix) {
  const trackingPrefix = remoteTrackingPrefix(remote, refPrefix);
  runGit(repoPath, ['fetch', remote, `+${refPrefix}/*:${trackingPrefix}/*`]);
}

/**
 * @param {string} repoPath
 * @param {string} remote
 * @param {string} refPrefix
 */
function pushLocalRefs(repoPath, remote, refPrefix) {
  runGit(repoPath, ['push', remote, `${refPrefix}/*`]);
}

/**
 * @param {string} remote
 * @param {string} refPrefix
 * @returns {string}
 */
function remoteTrackingPrefix(remote, refPrefix) {
  const suffix = refPrefix.replace(/^refs\//, '');
  return `refs/remotes/${remote}/${suffix}`;
}

/**
 * @param {string} repoPath
 * @param {string} refPrefix
 * @returns {string[]}
 */
function listRefSpecKeys(repoPath, refPrefix) {
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

/**
 * @param {string} repoPath
 * @param {string} localRef
 * @param {string} remoteRef
 * @returns {{ ahead: number, behind: number }}
 */
function countAheadBehind(repoPath, localRef, remoteRef) {
  if (!refExists(repoPath, localRef) && !refExists(repoPath, remoteRef)) {
    return { ahead: 0, behind: 0 };
  }
  if (!refExists(repoPath, localRef)) return { ahead: 0, behind: 1 };
  if (!refExists(repoPath, remoteRef)) return { ahead: 1, behind: 0 };
  const out = runGit(repoPath, ['rev-list', '--left-right', '--count', `${remoteRef}...${localRef}`]);
  const [behind, ahead] = out.split(/\s+/).map((n) => parseInt(n, 10) || 0);
  return { ahead, behind };
}

module.exports = {
  runGit,
  refExists,
  readRefPayload,
  writeRefPayload,
  fetchRemoteRefs,
  pushLocalRefs,
  remoteTrackingPrefix,
  listRefSpecKeys,
  countAheadBehind,
};
