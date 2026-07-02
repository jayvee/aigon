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
  runAigonCli,
} = require('../_helpers');

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

function writeProjectionEvents(repo, entityType, entityId, events) {
  const dirName = entityType === 'research' ? 'research' : 'features';
  const eventsDir = path.join(repo, '.aigon', 'workflows', dirName, String(entityId));
  fs.mkdirSync(eventsDir, { recursive: true });
  fs.writeFileSync(
    path.join(eventsDir, 'events.jsonl'),
    events.map((event) => JSON.stringify(event)).join('\n') + '\n',
  );
}

function loadGitRefStore(repo) {
  delete require.cache[require.resolve('../../lib/spec-store/index.js')];
  const { createSpecStore, resolveStorageConfig } = require('../../lib/spec-store/index.js');
  return createSpecStore({ repoPath: repo, storage: resolveStorageConfig(repo) });
}

function ctx(clone, label) {
  return `clone=${label} path=${clone}`;
}

function canonicalIds(store, key) {
  return store._readCanonicalEvents(key).map((event) => event.id).sort();
}

function assertCanonical(clone, label, store, key, expected, phase) {
  const ids = canonicalIds(store, key);
  assert.deepStrictEqual(
    ids,
    expected.sort(),
    `${phase}: ${ctx(clone, label)} key=${key} ref=refs/aigon/specs/${key}/events expected=[${expected}] got=[${ids}]`,
  );
}

async function setupTwoCloneHarness(base) {
  const bare = path.join(base, 'origin.git');
  const seed = path.join(base, 'seed');
  fs.mkdirSync(seed);
  execSync(`git init --bare "${bare}"`, { env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'ignore' });
  git('git init', seed);
  git(`git remote add origin "${bare}"`, seed);
  fs.writeFileSync(path.join(seed, 'README.md'), '# seed\n');
  git('git add README.md', seed);
  git('git commit -m "init"', seed);
  runAigonCli(seed, ['apply'], { extraEnv: cloneEnv(seed, 'seed') });
  git('git add -A', seed);
  git('git commit -m "chore: aigon bootstrap"', seed);
  git('git push -u origin HEAD', seed);

  const cloneA = path.join(base, 'clone-a');
  const cloneB = path.join(base, 'clone-b');
  execSync(`git clone "${bare}" "${cloneA}"`, { env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'ignore' });
  execSync(`git clone "${bare}" "${cloneB}"`, { env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'ignore' });
  runAigonCli(cloneA, ['apply'], { extraEnv: cloneEnv(cloneA, 'machine-a') });
  runAigonCli(cloneB, ['apply'], { extraEnv: cloneEnv(cloneB, 'machine-b') });
  return { bare, cloneA, cloneB };
}

function runStorageSync(repo, label, machineId) {
  const result = runAigonCli(repo, ['storage', 'sync'], { extraEnv: cloneEnv(repo, machineId) });
  assert.ok(
    result.output.includes('Synced git-ref specstore') || result.output.includes('sync skipped'),
    `${ctx(repo, label)} storage sync failed: ${result.output}`,
  );
}

function runStorageConvert(repo, label, machineId) {
  const result = runAigonCli(repo, ['storage', 'convert', '--remote=origin'], { extraEnv: cloneEnv(repo, machineId) });
  assert.ok(
    result.output.includes('Converted to git-ref') || result.output.includes('already configured'),
    `${ctx(repo, label)} storage convert failed: ${result.output}`,
  );
}

