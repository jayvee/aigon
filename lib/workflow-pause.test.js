#!/usr/bin/env node
'use strict';

/**
 * Tests for lib/workflow-pause.js — the bridge between feature-pause/resume and workflow-core.
 * Run: node lib/workflow-pause.test.js
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-wfpause-test-'));
}

function cleanTmpDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

const {
  isPauseEngineEnabled,
  runWorkflowPause,
  buildPauseEffects,
  runWorkflowResume,
  buildResumeEffects,
  defaultPauseExecutor,
  getWorkflowPauseState,
} = require('./workflow-pause');

const wf = require('./workflow-core');

// ===========================================================================
// isPauseEngineEnabled
// ===========================================================================

console.log('\nisPauseEngineEnabled');

test('returns false when no config and no env var', () => {
  delete process.env.AIGON_WORKFLOW_PAUSE_ENGINE;
  assert.strictEqual(isPauseEngineEnabled({}), false);
  assert.strictEqual(isPauseEngineEnabled(undefined), false);
  assert.strictEqual(isPauseEngineEnabled(null), false);
});

test('returns true when config.workflow.pauseEngine is true', () => {
  delete process.env.AIGON_WORKFLOW_PAUSE_ENGINE;
  assert.strictEqual(isPauseEngineEnabled({ workflow: { pauseEngine: true } }), true);
});

test('returns false when config.workflow.pauseEngine is false', () => {
  delete process.env.AIGON_WORKFLOW_PAUSE_ENGINE;
  assert.strictEqual(isPauseEngineEnabled({ workflow: { pauseEngine: false } }), false);
});

test('env var AIGON_WORKFLOW_PAUSE_ENGINE=1 overrides config', () => {
  process.env.AIGON_WORKFLOW_PAUSE_ENGINE = '1';
  assert.strictEqual(isPauseEngineEnabled({}), true);
  assert.strictEqual(isPauseEngineEnabled({ workflow: { pauseEngine: false } }), true);
  delete process.env.AIGON_WORKFLOW_PAUSE_ENGINE;
});

test('env var AIGON_WORKFLOW_PAUSE_ENGINE=0 overrides config', () => {
  process.env.AIGON_WORKFLOW_PAUSE_ENGINE = '0';
  assert.strictEqual(isPauseEngineEnabled({ workflow: { pauseEngine: true } }), false);
  delete process.env.AIGON_WORKFLOW_PAUSE_ENGINE;
});

// ===========================================================================
// buildPauseEffects / buildResumeEffects
// ===========================================================================

console.log('\nbuildPauseEffects');

test('builds move_spec effect for pause', () => {
  const effects = buildPauseEffects({
    specFromPath: '/repo/docs/specs/features/03-in-progress/feature-42-demo.md',
    specToPath: '/repo/docs/specs/features/06-paused/feature-42-demo.md',
  });
  assert.strictEqual(effects.length, 1);
  assert.strictEqual(effects[0].id, 'bridge.pause.move_spec');
  assert.strictEqual(effects[0].type, 'move_spec');
  assert.strictEqual(effects[0].payload.fromPath, '/repo/docs/specs/features/03-in-progress/feature-42-demo.md');
  assert.strictEqual(effects[0].payload.toPath, '/repo/docs/specs/features/06-paused/feature-42-demo.md');
});

test('skips move_spec when paths are the same', () => {
  const samePath = '/repo/docs/specs/features/03-in-progress/feature-42-demo.md';
  const effects = buildPauseEffects({ specFromPath: samePath, specToPath: samePath });
  assert.strictEqual(effects.length, 0);
});

test('skips move_spec when paths are null', () => {
  const effects = buildPauseEffects({ specFromPath: null, specToPath: null });
  assert.strictEqual(effects.length, 0);
});

console.log('\nbuildResumeEffects');

test('builds move_spec effect for resume', () => {
  const effects = buildResumeEffects({
    specFromPath: '/repo/docs/specs/features/06-paused/feature-42-demo.md',
    specToPath: '/repo/docs/specs/features/03-in-progress/feature-42-demo.md',
  });
  assert.strictEqual(effects.length, 1);
  assert.strictEqual(effects[0].id, 'bridge.resume.move_spec');
  assert.strictEqual(effects[0].type, 'move_spec');
});

// ===========================================================================
// getWorkflowPauseState
// ===========================================================================

console.log('\ngetWorkflowPauseState');

testAsync('returns null state for feature with no engine events', async () => {
  const tmp = makeTmpDir();
  try {
    const state = await getWorkflowPauseState(tmp, '50');
    assert.strictEqual(state.state, null);
    assert.strictEqual(state.hasPendingEffects, false);
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('returns implementing for started feature', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '51', 'solo_worktree', ['cc']);
    const state = await getWorkflowPauseState(tmp, '51');
    assert.strictEqual(state.state, 'implementing');
    assert.strictEqual(state.hasPendingEffects, false);
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('returns paused for paused feature', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '52', 'solo_worktree', ['cc']);
    await wf.pauseFeature(tmp, '52');
    const state = await getWorkflowPauseState(tmp, '52');
    assert.strictEqual(state.state, 'paused');
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// runWorkflowPause
// ===========================================================================

console.log('\nrunWorkflowPause');

testAsync('pauses a feature and moves spec', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '60', 'solo_worktree', ['cc']);

    // Create spec in in-progress
    const inProgressDir = path.join(tmp, 'docs', 'specs', 'features', '03-in-progress');
    const pausedDir = path.join(tmp, 'docs', 'specs', 'features', '06-paused');
    fs.mkdirSync(inProgressDir, { recursive: true });
    const specFromPath = path.join(inProgressDir, 'feature-60-demo.md');
    const specToPath = path.join(pausedDir, 'feature-60-demo.md');
    fs.writeFileSync(specFromPath, '# Feature 60\n');

    const result = await runWorkflowPause(tmp, '60', { specFromPath, specToPath });

    assert.strictEqual(result.kind, 'complete');
    assert.strictEqual(result.snapshot.currentSpecState, 'paused');

    // Verify spec was moved
    assert.strictEqual(fs.existsSync(specFromPath), false);
    assert.strictEqual(fs.existsSync(specToPath), true);
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('returns complete when feature already paused', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '61', 'solo_worktree', ['cc']);
    await wf.pauseFeature(tmp, '61');

    const result = await runWorkflowPause(tmp, '61', {
      specFromPath: '/fake/from',
      specToPath: '/fake/to',
    });

    assert.strictEqual(result.kind, 'complete');
    assert.ok(result.message.includes('already paused'));
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('returns error when feature not in implementing state', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '62', 'solo_branch', ['cc']);
    await wf.signalAgentReady(tmp, '62', 'cc');
    await wf.requestFeatureEval(tmp, '62');

    const result = await runWorkflowPause(tmp, '62', {
      specFromPath: '/fake/from',
      specToPath: '/fake/to',
    });

    assert.strictEqual(result.kind, 'error');
    assert.ok(result.message.includes('Cannot pause'));
    assert.ok(result.message.includes('evaluating'));
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// runWorkflowResume
// ===========================================================================

console.log('\nrunWorkflowResume');

testAsync('resumes a paused feature and moves spec back', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '70', 'solo_worktree', ['cc']);
    await wf.pauseFeature(tmp, '70');

    // Create spec in paused
    const pausedDir = path.join(tmp, 'docs', 'specs', 'features', '06-paused');
    const inProgressDir = path.join(tmp, 'docs', 'specs', 'features', '03-in-progress');
    fs.mkdirSync(pausedDir, { recursive: true });
    const specFromPath = path.join(pausedDir, 'feature-70-demo.md');
    const specToPath = path.join(inProgressDir, 'feature-70-demo.md');
    fs.writeFileSync(specFromPath, '# Feature 70\n');

    const result = await runWorkflowResume(tmp, '70', { specFromPath, specToPath });

    assert.strictEqual(result.kind, 'complete');
    assert.strictEqual(result.snapshot.currentSpecState, 'implementing');

    // Verify spec was moved back
    assert.strictEqual(fs.existsSync(specFromPath), false);
    assert.strictEqual(fs.existsSync(specToPath), true);
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('returns complete when feature already implementing', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '71', 'solo_worktree', ['cc']);

    const result = await runWorkflowResume(tmp, '71', {
      specFromPath: '/fake/from',
      specToPath: '/fake/to',
    });

    assert.strictEqual(result.kind, 'complete');
    assert.ok(result.message.includes('already implementing'));
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('returns error when feature not in paused state', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '72', 'solo_branch', ['cc']);
    await wf.signalAgentReady(tmp, '72', 'cc');
    await wf.requestFeatureEval(tmp, '72');

    const result = await runWorkflowResume(tmp, '72', {
      specFromPath: '/fake/from',
      specToPath: '/fake/to',
    });

    assert.strictEqual(result.kind, 'error');
    assert.ok(result.message.includes('Cannot resume'));
    assert.ok(result.message.includes('evaluating'));
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// defaultPauseExecutor
// ===========================================================================

console.log('\ndefaultPauseExecutor');

testAsync('move_spec moves file from source to target', async () => {
  const tmp = makeTmpDir();
  try {
    const srcDir = path.join(tmp, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    const srcPath = path.join(srcDir, 'feature.md');
    const dstPath = path.join(tmp, 'dst', 'feature.md');
    fs.writeFileSync(srcPath, '# Feature\n');

    await defaultPauseExecutor(tmp, '99', {
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

    await defaultPauseExecutor(tmp, '99', {
      type: 'move_spec',
      payload: { fromPath: path.join(tmp, 'nonexistent', 'feature.md'), toPath: dstPath },
    });

    assert.strictEqual(fs.readFileSync(dstPath, 'utf8'), '# Already moved\n');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('move_spec is idempotent when target already exists', async () => {
  const tmp = makeTmpDir();
  try {
    const srcDir = path.join(tmp, 'src');
    const dstDir = path.join(tmp, 'dst');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(dstDir, { recursive: true });
    const srcPath = path.join(srcDir, 'feature.md');
    const dstPath = path.join(dstDir, 'feature.md');
    fs.writeFileSync(srcPath, '# Source\n');
    fs.writeFileSync(dstPath, '# Already there\n');

    await defaultPauseExecutor(tmp, '99', {
      type: 'move_spec',
      payload: { fromPath: srcPath, toPath: dstPath },
    });

    // Target should not be overwritten
    assert.strictEqual(fs.readFileSync(dstPath, 'utf8'), '# Already there\n');
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// Full round-trip: pause then resume
// ===========================================================================

console.log('\nround-trip: pause then resume');

testAsync('pause → resume returns feature to implementing with correct events', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '80', 'solo_worktree', ['cc']);

    // Set up spec directories
    const inProgressDir = path.join(tmp, 'docs', 'specs', 'features', '03-in-progress');
    const pausedDir = path.join(tmp, 'docs', 'specs', 'features', '06-paused');
    fs.mkdirSync(inProgressDir, { recursive: true });
    const specFile = 'feature-80-roundtrip.md';
    fs.writeFileSync(path.join(inProgressDir, specFile), '# Feature 80\n');

    // Pause
    const pauseResult = await runWorkflowPause(tmp, '80', {
      specFromPath: path.join(inProgressDir, specFile),
      specToPath: path.join(pausedDir, specFile),
    });
    assert.strictEqual(pauseResult.kind, 'complete');
    assert.strictEqual(pauseResult.snapshot.currentSpecState, 'paused');
    assert.strictEqual(fs.existsSync(path.join(pausedDir, specFile)), true);
    assert.strictEqual(fs.existsSync(path.join(inProgressDir, specFile)), false);

    // Resume
    const resumeResult = await runWorkflowResume(tmp, '80', {
      specFromPath: path.join(pausedDir, specFile),
      specToPath: path.join(inProgressDir, specFile),
    });
    assert.strictEqual(resumeResult.kind, 'complete');
    assert.strictEqual(resumeResult.snapshot.currentSpecState, 'implementing');
    assert.strictEqual(fs.existsSync(path.join(inProgressDir, specFile)), true);
    assert.strictEqual(fs.existsSync(path.join(pausedDir, specFile)), false);

    // Verify event log contains all expected events
    const events = await wf.readEvents(wf.getEventsPath(tmp, '80'));
    const eventTypes = events.map((e) => e.type);
    assert.ok(eventTypes.includes('feature.started'));
    assert.ok(eventTypes.includes('feature.paused'));
    assert.ok(eventTypes.includes('feature.resumed'));
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
