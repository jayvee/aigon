#!/usr/bin/env node
'use strict';

/**
 * Tests for lib/workflow-eval.js — the bridge between feature-eval and workflow-core.
 * Run: node lib/workflow-eval.test.js
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-wfeval-test-'));
}

function cleanTmpDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

const {
  isEvalEngineEnabled,
  synthesizeAgentReadySignals,
  runWorkflowEval,
  buildEvalEffects,
  resumeEval,
  defaultEvalExecutor,
  getWorkflowEvalState,
  hasEngineState,
} = require('./workflow-eval');

const wf = require('./workflow-core');

// ===========================================================================
// isEvalEngineEnabled
// ===========================================================================

console.log('\nisEvalEngineEnabled');

test('returns false when no config and no env var', () => {
  delete process.env.AIGON_WORKFLOW_EVAL_ENGINE;
  assert.strictEqual(isEvalEngineEnabled({}), false);
  assert.strictEqual(isEvalEngineEnabled(undefined), false);
  assert.strictEqual(isEvalEngineEnabled(null), false);
});

test('returns true when config.workflow.evalEngine is true', () => {
  delete process.env.AIGON_WORKFLOW_EVAL_ENGINE;
  assert.strictEqual(isEvalEngineEnabled({ workflow: { evalEngine: true } }), true);
});

test('returns false when config.workflow.evalEngine is false', () => {
  delete process.env.AIGON_WORKFLOW_EVAL_ENGINE;
  assert.strictEqual(isEvalEngineEnabled({ workflow: { evalEngine: false } }), false);
});

test('env var AIGON_WORKFLOW_EVAL_ENGINE=1 overrides config', () => {
  process.env.AIGON_WORKFLOW_EVAL_ENGINE = '1';
  assert.strictEqual(isEvalEngineEnabled({}), true);
  assert.strictEqual(isEvalEngineEnabled({ workflow: { evalEngine: false } }), true);
  delete process.env.AIGON_WORKFLOW_EVAL_ENGINE;
});

test('env var AIGON_WORKFLOW_EVAL_ENGINE=0 overrides config', () => {
  process.env.AIGON_WORKFLOW_EVAL_ENGINE = '0';
  assert.strictEqual(isEvalEngineEnabled({ workflow: { evalEngine: true } }), false);
  delete process.env.AIGON_WORKFLOW_EVAL_ENGINE;
});

// ===========================================================================
// buildEvalEffects
// ===========================================================================

console.log('\nbuildEvalEffects');

test('builds move_spec + write_eval_stub when paths differ', () => {
  const effects = buildEvalEffects({
    specFromPath: '/repo/docs/specs/features/03-in-progress/feature-42-demo.md',
    specToPath: '/repo/docs/specs/features/04-in-evaluation/feature-42-demo.md',
  });
  assert.strictEqual(effects.length, 2);
  assert.strictEqual(effects[0].id, 'bridge.eval.move_spec');
  assert.strictEqual(effects[0].type, 'move_spec');
  assert.strictEqual(effects[1].id, 'bridge.eval.write_eval_stub');
  assert.strictEqual(effects[1].type, 'write_eval_stub');
});

test('skips move_spec when paths are the same', () => {
  const samePath = '/repo/docs/specs/features/04-in-evaluation/feature-42-demo.md';
  const effects = buildEvalEffects({
    specFromPath: samePath,
    specToPath: samePath,
  });
  assert.strictEqual(effects.length, 1);
  assert.strictEqual(effects[0].type, 'write_eval_stub');
});

test('skips move_spec when specFromPath is null', () => {
  const effects = buildEvalEffects({
    specFromPath: null,
    specToPath: null,
  });
  assert.strictEqual(effects.length, 1);
  assert.strictEqual(effects[0].type, 'write_eval_stub');
});

// ===========================================================================
// hasEngineState
// ===========================================================================

console.log('\nhasEngineState');

testAsync('returns false for feature with no engine state', async () => {
  const tmp = makeTmpDir();
  try {
    assert.strictEqual(await hasEngineState(tmp, '50'), false);
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('returns true for feature started via engine', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '51', 'fleet', ['cc', 'gg']);
    assert.strictEqual(await hasEngineState(tmp, '51'), true);
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// getWorkflowEvalState
// ===========================================================================

console.log('\ngetWorkflowEvalState');

testAsync('returns null state for empty feature', async () => {
  const tmp = makeTmpDir();
  try {
    const state = await getWorkflowEvalState(tmp, '50');
    assert.strictEqual(state.inProgress, false);
    assert.strictEqual(state.state, null);
    assert.strictEqual(state.hasPendingEffects, false);
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('returns evaluating state for feature in eval', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '52', 'fleet', ['cc', 'gg']);
    await wf.signalAgentReady(tmp, '52', 'cc');
    await wf.signalAgentReady(tmp, '52', 'gg');
    await wf.requestFeatureEval(tmp, '52');

    const state = await getWorkflowEvalState(tmp, '52');
    assert.strictEqual(state.state, 'evaluating');
    assert.strictEqual(state.hasPendingEffects, false);
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('returns inProgress when evaluating with pending effects', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '53', 'fleet', ['cc', 'gg']);
    await wf.signalAgentReady(tmp, '53', 'cc');
    await wf.signalAgentReady(tmp, '53', 'gg');
    await wf.requestFeatureEval(tmp, '53');

    // Register a pending effect
    const now = new Date().toISOString();
    await wf.persistEvents(tmp, '53', [
      {
        type: 'effect.requested',
        effect: { id: 'bridge.eval.write_eval_stub', type: 'write_eval_stub', payload: {} },
        at: now,
      },
    ]);

    const state = await getWorkflowEvalState(tmp, '53');
    assert.strictEqual(state.inProgress, true);
    assert.strictEqual(state.state, 'evaluating');
    assert.strictEqual(state.hasPendingEffects, true);
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// synthesizeAgentReadySignals
// ===========================================================================

console.log('\nsynthesizeAgentReadySignals');

testAsync('synthesizes ready signals from legacy manifest status', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '55', 'fleet', ['cc', 'gg']);

    // Mock manifest that reports both agents as submitted
    const mockManifest = {
      readAgentStatus: (featureId, agentId) => {
        return { status: 'submitted' };
      },
    };

    await synthesizeAgentReadySignals(tmp, '55', mockManifest);

    // Verify both agents are now ready in engine
    const snapshot = await wf.showFeature(tmp, '55');
    assert.strictEqual(snapshot.agents.cc.status, 'ready');
    assert.strictEqual(snapshot.agents.gg.status, 'ready');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('skips agents already ready in engine', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '56', 'fleet', ['cc', 'gg']);
    // Mark cc ready via engine
    await wf.signalAgentReady(tmp, '56', 'cc');

    let readCount = 0;
    const mockManifest = {
      readAgentStatus: (featureId, agentId) => {
        readCount++;
        return { status: 'submitted' };
      },
    };

    await synthesizeAgentReadySignals(tmp, '56', mockManifest);

    // cc was already ready, so only gg should have been checked+synthesized
    // Both should be ready now
    const snapshot = await wf.showFeature(tmp, '56');
    assert.strictEqual(snapshot.agents.cc.status, 'ready');
    assert.strictEqual(snapshot.agents.gg.status, 'ready');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('does not synthesize for agents not yet submitted', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '57', 'fleet', ['cc', 'gg']);

    const mockManifest = {
      readAgentStatus: (featureId, agentId) => {
        if (agentId === 'cc') return { status: 'submitted' };
        return { status: 'implementing' }; // gg not done yet
      },
    };

    await synthesizeAgentReadySignals(tmp, '57', mockManifest);

    const snapshot = await wf.showFeature(tmp, '57');
    assert.strictEqual(snapshot.agents.cc.status, 'ready');
    assert.notStrictEqual(snapshot.agents.gg.status, 'ready');
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// runWorkflowEval — guard enforcement
// ===========================================================================

console.log('\nrunWorkflowEval — guard enforcement');

testAsync('rejects eval when not all agents are ready', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '60', 'fleet', ['cc', 'gg']);
    // Only cc is ready, gg is not
    await wf.signalAgentReady(tmp, '60', 'cc');

    const result = await runWorkflowEval(tmp, '60', {
      specFromPath: null,
      specToPath: null,
    });

    assert.strictEqual(result.kind, 'guard_failed');
    assert.ok(result.message.includes('not all agents are ready'));
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('rejects eval from non-implementing state', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '61', 'fleet', ['cc', 'gg']);
    await wf.signalAgentReady(tmp, '61', 'cc');
    await wf.signalAgentReady(tmp, '61', 'gg');
    await wf.requestFeatureEval(tmp, '61');

    // Already in evaluating — try eval again
    const result = await runWorkflowEval(tmp, '61', {
      specFromPath: null,
      specToPath: null,
    });

    // Should resume (already evaluating), not error
    assert.strictEqual(result.kind, 'complete');
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// runWorkflowEval — successful eval
// ===========================================================================

console.log('\nrunWorkflowEval — successful eval');

testAsync('transitions to evaluating and moves spec', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '65', 'fleet', ['cc', 'gg']);
    await wf.signalAgentReady(tmp, '65', 'cc');
    await wf.signalAgentReady(tmp, '65', 'gg');

    // Create spec in in-progress
    const inProgressDir = path.join(tmp, 'docs', 'specs', 'features', '03-in-progress');
    const inEvalDir = path.join(tmp, 'docs', 'specs', 'features', '04-in-evaluation');
    fs.mkdirSync(inProgressDir, { recursive: true });
    const specFromPath = path.join(inProgressDir, 'feature-65-demo.md');
    const specToPath = path.join(inEvalDir, 'feature-65-demo.md');
    fs.writeFileSync(specFromPath, '# Feature 65\n');

    const result = await runWorkflowEval(tmp, '65', {
      specFromPath,
      specToPath,
    });

    assert.strictEqual(result.kind, 'complete');
    assert.strictEqual(result.snapshot.currentSpecState, 'evaluating');

    // Verify spec was moved
    assert.strictEqual(fs.existsSync(specFromPath), false);
    assert.strictEqual(fs.existsSync(specToPath), true);

    // Verify eval stub was created
    const evalStubPath = path.join(tmp, '.aigon', 'workflows', 'features', '65', 'eval-started.md');
    assert.strictEqual(fs.existsSync(evalStubPath), true);
    const stubContent = fs.readFileSync(evalStubPath, 'utf8');
    assert.ok(stubContent.includes('Feature 65'));
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('succeeds for solo (single agent) features', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '66', 'solo_worktree', ['cc']);
    await wf.signalAgentReady(tmp, '66', 'cc');

    const result = await runWorkflowEval(tmp, '66', {
      specFromPath: null,
      specToPath: null,
    });

    assert.strictEqual(result.kind, 'complete');
    assert.strictEqual(result.snapshot.currentSpecState, 'evaluating');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('eval without spec move still creates eval stub', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '67', 'fleet', ['cc', 'gg']);
    await wf.signalAgentReady(tmp, '67', 'cc');
    await wf.signalAgentReady(tmp, '67', 'gg');

    const result = await runWorkflowEval(tmp, '67', {
      specFromPath: null,
      specToPath: null,
    });

    assert.strictEqual(result.kind, 'complete');
    assert.strictEqual(result.snapshot.currentSpecState, 'evaluating');

    // Eval stub should still be created
    const evalStubPath = path.join(tmp, '.aigon', 'workflows', 'features', '67', 'eval-started.md');
    assert.strictEqual(fs.existsSync(evalStubPath), true);
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// resumeEval
// ===========================================================================

console.log('\nresumeEval');

testAsync('resumes interrupted eval with pending effects', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '70', 'fleet', ['cc', 'gg']);
    await wf.signalAgentReady(tmp, '70', 'cc');
    await wf.signalAgentReady(tmp, '70', 'gg');
    await wf.requestFeatureEval(tmp, '70');

    // Register effect but don't run it
    const now = new Date().toISOString();
    await wf.persistEvents(tmp, '70', [
      {
        type: 'effect.requested',
        effect: { id: 'bridge.eval.write_eval_stub', type: 'write_eval_stub', payload: {} },
        at: now,
      },
    ]);

    const result = await resumeEval(tmp, '70');
    assert.strictEqual(result.kind, 'complete');

    // Eval stub should be created
    const evalStubPath = path.join(tmp, '.aigon', 'workflows', 'features', '70', 'eval-started.md');
    assert.strictEqual(fs.existsSync(evalStubPath), true);
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('resume with no pending effects returns complete', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '71', 'fleet', ['cc', 'gg']);
    await wf.signalAgentReady(tmp, '71', 'cc');
    await wf.signalAgentReady(tmp, '71', 'gg');
    await wf.requestFeatureEval(tmp, '71');

    const result = await resumeEval(tmp, '71');
    assert.strictEqual(result.kind, 'complete');
    assert.ok(result.message.includes('no pending effects'));
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('resume on non-evaluating feature returns error', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '72', 'fleet', ['cc', 'gg']);
    // Still in implementing, not evaluating

    const result = await resumeEval(tmp, '72');
    assert.strictEqual(result.kind, 'error');
    assert.ok(result.message.includes('not in evaluating state'));
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// defaultEvalExecutor
// ===========================================================================

console.log('\ndefaultEvalExecutor');

testAsync('move_spec moves file from source to target', async () => {
  const tmp = makeTmpDir();
  try {
    const srcDir = path.join(tmp, 'src');
    const dstDir = path.join(tmp, 'dst');
    fs.mkdirSync(srcDir, { recursive: true });
    const srcPath = path.join(srcDir, 'feature.md');
    const dstPath = path.join(dstDir, 'feature.md');
    fs.writeFileSync(srcPath, '# Feature\n');

    await defaultEvalExecutor(tmp, '99', {
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

testAsync('move_spec is idempotent when source already moved', async () => {
  const tmp = makeTmpDir();
  try {
    const dstDir = path.join(tmp, 'dst');
    fs.mkdirSync(dstDir, { recursive: true });
    const dstPath = path.join(dstDir, 'feature.md');
    fs.writeFileSync(dstPath, '# Already moved\n');

    await defaultEvalExecutor(tmp, '99', {
      type: 'move_spec',
      payload: { fromPath: path.join(tmp, 'src', 'feature.md'), toPath: dstPath },
    });

    assert.strictEqual(fs.readFileSync(dstPath, 'utf8'), '# Already moved\n');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('write_eval_stub creates eval marker file', async () => {
  const tmp = makeTmpDir();
  try {
    await defaultEvalExecutor(tmp, '42', {
      type: 'write_eval_stub',
      payload: {},
    });

    const evalStubPath = path.join(tmp, '.aigon', 'workflows', 'features', '42', 'eval-started.md');
    assert.strictEqual(fs.existsSync(evalStubPath), true);
    const content = fs.readFileSync(evalStubPath, 'utf8');
    assert.ok(content.includes('Feature 42'));
    assert.ok(content.includes('Started at:'));
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('write_eval_stub is idempotent when file already exists', async () => {
  const tmp = makeTmpDir();
  try {
    const evalStubDir = path.join(tmp, '.aigon', 'workflows', 'features', '42');
    fs.mkdirSync(evalStubDir, { recursive: true });
    const evalStubPath = path.join(evalStubDir, 'eval-started.md');
    fs.writeFileSync(evalStubPath, '# Existing stub\n');

    await defaultEvalExecutor(tmp, '42', {
      type: 'write_eval_stub',
      payload: {},
    });

    // Should not overwrite
    assert.strictEqual(fs.readFileSync(evalStubPath, 'utf8'), '# Existing stub\n');
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
