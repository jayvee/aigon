#!/usr/bin/env node
'use strict';

/**
 * Tests for lib/workflow-close.js — the bridge between feature-close and workflow-core.
 * Run: node lib/workflow-close.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`  ✓ ${description}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${description}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

async function testAsync(description, fn) {
  try {
    await fn();
    console.log(`  ✓ ${description}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${description}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-wfclose-test-'));
}

function cleanTmpDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

const {
  isCloseEngineEnabled,
  bootstrapWorkflowState,
  runWorkflowClose,
  resumeClose,
  defaultCloseExecutor,
  resolveMode,
  getWorkflowCloseState,
} = require('./workflow-close');

const wf = require('./workflow-core');

// ===========================================================================
// isCloseEngineEnabled
// ===========================================================================

console.log('\nisCloseEngineEnabled');

test('returns false when no config and no env var', () => {
  delete process.env.AIGON_WORKFLOW_CLOSE_ENGINE;
  assert.strictEqual(isCloseEngineEnabled({}), false);
  assert.strictEqual(isCloseEngineEnabled(undefined), false);
  assert.strictEqual(isCloseEngineEnabled(null), false);
});

test('returns true when config.workflow.closeEngine is true', () => {
  delete process.env.AIGON_WORKFLOW_CLOSE_ENGINE;
  assert.strictEqual(isCloseEngineEnabled({ workflow: { closeEngine: true } }), true);
});

test('returns false when config.workflow.closeEngine is false', () => {
  delete process.env.AIGON_WORKFLOW_CLOSE_ENGINE;
  assert.strictEqual(isCloseEngineEnabled({ workflow: { closeEngine: false } }), false);
});

test('env var AIGON_WORKFLOW_CLOSE_ENGINE=1 overrides config', () => {
  process.env.AIGON_WORKFLOW_CLOSE_ENGINE = '1';
  assert.strictEqual(isCloseEngineEnabled({}), true);
  assert.strictEqual(isCloseEngineEnabled({ workflow: { closeEngine: false } }), true);
  delete process.env.AIGON_WORKFLOW_CLOSE_ENGINE;
});

test('env var AIGON_WORKFLOW_CLOSE_ENGINE=0 overrides config', () => {
  process.env.AIGON_WORKFLOW_CLOSE_ENGINE = '0';
  assert.strictEqual(isCloseEngineEnabled({ workflow: { closeEngine: true } }), false);
  delete process.env.AIGON_WORKFLOW_CLOSE_ENGINE;
});

// ===========================================================================
// resolveMode
// ===========================================================================

console.log('\nresolveMode');

test('solo branch when one agent and no worktree', () => {
  assert.strictEqual(resolveMode({ agents: { cc: {} } }, false), 'solo_branch');
});

test('solo worktree when one agent and worktree', () => {
  assert.strictEqual(resolveMode({ agents: { cc: {} } }, true), 'solo_worktree');
});

test('fleet when multiple agents', () => {
  assert.strictEqual(resolveMode({ agents: { cc: {}, gg: {} } }, false), 'fleet');
  assert.strictEqual(resolveMode({ agents: { cc: {}, gg: {} } }, true), 'fleet');
});

test('solo branch when no agents specified', () => {
  assert.strictEqual(resolveMode({}, false), 'solo_branch');
  assert.strictEqual(resolveMode({ agents: {} }, false), 'solo_branch');
});

// ===========================================================================
// bootstrapWorkflowState
// ===========================================================================

console.log('\nbootstrapWorkflowState');

testAsync('bootstraps a solo feature to ready_for_review', async () => {
  const tmp = makeTmpDir();
  try {
    const snapshot = await bootstrapWorkflowState(tmp, '42', {
      mode: 'solo_branch',
      agents: ['cc'],
      winnerId: 'cc',
    });
    assert.strictEqual(snapshot.currentSpecState, 'ready_for_review');
    assert.strictEqual(snapshot.winnerAgentId, 'cc');
    assert.strictEqual(snapshot.mode, 'solo_branch');
    assert.deepStrictEqual(Object.keys(snapshot.agents), ['cc']);
    assert.strictEqual(snapshot.agents.cc.status, 'ready');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('bootstraps a fleet feature to ready_for_review', async () => {
  const tmp = makeTmpDir();
  try {
    const snapshot = await bootstrapWorkflowState(tmp, '43', {
      mode: 'fleet',
      agents: ['cc', 'gg'],
      winnerId: 'gg',
    });
    assert.strictEqual(snapshot.currentSpecState, 'ready_for_review');
    assert.strictEqual(snapshot.winnerAgentId, 'gg');
    assert.strictEqual(snapshot.mode, 'fleet');
    assert.deepStrictEqual(Object.keys(snapshot.agents).sort(), ['cc', 'gg']);
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('is idempotent — re-bootstrap returns existing snapshot', async () => {
  const tmp = makeTmpDir();
  try {
    await bootstrapWorkflowState(tmp, '44', {
      mode: 'solo_branch',
      agents: ['cc'],
      winnerId: 'cc',
    });
    // Second call should be a no-op
    const snapshot = await bootstrapWorkflowState(tmp, '44', {
      mode: 'fleet',
      agents: ['cc', 'gg'],
      winnerId: 'gg',
    });
    // Should still be the first bootstrap's state
    assert.strictEqual(snapshot.currentSpecState, 'ready_for_review');
    assert.strictEqual(snapshot.winnerAgentId, 'cc');
    assert.strictEqual(snapshot.mode, 'solo_branch');
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// getWorkflowCloseState
// ===========================================================================

console.log('\ngetWorkflowCloseState');

testAsync('returns not in progress for empty feature', async () => {
  const tmp = makeTmpDir();
  try {
    const state = await getWorkflowCloseState(tmp, '50');
    assert.strictEqual(state.inProgress, false);
    assert.strictEqual(state.state, null);
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('returns in progress when feature is closing', async () => {
  const tmp = makeTmpDir();
  try {
    // Bootstrap to ready_for_review
    await bootstrapWorkflowState(tmp, '51', {
      mode: 'solo_branch',
      agents: ['cc'],
      winnerId: 'cc',
    });

    // Create a spec file for the close effect
    const specDir = path.join(tmp, 'specs');
    fs.mkdirSync(specDir, { recursive: true });
    const specPath = path.join(specDir, 'feature-51.md');
    fs.writeFileSync(specPath, '# Feature 51\n');

    // Initialize close (emit close_requested + effects)
    const now = new Date().toISOString();
    await wf.persistEvents(tmp, '51', [
      { type: 'feature.close_requested', at: now },
      {
        type: 'effect.requested',
        effect: { id: 'bridge.move_spec_to_done', type: 'move_spec', payload: { fromPath: specPath, toPath: path.join(specDir, 'done', 'feature-51.md') } },
        at: now,
      },
    ]);

    const state = await getWorkflowCloseState(tmp, '51');
    assert.strictEqual(state.inProgress, true);
    assert.strictEqual(state.state, 'closing');
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// runWorkflowClose — successful close
// ===========================================================================

console.log('\nrunWorkflowClose');

testAsync('successful close moves spec and writes closeout note', async () => {
  const tmp = makeTmpDir();
  try {
    // Setup: bootstrap to ready_for_review
    await bootstrapWorkflowState(tmp, '60', {
      mode: 'solo_branch',
      agents: ['cc'],
      winnerId: 'cc',
    });

    // Create spec file at source path
    const specDir = path.join(tmp, 'docs', 'specs', 'features', '03-in-progress');
    const doneDir = path.join(tmp, 'docs', 'specs', 'features', '05-done');
    fs.mkdirSync(specDir, { recursive: true });
    const specPath = path.join(specDir, 'feature-60-demo.md');
    const specToPath = path.join(doneDir, 'feature-60-demo.md');
    fs.writeFileSync(specPath, '# Feature 60\n');

    // Run close
    const result = await runWorkflowClose(tmp, '60', {
      specFromPath: specPath,
      specToPath: specToPath,
      winnerId: 'cc',
    });

    assert.strictEqual(result.kind, 'complete');
    assert.strictEqual(result.snapshot.currentSpecState, 'done');

    // Verify spec was moved
    assert.strictEqual(fs.existsSync(specPath), false);
    assert.strictEqual(fs.existsSync(specToPath), true);

    // Verify closeout note was written
    const closeoutPath = path.join(wf.getFeatureRoot(tmp, '60'), 'closeout.md');
    assert.strictEqual(fs.existsSync(closeoutPath), true);
    const closeout = fs.readFileSync(closeoutPath, 'utf8');
    assert.ok(closeout.includes('Winner: cc'));
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('close on already-done feature returns complete', async () => {
  const tmp = makeTmpDir();
  try {
    // Bootstrap + close
    await bootstrapWorkflowState(tmp, '61', {
      mode: 'solo_branch',
      agents: ['cc'],
      winnerId: 'cc',
    });

    const specDir = path.join(tmp, 'specs');
    fs.mkdirSync(specDir, { recursive: true });
    const specPath = path.join(specDir, 'feature-61.md');
    fs.writeFileSync(specPath, '# Feature 61\n');

    await runWorkflowClose(tmp, '61', {
      specFromPath: specPath,
      specToPath: path.join(specDir, 'done', 'feature-61.md'),
      winnerId: 'cc',
    });

    // Close again — should be a no-op
    const result = await runWorkflowClose(tmp, '61', {
      specFromPath: specPath,
      specToPath: path.join(specDir, 'done', 'feature-61.md'),
      winnerId: 'cc',
    });

    assert.strictEqual(result.kind, 'complete');
    assert.strictEqual(result.message, 'Feature already closed.');
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// Interrupted close — resume
// ===========================================================================

console.log('\nresumeClose');

testAsync('resume interrupted close completes remaining effects', async () => {
  const tmp = makeTmpDir();
  try {
    // Bootstrap to ready_for_review
    await bootstrapWorkflowState(tmp, '70', {
      mode: 'solo_branch',
      agents: ['cc'],
      winnerId: 'cc',
    });

    // Create spec file
    const specDir = path.join(tmp, 'docs', 'specs');
    fs.mkdirSync(specDir, { recursive: true });
    const specPath = path.join(specDir, 'feature-70.md');
    const donePath = path.join(specDir, 'done', 'feature-70.md');
    fs.writeFileSync(specPath, '# Feature 70\n');

    // Manually initialize close effects (simulating an interrupted close)
    const now = new Date().toISOString();
    await wf.persistEvents(tmp, '70', [
      { type: 'feature.close_requested', at: now },
      {
        type: 'effect.requested',
        effect: { id: 'bridge.move_spec_to_done', type: 'move_spec', payload: { fromPath: specPath, toPath: donePath } },
        at: now,
      },
      {
        type: 'effect.requested',
        effect: { id: 'bridge.write_close_note', type: 'write_close_note', payload: { winnerAgentId: 'cc' } },
        at: now,
      },
    ]);

    // Verify we're in closing state
    const stateBefore = await getWorkflowCloseState(tmp, '70');
    assert.strictEqual(stateBefore.inProgress, true);

    // Resume
    const result = await resumeClose(tmp, '70');
    assert.strictEqual(result.kind, 'complete');
    assert.strictEqual(result.snapshot.currentSpecState, 'done');

    // Verify spec was moved
    assert.strictEqual(fs.existsSync(donePath), true);
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('resume on non-closing feature returns error', async () => {
  const tmp = makeTmpDir();
  try {
    await bootstrapWorkflowState(tmp, '71', {
      mode: 'solo_branch',
      agents: ['cc'],
      winnerId: 'cc',
    });

    const result = await resumeClose(tmp, '71');
    assert.strictEqual(result.kind, 'error');
    assert.ok(result.message.includes('not in closing state'));
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// Blocked retry — healthy claim
// ===========================================================================

console.log('\nblocked retry');

testAsync('busy result returned when effect has healthy claim', async () => {
  const tmp = makeTmpDir();
  try {
    // Bootstrap
    await bootstrapWorkflowState(tmp, '80', {
      mode: 'solo_branch',
      agents: ['cc'],
      winnerId: 'cc',
    });

    // Create spec file
    const specDir = path.join(tmp, 'specs');
    fs.mkdirSync(specDir, { recursive: true });
    const specPath = path.join(specDir, 'feature-80.md');
    const donePath = path.join(specDir, 'done', 'feature-80.md');
    fs.writeFileSync(specPath, '# Feature 80\n');

    // Initialize close
    const now = new Date().toISOString();
    await wf.persistEvents(tmp, '80', [
      { type: 'feature.close_requested', at: now },
      {
        type: 'effect.requested',
        effect: { id: 'bridge.move_spec_to_done', type: 'move_spec', payload: { fromPath: specPath, toPath: donePath } },
        at: now,
      },
    ]);

    // Simulate a healthy claim (claimed recently, within timeout)
    await wf.persistEvents(tmp, '80', [
      { type: 'effect.claimed', effectId: 'bridge.move_spec_to_done', at: new Date().toISOString() },
    ]);

    // Attempt resume — should get busy
    const result = await resumeClose(tmp, '80');
    assert.strictEqual(result.kind, 'busy');
    assert.ok(result.message.includes('already being executed'));
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// Reclaim after timeout
// ===========================================================================

console.log('\nreclaim after timeout');

testAsync('expired claim allows reclaim and completion', async () => {
  const tmp = makeTmpDir();
  try {
    // Bootstrap
    await bootstrapWorkflowState(tmp, '90', {
      mode: 'solo_branch',
      agents: ['cc'],
      winnerId: 'cc',
    });

    // Create spec file
    const specDir = path.join(tmp, 'specs');
    fs.mkdirSync(specDir, { recursive: true });
    const specPath = path.join(specDir, 'feature-90.md');
    const donePath = path.join(specDir, 'done', 'feature-90.md');
    fs.writeFileSync(specPath, '# Feature 90\n');

    // Initialize close + claim the effect with an expired timestamp
    const expiredTime = new Date(Date.now() - 60_000).toISOString(); // 60s ago
    const now = new Date().toISOString();
    await wf.persistEvents(tmp, '90', [
      { type: 'feature.close_requested', at: now },
      {
        type: 'effect.requested',
        effect: { id: 'bridge.move_spec_to_done', type: 'move_spec', payload: { fromPath: specPath, toPath: donePath } },
        at: now,
      },
      {
        type: 'effect.requested',
        effect: { id: 'bridge.write_close_note', type: 'write_close_note', payload: { winnerAgentId: 'cc' } },
        at: now,
      },
      // Simulate a claim that expired
      { type: 'effect.claimed', effectId: 'bridge.move_spec_to_done', at: expiredTime },
    ]);

    // Resume with default timeout (30s) — the 60s-old claim should be expired
    const result = await resumeClose(tmp, '90');
    assert.strictEqual(result.kind, 'complete');
    assert.strictEqual(result.snapshot.currentSpecState, 'done');

    // Verify effects executed
    assert.strictEqual(fs.existsSync(donePath), true);
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// Fallback — flag disabled
// ===========================================================================

console.log('\nfallback when flag disabled');

test('isCloseEngineEnabled returns false with empty config', () => {
  delete process.env.AIGON_WORKFLOW_CLOSE_ENGINE;
  assert.strictEqual(isCloseEngineEnabled({}), false);
});

test('feature-close falls back to legacy path when flag is off', () => {
  // This is a unit test of the flag check only — integration with feature.js
  // is tested via the aigon-cli.test.js suite.
  delete process.env.AIGON_WORKFLOW_CLOSE_ENGINE;
  assert.strictEqual(isCloseEngineEnabled(undefined), false);
  assert.strictEqual(isCloseEngineEnabled({ workflow: {} }), false);
  assert.strictEqual(isCloseEngineEnabled({ workflow: { closeEngine: false } }), false);
});

// ===========================================================================
// defaultCloseExecutor
// ===========================================================================

console.log('\ndefaultCloseExecutor');

testAsync('move_spec is idempotent when target already exists', async () => {
  const tmp = makeTmpDir();
  try {
    const srcDir = path.join(tmp, 'src');
    const dstDir = path.join(tmp, 'dst');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(dstDir, { recursive: true });
    const dstPath = path.join(dstDir, 'feature.md');
    fs.writeFileSync(dstPath, '# Already moved\n');

    // Source doesn't exist, target does — should be a no-op
    await defaultCloseExecutor(tmp, '99', {
      type: 'move_spec',
      payload: { fromPath: path.join(srcDir, 'feature.md'), toPath: dstPath },
    });

    assert.strictEqual(fs.readFileSync(dstPath, 'utf8'), '# Already moved\n');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('move_spec moves file from source to target', async () => {
  const tmp = makeTmpDir();
  try {
    const srcDir = path.join(tmp, 'src');
    const dstDir = path.join(tmp, 'dst');
    fs.mkdirSync(srcDir, { recursive: true });
    const srcPath = path.join(srcDir, 'feature.md');
    const dstPath = path.join(dstDir, 'feature.md');
    fs.writeFileSync(srcPath, '# Feature\n');

    await defaultCloseExecutor(tmp, '99', {
      type: 'move_spec',
      payload: { fromPath: srcPath, toPath: dstPath },
    });

    assert.strictEqual(fs.existsSync(srcPath), false);
    assert.strictEqual(fs.existsSync(dstPath), true);
    assert.strictEqual(fs.readFileSync(dstPath, 'utf8'), '# Feature\n');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('write_close_note creates closeout file', async () => {
  const tmp = makeTmpDir();
  try {
    await defaultCloseExecutor(tmp, '99', {
      type: 'write_close_note',
      payload: { winnerAgentId: 'gg' },
    });

    const closeoutPath = path.join(wf.getFeatureRoot(tmp, '99'), 'closeout.md');
    assert.strictEqual(fs.existsSync(closeoutPath), true);
    const content = fs.readFileSync(closeoutPath, 'utf8');
    assert.ok(content.includes('Winner: gg'));
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// Summary
// ===========================================================================

setTimeout(() => {
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}, 2000);
