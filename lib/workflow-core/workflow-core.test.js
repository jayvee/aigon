#!/usr/bin/env node
'use strict';

/**
 * Unit tests for lib/workflow-core/
 * Run: node lib/workflow-core/workflow-core.test.js
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

const {
  FeatureMode,
  LifecycleState,
  AgentStatus,
  ManualActionKind,
  WorkflowEffectStatus,
  createAgentState,
  createWorkflowEffect,
} = require('./types');

const {
  getFeatureRoot,
  getEventsPath,
  getSnapshotPath,
  getLockPath,
  getSpecPath,
} = require('./paths');

const { readEvents, appendEvent } = require('./event-store');
const { readSnapshot, writeSnapshot } = require('./snapshot-store');
const { withFeatureLock, tryWithFeatureLock } = require('./lock');
const { projectContext } = require('./projector');
const { deriveAvailableActions } = require('./actions');
const { featureMachine } = require('./machine');
const engine = require('./engine');
const researchEngine = require('./research-engine');

// ===========================================================================
// types.js
// ===========================================================================

console.log('\n📦 types.js');

test('FeatureMode enum has expected values', () => {
  assert.strictEqual(FeatureMode.SOLO_BRANCH, 'solo_branch');
  assert.strictEqual(FeatureMode.SOLO_WORKTREE, 'solo_worktree');
  assert.strictEqual(FeatureMode.FLEET, 'fleet');
});

test('LifecycleState enum has all states', () => {
  const states = Object.values(LifecycleState);
  assert.ok(states.includes('backlog'));
  assert.ok(states.includes('implementing'));
  assert.ok(states.includes('reviewing'));
  assert.ok(states.includes('ready_for_review'));
  assert.ok(states.includes('evaluating'));
  assert.ok(states.includes('closing'));
  assert.ok(states.includes('done'));
  assert.ok(states.includes('paused'));
  assert.strictEqual(states.length, 8);
});

test('createAgentState returns correct shape', () => {
  const agent = createAgentState('cc', 'running', '2026-01-01T00:00:00Z');
  assert.strictEqual(agent.id, 'cc');
  assert.strictEqual(agent.status, 'running');
  assert.strictEqual(agent.lastHeartbeatAt, '2026-01-01T00:00:00Z');
});

test('createWorkflowEffect adds status fields', () => {
  const effect = createWorkflowEffect({ id: 'test', type: 'move_spec', payload: {} });
  assert.strictEqual(effect.status, 'requested');
  assert.strictEqual(effect.claimedAt, null);
  assert.strictEqual(effect.reclaimCount, 0);
  assert.strictEqual(effect.lastError, null);
});

// ===========================================================================
// paths.js
// ===========================================================================

console.log('\n📦 paths.js');

test('getFeatureRoot uses .aigon/workflows/', () => {
  const root = getFeatureRoot('/repo', '42');
  assert.ok(root.includes('.aigon'));
  assert.ok(root.includes('workflows'));
  assert.ok(root.includes('features'));
  assert.ok(root.endsWith('42'));
});

test('getEventsPath returns JSONL path', () => {
  assert.ok(getEventsPath('/repo', '42').endsWith('events.jsonl'));
});

test('getSnapshotPath returns JSON path', () => {
  assert.ok(getSnapshotPath('/repo', '42').endsWith('snapshot.json'));
});

test('getLockPath returns lock file path', () => {
  assert.ok(getLockPath('/repo', '42').endsWith('lock'));
});

test('getSpecPath returns spec path under lifecycle dir', () => {
  const specPath = getSpecPath('/repo', '42', 'implementing');
  assert.ok(specPath.includes('03-in-progress'));
  assert.ok(specPath.endsWith('42.md'));
});

// ===========================================================================
// event-store.js
// ===========================================================================

console.log('\n📦 event-store.js');

testAsync('readEvents returns empty array for missing file', async () => {
  const events = await readEvents('/nonexistent/events.jsonl');
  assert.deepStrictEqual(events, []);
});

testAsync('appendEvent + readEvents round-trips events', async () => {
  const tmp = makeTmpDir();
  try {
    const eventsPath = path.join(tmp, 'events.jsonl');
    const event1 = { type: 'feature.started', featureId: '1', mode: 'fleet', agents: ['cc'], at: '2026-01-01T00:00:00Z' };
    const event2 = { type: 'feature.paused', at: '2026-01-01T01:00:00Z' };

    await appendEvent(eventsPath, event1);
    await appendEvent(eventsPath, event2);

    const events = await readEvents(eventsPath);
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].type, 'feature.started');
    assert.strictEqual(events[1].type, 'feature.paused');
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// snapshot-store.js
// ===========================================================================

console.log('\n📦 snapshot-store.js');

testAsync('readSnapshot returns null for missing file', async () => {
  const result = await readSnapshot('/nonexistent/snapshot.json');
  assert.strictEqual(result, null);
});

testAsync('writeSnapshot + readSnapshot round-trips', async () => {
  const tmp = makeTmpDir();
  try {
    const snapshotPath = path.join(tmp, 'snapshot.json');
    const snapshot = { featureId: '42', lifecycle: 'implementing', eventCount: 1 };
    await writeSnapshot(snapshotPath, snapshot);
    const read = await readSnapshot(snapshotPath);
    assert.deepStrictEqual(read, snapshot);
  } finally {
    cleanTmpDir(tmp);
  }
});

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
// projector.js
// ===========================================================================

console.log('\n📦 projector.js');

test('projectContext returns null for empty events', () => {
  assert.strictEqual(projectContext([]), null);
});

test('projectContext initializes from feature.started', () => {
  const events = [
    { type: 'feature.started', featureId: '42', mode: 'fleet', agents: ['cc', 'gg'], at: '2026-01-01T00:00:00Z' },
  ];
  const ctx = projectContext(events);
  assert.strictEqual(ctx.featureId, '42');
  assert.strictEqual(ctx.mode, 'fleet');
  assert.strictEqual(ctx.currentSpecState, 'implementing');
  assert.strictEqual(Object.keys(ctx.agents).length, 2);
  assert.strictEqual(ctx.agents.cc.status, 'running');
  assert.strictEqual(ctx.agents.gg.status, 'running');
});

test('projectContext handles pause/resume cycle', () => {
  const events = [
    { type: 'feature.started', featureId: '1', mode: 'solo_branch', agents: ['cc'], at: '2026-01-01T00:00:00Z' },
    { type: 'feature.paused', at: '2026-01-01T01:00:00Z' },
  ];
  assert.strictEqual(projectContext(events).currentSpecState, 'paused');

  events.push({ type: 'feature.resumed', at: '2026-01-01T02:00:00Z' });
  assert.strictEqual(projectContext(events).currentSpecState, 'implementing');
});

test('projectContext handles agent signals', () => {
  const events = [
    { type: 'feature.started', featureId: '1', mode: 'fleet', agents: ['cc', 'gg'], at: '2026-01-01T00:00:00Z' },
    { type: 'signal.agent_ready', agentId: 'cc', at: '2026-01-01T01:00:00Z' },
    { type: 'signal.agent_failed', agentId: 'gg', at: '2026-01-01T01:30:00Z' },
  ];
  const ctx = projectContext(events);
  assert.strictEqual(ctx.agents.cc.status, 'ready');
  assert.strictEqual(ctx.agents.gg.status, 'failed');
});

test('projectContext handles full lifecycle to done', () => {
  const events = [
    { type: 'feature.started', featureId: '1', mode: 'fleet', agents: ['cc', 'gg'], at: '2026-01-01T00:00:00Z' },
    { type: 'signal.agent_ready', agentId: 'cc', at: '2026-01-01T01:00:00Z' },
    { type: 'signal.agent_ready', agentId: 'gg', at: '2026-01-01T01:00:00Z' },
    { type: 'feature.eval_requested', at: '2026-01-01T02:00:00Z' },
    { type: 'winner.selected', agentId: 'cc', at: '2026-01-01T03:00:00Z' },
    { type: 'feature.close_requested', at: '2026-01-01T04:00:00Z' },
    { type: 'feature.closed', at: '2026-01-01T05:00:00Z' },
  ];
  const ctx = projectContext(events);
  assert.strictEqual(ctx.currentSpecState, 'done');
  assert.strictEqual(ctx.winnerAgentId, 'cc');
});

test('projectContext handles effect lifecycle', () => {
  const events = [
    { type: 'feature.started', featureId: '1', mode: 'solo_branch', agents: ['cc'], at: '2026-01-01T00:00:00Z' },
    {
      type: 'effect.requested',
      effect: { id: 'e1', type: 'move_spec', payload: {} },
      at: '2026-01-01T01:00:00Z',
    },
    { type: 'effect.claimed', effectId: 'e1', at: '2026-01-01T01:01:00Z' },
    { type: 'effect.succeeded', effectId: 'e1', at: '2026-01-01T01:02:00Z' },
  ];
  const ctx = projectContext(events);
  assert.strictEqual(ctx.effects.length, 1);
  assert.strictEqual(ctx.effects[0].status, 'succeeded');
});

test('projectContext handles agent dropped', () => {
  const events = [
    { type: 'feature.started', featureId: '1', mode: 'fleet', agents: ['cc', 'gg'], at: '2026-01-01T00:00:00Z' },
    { type: 'agent.dropped', agentId: 'gg', at: '2026-01-01T01:00:00Z' },
  ];
  const ctx = projectContext(events);
  assert.strictEqual(Object.keys(ctx.agents).length, 1);
  assert.strictEqual(ctx.agents.gg, undefined);
});

test('projectContext handles session lost / heartbeat expired', () => {
  const events = [
    { type: 'feature.started', featureId: '1', mode: 'fleet', agents: ['cc', 'gg'], at: '2026-01-01T00:00:00Z' },
    { type: 'signal.session_lost', agentId: 'cc', at: '2026-01-01T01:00:00Z' },
    { type: 'signal.heartbeat_expired', agentId: 'gg', at: '2026-01-01T01:00:00Z' },
  ];
  const ctx = projectContext(events);
  assert.strictEqual(ctx.agents.cc.status, 'lost');
  assert.strictEqual(ctx.agents.gg.status, 'lost');
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
// engine.js — persistence round-trip against temp directory
// ===========================================================================

console.log('\n📦 engine.js');

testAsync('startFeature creates events and snapshot', async () => {
  const tmp = makeTmpDir();
  try {
    const snapshot = await engine.startFeature(tmp, '99', 'fleet', ['cc', 'gg']);
    assert.strictEqual(snapshot.featureId, '99');
    assert.strictEqual(snapshot.lifecycle, 'implementing');
    assert.strictEqual(snapshot.mode, 'fleet');
    assert.ok(snapshot.agents.cc);
    assert.ok(snapshot.agents.gg);
    assert.strictEqual(snapshot.eventCount, 1);

    // Verify event log was written
    const events = await readEvents(getEventsPath(tmp, '99'));
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'feature.started');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('emitSignal persists agent signals', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '99', 'fleet', ['cc']);
    const snapshot = await engine.emitSignal(tmp, '99', 'agent-ready', 'cc');
    assert.strictEqual(snapshot.agents.cc.status, 'ready');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('showFeature rebuilds snapshot from events', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '99', 'solo_branch', ['cc']);
    const snapshot = await engine.showFeature(tmp, '99');
    assert.strictEqual(snapshot.featureId, '99');
    assert.strictEqual(snapshot.lifecycle, 'implementing');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('listActions returns action strings', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '99', 'solo_branch', ['cc']);
    const actions = await engine.listActions(tmp, '99');
    assert.ok(actions.includes('pause-feature'));
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('pauseFeature transitions to paused', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '99', 'solo_branch', ['cc']);
    const snapshot = await engine.pauseFeature(tmp, '99');
    assert.strictEqual(snapshot.lifecycle, 'paused');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('requestFeatureEval transitions when agents ready', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '99', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '99', 'agent-ready', 'cc');
    await engine.emitSignal(tmp, '99', 'agent-ready', 'gg');
    const snapshot = await engine.requestFeatureEval(tmp, '99');
    assert.strictEqual(snapshot.lifecycle, 'evaluating');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('selectWinner transitions to ready_for_review', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '99', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '99', 'agent-ready', 'cc');
    await engine.emitSignal(tmp, '99', 'agent-ready', 'gg');
    await engine.requestFeatureEval(tmp, '99');
    const snapshot = await engine.selectWinner(tmp, '99', 'cc');
    assert.strictEqual(snapshot.lifecycle, 'ready_for_review');
    assert.strictEqual(snapshot.winnerAgentId, 'cc');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('tryCloseFeatureWithEffects closes solo ready feature without explicit winner selection', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '99', 'solo_branch', ['cc']);
    await engine.emitSignal(tmp, '99', 'agent-ready', 'cc');

    const result = await engine.tryCloseFeatureWithEffects(tmp, '99', async () => {});
    assert.strictEqual(result.kind, 'complete');
    assert.strictEqual(result.snapshot.lifecycle, 'done');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('listEvents returns full event history', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '99', 'solo_branch', ['cc']);
    await engine.pauseFeature(tmp, '99');
    const events = await engine.listEvents(tmp, '99');
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].type, 'feature.started');
    assert.strictEqual(events[1].type, 'feature.paused');
  } finally {
    cleanTmpDir(tmp);
  }
});

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

    const started = await researchEngine.startResearch(tmp, '07', 'fleet', ['cc', 'gg']);
    assert.strictEqual(started.lifecycle, 'implementing');
    assert.ok(fs.existsSync(path.join(inProgress, fileName)));

    const evaluating = await researchEngine.requestResearchEval(tmp, '07');
    assert.strictEqual(evaluating.lifecycle, 'evaluating');
    assert.ok(fs.existsSync(path.join(inEval, fileName)));

    const closed = await researchEngine.closeResearch(tmp, '07');
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
