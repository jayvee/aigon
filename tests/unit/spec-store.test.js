#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, testAsync, report, withTempDirAsync, seedEntityDirs } = require('../_helpers');

const SPEC_STORE_PATH = path.join(__dirname, '../../lib/spec-store/index.js');

function countFsMutations(fn) {
  const counters = { writeFileSync: 0, appendFileSync: 0, mkdirSync: 0, rmSync: 0, renameSync: 0 };
  const originals = {};
  for (const name of Object.keys(counters)) {
    originals[name] = fs[name];
    fs[name] = (...args) => {
      counters[name] += 1;
      return originals[name](...args);
    };
  }
  try {
    fn();
  } finally {
    for (const name of Object.keys(counters)) {
      fs[name] = originals[name];
    }
  }
  return counters;
}

test('require lib/spec-store/index.js performs no filesystem writes', () => {
  // REGRESSION: SpecStore module load must be side-effect free (feature 573 AC).
  delete require.cache[require.resolve(SPEC_STORE_PATH)];
  const counters = countFsMutations(() => {
    require(SPEC_STORE_PATH);
  });
  const total = Object.values(counters).reduce((sum, n) => sum + n, 0);
  assert.strictEqual(total, 0);
});

test('SPEC_STORE_METHODS are all functions on createSpecStore()', () => {
  // REGRESSION: documented interface surface must be complete (feature 573 AC).
  const { createSpecStore, SPEC_STORE_METHODS } = require(SPEC_STORE_PATH);
  const store = createSpecStore({ repoPath: process.cwd() });
  for (const name of SPEC_STORE_METHODS) {
    assert.strictEqual(typeof store[name], 'function', `missing ${name}`);
  }
});

test('spec key format/parse round-trips for F42 and R43', () => {
  // REGRESSION: spec keys must round-trip without coercion (feature 573 AC).
  const { parseSpecKey, formatSpecKey } = require(SPEC_STORE_PATH);
  assert.strictEqual(formatSpecKey(parseSpecKey('F42')), 'F42');
  assert.strictEqual(formatSpecKey(parseSpecKey('R43')), 'R43');
  assert.deepStrictEqual(parseSpecKey('F42'), {
    key: 'F42',
    kind: 'feature',
    letter: 'F',
    number: 42,
  });
});

test('malformed spec keys throw SpecKeyError', () => {
  // REGRESSION: malformed keys must not silently coerce (feature 573 AC).
  const { parseSpecKey, SpecKeyError } = require(SPEC_STORE_PATH);
  for (const bad of ['X1', 'F', 'F0', 'R0', '', '   ']) {
    assert.throws(() => parseSpecKey(bad), SpecKeyError);
  }
});

testAsync('sync and health stubs return documented local shape', async () => {
  const { createSpecStore } = require(SPEC_STORE_PATH);
  const store = createSpecStore({ repoPath: process.cwd() });
  assert.deepStrictEqual(await store.sync(), { ok: true, backend: 'local' });
  assert.deepStrictEqual(await store.health(), { ok: true, backend: 'local' });
});

testAsync('local adapter: missing events/snapshot return empty/null without throw', async () => {
  // REGRESSION: missing workflow files must not throw (feature 576 AC).
  await withTempDirAsync('specstore-missing-', async (repo) => {
    const { createSpecStore } = require(SPEC_STORE_PATH);
    const store = createSpecStore({ repoPath: repo });
    const ref = { entityType: 'feature', entityId: '99' };
    assert.deepStrictEqual(await store.readEvents(ref), []);
    assert.strictEqual(await store.readSnapshot(ref), null);
    assert.deepStrictEqual(store.readEventsSync(ref), []);
    assert.strictEqual(store.readSnapshotSync(ref), null);
  });
});

