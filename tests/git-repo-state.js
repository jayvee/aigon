'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const assert = require('assert');
const { GIT_SAFE_ENV } = require('./_helpers');

function gitEnv() {
  return { ...process.env, ...GIT_SAFE_ENV };
}

function isIgnoredUntracked(relPath, ignorePrefixes = []) {
  return ignorePrefixes.some((prefix) => relPath === prefix.replace(/\/$/, '') || relPath.startsWith(prefix));
}

/**
 * Snapshot checkout Git state for regression tests that storage projection must
 * not mutate tracked repository content (F666). Aigon-owned projection paths
 * under `.aigon/` are excluded — those are allowed to change.
 *
 * @param {string} repoPath
 * @param {{ ignoreUntrackedPrefixes?: string[] }} [options]
 * @returns {{ head: string, specsIndex: string, specsWorktree: string, trackedOutsideAigon: string, untracked: string[], untrackedHashes: Record<string, string> }}
 */
function captureGitRepoState(repoPath, options = {}) {
  const env = gitEnv();
  const ignoreUntrackedPrefixes = options.ignoreUntrackedPrefixes || ['.aigon/'];
  const head = execSync('git rev-parse HEAD', { cwd: repoPath, env, encoding: 'utf8' }).trim();
  const specsIndex = execSync('git ls-files -s -- docs/specs', { cwd: repoPath, env, encoding: 'utf8' });
  const specsWorktree = execSync('git diff HEAD -- docs/specs', { cwd: repoPath, env, encoding: 'utf8' });
  const trackedOutsideAigon = execSync('git diff HEAD -- . ":(exclude).aigon"', { cwd: repoPath, env, encoding: 'utf8' });
  const untracked = execSync('git ls-files --others --exclude-standard', { cwd: repoPath, env, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((rel) => !isIgnoredUntracked(rel, ignoreUntrackedPrefixes))
    .sort();
  const untrackedHashes = {};
  for (const rel of untracked) {
    const abs = path.join(repoPath, rel);
    untrackedHashes[rel] = fs.readFileSync(abs).toString('base64');
  }
  return {
    head,
    specsIndex,
    specsWorktree,
    trackedOutsideAigon,
    untracked,
    untrackedHashes,
  };
}

/**
 * @param {ReturnType<typeof captureGitRepoState>} before
 * @param {ReturnType<typeof captureGitRepoState>} after
 * @param {string} [label]
 */
function assertGitRepoStateUnchanged(before, after, label = 'git repo state') {
  assert.strictEqual(after.head, before.head, `${label}: HEAD changed`);
  assert.strictEqual(after.specsIndex, before.specsIndex, `${label}: docs/specs index changed`);
  assert.strictEqual(after.specsWorktree, before.specsWorktree, `${label}: docs/specs worktree changed`);
  assert.strictEqual(after.trackedOutsideAigon, before.trackedOutsideAigon, `${label}: tracked worktree outside .aigon changed`);
  assert.deepStrictEqual(after.untracked, before.untracked, `${label}: untracked paths outside .aigon changed`);
  assert.deepStrictEqual(after.untrackedHashes, before.untrackedHashes, `${label}: untracked content outside .aigon changed`);
}

module.exports = {
  captureGitRepoState,
  assertGitRepoStateUnchanged,
};
