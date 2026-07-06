'use strict';

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
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
    env: {
      GIT_AUTHOR_NAME: 'Aigon SpecStore',
      GIT_AUTHOR_EMAIL: 'specstore@aigon.local',
      GIT_COMMITTER_NAME: 'Aigon SpecStore',
      GIT_COMMITTER_EMAIL: 'specstore@aigon.local',
      ...process.env,
      ...options.env,
    },
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
// ---------------------------------------------------------------------------
// Tree-aware plumbing for the git-branch backend (F609).
//
// The git-branch backend stores canonical state as a file tree on an orphan
// branch (default `aigon-state`): `meta.json` at the root and one
// `specs/<KEY>/events.jsonl` per spec. All reads/writes go through plumbing so
// the branch is *never* checked out and `git status` in the user's worktree is
// untouched. Writes build commits against a throwaway index under
// `.aigon/cache/` — never the user's index.
// ---------------------------------------------------------------------------

/**
 * Read a single file's contents from a commit's tree.
 *
 * @param {string} repoPath
 * @param {string} commitish
 * @param {string} filePath
 * @returns {string|null} file contents, or null when absent
 */
function readFileFromCommit(repoPath, commitish, filePath) {
  if (!commitish) return null;
  try {
    return runGit(repoPath, ['cat-file', '-p', `${commitish}:${filePath}`]);
  } catch (_) {
    return null;
  }
}

/**
 * Resolve the blob sha of a single file in a commit's tree, or null when the
 * path is absent. Used by the CAS lease path to classify a rejected push:
 * an unchanged lease blob means only unrelated paths moved (retry), a changed
 * one means we lost the race (conflict).
 *
 * @param {string} repoPath
 * @param {string|null} commitish
 * @param {string} filePath
 * @returns {string|null}
 */
function treeBlobSha(repoPath, commitish, filePath) {
  if (!commitish) return null;
  try {
    return runGit(repoPath, ['rev-parse', `${commitish}:${filePath}`]);
  } catch (_) {
    return null;
  }
}

/**
 * List file paths under a tree prefix in a commit.
 *
 * @param {string} repoPath
 * @param {string} commitish
 * @param {string} [prefix]
 * @returns {string[]} repo-relative file paths (e.g. `specs/F42/events.jsonl`)
 */
function listTreeFiles(repoPath, commitish, prefix) {
  if (!commitish) return [];
  const args = ['ls-tree', '-r', '--name-only', commitish];
  if (prefix) args.push(prefix);
  let out;
  try {
    out = runGit(repoPath, args);
  } catch (_) {
    return [];
  }
  return out.split('\n').map((line) => line.trim()).filter(Boolean);
}

/**
 * Build a commit that adds/replaces one or more file paths in a base tree,
 * using a throwaway index under `.aigon/cache/` so the user's index and
 * worktree are never touched. Pass `baseCommit: null` to build an orphan commit.
 *
 * @param {string} repoPath
 * @param {{ baseCommit?: string|null, updates: Record<string,string>, message: string, parents?: string[] }} options
 * @returns {string} new commit sha
 */
function commitTreeWithFiles(repoPath, options) {
  const { baseCommit = null, updates = {}, message, parents = [] } = options;
  const cacheDir = path.join(repoPath, '.aigon', 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const indexFile = path.join(
    cacheDir,
    `git-branch-index-${process.pid}-${crypto.randomBytes(6).toString('hex')}`,
  );
  const env = { GIT_INDEX_FILE: indexFile };
  try {
    if (baseCommit) {
      runGit(repoPath, ['read-tree', baseCommit], { env });
    }
    for (const [filePath, content] of Object.entries(updates)) {
      const blobSha = runGit(repoPath, ['hash-object', '-w', '--stdin'], { input: content });
      runGit(repoPath, ['update-index', '--add', '--cacheinfo', `100644,${blobSha},${filePath}`], { env });
    }
    const treeSha = runGit(repoPath, ['write-tree'], { env });
    const commitArgs = ['commit-tree', treeSha, '-m', message || 'aigon-specstore: state'];
    for (const parent of parents.filter(Boolean)) commitArgs.push('-p', parent);
    return runGit(repoPath, commitArgs);
  } finally {
    try { fs.rmSync(indexFile, { force: true }); } catch (_) { /* best effort */ }
  }
}

/**
 * @param {string} repoPath
 * @param {string} maybeAncestor
 * @param {string} descendant
 * @returns {boolean} true when `maybeAncestor` is an ancestor of `descendant`
 */
function isAncestor(repoPath, maybeAncestor, descendant) {
  if (!maybeAncestor || !descendant) return false;
  const result = spawnSync('git', ['merge-base', '--is-ancestor', maybeAncestor, descendant], {
    cwd: repoPath,
    encoding: 'utf8',
  });
  return result.status === 0;
}

/**
 * Fetch a single state branch into an internal tracking ref, never relying on
 * the user's default fetch refspec.
 *
 * @param {string} repoPath
 * @param {string} remote
 * @param {string} branch
 * @param {string} trackingRef
 */
function fetchStateBranch(repoPath, remote, branch, trackingRef) {
  try {
    runGit(repoPath, ['fetch', remote, `+refs/heads/${branch}:${trackingRef}`]);
  } catch (error) {
    if (/couldn't find remote ref|no matching remote|does not appear to be a git repository/i.test(error.message || '')) {
      return;
    }
    throw error;
  }
}

/**
 * Push the local state branch tip to `refs/heads/<branch>` on the remote.
 *
 * @param {string} repoPath
 * @param {string} remote
 * @param {string} branch
 */
function pushStateBranch(repoPath, remote, branch) {
  runGit(repoPath, ['push', remote, `refs/heads/${branch}:refs/heads/${branch}`]);
}

/**
 * Internal tracking ref for a state branch. Default branch collapses to
 * `refs/aigon-internal/state`; non-default branches carry their name.
 *
 * @param {string} branch
 * @param {string} defaultBranch
 * @returns {string}
 */
function stateTrackingRef(branch, defaultBranch) {
  if (branch === defaultBranch) return 'refs/aigon-internal/state';
  const safe = branch.replace(/[^A-Za-z0-9._-]/g, '-');
  return `refs/aigon-internal/${safe}`;
}

module.exports = {
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
};
