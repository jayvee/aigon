#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { withTempDirAsync } = require('../_helpers');
const {
  bootEvent,
  makeStore,
  makeStoreFromConfig,
  ctx,
  canonicalIds,
  leaseFileAt,
  assertHarnessAsync,
  setupTwoCloneHarness,
  forkAcquireLease,
  forkReserveIdentity,
  git,
} = require('./two-clone-git-branch-harness');
const { setCasTestHooks, clearCasTestHooks } = require('../../lib/spec-store/git-branch-leases');
const {
  IdentityUnavailableError,
} = require('../../lib/spec-store/identity-sequences');
const {
  LeaseConflictError,
  LeaseUnavailableError,
  setLeaseNowForTests,
  clearLeaseNowForTests,
} = require('../../lib/spec-store/leases');
const statsCanonical = require('../../lib/spec-store/stats-canonical');
const sa = require('../../lib/stats-aggregate');
const { runStorageDoctor } = require('../../lib/spec-store/doctor');
const { runGit } = require('../../lib/spec-store/git-plumbing');
const engine = require('../../lib/workflow-core/engine');
const { pollOnce } = require('../../lib/storage-poller');
const { collectRepoStatus, clearTierCache } = require('../../lib/dashboard-status-collector');
const { captureGitRepoState, assertGitRepoStateUnchanged } = require('../git-repo-state');

function liveLeaseClock() {
  clearLeaseNowForTests();
  setLeaseNowForTests(Date.parse('2026-07-01T12:00:00.000Z'));
}

async function runCase(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.error(`  ✗ ${name}\n    ${error.stack || error.message}`);
    return false;
  }
}

