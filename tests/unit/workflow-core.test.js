#!/usr/bin/env node
'use strict';

/**
 * Unit tests for lib/workflow-core/ — guards, actions, signals, research
 * Internal API tests (types, paths, event-store, snapshot-store, projector)
 * and engine happy-paths removed: covered by lifecycle.test.js
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-wc-test-'));
}

function cleanTmpDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

const { withFeatureLock, tryWithFeatureLock } = require('../../lib/../lib/workflow-core/lock');
const { projectContext } = require('../../lib/../lib/workflow-core/projector');
const { deriveAvailableActions } = require('../../lib/../lib/workflow-core/actions');
const engine = require('../../lib/../lib/workflow-core/engine');

// ===========================================================================
// lock.js
// ===========================================================================

console.log('\n📦 lock.js');

testAsync('withFeatureLock executes work and releases lock', async () => {
  const tmp = makeTmpDir();
  try {
    const lockPath = path.join(tmp, 'lock');
    const result = await withFeatureLock(lockPath, async () => 'done');
    assert.strictEqual(result, 'done');
    // Lock file should be cleaned up
    assert.ok(!fs.existsSync(lockPath));
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('tryWithFeatureLock returns busy when lock is held', async () => {
  const tmp = makeTmpDir();
  try {
    const lockPath = path.join(tmp, 'lock');
    // Create lock file manually to simulate held lock
    fs.writeFileSync(lockPath, '');
    const result = await tryWithFeatureLock(lockPath, async () => 'done');
    assert.strictEqual(result.kind, 'busy');
    fs.unlinkSync(lockPath);
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('tryWithFeatureLock returns ok when lock is free', async () => {
  const tmp = makeTmpDir();
  try {
    const lockPath = path.join(tmp, 'lock');
    const result = await tryWithFeatureLock(lockPath, async () => 42);
    assert.strictEqual(result.kind, 'ok');
    assert.strictEqual(result.value, 42);
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// actions.js
// ===========================================================================

console.log('\n📦 actions.js');

test('deriveAvailableActions shows pause during implementing', () => {
  const ctx = projectContext([
    { type: 'feature.started', featureId: '1', mode: 'solo_branch', agents: ['cc'], at: '2026-01-01T00:00:00Z' },
  ]);
  const actions = deriveAvailableActions(ctx);
  const kinds = actions.map((a) => a.kind);
  assert.ok(kinds.includes('pause-feature'));
  assert.ok(!kinds.includes('resume-feature'));
  assert.ok(!kinds.includes('feature-close'));
});

test('deriveAvailableActions shows eval when all agents ready', () => {
  const ctx = projectContext([
    { type: 'feature.started', featureId: '1', mode: 'fleet', agents: ['cc', 'gg'], at: '2026-01-01T00:00:00Z' },
    { type: 'signal.agent_ready', agentId: 'cc', at: '2026-01-01T01:00:00Z' },
    { type: 'signal.agent_ready', agentId: 'gg', at: '2026-01-01T01:00:00Z' },
  ]);
  const actions = deriveAvailableActions(ctx);
  const kinds = actions.map((a) => a.kind);
  assert.ok(kinds.includes('feature-eval'));
});

test('deriveAvailableActions shows close for solo feature when agent is ready', () => {
  const ctx = projectContext([
    { type: 'feature.started', featureId: '1', mode: 'solo_branch', agents: ['cc'], at: '2026-01-01T00:00:00Z' },
    { type: 'signal.agent_ready', agentId: 'cc', at: '2026-01-01T01:00:00Z' },
  ]);
  const actions = deriveAvailableActions(ctx);
  const kinds = actions.map((a) => a.kind);
  assert.ok(kinds.includes('feature-close'));
});

test('deriveAvailableActions shows resume during paused', () => {
  const ctx = projectContext([
    { type: 'feature.started', featureId: '1', mode: 'solo_branch', agents: ['cc'], at: '2026-01-01T00:00:00Z' },
    { type: 'feature.paused', at: '2026-01-01T01:00:00Z' },
  ]);
  const actions = deriveAvailableActions(ctx);
  const kinds = actions.map((a) => a.kind);
  assert.ok(kinds.includes('resume-feature'));
  assert.ok(!kinds.includes('pause-feature'));
});

test('deriveAvailableActions shows select-winner during evaluating', () => {
  const ctx = projectContext([
    { type: 'feature.started', featureId: '1', mode: 'fleet', agents: ['cc', 'gg'], at: '2026-01-01T00:00:00Z' },
    { type: 'signal.agent_ready', agentId: 'cc', at: '2026-01-01T01:00:00Z' },
    { type: 'signal.agent_ready', agentId: 'gg', at: '2026-01-01T01:00:00Z' },
    { type: 'feature.eval_requested', at: '2026-01-01T02:00:00Z' },
  ]);
  const actions = deriveAvailableActions(ctx);
  const kinds = actions.map((a) => a.kind);
  assert.ok(kinds.includes('select-winner'));
});

test('deriveAvailableActions shows close during ready_for_review', () => {
  const ctx = projectContext([
    { type: 'feature.started', featureId: '1', mode: 'fleet', agents: ['cc', 'gg'], at: '2026-01-01T00:00:00Z' },
    { type: 'signal.agent_ready', agentId: 'cc', at: '2026-01-01T01:00:00Z' },
    { type: 'signal.agent_ready', agentId: 'gg', at: '2026-01-01T01:00:00Z' },
    { type: 'feature.eval_requested', at: '2026-01-01T02:00:00Z' },
    { type: 'winner.selected', agentId: 'cc', at: '2026-01-01T03:00:00Z' },
  ]);
  const actions = deriveAvailableActions(ctx);
  const kinds = actions.map((a) => a.kind);
  assert.ok(kinds.includes('feature-close'));
});

test('deriveAvailableActions returns empty for done', () => {
  const ctx = projectContext([
    { type: 'feature.started', featureId: '1', mode: 'fleet', agents: ['cc', 'gg'], at: '2026-01-01T00:00:00Z' },
    { type: 'signal.agent_ready', agentId: 'cc', at: '2026-01-01T01:00:00Z' },
    { type: 'signal.agent_ready', agentId: 'gg', at: '2026-01-01T01:00:00Z' },
    { type: 'feature.eval_requested', at: '2026-01-01T02:00:00Z' },
    { type: 'winner.selected', agentId: 'cc', at: '2026-01-01T03:00:00Z' },
    { type: 'feature.close_requested', at: '2026-01-01T04:00:00Z' },
    { type: 'feature.closed', at: '2026-01-01T05:00:00Z' },
  ]);
  const actions = deriveAvailableActions(ctx);
  assert.strictEqual(actions.length, 0);
});

test('deriveAvailableActions shows restart/force-ready/drop for failed agents', () => {
  const ctx = projectContext([
    { type: 'feature.started', featureId: '1', mode: 'fleet', agents: ['cc', 'gg'], at: '2026-01-01T00:00:00Z' },
    { type: 'signal.agent_failed', agentId: 'gg', at: '2026-01-01T01:00:00Z' },
  ]);
  const actions = deriveAvailableActions(ctx);
  const ggActions = actions.filter((a) => a.agentId === 'gg');
  const ggKinds = ggActions.map((a) => a.kind);
  assert.ok(ggKinds.includes('restart-agent'));
  assert.ok(ggKinds.includes('force-agent-ready'));
  assert.ok(ggKinds.includes('drop-agent'));
});

// ===========================================================================
// engine.js — research lifecycle (not covered by lifecycle.test.js)
// ===========================================================================

console.log('\n📦 engine.js — research');

testAsync('research engine start/eval/close projects spec folders', async () => {
  const tmp = makeTmpDir();
  try {
    const backlog = path.join(tmp, 'docs', 'specs', 'research-topics', '02-backlog');
    const inProgress = path.join(tmp, 'docs', 'specs', 'research-topics', '03-in-progress');
    const inEval = path.join(tmp, 'docs', 'specs', 'research-topics', '04-in-evaluation');
    const done = path.join(tmp, 'docs', 'specs', 'research-topics', '05-done');
    fs.mkdirSync(backlog, { recursive: true });
    fs.mkdirSync(inProgress, { recursive: true });
    fs.mkdirSync(inEval, { recursive: true });
    fs.mkdirSync(done, { recursive: true });

    const fileName = 'research-07-workflow-migration.md';
    fs.writeFileSync(path.join(backlog, fileName), '# Research 07\n');

    const started = await engine.startResearch(tmp, '07', 'fleet', ['cc', 'gg']);
    assert.strictEqual(started.lifecycle, 'implementing');
    assert.ok(fs.existsSync(path.join(inProgress, fileName)));

    const evaluating = await engine.requestResearchEval(tmp, '07');
    assert.strictEqual(evaluating.lifecycle, 'evaluating');
    assert.ok(fs.existsSync(path.join(inEval, fileName)));

    const closed = await engine.closeResearch(tmp, '07');
    assert.strictEqual(closed.lifecycle, 'done');
    assert.ok(fs.existsSync(path.join(done, fileName)));
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// engine.js — signal guards (dedup + terminal state)
// ===========================================================================

console.log('\n📦 engine.js — signal guards');

test('isSignalRedundant returns true for agent-ready when already ready', () => {
  const snapshot = {
    currentSpecState: 'implementing',
    agents: { cc: { id: 'cc', status: 'ready', lastHeartbeatAt: null } },
  };
  assert.strictEqual(engine.isSignalRedundant(snapshot, 'signal.agent_ready', 'cc'), true);
});

test('isSignalRedundant returns false for agent-ready when agent is running', () => {
  const snapshot = {
    currentSpecState: 'implementing',
    agents: { cc: { id: 'cc', status: 'running', lastHeartbeatAt: null } },
  };
  assert.strictEqual(engine.isSignalRedundant(snapshot, 'signal.agent_ready', 'cc'), false);
});

test('isSignalRedundant returns true when feature is done', () => {
  const snapshot = {
    currentSpecState: 'done',
    agents: { cc: { id: 'cc', status: 'running', lastHeartbeatAt: null } },
  };
  assert.strictEqual(engine.isSignalRedundant(snapshot, 'signal.agent_ready', 'cc'), true);
});

test('isSignalRedundant returns true when feature is closing', () => {
  const snapshot = {
    currentSpecState: 'closing',
    agents: { cc: { id: 'cc', status: 'running', lastHeartbeatAt: null } },
  };
  assert.strictEqual(engine.isSignalRedundant(snapshot, 'signal.heartbeat', 'cc'), true);
});

test('isSignalRedundant returns true for duplicate session-lost', () => {
  const snapshot = {
    currentSpecState: 'implementing',
    agents: { cc: { id: 'cc', status: 'lost', lastHeartbeatAt: null } },
  };
  assert.strictEqual(engine.isSignalRedundant(snapshot, 'signal.session_lost', 'cc'), true);
});

test('isSignalRedundant returns true for duplicate heartbeat-expired', () => {
  const snapshot = {
    currentSpecState: 'implementing',
    agents: { cc: { id: 'cc', status: 'lost', lastHeartbeatAt: null } },
  };
  assert.strictEqual(engine.isSignalRedundant(snapshot, 'signal.heartbeat_expired', 'cc'), true);
});

test('isSignalRedundant returns true for duplicate agent-failed', () => {
  const snapshot = {
    currentSpecState: 'implementing',
    agents: { cc: { id: 'cc', status: 'failed', lastHeartbeatAt: null } },
  };
  assert.strictEqual(engine.isSignalRedundant(snapshot, 'signal.agent_failed', 'cc'), true);
});

test('isSignalRedundant returns false for heartbeat (no target status)', () => {
  const snapshot = {
    currentSpecState: 'implementing',
    agents: { cc: { id: 'cc', status: 'running', lastHeartbeatAt: null } },
  };
  assert.strictEqual(engine.isSignalRedundant(snapshot, 'signal.heartbeat', 'cc'), false);
});

testAsync('emitSignal deduplicates duplicate agent-ready', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '99', 'fleet', ['cc']);
    await engine.emitSignal(tmp, '99', 'agent-ready', 'cc');
    await engine.emitSignal(tmp, '99', 'agent-ready', 'cc'); // duplicate

    const events = await engine.listEvents(tmp, '99');
    const readyEvents = events.filter((e) => e.type === 'signal.agent_ready');
    assert.strictEqual(readyEvents.length, 1, 'Should have exactly one agent-ready event');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('emitSignal discards signals after feature is closed', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '99', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '99', 'agent-ready', 'cc');
    await engine.emitSignal(tmp, '99', 'agent-ready', 'gg');
    await engine.requestFeatureEval(tmp, '99');
    await engine.selectWinner(tmp, '99', 'cc');
    await engine.closeFeature(tmp, '99');

    const beforeCount = (await engine.listEvents(tmp, '99')).length;
    await engine.emitSignal(tmp, '99', 'heartbeat', 'cc'); // late signal
    const afterCount = (await engine.listEvents(tmp, '99')).length;

    assert.strictEqual(afterCount, beforeCount, 'No events should be appended after close');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('emitSignal allows agent-ready after restart (not deduped)', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '99', 'fleet', ['cc']);

    // First agent-ready
    await engine.emitSignal(tmp, '99', 'agent-ready', 'cc');
    let snapshot = await engine.showFeature(tmp, '99');
    assert.strictEqual(snapshot.agents.cc.status, 'ready');

    // Agent fails, then restarts (status goes back to running)
    await engine.emitSignal(tmp, '99', 'agent-failed', 'cc');
    snapshot = await engine.showFeature(tmp, '99');
    assert.strictEqual(snapshot.agents.cc.status, 'failed');

    await engine.restartAgent(tmp, '99', 'cc');
    snapshot = await engine.showFeature(tmp, '99');
    assert.strictEqual(snapshot.agents.cc.status, 'running');

    // Second agent-ready after restart — should NOT be deduped
    await engine.emitSignal(tmp, '99', 'agent-ready', 'cc');
    snapshot = await engine.showFeature(tmp, '99');
    assert.strictEqual(snapshot.agents.cc.status, 'ready');

    const events = await engine.listEvents(tmp, '99');
    const readyEvents = events.filter((e) => e.type === 'signal.agent_ready');
    assert.strictEqual(readyEvents.length, 2, 'Both agent-ready events should exist after restart cycle');
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// Summary
// ===========================================================================

// Wait for all async tests to complete
setTimeout(() => {
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}, 2000);
