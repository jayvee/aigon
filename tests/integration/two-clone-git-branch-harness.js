'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, fork } = require('child_process');
const { GIT_SAFE_ENV } = require('../_helpers');
const { createGitBranchBackend } = require('../../lib/spec-store/git-branch-backend');
const { runGit } = require('../../lib/spec-store/git-plumbing');
const { parseLeaseFile } = require('../../lib/spec-store/leases');

function git(cmd, cwd) {
  execSync(cmd, { cwd, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'ignore' });
}

function cloneEnv(repo, machineId) {
  return {
    HOME: repo,
    USERPROFILE: repo,
    AIGON_NONINTERACTIVE: '1',
    AIGON_MACHINE_ID: machineId,
  };
}

function bootEvent(id, featureId, at) {
  return { id, type: 'feature.bootstrapped', at, featureId, lifecycle: 'backlog' };
}

function makeStore(repo, overrides = {}) {
  return createGitBranchBackend(repo, { remote: 'origin', branch: 'aigon-state', ...overrides });
}

function makeStoreFromConfig(repo) {
  const { createSpecStore, resolveStorageConfig } = require('../../lib/spec-store/index.js');
  return createSpecStore({ repoPath: repo, storage: resolveStorageConfig(repo) });
}

function ctx(clone, label) {
  return `clone=${label} path=${clone}`;
}

function canonicalIds(store, key) {
  return store._readCanonicalEvents(key).map((e) => e.id).sort();
}

function leaseFileAt(repo, key) {
  let tip;
  try { tip = runGit(repo, ['rev-parse', 'refs/heads/aigon-state']); } catch (_) { return {}; }
  let raw = null;
  try { raw = runGit(repo, ['cat-file', '-p', `${tip}:leases/${key}.json`]); } catch (_) { /* absent */ }
  return parseLeaseFile(raw);
}

function eventTail(repo, key, lines = 5) {
  let tip;
  try { tip = runGit(repo, ['rev-parse', 'refs/heads/aigon-state']); } catch (_) { return '(no branch)'; }
  let raw = '';
  try { raw = runGit(repo, ['cat-file', '-p', `${tip}:specs/${key}/events.jsonl`]); } catch (_) { return '(absent)'; }
  return raw.split('\n').filter(Boolean).slice(-lines).join('\n') || '(empty)';
}

function branchTip(repo) {
  try { return runGit(repo, ['rev-parse', 'refs/heads/aigon-state']); } catch (_) { return '(no branch)'; }
}

function formatHarnessDump(property, { cloneA, cloneB, key }) {
  const leaseA = key ? JSON.stringify(leaseFileAt(cloneA, key), null, 2) : '(n/a)';
  const leaseB = key ? JSON.stringify(leaseFileAt(cloneB, key), null, 2) : '(n/a)';
  return [
    `PROPERTY VIOLATED: ${property}`,
    `clone A tip: ${branchTip(cloneA)}`,
    `clone B tip: ${branchTip(cloneB)}`,
    key ? `clone A lease ${key}: ${leaseA}` : null,
    key ? `clone B lease ${key}: ${leaseB}` : null,
    key ? `clone A events tail ${key}:\n${eventTail(cloneA, key)}` : null,
    key ? `clone B events tail ${key}:\n${eventTail(cloneB, key)}` : null,
  ].filter(Boolean).join('\n');
}

function assertHarness(property, context, fn) {
  try {
    return fn();
  } catch (error) {
    const dump = formatHarnessDump(property, context);
    error.message = `${error.message}\n\n${dump}`;
    throw error;
  }
}

async function assertHarnessAsync(property, context, fn) {
  try {
    return await fn();
  } catch (error) {
    const dump = formatHarnessDump(property, context);
    error.message = `${error.message}\n\n${dump}`;
    throw error;
  }
}

async function setupTwoCloneHarness(base) {
  const bare = path.join(base, 'origin.git');
  const seed = path.join(base, 'seed');
  execSync(`git init --bare "${bare}"`, { env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'ignore' });
  fs.mkdirSync(seed);
  git('git init', seed);
  git(`git remote add origin "${bare}"`, seed);
  fs.writeFileSync(path.join(seed, 'README.md'), '# seed\n');
  git('git add -A', seed);
  git('git commit -m init', seed);
  git('git push -u origin HEAD', seed);

  const cloneA = path.join(base, 'clone-a');
  const cloneB = path.join(base, 'clone-b');
  execSync(`git clone "${bare}" "${cloneA}"`, { env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'ignore' });
  execSync(`git clone "${bare}" "${cloneB}"`, { env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'ignore' });
  git('git config user.email a@team.com', cloneA);
  git('git config user.email b@team.com', cloneB);
  for (const clone of [cloneA, cloneB]) {
    fs.mkdirSync(path.join(clone, '.aigon'), { recursive: true });
    fs.writeFileSync(path.join(clone, '.aigon', 'config.json'), `${JSON.stringify({
      storage: { backend: 'git-branch', git: { remote: 'origin', branch: 'aigon-state' } },
    }, null, 2)}\n`);
  }
  return { bare, cloneA, cloneB };
}

function forkAcquireLease(repo, machineId, featureId, holderId, agentId) {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'two-clone-git-branch-worker.js'), [], {
      env: { ...process.env, ...GIT_SAFE_ENV, ...cloneEnv(repo, machineId) },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stdout += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`worker exit ${code}: ${stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (_error) {
        reject(new Error(`worker parse failed: ${stdout}`));
      }
    });
    child.send({ cmd: 'acquire', featureId, holderId, agentId, repo });
  });
}

module.exports = {
  git,
  cloneEnv,
  bootEvent,
  makeStore,
  makeStoreFromConfig,
  ctx,
  canonicalIds,
  leaseFileAt,
  eventTail,
  branchTip,
  formatHarnessDump,
  assertHarness,
  assertHarnessAsync,
  setupTwoCloneHarness,
  forkAcquireLease,
};