async function main() {
  let failed = 0;

  if (!await runCase('two-clone git-branch harness: distinct-spec events converge with no dupes', async () => {
    await withTempDirAsync('two-clone-branch-', async (base) => {
      const { cloneA, cloneB } = await setupTwoCloneHarness(base);
      const harness = { cloneA, cloneB };
      await assertHarnessAsync('event-convergence-distinct-spec', harness, async () => {
        const storeA = makeStore(cloneA);
        const storeB = makeStore(cloneB);
        await storeA.appendEvent({ entityType: 'feature', entityId: '10' }, bootEvent('evt-f10', '10', '2026-07-01T08:00:00.000Z'));
        await storeB.appendEvent({ entityType: 'feature', entityId: '11' }, bootEvent('evt-f11', '11', '2026-07-01T09:00:00.000Z'));
        assert.strictEqual((await storeA.sync()).ok, true);
        assert.strictEqual((await storeB.sync()).ok, true);
        assert.strictEqual((await storeA.sync()).ok, true);
        const idsA = canonicalIds(makeStore(cloneA), 'F10').concat(canonicalIds(makeStore(cloneA), 'F11')).sort();
        const idsB = canonicalIds(makeStore(cloneB), 'F10').concat(canonicalIds(makeStore(cloneB), 'F11')).sort();
        assert.deepStrictEqual(idsA, ['evt-f10', 'evt-f11']);
        assert.deepStrictEqual(idsB, idsA);
      });
    });
  })) failed += 1;

  if (!await runCase('two-clone git-branch harness: same-spec concurrent appends union-merge with no dupes', async () => {
    await withTempDirAsync('two-clone-branch-same-', async (base) => {
      const { cloneA, cloneB } = await setupTwoCloneHarness(base);
      const ref = { entityType: 'feature', entityId: '20' };
      const storeA = makeStore(cloneA);
      await storeA.appendEvent(ref, bootEvent('evt-base', '20', '2026-07-01T07:00:00.000Z'));
      await storeA.sync();
      await makeStore(cloneB).sync();
      await makeStore(cloneA).appendEvent(ref, bootEvent('evt-a', '20', '2026-07-01T08:00:00.000Z'));
      await makeStore(cloneB).appendEvent(ref, bootEvent('evt-b', '20', '2026-07-01T09:00:00.000Z'));
      await makeStore(cloneA).sync();
      await makeStore(cloneB).sync();
      await makeStore(cloneA).sync();
      const ids = ['evt-a', 'evt-b', 'evt-base'];
      assert.deepStrictEqual(canonicalIds(makeStore(cloneA), 'F20'), ids);
      assert.deepStrictEqual(canonicalIds(makeStore(cloneB), 'F20'), ids);
    });
  })) failed += 1;

  if (!await runCase('two-clone git-branch harness: parallel acquire race has exactly one winner', async () => {
    liveLeaseClock();
    try {
      await withTempDirAsync('two-clone-race-parallel-', async (base) => {
        const { cloneA, cloneB } = await setupTwoCloneHarness(base);
        const harness = { cloneA, cloneB, key: 'F42' };
        await assertHarnessAsync('race-one-winner-parallel', harness, async () => {
          const [a, b] = await Promise.all([
            forkAcquireLease(cloneA, 'machine-a', '42', 'machine-a', 'cc'),
            forkAcquireLease(cloneB, 'machine-b', '42', 'machine-b', 'cx'),
          ]);
          const winners = [a, b].filter((r) => r.ok);
          const conflicts = [a, b].filter((r) => !r.ok && r.error === 'LeaseConflictError');
          assert.strictEqual(winners.length, 1, `expected one winner, got ${JSON.stringify([a, b])}`);
          assert.strictEqual(conflicts.length, 1);
          assert.strictEqual(conflicts[0].holderId, winners[0].holderId, 'conflict must name the winner');
          await makeStore(cloneA).sync();
          await makeStore(cloneB).sync();
          const map = leaseFileAt(cloneA, 'F42');
          assert.ok(map.impl);
          assert.deepStrictEqual(map, leaseFileAt(cloneB, 'F42'));
          const leaseEvents = makeStore(cloneA)._readCanonicalEvents('F42').filter((e) => e.type && e.type.startsWith('lease.'));
          assert.ok(leaseEvents.length >= 1, 'coherent lease audit trail');
          const tip = runGit(cloneA, ['rev-parse', 'refs/heads/aigon-state']);
          const rawLease = runGit(cloneA, ['cat-file', '-p', `${tip}:leases/F42.json`]);
          const rawEvents = runGit(cloneA, ['cat-file', '-p', `${tip}:specs/F42/events.jsonl`]);
          assert.ok(rawLease.length > 0, 'lease file present at branch tip');
          const acqAtTip = rawEvents.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.type === 'lease.acquired');
          assert.ok(acqAtTip.length >= 1, 'lease.acquired event in same branch commit as lease file');
        });
      });
    } finally {
      clearLeaseNowForTests();
    }
  })) failed += 1;

  if (!await runCase('two-clone git-branch harness: unrelated events push retries claim without false conflict', async () => {
    liveLeaseClock();
    try {
      await withTempDirAsync('two-clone-retry-unrelated-', async (base) => {
        const { cloneA, cloneB } = await setupTwoCloneHarness(base);
        const ref = { entityType: 'feature', entityId: '44' };
        const harness = { cloneA, cloneB, key: 'F44' };
        let hooked = false;
        setCasTestHooks({
          afterFetch: async ({ repoPath }) => {
            if (repoPath !== cloneA || hooked) return;
            hooked = true;
            await makeStore(cloneB).appendEvent({ entityType: 'feature', entityId: '55' }, bootEvent('evt-f55', '55', '2026-07-01T10:00:00.000Z'));
            await makeStore(cloneB).sync();
          },
        });
        try {
          await assertHarnessAsync('retry-on-unrelated-change', harness, async () => {
            const acquired = await makeStore(cloneA).acquireLease(ref, { role: 'impl', agentId: 'cc', holderId: 'machine-a' });
            assert.strictEqual(acquired.action, 'acquired');
            assert.ok(leaseFileAt(cloneA, 'F44').impl);
            assert.ok(canonicalIds(makeStore(cloneA), 'F55').includes('evt-f55'));
          });
        } finally {
          clearCasTestHooks();
        }
      });
    } finally {
      clearLeaseNowForTests();
    }
  })) failed += 1;

  if (!await runCase('two-clone git-branch harness: expired lease reclaim via injected clock', async () => {
    await withTempDirAsync('two-clone-expiry-', async (base) => {
      const { cloneA, cloneB } = await setupTwoCloneHarness(base);
      const ref = { entityType: 'feature', entityId: '45' };
      const harness = { cloneA, cloneB, key: 'F45' };
      const t0 = Date.parse('2026-07-01T12:00:00.000Z');
      setLeaseNowForTests(t0);
      try {
        await makeStore(cloneA).acquireLease(ref, { role: 'impl', agentId: 'cc', holderId: 'machine-a', ttlMs: 60_000 });
        setLeaseNowForTests(t0 + 120_000);
        await assertHarnessAsync('expiry-reclaim', harness, async () => {
          const reclaimed = await makeStore(cloneB).acquireLease(ref, { role: 'impl', agentId: 'cx', holderId: 'machine-b' });
          assert.strictEqual(reclaimed.action, 'acquired');
          assert.strictEqual(leaseFileAt(cloneB, 'F45').impl.holderId, 'machine-b');
          const events = makeStore(cloneB)._readCanonicalEvents('F45').filter((e) => e.type && e.type.startsWith('lease.'));
          assert.ok(events.some((e) => e.type === 'lease.acquired'));
        });
      } finally {
        clearLeaseNowForTests();
      }
    });
  })) failed += 1;

  if (!await runCase('two-clone git-branch harness: takeover records priorHolder and concurrent renew has one winner', async () => {
    liveLeaseClock();
    try {
      await withTempDirAsync('two-clone-takeover-', async (base) => {
        const { cloneA, cloneB } = await setupTwoCloneHarness(base);
        const ref = { entityType: 'feature', entityId: '46' };
        await makeStore(cloneA).acquireLease(ref, { role: 'impl', agentId: 'cc', holderId: 'machine-a' });
        await makeStore(cloneB).fetchRemoteProjection();
        assert.strictEqual(leaseFileAt(cloneB, 'F46').impl.holderId, 'machine-a', 'B must see A lease before takeover');
        const takeover = await makeStore(cloneB).acquireLease(ref, {
          role: 'impl', agentId: 'cx', holderId: 'machine-b', takeover: true,
        });
        assert.strictEqual(takeover.action, 'taken_over');
        assert.strictEqual(leaseFileAt(cloneB, 'F46').impl.priorHolderId, 'machine-a');
        const results = await Promise.allSettled([
          makeStore(cloneA).renewLease(ref, { role: 'impl', holderId: 'machine-a', agentId: 'cc' }),
          makeStore(cloneB).renewLease(ref, { role: 'impl', holderId: 'machine-b', agentId: 'cx' }),
        ]);
        const ok = results.filter((r) => r.status === 'fulfilled' && r.value.ok);
        const rejected = results.filter((r) => r.status === 'rejected');
        assert.ok(ok.length >= 1);
        assert.ok(ok.length + rejected.length === 2);
        if (rejected.length) assert.ok(rejected[0].reason instanceof LeaseConflictError);
      });
    } finally {
      clearLeaseNowForTests();
    }
  })) failed += 1;

  if (!await runCase('two-clone git-branch harness: unreachable remote refuses acquire', async () => {
    liveLeaseClock();
    try {
      await withTempDirAsync('two-clone-unreachable-', async (base) => {
        const { cloneA } = await setupTwoCloneHarness(base);
        git('git remote set-url origin /dev/null/unreachable-remote', cloneA);
        await assert.rejects(
          () => makeStore(cloneA).acquireLease({ entityType: 'feature', entityId: '52' }, {
            role: 'impl', agentId: 'cc', holderId: 'machine-a',
          }),
          LeaseUnavailableError,
        );
      });
    } finally {
      clearLeaseNowForTests();
    }
  })) failed += 1;

  if (!await runCase('two-clone git-branch harness: offline refuses acquire but allows local append and later sync', async () => {
    await withTempDirAsync('two-clone-offline-', async (base) => {
      const { cloneA, cloneB } = await setupTwoCloneHarness(base);
      const ref = { entityType: 'feature', entityId: '47' };
      const offlineStore = makeStore(cloneA, { offline: true });
      await assert.rejects(
        () => offlineStore.acquireLease(ref, { role: 'impl', agentId: 'cc', holderId: 'machine-a' }),
        LeaseUnavailableError,
      );
      await offlineStore.appendEvent(ref, bootEvent('evt-offline', '47', '2026-07-01T08:00:00.000Z'));
      assert.deepStrictEqual(canonicalIds(offlineStore, 'F47'), ['evt-offline']);
      const prev = process.env.AIGON_STORAGE_OFFLINE;
      process.env.AIGON_STORAGE_OFFLINE = '1';
      try {
        await assert.rejects(
          () => makeStoreFromConfig(cloneB).acquireLease(ref, { role: 'impl', agentId: 'cx', holderId: 'machine-b' }),
          LeaseUnavailableError,
        );
      } finally {
        if (prev === undefined) delete process.env.AIGON_STORAGE_OFFLINE;
        else process.env.AIGON_STORAGE_OFFLINE = prev;
      }
      assert.strictEqual((await makeStore(cloneA).sync()).ok, true);
      await makeStore(cloneB).sync();
      assert.deepStrictEqual(canonicalIds(makeStore(cloneB), 'F47'), ['evt-offline']);
    });
  })) failed += 1;

  if (!await runCase('two-clone git-branch harness: events and stats converge under contention', async () => {
    await withTempDirAsync('two-clone-stats-', async (base) => {
      const { cloneA, cloneB } = await setupTwoCloneHarness(base);
      await makeStore(cloneA).appendEvent({ entityType: 'feature', entityId: '50' }, bootEvent('evt-f50', '50', '2026-07-01T08:00:00.000Z'));
      await makeStore(cloneB).appendEvent({ entityType: 'feature', entityId: '51' }, bootEvent('evt-f51', '51', '2026-07-01T09:00:00.000Z'));
      await makeStore(cloneA).sync();
      await makeStore(cloneB).sync();
      await makeStore(cloneA).sync();
      await statsCanonical.recordCanonicalStats(cloneA, 'feature', '50', {
        completedAt: '2026-07-02T10:00:00.000Z', durationMs: 600000, commitCount: 3,
        linesAdded: 90, linesRemoved: 4, cost: { estimatedUsd: 1.5, byAgent: { cu: { costUsd: 1.5, sessions: 1 } } },
      });
      await statsCanonical.recordCanonicalStats(cloneB, 'feature', '51', {
        completedAt: '2026-07-02T11:00:00.000Z', durationMs: 800000, commitCount: 5,
        linesAdded: 140, linesRemoved: 6, cost: { estimatedUsd: 2.0, byAgent: { cx: { costUsd: 2.0, sessions: 2 } } },
      });
      await makeStore(cloneA).sync();
      await makeStore(cloneB).sync();
      await makeStore(cloneA).sync();
      const agA = sa.rebuildAggregate(cloneA);
      const agB = sa.rebuildAggregate(cloneB);
      assert.strictEqual(agA.totals.features, 2);
      assert.strictEqual(agB.totals.features, 2);
      assert.strictEqual(agA.totals.commits, agB.totals.commits);
      assert.strictEqual(agA.totals.cost, agB.totals.cost);
      assert.deepStrictEqual(
        canonicalIds(makeStore(cloneA), 'F50').concat(canonicalIds(makeStore(cloneA), 'F51')).sort(),
        canonicalIds(makeStore(cloneB), 'F50').concat(canonicalIds(makeStore(cloneB), 'F51')).sort(),
      );
    });
  })) failed += 1;

  if (!await runCase('two-clone git-branch harness: crash windows self-recover on next sync', async () => {
    liveLeaseClock();
    try {
      await withTempDirAsync('two-clone-crash-', async (base) => {
        const { cloneA } = await setupTwoCloneHarness(base);
        const ref = { entityType: 'feature', entityId: '48' };
        setCasTestHooks({
          beforePush: async ({ repoPath }) => {
            if (repoPath === cloneA) {
              const err = new Error('simulated crash before push');
              err.simulatedCrash = true;
              throw err;
            }
          },
        });
        try {
          await assert.rejects(
            () => makeStore(cloneA).acquireLease(ref, { role: 'impl', agentId: 'cc', holderId: 'machine-a' }),
            (err) => err.simulatedCrash === true,
          );
          clearCasTestHooks();
          const recovered = await makeStore(cloneA).acquireLease(ref, { role: 'impl', agentId: 'cc', holderId: 'machine-a' });
          assert.ok(recovered.ok);
          assert.ok(['acquired', 'skipped', 'renewed'].includes(recovered.action), `recovery action: ${recovered.action}`);
          assert.strictEqual((await makeStore(cloneA).sync()).ok, true);
          assert.ok(leaseFileAt(cloneA, 'F48').impl, 'lease published after recovery sync');
          const doctor = await runStorageDoctor(cloneA, { fix: false });
          assert.ok(!doctor.issues.some((i) => i.severity === 'error'), `${ctx(cloneA, 'A')} doctor errors: ${JSON.stringify(doctor.issues)}`);
        } finally {
          clearCasTestHooks();
        }

        setCasTestHooks({
          afterPushBeforeProjection: async ({ repoPath }) => {
            if (repoPath === cloneA) {
              const err = new Error('simulated crash before projection');
              err.simulatedCrash = true;
              throw err;
            }
          },
        });
        try {
          const ref2 = { entityType: 'feature', entityId: '49' };
          await assert.rejects(
            () => makeStore(cloneA).acquireLease(ref2, { role: 'impl', agentId: 'cc', holderId: 'machine-a' }),
            LeaseUnavailableError,
          );
          clearCasTestHooks();
          await makeStore(cloneA).fetchRemoteProjection();
          assert.ok(leaseFileAt(cloneA, 'F49').impl, 'projection rebuilt after push-only crash');
        } finally {
          clearCasTestHooks();
        }
      });
    } finally {
      clearLeaseNowForTests();
    }
  })) failed += 1;

  if (!await runCase('two-clone git-branch harness: releaseLease clears the role entry via CAS', async () => {
    liveLeaseClock();
    try {
      await withTempDirAsync('two-clone-release-', async (base) => {
        const { cloneA } = await setupTwoCloneHarness(base);
        const ref = { entityType: 'feature', entityId: '60' };
        const acquired = await makeStore(cloneA).acquireLease(ref, { role: 'impl', agentId: 'cc', holderId: 'machine-a' });
        assert.strictEqual(acquired.action, 'acquired');
        const released = await makeStore(cloneA).releaseLease(ref, { role: 'impl', holderId: 'machine-a' });
        assert.strictEqual(released.action, 'released');
        assert.strictEqual(released.ok, true);
        assert.ok(!leaseFileAt(cloneA, 'F60').impl, 'impl entry cleared after release');
      });
    } finally {
      clearLeaseNowForTests();
    }
  })) failed += 1;

  if (!await runCase('two-clone git-branch harness: close-releases writes lease.released audit event', async () => {
    liveLeaseClock();
    const prevMachine = process.env.AIGON_MACHINE_ID;
    process.env.AIGON_MACHINE_ID = 'machine-a';
    try {
      await withTempDirAsync('two-clone-close-release-', async (base) => {
        const { cloneA } = await setupTwoCloneHarness(base);
        const ref = { entityType: 'feature', entityId: '61' };
        const store = makeStore(cloneA);
        await store.acquireLease(ref, { role: 'impl', agentId: 'cc' });
        await store.acquireLease(ref, { role: 'close', agentId: 'cc' });
        const { releaseLeasesAfterClose } = require('../../lib/spec-store/lease-coordination');
        await releaseLeasesAfterClose(store, ref, 'feature', 'cc');
        assert.ok(!leaseFileAt(cloneA, 'F61').impl, 'impl cleared after close release path');
        assert.ok(!leaseFileAt(cloneA, 'F61').close, 'close cleared after close release path');
        const events = store._readCanonicalEvents('F61').filter((e) => e.type === 'lease.released');
        assert.ok(events.length >= 2, 'lease.released audit events recorded');
        const tip = runGit(cloneA, ['rev-parse', 'refs/heads/aigon-state']);
        const rawEvents = runGit(cloneA, ['cat-file', '-p', `${tip}:specs/F61/events.jsonl`]);
        assert.ok(rawEvents.includes('lease.released'), 'lease.released in branch tip events');
      });
    } finally {
      if (prevMachine === undefined) delete process.env.AIGON_MACHINE_ID;
      else process.env.AIGON_MACHINE_ID = prevMachine;
      clearLeaseNowForTests();
    }
  })) failed += 1;

  if (!await runCase('two-clone git-branch harness: reset-releases clears impl lease', async () => {
    liveLeaseClock();
    const prevMachine = process.env.AIGON_MACHINE_ID;
    process.env.AIGON_MACHINE_ID = 'machine-a';
    try {
      await withTempDirAsync('two-clone-reset-release-', async (base) => {
        const { cloneA } = await setupTwoCloneHarness(base);
        const ref = { entityType: 'feature', entityId: '63' };
        const store = makeStore(cloneA);
        await store.acquireLease(ref, { role: 'impl', agentId: 'cc' });
        const { releaseLeasesAfterResetOrPause } = require('../../lib/spec-store/lease-coordination');
        await releaseLeasesAfterResetOrPause(store, ref, 'feature', 'cc');
        assert.ok(!leaseFileAt(cloneA, 'F63').impl, 'impl cleared after reset release path');
      });
    } finally {
      if (prevMachine === undefined) delete process.env.AIGON_MACHINE_ID;
      else process.env.AIGON_MACHINE_ID = prevMachine;
      clearLeaseNowForTests();
    }
  })) failed += 1;

  if (!await runCase('two-clone git-branch harness: non-holder release leaves lease intact', async () => {
    liveLeaseClock();
    try {
      await withTempDirAsync('two-clone-not-holder-', async (base) => {
        const { cloneA, cloneB } = await setupTwoCloneHarness(base);
        const ref = { entityType: 'feature', entityId: '64' };
        await makeStore(cloneA).acquireLease(ref, { role: 'impl', agentId: 'cc', holderId: 'machine-a' });
        await makeStore(cloneB).sync();
        const result = await makeStore(cloneB).releaseLease(ref, { role: 'impl', holderId: 'machine-b', agentId: 'cx' });
        assert.strictEqual(result.action, 'not_holder');
        assert.strictEqual(result.ok, false);
        assert.strictEqual(leaseFileAt(cloneB, 'F64').impl.holderId, 'machine-a');
      });
    } finally {
      clearLeaseNowForTests();
    }
  })) failed += 1;

  if (!await runCase('two-clone git-branch harness: remote lifecycle projection does not mutate checkout git state', async () => {
    await withTempDirAsync('two-clone-readonly-proj-', async (base) => {
      const { cloneA, cloneB } = await setupTwoCloneHarness(base);
      const featureId = '70';
      const backlogDir = 'docs/specs/features/02-backlog';
      const specName = 'feature-70-readonly-projection.md';
      for (const clone of [cloneA, cloneB]) {
        fs.mkdirSync(path.join(clone, backlogDir), { recursive: true });
        fs.writeFileSync(path.join(clone, backlogDir, specName), '# Feature: readonly projection\n');
        git('git add docs', clone);
        git('git commit -m "add feature 70 spec"', clone);
      }
      git('git push origin HEAD', cloneA);
      git('git pull origin HEAD', cloneB);

      const specPathA = path.join(cloneA, backlogDir, specName);
      engine.ensureEntityBootstrappedSync(cloneA, 'feature', featureId, 'backlog', specPathA, { authorAgentId: 'cc' });
      await engine.startFeature(cloneA, featureId, 'solo_branch', ['cc']);
      await makeStore(cloneA).sync();

      const specPathB = path.join(cloneB, backlogDir, specName);
      engine.ensureEntityBootstrappedSync(cloneB, 'feature', featureId, 'backlog', specPathB, { authorAgentId: 'cc' });
      assert.ok(fs.existsSync(specPathB), 'clone B spec should remain in backlog');

      const before = captureGitRepoState(cloneB);
      await makeStore(cloneB).fetchRemoteProjection();
      assertGitRepoStateUnchanged(before, captureGitRepoState(cloneB), 'fetchRemoteProjection');

      const beforePoll = captureGitRepoState(cloneB);
      const pollResult = await pollOnce({ repoPath: cloneB });
      assert.strictEqual(pollResult.ok, true);
      assertGitRepoStateUnchanged(beforePoll, captureGitRepoState(cloneB), 'storage poller fetch');

      const snapshotPath = path.join(cloneB, '.aigon/workflows/features/70/snapshot.json');
      assert.ok(fs.existsSync(snapshotPath), 'projection snapshot should exist on peer');
      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      assert.strictEqual(snapshot.currentSpecState, 'implementing', 'peer projection should reflect remote lifecycle');

      clearTierCache(cloneB);
      const status = collectRepoStatus(cloneB, { summary: { total: 0 } });
      const feature = (status.features || []).find((f) => String(f.id) === featureId);
      assert.ok(feature, 'feature 70 missing from peer collector');
      assert.ok(feature.specDrift, 'stale backlog folder should surface drift, not a missing row');
      assert.strictEqual(feature.stage, 'in-progress');
    });
  })) failed += 1;

  // REGRESSION: F667 git-branch identity CAS assigns distinct feature ids across clones.
  if (!await runCase('two-clone git-branch: parallel feature identity reservations are distinct', async () => {
    await withTempDirAsync('two-clone-id-feature-', async (base) => {
      const { cloneA, cloneB } = await setupTwoCloneHarness(base);
      const [a, b] = await Promise.all([
        forkReserveIdentity(cloneA, 'machine-a', 'feature'),
        forkReserveIdentity(cloneB, 'machine-b', 'feature'),
      ]);
      assert.ok(a.ok && b.ok, JSON.stringify({ a, b }));
      assert.notStrictEqual(a.reserved.number, b.reserved.number);
      await makeStore(cloneA).sync();
      await makeStore(cloneB).sync();
      const tip = runGit(cloneA, ['rev-parse', 'refs/heads/aigon-state']);
      const raw = runGit(cloneA, ['cat-file', '-p', `${tip}:identity/sequences.json`]);
      const doc = JSON.parse(raw);
      assert.ok(doc.feature.next > Math.max(a.reserved.number, b.reserved.number));
    });
  })) failed += 1;

  // REGRESSION: F667 offline git-branch create refuses to invent a numeric id locally.
  if (!await runCase('two-clone git-branch: offline storage refuses identity reservation', async () => {
    await withTempDirAsync('two-clone-id-offline-', async (base) => {
      const { cloneA } = await setupTwoCloneHarness(base);
      const store = makeStore(cloneA, { offline: true });
      assert.throws(() => store.reserveIdentitySync('feature'), (error) => error instanceof IdentityUnavailableError);
    });
  })) failed += 1;

  // REGRESSION: F667 abandoned reservations remain pending and are never reused.
  if (!await runCase('two-clone git-branch: pending reservation leaves a gap without reuse', async () => {
    await withTempDirAsync('two-clone-id-pending-', async (base) => {
      const { cloneA } = await setupTwoCloneHarness(base);
      const store = makeStore(cloneA);
      const first = store.reserveIdentitySync('feature');
      assert.ok(store.readIdentityPending().some((row) => row.number === String(first.number)));
      const second = store.reserveIdentitySync('feature');
      assert.notStrictEqual(first.number, second.number);
      store.markIdentityMaterializedSync('feature', first.number);
      const pending = store.readIdentityPending();
      assert.ok(!pending.some((row) => row.number === String(first.number)));
      assert.ok(pending.some((row) => row.number === String(second.number)));
    });
  })) failed += 1;

  const passed = 22 - failed;
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
