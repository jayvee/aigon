#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  testAsync,
  report,
  withTempDirAsync,
  GIT_SAFE_ENV,
} = require('../_helpers');

const { createGitBranchBackend } = require('../../lib/spec-store/git-branch-backend');
const { runGit } = require('../../lib/spec-store/git-plumbing');
const { LeaseConflictError, LeaseUnavailableError, parseLeaseFile } = require('../../lib/spec-store/leases');

function git(cmd, cwd) {
  execSync(cmd, { cwd, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'ignore' });
}

function makeStore(repo, overrides = {}) {
  return createGitBranchBackend(repo, { remote: 'origin', branch: 'aigon-state', offline: false, ...overrides });
}

async function setupTwoClones(base) {
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
  return { bare, cloneA, cloneB };
}

function leaseFileAt(repo, key) {
  const tip = runGit(repo, ['rev-parse', 'refs/heads/aigon-state']);
  let raw = null;
  try { raw = runGit(repo, ['cat-file', '-p', `${tip}:leases/${key}.json`]); } catch (_) { /* absent */ }
  return parseLeaseFile(raw);
}

testAsync('two-clone git-branch CAS: exactly one wins a concurrent acquire race', async () => {
  // AC (F610): two clones race acquireLease for the same key/role concurrently;
  // exactly one ok:true and one LeaseConflictError, one lease record on the branch.
  await withTempDirAsync('cas-lease-race-', async (base) => {
    const { cloneA, cloneB } = await setupTwoClones(base);
    const ref = { entityType: 'feature', entityId: '42' };

    const results = await Promise.allSettled([
      makeStore(cloneA).acquireLease(ref, { role: 'impl', agentId: 'cc', holderId: 'machine-a' }),
      makeStore(cloneB).acquireLease(ref, { role: 'impl', agentId: 'cx', holderId: 'machine-b' }),
    ]);

    const winners = results.filter((r) => r.status === 'fulfilled' && r.value.ok);
    const conflicts = results.filter((r) => r.status === 'rejected' && r.reason instanceof LeaseConflictError);
    assert.strictEqual(winners.length, 1, `expected exactly one winner, got ${winners.length}`);
    assert.strictEqual(conflicts.length, 1, `expected exactly one LeaseConflictError, got ${conflicts.length}: ${results.map((r) => r.status === 'rejected' && r.reason && r.reason.name).join(',')}`);

    // Both clones fetch: the branch holds exactly one lease record for impl.
    await makeStore(cloneA).sync();
    await makeStore(cloneB).sync();
    const mapA = leaseFileAt(cloneA, 'F42');
    const mapB = leaseFileAt(cloneB, 'F42');
    assert.ok(mapA.impl, 'A sees an impl lease');
    assert.deepStrictEqual(mapA, mapB, 'lease file byte-identical across clones');
    assert.ok(['machine-a', 'machine-b'].includes(mapA.impl.holderId));
    assert.ok(['a@team.com', 'b@team.com'].includes(mapA.impl.user), 'user resolved from git identity');
    assert.ok(mapA.impl.expiresAt, 'lease has an expiry');
  });
});

testAsync('git-branch CAS: audit event lands in the same commit as the lease file', async () => {
  await withTempDirAsync('cas-lease-audit-', async (base) => {
    const { cloneA } = await setupTwoClones(base);
    const ref = { entityType: 'feature', entityId: '7' };
    const store = makeStore(cloneA);
    await store.acquireLease(ref, { role: 'impl', agentId: 'cc', holderId: 'machine-a' });

    const tip = runGit(cloneA, ['rev-parse', 'refs/heads/aigon-state']);
    const leaseRaw = runGit(cloneA, ['cat-file', '-p', `${tip}:leases/F7.json`]);
    const eventsRaw = runGit(cloneA, ['cat-file', '-p', `${tip}:specs/F7/events.jsonl`]);
    assert.ok(parseLeaseFile(leaseRaw).impl, 'lease file present at tip');
    const leaseEvents = eventsRaw.split('\n').filter(Boolean).map((l) => JSON.parse(l))
      .filter((e) => e.type === 'lease.acquired');
    assert.strictEqual(leaseEvents.length, 1, 'exactly one lease.acquired audit event in same commit');
  });
});