testAsync('two-clone git-ref harness: convert, sync, leases, and stats converge', async () => {
  // REGRESSION: two machines sharing one origin must see merged histories, block leases, and converge stats (feature 598 AC).
  await withTempDirAsync('two-clone-harness-', async (base) => {
    const { cloneA, cloneB } = await setupTwoCloneHarness(base);
    const evtF10 = 'evt-f10-boot';
    const evtF11 = 'evt-f11-boot';

    writeProjectionEvents(cloneA, 'feature', '10', [{
      id: evtF10,
      type: 'feature.bootstrapped',
      at: '2026-07-01T08:00:00.000Z',
      featureId: '10',
      lifecycle: 'backlog',
    }]);
    writeProjectionEvents(cloneB, 'feature', '11', [{
      id: evtF11,
      type: 'feature.bootstrapped',
      at: '2026-07-01T09:00:00.000Z',
      featureId: '11',
      lifecycle: 'backlog',
    }]);

    runStorageConvert(cloneA, 'A', 'machine-a');
    runStorageConvert(cloneB, 'B', 'machine-b');

    const storeA = loadGitRefStore(cloneA);
    const storeB = loadGitRefStore(cloneB);
    assertCanonical(cloneA, 'A', storeA, 'F10', [evtF10], 'post-convert');
    assertCanonical(cloneB, 'B', storeB, 'F11', [evtF11], 'post-convert');

    runStorageSync(cloneA, 'A', 'machine-a');
    runStorageSync(cloneB, 'B', 'machine-b');
    runStorageSync(cloneA, 'A', 'machine-a');

    const storeA2 = loadGitRefStore(cloneA);
    const storeB2 = loadGitRefStore(cloneB);
    const expectedBoth = [evtF10, evtF11];
    assertCanonical(cloneA, 'A', storeA2, 'F10', [evtF10], 'post-sync');
    assertCanonical(cloneA, 'A', storeA2, 'F11', [evtF11], 'post-sync');
    assertCanonical(cloneB, 'B', storeB2, 'F10', [evtF10], 'post-sync');
    assertCanonical(cloneB, 'B', storeB2, 'F11', [evtF11], 'post-sync');
    assert.deepStrictEqual(canonicalIds(storeA2, 'F10').concat(canonicalIds(storeA2, 'F11')).sort(), expectedBoth.sort());

    const refF10 = { entityType: 'feature', entityId: '10' };
    await storeA2.acquireLease(refF10, { role: 'impl', agentId: 'cu', holderId: 'machine-a' });
    runStorageSync(cloneA, 'A', 'machine-a');
    runStorageSync(cloneB, 'B', 'machine-b');

    const storeB3 = loadGitRefStore(cloneB);
    const { LeaseConflictError } = require('../../lib/spec-store/leases');
    await assert.rejects(
      () => storeB3.acquireLease(refF10, { role: 'impl', agentId: 'cx', holderId: 'machine-b' }),
      (err) => {
        assert.ok(err instanceof LeaseConflictError, `expected LeaseConflictError on F10 for machine-b, got ${err}`);
        assert.match(err.message, /held by machine-a/i);
        assert.strictEqual(err.activeLease.holderId, 'machine-a');
        return true;
      },
    );

    const takeover = await storeB3.acquireLease(refF10, {
      role: 'impl',
      agentId: 'cx',
      holderId: 'machine-b',
      takeover: true,
    });
    assert.strictEqual(takeover.action, 'taken_over');

    const statsCanonical = require('../../lib/spec-store/stats-canonical');
    const sa = require('../../lib/stats-aggregate');
    await statsCanonical.recordCanonicalStats(cloneA, 'feature', '10', {
      completedAt: '2026-07-02T10:00:00.000Z',
      durationMs: 600000,
      commitCount: 3,
      linesAdded: 90,
      linesRemoved: 4,
      cost: { estimatedUsd: 1.5, byAgent: { cu: { costUsd: 1.5, sessions: 1 } } },
    });
    await statsCanonical.recordCanonicalStats(cloneB, 'feature', '11', {
      completedAt: '2026-07-02T11:00:00.000Z',
      durationMs: 800000,
      commitCount: 5,
      linesAdded: 140,
      linesRemoved: 6,
      cost: { estimatedUsd: 2.0, byAgent: { cx: { costUsd: 2.0, sessions: 2 } } },
    });

    runStorageSync(cloneA, 'A', 'machine-a');
    runStorageSync(cloneB, 'B', 'machine-b');
    runStorageSync(cloneA, 'A', 'machine-a');

    const agA = sa.rebuildAggregate(cloneA);
    const agB = sa.rebuildAggregate(cloneB);
    assert.strictEqual(agA.totals.features, 2, `${ctx(cloneA, 'A')} stats features`);
    assert.strictEqual(agB.totals.features, 2, `${ctx(cloneB, 'B')} stats features`);
    assert.strictEqual(agA.totals.commits, agB.totals.commits, 'stats commits must converge');
    assert.strictEqual(agA.totals.cost, agB.totals.cost, 'stats cost must converge');

    const healthA = await loadGitRefStore(cloneA).health();
    const healthB = await loadGitRefStore(cloneB).health();
    assert.strictEqual(healthA.backend, 'git-ref', `${ctx(cloneA, 'A')} storage status backend`);
    assert.strictEqual(healthB.backend, 'git-ref', `${ctx(cloneB, 'B')} storage status backend`);
    assert.strictEqual(healthA.refPrefix, 'refs/aigon/specs');
    assert.strictEqual(healthB.refPrefix, 'refs/aigon/specs');
  });
});

report();