testAsync('local adapter: append and snapshot write preserve .aigon/workflows layout', async () => {
  // REGRESSION: on-disk layout must stay byte-compatible (feature 576 AC).
  await withTempDirAsync('specstore-io-', async (repo) => {
    const { createSpecStore } = require(SPEC_STORE_PATH);
    const store = createSpecStore({ repoPath: repo });
    const ref = { entityType: 'feature', entityId: '42' };
    const event = { type: 'feature.bootstrapped', at: '2026-06-25T00:00:00.000Z' };
    await store.appendEvent(ref, event);
    const eventsPath = path.join(repo, '.aigon/workflows/features/42/events.jsonl');
    assert.ok(fs.existsSync(eventsPath));
    assert.strictEqual(fs.readFileSync(eventsPath, 'utf8').trim(), JSON.stringify(event));
    const snap = { featureId: '42', lifecycle: 'backlog', currentSpecState: 'backlog' };
    await store.writeSnapshot(ref, snap);
    const snapshotPath = path.join(repo, '.aigon/workflows/features/42/snapshot.json');
    assert.strictEqual(JSON.parse(fs.readFileSync(snapshotPath, 'utf8')).lifecycle, 'backlog');
  });
});

testAsync('local adapter: duplicate append is allowed (append-only log)', async () => {
  // REGRESSION: idempotent re-append must not corrupt the log (feature 576 AC).
  await withTempDirAsync('specstore-dup-', async (repo) => {
    const { createSpecStore } = require(SPEC_STORE_PATH);
    const store = createSpecStore({ repoPath: repo });
    const ref = { entityType: 'feature', entityId: '5' };
    const event = { type: 'test.event', at: '2026-06-25T00:00:00.000Z' };
    await store.appendEvent(ref, event);
    await store.appendEvent(ref, event);
    assert.strictEqual((await store.readEvents(ref)).length, 2);
  });
});

testAsync('local adapter: lock serializes concurrent writers', async () => {
  // REGRESSION: per-spec lock must serialize concurrent persist (feature 576 AC).
  await withTempDirAsync('specstore-lock-', async (repo) => {
    const { createSpecStore } = require(SPEC_STORE_PATH);
    const store = createSpecStore({ repoPath: repo });
    const ref = { entityType: 'feature', entityId: '1' };
    let concurrent = 0;
    let maxConcurrent = 0;
    await Promise.all([1, 2, 3].map((n) => store.lock(ref, async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 25));
      await store.appendEvent(ref, { type: 'test.tick', n, at: '2026-06-25T00:00:00.000Z' });
      concurrent -= 1;
    })));
    assert.strictEqual(maxConcurrent, 1);
    assert.strictEqual((await store.readEvents(ref)).length, 3);
  });
});

testAsync('engine persistence round-trip uses SpecStore and unchanged workflow paths', async () => {
  // REGRESSION: engine must persist via SpecStore without layout migration (feature 576 AC).
  await withTempDirAsync('specstore-engine-', async (repo) => {
    seedEntityDirs(repo, 'features');
    const workflowCore = require('../../lib/workflow-core');
    await workflowCore.ensureEntityBootstrapped(repo, 'feature', '77', 'backlog');
    const eventsPath = path.join(repo, '.aigon/workflows/features/77/events.jsonl');
    const snapshotPath = path.join(repo, '.aigon/workflows/features/77/snapshot.json');
    assert.ok(fs.existsSync(eventsPath));
    assert.ok(fs.existsSync(snapshotPath));
    await workflowCore.persistEntityEvents(repo, 'feature', '77', [
      { type: 'feature.prioritised', at: '2026-06-25T01:00:00.000Z' },
    ]);
    const events = await workflowCore.readEvents(eventsPath);
    assert.ok(events.some((entry) => entry.type === 'feature.prioritised'));
    const shown = await workflowCore.showFeature(repo, '77');
    assert.ok(shown);
  });
});

test('engine.js does not import raw event/snapshot/lock helpers', () => {
  // REGRESSION: migrated engine paths must use SpecStore only (feature 576 AC).
  const engineSrc = fs.readFileSync(path.join(__dirname, '../../lib/workflow-core/engine.js'), 'utf8');
  assert.ok(!engineSrc.includes("require('./event-store')"));
  assert.ok(!engineSrc.includes("require('./snapshot-store')"));
  assert.ok(!engineSrc.includes("require('./lock')"));
});

report();