testAsync('git-branch CAS: renew/takeover/release round-trip through CAS', async () => {
  await withTempDirAsync('cas-lease-rt-', async (base) => {
    const { cloneA, cloneB } = await setupTwoClones(base);
    const ref = { entityType: 'feature', entityId: '9' };

    const acquired = await makeStore(cloneA).acquireLease(ref, { role: 'impl', agentId: 'cc', holderId: 'machine-a' });
    assert.strictEqual(acquired.action, 'acquired');

    // B cannot acquire while A's lease is live, but --takeover records it.
    await assert.rejects(
      () => makeStore(cloneB).acquireLease(ref, { role: 'impl', agentId: 'cx', holderId: 'machine-b' }),
      LeaseConflictError,
    );
    const takeover = await makeStore(cloneB).acquireLease(ref, { role: 'impl', agentId: 'cx', holderId: 'machine-b', takeover: true });
    assert.strictEqual(takeover.action, 'taken_over');
    const afterTakeover = leaseFileAt(cloneB, 'F9');
    assert.strictEqual(afterTakeover.impl.holderId, 'machine-b');
    assert.strictEqual(afterTakeover.impl.priorHolderId, 'machine-a');

    // B releases; the role entry clears.
    const released = await makeStore(cloneB).releaseLease(ref, { role: 'impl', holderId: 'machine-b' });
    assert.strictEqual(released.action, 'released');
    assert.ok(!leaseFileAt(cloneB, 'F9').impl, 'impl entry cleared after release');
  });
});

testAsync('git-branch CAS: offline claim is refused with LeaseUnavailableError', async () => {
  await withTempDirAsync('cas-lease-offline-', async (base) => {
    const { cloneA } = await setupTwoClones(base);
    const ref = { entityType: 'feature', entityId: '3' };
    const store = makeStore(cloneA, { offline: true });
    await assert.rejects(
      () => store.acquireLease(ref, { role: 'impl', agentId: 'cc', holderId: 'machine-a' }),
      LeaseUnavailableError,
    );
    // Release stays offline-tolerant (never blocks feature-close).
    const released = await store.releaseLease(ref, { role: 'impl', holderId: 'machine-a' });
    assert.strictEqual(released.ok, true);
    assert.strictEqual(released.action, 'offline');
  });
});

testAsync('git-branch CAS: an unrelated events push does not masquerade as a conflict', async () => {
  await withTempDirAsync('cas-lease-unrelated-', async (base) => {
    const { cloneA, cloneB } = await setupTwoClones(base);
    // A holds an events-only spec; B acquires a lease on a different key. B's CAS
    // must survive an interleaved events push (unrelated path) via retry, not a conflict.
    await makeStore(cloneA).appendEvent({ entityType: 'feature', entityId: '11' }, {
      id: 'evt-f11', type: 'feature.bootstrapped', at: '2026-07-01T08:00:00.000Z', featureId: '11', lifecycle: 'backlog',
    });
    await makeStore(cloneA).sync();

    const ref = { entityType: 'feature', entityId: '12' };
    const acquired = await makeStore(cloneB).acquireLease(ref, { role: 'impl', agentId: 'cx', holderId: 'machine-b' });
    assert.strictEqual(acquired.action, 'acquired');
    // A's events survive alongside B's lease.
    await makeStore(cloneA).sync();
    assert.ok(leaseFileAt(cloneA, 'F12').impl, 'A sees B lease');
    const tip = runGit(cloneA, ['rev-parse', 'refs/heads/aigon-state']);
    assert.ok(runGit(cloneA, ['cat-file', '-p', `${tip}:specs/F11/events.jsonl`]).includes('evt-f11'), 'F11 events preserved');
  });
});

report();
