#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { test, testAsync, report, withTempDirAsync, GIT_SAFE_ENV } = require('../_helpers');

function initRepoWithBareRemote(base) {
  const bare = path.join(base, 'remote.git');
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  execSync(`git init --bare "${bare}"`, { env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'ignore' });
  execSync('git init', { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'ignore' });
  execSync('git remote add origin ../remote.git', { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV } });
  fs.writeFileSync(path.join(repo, 'README.md'), '# test\n');
  execSync('git add README.md', { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV } });
  execSync('git commit -m "init"', { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV } });
  execSync('git push -u origin HEAD', { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV } });
  fs.mkdirSync(path.join(repo, '.aigon'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.aigon', 'config.json'), `${JSON.stringify({
    storage: {
      backend: 'git-ref',
      git: { remote: 'origin', refPrefix: 'refs/aigon/specs' },
    },
  }, null, 2)}\n`);
  return { repo, bare };
}

function loadStore(repo) {
  delete require.cache[require.resolve('../../lib/spec-store/index.js')];
  const { createSpecStore, resolveStorageConfig } = require('../../lib/spec-store/index.js');
  return createSpecStore({ repoPath: repo, storage: resolveStorageConfig(repo) });
}

test('machine ids are normalized for stable lease holder identity', () => {
  const { normalizeMachineId } = require('../../lib/config');
  assert.strictEqual(normalizeMachineId('VinorgAir.local'), 'vinorgair');
  assert.strictEqual(normalizeMachineId(' My MacBook Pro.local '), 'my-macbook-pro');
  assert.strictEqual(normalizeMachineId('github-machine-A'), 'github-machine-a');
});

test('deriveActiveLease expires by wall clock', () => {
  // REGRESSION: stale leases must not block after TTL (feature 578 AC).
  const { deriveActiveLease, isLeaseExpired } = require('../../lib/spec-store/leases');
  const past = new Date(Date.now() - 60_000).toISOString();
  const events = [{
    id: 'l1',
    type: 'lease.acquired',
    at: past,
    leaseKey: 'F42',
    leaseRole: 'impl',
    holderId: 'machine-a',
    agentId: 'cu',
    acquiredAt: past,
    expiresAt: past,
    renewCount: 0,
  }];
  const active = deriveActiveLease(events, 'F42', 'impl');
  assert.ok(active);
  assert.strictEqual(isLeaseExpired(active), true);
});

testAsync('lease acquire/renew/release round-trip on git-ref backend', async () => {
  // REGRESSION: lease events must append to canonical log and sync (feature 578 AC).
  await withTempDirAsync('lease-roundtrip-', async (base) => {
    const { repo } = initRepoWithBareRemote(base);
    const store = loadStore(repo);
    const ref = { entityType: 'feature', entityId: '42' };
    const holderId = 'test-machine-a-roundtrip';
    const acquired = await store.acquireLease(ref, { role: 'impl', agentId: 'cu', holderId });
    assert.strictEqual(acquired.action, 'acquired');
    const renewed = await store.renewLease(ref, { role: 'impl', agentId: 'cu', holderId });
    assert.ok(['renewed', 'skipped'].includes(renewed.action));
    const released = await store.releaseLease(ref, { role: 'impl', agentId: 'cu', holderId });
    assert.strictEqual(released.action, 'released');
    const leases = await store.readLeases(ref);
    assert.ok(!leases.impl || leases.impl.expired);
  });
});

testAsync('conflicting holder blocks unless takeover', async () => {
  // REGRESSION: active foreign lease must block with actionable error (feature 578 AC).
  await withTempDirAsync('lease-conflict-', async (base) => {
    const { repo } = initRepoWithBareRemote(base);
    const store = loadStore(repo);
    const ref = { entityType: 'feature', entityId: '7' };
    await store.acquireLease(ref, { role: 'impl', agentId: 'cu', holderId: 'machine-a' });
    await assert.rejects(
      () => store.acquireLease(ref, { role: 'impl', agentId: 'cx', holderId: 'machine-b' }),
      /held by/,
    );
    const takeover = await store.acquireLease(ref, { role: 'impl', agentId: 'cx', holderId: 'machine-b', takeover: true });
    assert.strictEqual(takeover.action, 'taken_over');
  });
});

testAsync('idempotent lease events on re-push', async () => {
  // REGRESSION: replaying lease event ids must not duplicate (feature 578 AC).
  await withTempDirAsync('lease-idempotent-', async (base) => {
    const { repo } = initRepoWithBareRemote(base);
    const store = loadStore(repo);
    const ref = { entityType: 'feature', entityId: '8' };
    const { buildLeaseEvent, computeExpiresAt } = require('../../lib/spec-store/leases');
    const event = buildLeaseEvent('lease.acquired', {
      key: 'F8',
      role: 'impl',
      holderId: 'm1',
      agentId: 'cu',
      acquiredAt: new Date().toISOString(),
      expiresAt: computeExpiresAt(),
      renewCount: 0,
    });
    await store.appendEvent(ref, event);
    await store.appendEvent(ref, event);
    const canonical = store._readCanonicalEvents('F8').filter((e) => e.type.startsWith('lease.'));
    assert.strictEqual(canonical.length, 1);
  });
});

testAsync('storage doctor flags expired-but-unreleased lease', async () => {
  // REGRESSION: doctor must surface expired unreleased leases (feature 578 AC).
  await withTempDirAsync('lease-doctor-', async (base) => {
    const { repo } = initRepoWithBareRemote(base);
    const store = loadStore(repo);
    const ref = { entityType: 'feature', entityId: '9' };
    const past = new Date(Date.now() - 60_000).toISOString();
    const { buildLeaseEvent } = require('../../lib/spec-store/leases');
    await store.appendEvent(ref, buildLeaseEvent('lease.acquired', {
      key: 'F9',
      role: 'impl',
      holderId: 'dead-machine',
      agentId: 'cu',
      acquiredAt: past,
      expiresAt: past,
      renewCount: 0,
    }));
    const { runStorageDoctor } = require('../../lib/spec-store/doctor');
    const result = await runStorageDoctor(repo);
    assert.ok(result.issues.some((i) => i.code === 'expired_unreleased_lease'));
  });
});

testAsync('cross-repo report merges specs from two git-ref repos', async () => {
  // REGRESSION: storage report must assemble fetched refs across repos (feature 578 AC).
  await withTempDirAsync('lease-report-', async (base) => {
    fs.mkdirSync(path.join(base, 'a'), { recursive: true });
    fs.mkdirSync(path.join(base, 'b'), { recursive: true });
    const { repo: repoA } = initRepoWithBareRemote(path.join(base, 'a'));
    const { repo: repoB } = initRepoWithBareRemote(path.join(base, 'b'));
    const storeA = loadStore(repoA);
    const storeB = loadStore(repoB);
    await storeA.appendEvent({ entityType: 'feature', entityId: '1' }, {
      id: 'evt-a1', type: 'feature.bootstrapped', at: '2026-06-25T10:00:00.000Z', featureId: '1', lifecycle: 'backlog',
    });
    await storeA.sync();
    await storeB.appendEvent({ entityType: 'feature', entityId: '2' }, {
      id: 'evt-b2', type: 'feature.bootstrapped', at: '2026-06-25T11:00:00.000Z', featureId: '2', lifecycle: 'backlog',
    });
    await storeB.sync();
    const { runStorageReport } = require('../../lib/spec-store/report');
    const report = await runStorageReport({ repos: [repoA, repoB] });
    const keys = report.specs.map((s) => s.key).sort();
    assert.deepStrictEqual(keys, ['F1', 'F2']);
  });
});

report();
