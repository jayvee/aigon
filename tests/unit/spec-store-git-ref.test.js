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

function loadGitRefStore(repo) {
  delete require.cache[require.resolve('../../lib/spec-store/index.js')];
  delete require.cache[require.resolve('../../lib/workflow-core/engine.js')];
  const { createSpecStore, resolveStorageConfig } = require('../../lib/spec-store/index.js');
  const storage = resolveStorageConfig(repo);
  return createSpecStore({ repoPath: repo, storage });
}

test('git-ref events ref uses key-addressed naming', () => {
  // REGRESSION: canonical refs must live under refPrefix/<key>/events (feature 577 AC).
  const { createGitRefBackend } = require('../../lib/spec-store/git-ref-backend');
  const store = createGitRefBackend(process.cwd(), { remote: 'origin', refPrefix: 'refs/aigon/specs' });
  assert.strictEqual(store._eventsRefForKey('F42'), 'refs/aigon/specs/F42/events');
});

test('event payload round-trips through serialize/parse', () => {
  // REGRESSION: versioned event payload must survive git blob round-trip (feature 577 AC).
  const { serializeEventsPayload, parseEventsPayload } = require('../../lib/spec-store/event-merge');
  const events = [{ id: 'evt-1', type: 'feature.bootstrapped', at: '2026-06-25T00:00:00.000Z' }];
  const parsed = parseEventsPayload(serializeEventsPayload(events));
  assert.deepStrictEqual(parsed, events);
});

testAsync('git-ref appendEvent is idempotent by event id', async () => {
  // REGRESSION: replaying a known event id must not duplicate canonical events (feature 577 AC).
  await withTempDirAsync('gitref-idempotent-', async (base) => {
    const { repo } = initRepoWithBareRemote(base);
    const store = loadGitRefStore(repo);
    const ref = { entityType: 'feature', entityId: '42' };
    const event = { id: 'evt-dup', type: 'feature.bootstrapped', at: '2026-06-25T00:00:00.000Z' };
    await store.appendEvent(ref, event);
    await store.appendEvent(ref, event);
    const canonical = store._readCanonicalEvents('F42');
    assert.strictEqual(canonical.length, 1);
    assert.strictEqual(store.readEventsSync(ref).length, 1);
  });
});

testAsync('sync reads resolve from local projection without network', async () => {
  // REGRESSION: readEventsSync/readSnapshotSync must not call git fetch (feature 577 AC).
  await withTempDirAsync('gitref-syncread-', async (base) => {
    const { repo } = initRepoWithBareRemote(base);
    const store = loadGitRefStore(repo);
    const ref = { entityType: 'feature', entityId: '7' };
    const event = { id: 'evt-local', type: 'feature.bootstrapped', at: '2026-06-25T01:00:00.000Z', featureId: '7', lifecycle: 'inbox' };
    await store.appendEvent(ref, event);
    const configPath = path.join(repo, '.aigon', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.storage.git.remote = 'definitely-not-a-real-remote';
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    const readStore = loadGitRefStore(repo);
    assert.strictEqual(readStore.readEventsSync(ref).length, 1);
    assert.ok(readStore.readSnapshotSync(ref));
  });
});

testAsync('push rejection merges by event id and retries', async () => {
  // REGRESSION: non-ff push must fetch, union-merge on event id, and retry (feature 577 AC).
  await withTempDirAsync('gitref-merge-', async (base) => {
    const { repo, bare } = initRepoWithBareRemote(base);
    const clone = path.join(base, 'clone');
    execSync(`git clone "${bare}" "${clone}"`, { env: { ...process.env, ...GIT_SAFE_ENV } });
    fs.mkdirSync(path.join(clone, '.aigon'), { recursive: true });
    fs.writeFileSync(path.join(clone, '.aigon', 'config.json'), fs.readFileSync(path.join(repo, '.aigon', 'config.json'), 'utf8'));

    const storeA = loadGitRefStore(repo);
    const storeB = loadGitRefStore(clone);
    const ref = { entityType: 'feature', entityId: '99' };
    await storeA.appendEvent(ref, { id: 'evt-a', type: 'feature.bootstrapped', at: '2026-06-25T02:00:00.000Z', featureId: '99', lifecycle: 'inbox' });
    await storeB.appendEvent(ref, { id: 'evt-b', type: 'feature.prioritised', at: '2026-06-25T03:00:00.000Z', featureId: '99' });

    const pushA = await storeA.sync();
    const pushB = await storeB.sync();
    assert.strictEqual(pushA.ok, true);
    assert.strictEqual(pushB.ok, true);
    await storeA.sync();

    const mergedOnA = storeA._readCanonicalEvents('F99').map((e) => e.id).sort();
    assert.deepStrictEqual(mergedOnA, ['evt-a', 'evt-b']);
  });
});

testAsync('aigon storage status reports git-ref health fields', async () => {
  // REGRESSION: storage status must expose backend, remote, prefix, sync metadata (feature 577 AC).
  await withTempDirAsync('gitref-status-', async (base) => {
    const { repo } = initRepoWithBareRemote(base);
    const store = loadGitRefStore(repo);
    const health = await store.health();
    assert.strictEqual(health.backend, 'git-ref');
    assert.strictEqual(health.remote, 'origin');
    assert.strictEqual(health.refPrefix, 'refs/aigon/specs');
    assert.ok(Object.prototype.hasOwnProperty.call(health, 'ahead'));
    assert.ok(Object.prototype.hasOwnProperty.call(health, 'behind'));
  });
});

report();
