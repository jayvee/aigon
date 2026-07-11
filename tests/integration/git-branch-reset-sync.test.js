'use strict';

// Regression: `feature-reset` / `research-reset` must converge across git-branch
// storage clones. The old reset wiped the local `.aigon/workflows` dir out of
// band and never touched the canonical event log on the `aigon-state` branch, so
// the next `storage sync` re-projected `feature.started` and the entity snapped
// back to in-progress on every machine. The fix records a merge-safe `*.reset`
// event that the projector replays as a return to backlog.

const assert = require('assert');
const { withTempDirAsync } = require('../_helpers');
const { setupTwoCloneHarness, makeStoreFromConfig } = require('./two-clone-git-branch-harness');
const engine = require('../../lib/workflow-core/engine');

async function runCase(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    return false;
  }
}

async function lifecycleOf(clone, id) {
  const snap = await engine.showFeatureOrNull(clone, id);
  return snap ? snap.currentSpecState : null;
}

async function main() {
  let passed = 0;
  let failed = 0;
  const record = (ok) => { if (ok) passed++; else failed++; };

  await withTempDirAsync(async (base) => {
    record(await runCase('feature reset propagates to a second clone via aigon-state', async () => {
      const { cloneA, cloneB } = await setupTwoCloneHarness(base);
      const id = '30';

      // Clone A: bootstrap + start, then publish to aigon-state.
      await engine.ensureEntityBootstrapped(cloneA, 'feature', id, 'backlog');
      await engine.startFeature(cloneA, id, 'solo', ['cc']);
      await makeStoreFromConfig(cloneA).sync();

      // Clone B pulls and sees the feature in progress.
      await makeStoreFromConfig(cloneB).sync();
      assert.strictEqual(await lifecycleOf(cloneB, id), 'implementing', 'clone B should see the feature implementing after sync');

      // Clone A resets and publishes.
      const reset = await engine.resetFeature(cloneA, id);
      assert.strictEqual(reset.removed, true, 'resetFeature should report it acted');
      assert.strictEqual(await lifecycleOf(cloneA, id), 'backlog', 'clone A should be back at backlog immediately');
      await makeStoreFromConfig(cloneA).sync();

      // Clone B pulls again and must converge on backlog — the bug was it stayed implementing.
      await makeStoreFromConfig(cloneB).sync();
      assert.strictEqual(await lifecycleOf(cloneB, id), 'backlog', 'clone B must see backlog after the reset syncs');

      // Idempotent: re-syncing either clone does not resurrect the started state.
      await makeStoreFromConfig(cloneB).sync();
      await makeStoreFromConfig(cloneA).sync();
      assert.strictEqual(await lifecycleOf(cloneB, id), 'backlog', 'clone B stays backlog on re-sync');
      assert.strictEqual(await lifecycleOf(cloneA, id), 'backlog', 'clone A stays backlog on re-sync');
    }));

    record(await runCase('a re-start after reset supersedes the reset on both clones', async () => {
      const { cloneA, cloneB } = await setupTwoCloneHarness(base + '-restart');
      const id = '31';

      await engine.ensureEntityBootstrapped(cloneA, 'feature', id, 'backlog');
      await engine.startFeature(cloneA, id, 'solo', ['cc']);
      await engine.resetFeature(cloneA, id);
      await engine.startFeature(cloneA, id, 'solo', ['cc']);
      await makeStoreFromConfig(cloneA).sync();

      await makeStoreFromConfig(cloneB).sync();
      assert.strictEqual(await lifecycleOf(cloneA, id), 'implementing', 'clone A implementing after re-start');
      assert.strictEqual(await lifecycleOf(cloneB, id), 'implementing', 'clone B implementing after re-start syncs');
    }));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
