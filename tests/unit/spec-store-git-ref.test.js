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

function writeProjectionEvents(repo, entityType, entityId, events) {
  const dirName = entityType === 'research' ? 'research' : 'features';
  const eventsDir = path.join(repo, '.aigon', 'workflows', dirName, String(entityId));
  fs.mkdirSync(eventsDir, { recursive: true });
  fs.writeFileSync(
    path.join(eventsDir, 'events.jsonl'),
    events.map((event) => JSON.stringify(event)).join('\n') + '\n',
  );
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

testAsync('git-ref appendEvent accepts zero-padded workflow ids', async () => {
  // REGRESSION: real feature workflow ids are often zero-padded directory names
  // like "01"; canonical git-ref keys must still be F1 while preserving the
  // caller's local projection path.
  await withTempDirAsync('gitref-padded-append-', async (base) => {
    const { repo } = initRepoWithBareRemote(base);
    const store = loadGitRefStore(repo);
    const ref = { entityType: 'feature', entityId: '01' };
    const event = { id: 'evt-padded', type: 'feature.bootstrapped', at: '2026-06-25T01:30:00.000Z', featureId: '01', lifecycle: 'backlog' };
    await store.appendEvent(ref, event);
    assert.deepStrictEqual(store._readCanonicalEvents('F1').map((entry) => entry.id), ['evt-padded']);
    assert.strictEqual(store.readEventsSync(ref).length, 1);
    assert.ok(fs.existsSync(path.join(repo, '.aigon', 'workflows', 'features', '01', 'events.jsonl')));
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

testAsync('sync imports existing numeric local projection events before pushing', async () => {
  // REGRESSION: enabling git-ref after local workflow history exists must seed refs.
  await withTempDirAsync('gitref-import-local-', async (base) => {
    const { repo } = initRepoWithBareRemote(base);
    const store = loadGitRefStore(repo);
    writeProjectionEvents(repo, 'feature', '12', [
      { id: 'evt-existing', type: 'feature.bootstrapped', at: '2026-06-25T04:00:00.000Z', featureId: '12', lifecycle: 'backlog' },
    ]);
    const result = await store.sync();
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(store._readCanonicalEvents('F12').map((event) => event.id), ['evt-existing']);
  });
});

testAsync('sync imports zero-padded local projection events into canonical keys', async () => {
  // REGRESSION: Aigon workflow directories use padded ids (01) while SpecStore
  // refs use display keys without padding (F1).
  await withTempDirAsync('gitref-import-padded-local-', async (base) => {
    const { repo } = initRepoWithBareRemote(base);
    const store = loadGitRefStore(repo);
    writeProjectionEvents(repo, 'feature', '01', [
      { id: 'evt-existing-padded', type: 'feature.bootstrapped', at: '2026-06-25T04:30:00.000Z', featureId: '01', lifecycle: 'backlog' },
    ]);
    const result = await store.sync();
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(store._readCanonicalEvents('F1').map((event) => event.id), ['evt-existing-padded']);
    assert.strictEqual(store.readEventsSync({ entityType: 'feature', entityId: '01' }).length, 1);
  });
});

testAsync('sync rebuilds peer projection at padded id when no local dir exists', async () => {
  // REGRESSION: peer storage sync must rebuild F1 at workflow dir 01, not 1 (feature 608 AC).
  await withTempDirAsync('gitref-peer-rebuild-padded-', async (base) => {
    const { repo, bare } = initRepoWithBareRemote(base);
    const storeA = loadGitRefStore(repo);
    await storeA.appendEvent(
      { entityType: 'feature', entityId: '01' },
      { id: 'evt-f1-peer', type: 'feature.bootstrapped', at: '2026-07-03T00:00:00.000Z', featureId: '01', lifecycle: 'backlog' },
    );
    await storeA.sync();

    const clone = path.join(base, 'clone');
    execSync(`git clone "${bare}" "${clone}"`, { env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'ignore' });
    fs.mkdirSync(path.join(clone, '.aigon'), { recursive: true });
    fs.writeFileSync(path.join(clone, '.aigon', 'config.json'), fs.readFileSync(path.join(repo, '.aigon', 'config.json'), 'utf8'));

    const unpaddedDir = path.join(clone, '.aigon', 'workflows', 'features', '1');
    const paddedDir = path.join(clone, '.aigon', 'workflows', 'features', '01');
    assert.ok(!fs.existsSync(unpaddedDir));
    assert.ok(!fs.existsSync(paddedDir));

    const storeB = loadGitRefStore(clone);
    await storeB.sync();

    assert.ok(fs.existsSync(path.join(paddedDir, 'events.jsonl')));
    assert.ok(!fs.existsSync(unpaddedDir));
    assert.strictEqual(storeB.readEventsSync({ entityType: 'feature', entityId: '01' }).length, 1);
  });
});

testAsync('git-ref remote may be configured as a URL path', async () => {
  // REGRESSION: remote tracking refs must not embed slash-containing remote URLs.
  await withTempDirAsync('gitref-url-remote-', async (base) => {
    const { repo, bare } = initRepoWithBareRemote(base);
    const configPath = path.join(repo, '.aigon', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.storage.git.remote = bare;
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    const store = loadGitRefStore(repo);
    await store.appendEvent(
      { entityType: 'feature', entityId: '13' },
      { id: 'evt-url', type: 'feature.bootstrapped', at: '2026-06-25T05:00:00.000Z', featureId: '13', lifecycle: 'backlog' },
    );
    const result = await store.sync();
    assert.strictEqual(result.ok, true);
    assert.ok(store._trackingPrefix.startsWith('refs/remotes/url-'));
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

test('stats.recorded event id is deterministic', () => {
  // REGRESSION: duplicate close stats writes must dedupe by stable event id (feature 595 AC).
  const {
    buildStatsRecordedEvent,
    buildStatsEventId,
    STATS_EVENT_TYPE,
  } = require('../../lib/spec-store/stats-canonical');
  const stats = { completedAt: '2026-07-01T10:00:00.000Z', commitCount: 1, cost: { estimatedUsd: 1 } };
  const a = buildStatsRecordedEvent('feature', '7', stats);
  const b = buildStatsRecordedEvent('feature', '7', stats);
  assert.strictEqual(a.id, b.id);
  assert.strictEqual(a.type, STATS_EVENT_TYPE);
  assert.strictEqual(buildStatsEventId('feature', '7', stats), a.id);
});

report();
