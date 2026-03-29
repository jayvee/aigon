#!/usr/bin/env node
'use strict';

/**
 * Tests for lib/workflow-start.js — the bridge between feature-start and workflow-core.
 * Run: node lib/workflow-start.test.js
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-wfstart-test-'));
}

function cleanTmpDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

const {
  isStartEngineEnabled,
  resolveMode,
  runWorkflowStart,
  buildStartEffects,
  resumeStart,
  defaultStartExecutor,
  getWorkflowStartState,
  writeLegacyManifest,
} = require('./workflow-start');

const wf = require('./workflow-core');

// ===========================================================================
// isStartEngineEnabled
// ===========================================================================

console.log('\nisStartEngineEnabled');

test('returns false when no config and no env var', () => {
  delete process.env.AIGON_WORKFLOW_START_ENGINE;
  assert.strictEqual(isStartEngineEnabled({}), false);
  assert.strictEqual(isStartEngineEnabled(undefined), false);
  assert.strictEqual(isStartEngineEnabled(null), false);
});

test('returns true when config.workflow.startEngine is true', () => {
  delete process.env.AIGON_WORKFLOW_START_ENGINE;
  assert.strictEqual(isStartEngineEnabled({ workflow: { startEngine: true } }), true);
});

test('returns false when config.workflow.startEngine is false', () => {
  delete process.env.AIGON_WORKFLOW_START_ENGINE;
  assert.strictEqual(isStartEngineEnabled({ workflow: { startEngine: false } }), false);
});

test('env var AIGON_WORKFLOW_START_ENGINE=1 overrides config', () => {
  process.env.AIGON_WORKFLOW_START_ENGINE = '1';
  assert.strictEqual(isStartEngineEnabled({}), true);
  assert.strictEqual(isStartEngineEnabled({ workflow: { startEngine: false } }), true);
  delete process.env.AIGON_WORKFLOW_START_ENGINE;
});

test('env var AIGON_WORKFLOW_START_ENGINE=0 overrides config', () => {
  process.env.AIGON_WORKFLOW_START_ENGINE = '0';
  assert.strictEqual(isStartEngineEnabled({ workflow: { startEngine: true } }), false);
  delete process.env.AIGON_WORKFLOW_START_ENGINE;
});

// ===========================================================================
// resolveMode
// ===========================================================================

console.log('\nresolveMode');

test('solo branch when no agents', () => {
  assert.strictEqual(resolveMode([]), 'solo_branch');
});

test('solo worktree when one agent', () => {
  assert.strictEqual(resolveMode(['cc']), 'solo_worktree');
});

test('fleet when multiple agents', () => {
  assert.strictEqual(resolveMode(['cc', 'gg']), 'fleet');
  assert.strictEqual(resolveMode(['cc', 'gg', 'cx']), 'fleet');
});

// ===========================================================================
// buildStartEffects
// ===========================================================================

console.log('\nbuildStartEffects');

test('builds move_spec + init_log for single agent', () => {
  const effects = buildStartEffects({
    specFromPath: '/repo/docs/specs/features/02-backlog/feature-42-demo.md',
    specToPath: '/repo/docs/specs/features/03-in-progress/feature-42-demo.md',
    agents: ['cc'],
    num: '42',
    desc: 'demo',
  });
  assert.strictEqual(effects.length, 2);
  assert.strictEqual(effects[0].id, 'bridge.start.move_spec');
  assert.strictEqual(effects[0].type, 'move_spec');
  assert.strictEqual(effects[1].id, 'bridge.start.init_log_cc');
  assert.strictEqual(effects[1].type, 'init_log');
  assert.strictEqual(effects[1].payload.agentId, 'cc');
});

test('builds move_spec + init_log per agent for fleet', () => {
  const effects = buildStartEffects({
    specFromPath: '/repo/backlog/feature-43.md',
    specToPath: '/repo/in-progress/feature-43.md',
    agents: ['cc', 'gg'],
    num: '43',
    desc: 'fleet-demo',
  });
  assert.strictEqual(effects.length, 3); // move_spec + 2x init_log
  assert.strictEqual(effects[0].type, 'move_spec');
  assert.strictEqual(effects[1].id, 'bridge.start.init_log_cc');
  assert.strictEqual(effects[2].id, 'bridge.start.init_log_gg');
});

test('builds single init_log for drive mode (no agents)', () => {
  const effects = buildStartEffects({
    specFromPath: '/repo/backlog/feature-44.md',
    specToPath: '/repo/in-progress/feature-44.md',
    agents: [],
    num: '44',
    desc: 'drive-demo',
  });
  assert.strictEqual(effects.length, 2); // move_spec + init_log (no agent)
  assert.strictEqual(effects[1].id, 'bridge.start.init_log');
  assert.strictEqual(effects[1].payload.agentId, null);
});

test('skips move_spec when paths are the same', () => {
  const samePath = '/repo/in-progress/feature-45.md';
  const effects = buildStartEffects({
    specFromPath: samePath,
    specToPath: samePath,
    agents: ['cc'],
    num: '45',
    desc: 'same-path',
  });
  assert.strictEqual(effects.length, 1); // only init_log
  assert.strictEqual(effects[0].type, 'init_log');
});

test('skips move_spec when specFromPath is null', () => {
  const effects = buildStartEffects({
    specFromPath: null,
    specToPath: null,
    agents: ['cc'],
    num: '46',
    desc: 'already-in-progress',
  });
  assert.strictEqual(effects.length, 1); // only init_log
  assert.strictEqual(effects[0].type, 'init_log');
});

// ===========================================================================
// getWorkflowStartState
// ===========================================================================

console.log('\ngetWorkflowStartState');

testAsync('returns null state for empty feature', async () => {
  const tmp = makeTmpDir();
  try {
    const state = await getWorkflowStartState(tmp, '50');
    assert.strictEqual(state.inProgress, false);
    assert.strictEqual(state.state, null);
    assert.strictEqual(state.hasPendingEffects, false);
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('returns implementing state for started feature', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '51', 'solo_worktree', ['cc']);
    const state = await getWorkflowStartState(tmp, '51');
    assert.strictEqual(state.state, 'implementing');
    assert.strictEqual(state.hasPendingEffects, false); // no effects registered yet
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('returns inProgress when implementing with pending effects', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '52', 'solo_worktree', ['cc']);
    const now = new Date().toISOString();
    await wf.persistEvents(tmp, '52', [
      {
        type: 'effect.requested',
        effect: { id: 'bridge.start.init_log_cc', type: 'init_log', payload: { agentId: 'cc', num: '52', desc: 'test' } },
        at: now,
      },
    ]);
    const state = await getWorkflowStartState(tmp, '52');
    assert.strictEqual(state.inProgress, true);
    assert.strictEqual(state.state, 'implementing');
    assert.strictEqual(state.hasPendingEffects, true);
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// runWorkflowStart — successful start
// ===========================================================================

console.log('\nrunWorkflowStart');

testAsync('starts a solo worktree feature with spec move and log creation', async () => {
  const tmp = makeTmpDir();
  try {
    // Create spec in backlog
    const backlogDir = path.join(tmp, 'docs', 'specs', 'features', '02-backlog');
    const inProgressDir = path.join(tmp, 'docs', 'specs', 'features', '03-in-progress');
    fs.mkdirSync(backlogDir, { recursive: true });
    const specFromPath = path.join(backlogDir, 'feature-60-demo.md');
    const specToPath = path.join(inProgressDir, 'feature-60-demo.md');
    fs.writeFileSync(specFromPath, '# Feature 60\n');

    const result = await runWorkflowStart(tmp, '60', {
      agents: ['cc'],
      specFromPath,
      specToPath,
      num: '60',
      desc: 'demo',
    });

    assert.strictEqual(result.kind, 'complete');
    assert.strictEqual(result.snapshot.currentSpecState, 'implementing');
    assert.strictEqual(result.snapshot.mode, 'solo_worktree');
    assert.deepStrictEqual(Object.keys(result.snapshot.agents), ['cc']);

    // Verify spec was moved
    assert.strictEqual(fs.existsSync(specFromPath), false);
    assert.strictEqual(fs.existsSync(specToPath), true);

    // Verify log was created
    const logPath = path.join(tmp, 'docs', 'specs', 'features', 'logs', 'feature-60-cc-demo-log.md');
    assert.strictEqual(fs.existsSync(logPath), true);
    const logContent = fs.readFileSync(logPath, 'utf8');
    assert.ok(logContent.includes('Feature 60'));
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('starts a fleet feature with logs per agent', async () => {
  const tmp = makeTmpDir();
  try {
    const backlogDir = path.join(tmp, 'docs', 'specs', 'features', '02-backlog');
    const inProgressDir = path.join(tmp, 'docs', 'specs', 'features', '03-in-progress');
    fs.mkdirSync(backlogDir, { recursive: true });
    const specFromPath = path.join(backlogDir, 'feature-61-fleet.md');
    const specToPath = path.join(inProgressDir, 'feature-61-fleet.md');
    fs.writeFileSync(specFromPath, '# Feature 61\n');

    const result = await runWorkflowStart(tmp, '61', {
      agents: ['cc', 'gg'],
      specFromPath,
      specToPath,
      num: '61',
      desc: 'fleet',
    });

    assert.strictEqual(result.kind, 'complete');
    assert.strictEqual(result.snapshot.mode, 'fleet');
    assert.deepStrictEqual(Object.keys(result.snapshot.agents).sort(), ['cc', 'gg']);

    // Verify logs created per agent
    const logsDir = path.join(tmp, 'docs', 'specs', 'features', 'logs');
    assert.strictEqual(fs.existsSync(path.join(logsDir, 'feature-61-cc-fleet-log.md')), true);
    assert.strictEqual(fs.existsSync(path.join(logsDir, 'feature-61-gg-fleet-log.md')), true);
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('starts a drive mode feature (no agents)', async () => {
  const tmp = makeTmpDir();
  try {
    const backlogDir = path.join(tmp, 'docs', 'specs', 'features', '02-backlog');
    const inProgressDir = path.join(tmp, 'docs', 'specs', 'features', '03-in-progress');
    fs.mkdirSync(backlogDir, { recursive: true });
    const specFromPath = path.join(backlogDir, 'feature-62-drive.md');
    const specToPath = path.join(inProgressDir, 'feature-62-drive.md');
    fs.writeFileSync(specFromPath, '# Feature 62\n');

    const result = await runWorkflowStart(tmp, '62', {
      agents: [],
      specFromPath,
      specToPath,
      num: '62',
      desc: 'drive',
    });

    assert.strictEqual(result.kind, 'complete');
    assert.strictEqual(result.snapshot.mode, 'solo_branch');

    // Verify log created (no agent prefix)
    const logPath = path.join(tmp, 'docs', 'specs', 'features', 'logs', 'feature-62-drive-log.md');
    assert.strictEqual(fs.existsSync(logPath), true);
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('start when spec already in in-progress (no move needed)', async () => {
  const tmp = makeTmpDir();
  try {
    const inProgressDir = path.join(tmp, 'docs', 'specs', 'features', '03-in-progress');
    fs.mkdirSync(inProgressDir, { recursive: true });
    fs.writeFileSync(path.join(inProgressDir, 'feature-63-already.md'), '# Feature 63\n');

    const result = await runWorkflowStart(tmp, '63', {
      agents: ['cc'],
      specFromPath: null,
      specToPath: null,
      num: '63',
      desc: 'already',
    });

    assert.strictEqual(result.kind, 'complete');
    assert.strictEqual(result.snapshot.currentSpecState, 'implementing');

    // Log should still be created
    const logPath = path.join(tmp, 'docs', 'specs', 'features', 'logs', 'feature-63-cc-already-log.md');
    assert.strictEqual(fs.existsSync(logPath), true);
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('returns error when feature already exists in different state', async () => {
  const tmp = makeTmpDir();
  try {
    // Start feature, then signal agents ready, request eval
    await wf.startFeature(tmp, '64', 'solo_branch', ['cc']);
    await wf.signalAgentReady(tmp, '64', 'cc');
    await wf.requestFeatureEval(tmp, '64');

    const result = await runWorkflowStart(tmp, '64', {
      agents: ['cc'],
      specFromPath: null,
      specToPath: null,
      num: '64',
      desc: 'already-evaluating',
    });

    assert.strictEqual(result.kind, 'error');
    assert.ok(result.message.includes('already exists'));
    assert.ok(result.message.includes('evaluating'));
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// resumeStart — interrupted start
// ===========================================================================

console.log('\nresumeStart');

testAsync('resumes interrupted start with pending effects', async () => {
  const tmp = makeTmpDir();
  try {
    // Create engine state manually (simulate interrupted start)
    await wf.startFeature(tmp, '70', 'solo_worktree', ['cc']);

    // Register effects but don't run them
    const logsDir = path.join(tmp, 'docs', 'specs', 'features', 'logs');
    const now = new Date().toISOString();
    await wf.persistEvents(tmp, '70', [
      {
        type: 'effect.requested',
        effect: {
          id: 'bridge.start.init_log_cc',
          type: 'init_log',
          payload: { agentId: 'cc', num: '70', desc: 'resume-test' },
        },
        at: now,
      },
    ]);

    // Resume — should run the pending init_log effect
    const result = await resumeStart(tmp, '70');
    assert.strictEqual(result.kind, 'complete');

    // Log should be created
    const logPath = path.join(logsDir, 'feature-70-cc-resume-test-log.md');
    assert.strictEqual(fs.existsSync(logPath), true);
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('resume with no pending effects returns complete', async () => {
  const tmp = makeTmpDir();
  try {
    await wf.startFeature(tmp, '71', 'solo_worktree', ['cc']);

    const result = await resumeStart(tmp, '71');
    assert.strictEqual(result.kind, 'complete');
    assert.ok(result.message.includes('no pending effects'));
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('resume on non-implementing feature returns error', async () => {
  const tmp = makeTmpDir();
  try {
    // Start then advance past implementing
    await wf.startFeature(tmp, '72', 'solo_branch', ['cc']);
    await wf.signalAgentReady(tmp, '72', 'cc');
    await wf.requestFeatureEval(tmp, '72');

    const result = await resumeStart(tmp, '72');
    assert.strictEqual(result.kind, 'error');
    assert.ok(result.message.includes('not in implementing state'));
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// defaultStartExecutor
// ===========================================================================

console.log('\ndefaultStartExecutor');

testAsync('move_spec moves file from source to target', async () => {
  const tmp = makeTmpDir();
  try {
    const srcDir = path.join(tmp, 'src');
    const dstDir = path.join(tmp, 'dst');
    fs.mkdirSync(srcDir, { recursive: true });
    const srcPath = path.join(srcDir, 'feature.md');
    const dstPath = path.join(dstDir, 'feature.md');
    fs.writeFileSync(srcPath, '# Feature\n');

    await defaultStartExecutor(tmp, '99', {
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

    // Source doesn't exist — should be a no-op
    await defaultStartExecutor(tmp, '99', {
      type: 'move_spec',
      payload: { fromPath: path.join(tmp, 'src', 'feature.md'), toPath: dstPath },
    });

    assert.strictEqual(fs.readFileSync(dstPath, 'utf8'), '# Already moved\n');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('init_log creates log file with agent prefix', async () => {
  const tmp = makeTmpDir();
  try {
    await defaultStartExecutor(tmp, '99', {
      type: 'init_log',
      payload: { agentId: 'cc', num: '42', desc: 'dark-mode' },
    });

    const logPath = path.join(tmp, 'docs', 'specs', 'features', 'logs', 'feature-42-cc-dark-mode-log.md');
    assert.strictEqual(fs.existsSync(logPath), true);
    const content = fs.readFileSync(logPath, 'utf8');
    assert.ok(content.includes('Feature 42'));
    assert.ok(content.includes('## Plan'));
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('init_log creates log file without agent prefix', async () => {
  const tmp = makeTmpDir();
  try {
    await defaultStartExecutor(tmp, '99', {
      type: 'init_log',
      payload: { agentId: null, num: '42', desc: 'dark-mode' },
    });

    const logPath = path.join(tmp, 'docs', 'specs', 'features', 'logs', 'feature-42-dark-mode-log.md');
    assert.strictEqual(fs.existsSync(logPath), true);
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('init_log is idempotent when log already exists', async () => {
  const tmp = makeTmpDir();
  try {
    const logsDir = path.join(tmp, 'docs', 'specs', 'features', 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const logPath = path.join(logsDir, 'feature-42-cc-dark-mode-log.md');
    fs.writeFileSync(logPath, '# Existing log\n');

    await defaultStartExecutor(tmp, '99', {
      type: 'init_log',
      payload: { agentId: 'cc', num: '42', desc: 'dark-mode' },
    });

    // Should not overwrite
    assert.strictEqual(fs.readFileSync(logPath, 'utf8'), '# Existing log\n');
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// writeLegacyManifest
// ===========================================================================

console.log('\nwriteLegacyManifest');

test('writes manifest with correct shape', () => {
  let written = null;
  const mockManifest = {
    writeManifest: (id, data, event) => {
      written = { id, data, event };
    },
  };

  writeLegacyManifest(mockManifest, '42', ['cc', 'gg']);

  assert.strictEqual(written.id, '42');
  assert.strictEqual(written.data.stage, 'in-progress');
  assert.deepStrictEqual(written.data.agents, ['cc', 'gg']);
  assert.deepStrictEqual(written.data.pending, []);
  assert.strictEqual(written.event.type, 'transition:feature-start');
  assert.strictEqual(written.event.actor, 'workflow-core/start');
});

// ===========================================================================
// Summary
// ===========================================================================

setTimeout(() => {
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}, 2000);
