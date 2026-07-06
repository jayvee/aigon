#!/usr/bin/env node
// REGRESSION F611: git-branch observability — status/doctor/report/dashboard DTOs.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { testAsync, report, withTempDirAsync, GIT_SAFE_ENV } = require('../_helpers');
const { createGitBranchBackend } = require('../../lib/spec-store/git-branch-backend');
const { runStorageDoctor } = require('../../lib/spec-store/doctor');
const { runStorageReport } = require('../../lib/spec-store/report');
const { pollOnce } = require('../../lib/storage-poller');
const {
  buildRepoStorageStatus,
  buildEntityActiveLeases,
  buildRepoStorageActions,
} = require('../../lib/dashboard-storage');

function git(cmd, cwd) {
  execSync(cmd, { cwd, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'ignore' });
}

function initGitBranchRepo(base) {
  const bare = path.join(base, 'remote.git');
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  execSync(`git init --bare "${bare}"`, { env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'ignore' });
  git('git init', repo);
  git(`git remote add origin "${bare}"`, repo);
  fs.writeFileSync(path.join(repo, 'README.md'), '# test\n');
  git('git add README.md', repo);
  git('git commit -m init', repo);
  git('git push -u origin HEAD', repo);
  fs.mkdirSync(path.join(repo, '.aigon'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.aigon', 'config.json'), `${JSON.stringify({
    storage: {
      backend: 'git-branch',
      git: { remote: 'origin', branch: 'aigon-state' },
    },
  }, null, 2)}\n`);
  return { repo, bare };
}

testAsync('git-branch storage status exposes branch health fields', async () => {
  // REGRESSION F611: status must mirror git-ref layout with branch instead of refPrefix.
  await withTempDirAsync('gb-obs-status-', async (base) => {
    const { repo } = initGitBranchRepo(base);
    const store = createGitBranchBackend(repo, { remote: 'origin', branch: 'aigon-state', offline: false });
    const health = await store.health();
    assert.strictEqual(health.backend, 'git-branch');
    assert.strictEqual(health.remote, 'origin');
    assert.strictEqual(health.branch, 'aigon-state');
    assert.ok(Object.prototype.hasOwnProperty.call(health, 'ahead'));
    assert.ok(Object.prototype.hasOwnProperty.call(health, 'behind'));

    const dto = buildRepoStorageStatus(repo);
    assert.strictEqual(dto.backend, 'git-branch');
    assert.strictEqual(dto.branch, 'aigon-state');
    assert.strictEqual(dto.remote, 'origin');
    assert.ok(dto.localHolderId);
    assert.ok(Array.isArray(buildRepoStorageActions(dto)));
    assert.ok(buildRepoStorageActions(dto).some((a) => a.args[0] === 'sync'));
  });
});

testAsync('git-branch dashboard leases read authoritative lease file with user', async () => {
  // REGRESSION F611: dashboard must surface user + holder from leases/<KEY>.json.
  await withTempDirAsync('gb-obs-lease-', async (base) => {
    const { repo } = initGitBranchRepo(base);
    const store = createGitBranchBackend(repo, { remote: 'origin', branch: 'aigon-state', offline: false });
    await store.acquireLease({ entityType: 'feature', entityId: '42' }, {
      role: 'impl',
      agentId: 'cu',
      holderId: 'machine-obs-test',
      user: 'dev@example.com',
    });
    const leases = buildEntityActiveLeases(repo, 'feature', '42');
    assert.strictEqual(leases.length, 1);
    assert.strictEqual(leases[0].holderId, 'machine-obs-test');
    assert.strictEqual(leases[0].user, 'dev@example.com');
    assert.strictEqual(leases[0].agentId, 'cu');
  });
});

testAsync('git-branch storage doctor and report include lease metadata', async () => {
  // REGRESSION F611: doctor/report surfaces git-branch repos like git-ref.
  await withTempDirAsync('gb-obs-report-', async (base) => {
    const { repo } = initGitBranchRepo(base);
    const store = createGitBranchBackend(repo, { remote: 'origin', branch: 'aigon-state', offline: false });
    await store.appendEvent(
      { entityType: 'feature', entityId: '7' },
      { id: 'evt-7', type: 'feature.bootstrapped', at: '2026-07-01T08:00:00.000Z', featureId: '7', lifecycle: 'backlog' },
    );
    await store.acquireLease({ entityType: 'feature', entityId: '7' }, {
      role: 'impl',
      holderId: 'machine-report',
      agentId: 'cc',
      user: 'report@example.com',
    });
    const doctor = await runStorageDoctor(repo, { fix: false });
    assert.strictEqual(doctor.backend, 'git-branch');
    assert.ok(doctor.ok);

    const report = await runStorageReport({ repos: [repo] });
    const row = report.specs.find((s) => s.key === 'F7');
    assert.ok(row, 'F7 missing from report');
    assert.ok(row.leases.impl);
    assert.strictEqual(row.leases.impl.holderId, 'machine-report');
    assert.strictEqual(row.leases.impl.user, 'report@example.com');
  });
});

testAsync('storage poller fetch-only updates lastFetchAt for git-branch', async () => {
  // REGRESSION F611: background fetch records freshness without pushing.
  await withTempDirAsync('gb-obs-poll-', async (base) => {
    const { repo } = initGitBranchRepo(base);
    const store = createGitBranchBackend(repo, { remote: 'origin', branch: 'aigon-state', offline: false });
    await store.appendEvent(
      { entityType: 'feature', entityId: '3' },
      { id: 'evt-3', type: 'feature.bootstrapped', at: '2026-07-01T08:00:00.000Z', featureId: '3', lifecycle: 'backlog' },
    );
    await store.sync();
    const result = await pollOnce({ repoPath: repo });
    assert.strictEqual(result.skipped, undefined);
    assert.strictEqual(result.ok, true);
    const dto = buildRepoStorageStatus(repo);
    assert.ok(dto.lastLeaseRefreshAt);
    assert.strictEqual(dto.leaseDataStale, false);
  });
});

report();
