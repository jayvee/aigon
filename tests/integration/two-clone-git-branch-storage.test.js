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

function git(cmd, cwd) {
  execSync(cmd, { cwd, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'ignore' });
}

function bootEvent(id, featureId, at) {
  return { id, type: 'feature.bootstrapped', at, featureId, lifecycle: 'backlog' };
}

function makeStore(repo) {
  return createGitBranchBackend(repo, { remote: 'origin', branch: 'aigon-state', offline: false });
}

function canonicalIds(store, key) {
  return store._readCanonicalEvents(key).map((e) => e.id).sort();
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
  return { bare, cloneA, cloneB };
}

testAsync('two-clone git-branch: distinct-spec events converge with no dupes after both sync', async () => {
  // AC (F609): two clones of one remote, each appending distinct events while the
  // other is unsynced, converge to identical events.jsonl content after both sync.
  await withTempDirAsync('two-clone-branch-', async (base) => {
    const { cloneA, cloneB } = await setupTwoClones(base);

    // A writes F10, B writes F11 — both offline of each other until they sync.
    const storeA = makeStore(cloneA);
    const storeB = makeStore(cloneB);
    await storeA.appendEvent({ entityType: 'feature', entityId: '10' }, bootEvent('evt-f10', '10', '2026-07-01T08:00:00.000Z'));
    await storeB.appendEvent({ entityType: 'feature', entityId: '11' }, bootEvent('evt-f11', '11', '2026-07-01T09:00:00.000Z'));

    // A pushes first; B pushes second (push rejection → fetch/union-merge/re-push).
    assert.strictEqual((await storeA.sync()).ok, true, 'A sync ok');
    assert.strictEqual((await storeB.sync()).ok, true, 'B sync ok (must merge-on-reject)');
    // A pulls B's state.
    assert.strictEqual((await storeA.sync()).ok, true, 'A re-sync ok');

    const storeA2 = makeStore(cloneA);
    const storeB2 = makeStore(cloneB);
    assert.deepStrictEqual(canonicalIds(storeA2, 'F10'), ['evt-f10']);
    assert.deepStrictEqual(canonicalIds(storeA2, 'F11'), ['evt-f11']);
    assert.deepStrictEqual(canonicalIds(storeB2, 'F10'), ['evt-f10']);
    assert.deepStrictEqual(canonicalIds(storeB2, 'F11'), ['evt-f11']);

    // Branch tip content is byte-identical across clones for both specs.
    const tipA = runGit(cloneA, ['rev-parse', 'refs/heads/aigon-state']);
    const tipB = runGit(cloneB, ['rev-parse', 'refs/heads/aigon-state']);
    for (const key of ['F10', 'F11']) {
      const a = runGit(cloneA, ['cat-file', '-p', `${tipA}:specs/${key}/events.jsonl`]);
      const b = runGit(cloneB, ['cat-file', '-p', `${tipB}:specs/${key}/events.jsonl`]);
      assert.strictEqual(a, b, `${key} events.jsonl identical across clones`);
    }
  });
});

testAsync('two-clone git-branch: concurrent appends to the SAME spec union-merge with no dupes', async () => {
  // Harder case: both clones append a distinct event to F20 while unsynced.
  await withTempDirAsync('two-clone-branch-same-', async (base) => {
    const { cloneA, cloneB } = await setupTwoClones(base);
    const ref = { entityType: 'feature', entityId: '20' };

    // Seed a shared base event on A, push, pull to B so both share history.
    const storeA = makeStore(cloneA);
    await storeA.appendEvent(ref, bootEvent('evt-base', '20', '2026-07-01T07:00:00.000Z'));
    await storeA.sync();
    await makeStore(cloneB).sync();

    // Now both append distinct events while unsynced.
    await makeStore(cloneA).appendEvent(ref, bootEvent('evt-a', '20', '2026-07-01T08:00:00.000Z'));
    await makeStore(cloneB).appendEvent(ref, bootEvent('evt-b', '20', '2026-07-01T09:00:00.000Z'));

    await makeStore(cloneA).sync();
    await makeStore(cloneB).sync(); // push rejected → merge evt-a → re-push
    await makeStore(cloneA).sync(); // pull evt-b

    const idsA = canonicalIds(makeStore(cloneA), 'F20');
    const idsB = canonicalIds(makeStore(cloneB), 'F20');
    assert.deepStrictEqual(idsA, ['evt-a', 'evt-b', 'evt-base']);
    assert.deepStrictEqual(idsB, ['evt-a', 'evt-b', 'evt-base']);
    // no duplicates
    assert.strictEqual(new Set(idsA).size, idsA.length, 'no dupes on A');
  });
});

testAsync('two-clone git-branch: health reports backend/branch/remote and converges to ok', async () => {
  await withTempDirAsync('two-clone-branch-health-', async (base) => {
    const { cloneA } = await setupTwoClones(base);
    const store = makeStore(cloneA);
    await store.appendEvent({ entityType: 'feature', entityId: '30' }, bootEvent('evt-h', '30', '2026-07-01T08:00:00.000Z'));
    await store.sync();
    const health = await makeStore(cloneA).health();
    assert.strictEqual(health.backend, 'git-branch');
    assert.strictEqual(health.branch, 'aigon-state');
    assert.strictEqual(health.remote, 'origin');
    assert.strictEqual(health.remoteReachable, true);
    assert.strictEqual(health.health, 'ok', `expected ok after push, got ${health.health}`);
    assert.ok(health.ok);
  });
});

report();
