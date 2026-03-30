#!/usr/bin/env node
'use strict';

/**
 * Tests for workflow engine agent signals (feature 166).
 *
 * Covers: signal emission, heartbeat mechanism, guard enforcement,
 * snapshot adapter reads, and event filtering.
 *
 * Run: node lib/workflow-signals.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const asyncTests = [];

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

function testAsync(description, fn) {
  asyncTests.push(
    fn()
      .then(() => {
        console.log(`  ✓ ${description}`);
        passed++;
      })
      .catch((err) => {
        console.error(`  ✗ ${description}`);
        console.error(`    ${err.message}`);
        failed++;
      })
  );
}

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-signals-test-'));
}

function cleanTmpDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

const engine = require('./workflow-core/engine');
const { projectContext } = require('./workflow-core/projector');
const { readEvents } = require('./workflow-core/event-store');
const { getEventsPath, getSnapshotPath } = require('./workflow-core/paths');
const {
  readFeatureSnapshotSync,
  snapshotAgentStatuses,
  readFeatureEventsSync,
  filterAgentSignalEvents,
  AGENT_STATUS_TO_DASHBOARD,
} = require('./workflow-snapshot-adapter');
const {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  getHeartbeatConfig,
  emitHeartbeat,
  sweepExpiredHeartbeats,
  sweepAgentRecovery,
} = require('./workflow-heartbeat');
const { getRecoveryConfig } = require('./config');

// ===========================================================================
// Signal emission via engine
// ===========================================================================

console.log('\n📡 Signal emission');

testAsync('emitSignal agent-ready sets agent status to ready', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '01', 'fleet', ['cc', 'gg']);
    const before = await engine.showFeature(tmp, '01');
    assert.strictEqual(before.agents.cc.status, 'running');

    await engine.emitSignal(tmp, '01', 'agent-ready', 'cc');
    const after = await engine.showFeature(tmp, '01');
    assert.strictEqual(after.agents.cc.status, 'ready');
    assert.strictEqual(after.agents.gg.status, 'running'); // Other agent unchanged
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('emitSignal agent-failed sets agent status to failed', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '02', 'solo_worktree', ['cc']);
    await engine.emitSignal(tmp, '02', 'agent-failed', 'cc');
    const snapshot = await engine.showFeature(tmp, '02');
    assert.strictEqual(snapshot.agents.cc.status, 'failed');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('emitSignal session-lost sets agent status to lost', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '03', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '03', 'agent-started', 'cc');
    await engine.emitSignal(tmp, '03', 'session-lost', 'cc');
    const snapshot = await engine.showFeature(tmp, '03');
    assert.strictEqual(snapshot.agents.cc.status, 'lost');
    assert.strictEqual(snapshot.agents.gg.status, 'running'); // Unaffected
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('emitSignal agent-started sets agent status to running', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '04', 'solo_worktree', ['cc']);
    await engine.emitSignal(tmp, '04', 'agent-started', 'cc');
    const snapshot = await engine.showFeature(tmp, '04');
    assert.strictEqual(snapshot.agents.cc.status, 'running');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('emitSignal agent-waiting sets agent status to waiting', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '05', 'solo_worktree', ['cc']);
    await engine.emitSignal(tmp, '05', 'agent-waiting', 'cc');
    const snapshot = await engine.showFeature(tmp, '05');
    assert.strictEqual(snapshot.agents.cc.status, 'waiting');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('emitSignal heartbeat updates lastHeartbeatAt without changing status', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '06', 'solo_worktree', ['cc']);
    await engine.emitSignal(tmp, '06', 'agent-started', 'cc');
    const before = await engine.showFeature(tmp, '06');
    assert.strictEqual(before.agents.cc.status, 'running');
    const beforeBeat = before.agents.cc.lastHeartbeatAt;

    await engine.emitSignal(tmp, '06', 'heartbeat', 'cc');
    const after = await engine.showFeature(tmp, '06');
    assert.strictEqual(after.agents.cc.status, 'running'); // Status unchanged
    assert.notStrictEqual(after.agents.cc.lastHeartbeatAt, beforeBeat); // Timestamp updated
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('emitSignal heartbeat-expired sets agent status to lost', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '07', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '07', 'agent-started', 'cc');
    await engine.emitSignal(tmp, '07', 'heartbeat-expired', 'cc');
    const snapshot = await engine.showFeature(tmp, '07');
    assert.strictEqual(snapshot.agents.cc.status, 'lost');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('emitSignal ignores unknown agents gracefully', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '08', 'solo_worktree', ['cc']);
    // Should not throw for unknown agent
    await engine.emitSignal(tmp, '08', 'agent-ready', 'nonexistent');
    const snapshot = await engine.showFeature(tmp, '08');
    assert.strictEqual(snapshot.agents.cc.status, 'running');
    assert.strictEqual(snapshot.agents.nonexistent, undefined);
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// XState guard enforcement with signals
// ===========================================================================

console.log('\n🛡️  XState guard enforcement');

testAsync('allAgentsReady guard passes when all agents have signal.agent_ready', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '10', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '10', 'agent-ready', 'cc');
    await engine.emitSignal(tmp, '10', 'agent-ready', 'gg');

    // requestFeatureEval should succeed (guard passes)
    await engine.requestFeatureEval(tmp, '10');
    const snapshot = await engine.showFeature(tmp, '10');
    assert.strictEqual(snapshot.currentSpecState, 'evaluating');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('allAgentsReady guard blocks eval when not all agents are ready', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '11', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '11', 'agent-ready', 'cc');
    // gg is still idle

    try {
      await engine.requestFeatureEval(tmp, '11');
      assert.fail('Should have thrown — guard should block');
    } catch (err) {
      assert.ok(err.message.includes('invalid'), `Expected guard error, got: ${err.message}`);
    }
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('agentRecoverable guard allows restart of lost agent', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '12', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '12', 'session-lost', 'cc');
    const snapshot = await engine.showFeature(tmp, '12');
    assert.strictEqual(snapshot.agents.cc.status, 'lost');

    // Restart should work
    await engine.restartAgent(tmp, '12', 'cc');
    const after = await engine.showFeature(tmp, '12');
    assert.strictEqual(after.agents.cc.status, 'running');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('agentRecoverable guard allows restart of failed agent', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '13', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '13', 'agent-failed', 'gg');

    await engine.restartAgent(tmp, '13', 'gg');
    const after = await engine.showFeature(tmp, '13');
    assert.strictEqual(after.agents.gg.status, 'running');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('agentDroppable guard allows dropping lost agent in fleet', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '14', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '14', 'session-lost', 'gg');

    await engine.dropAgent(tmp, '14', 'gg');
    const after = await engine.showFeature(tmp, '14');
    assert.strictEqual(after.agents.gg, undefined); // Dropped
    assert.strictEqual(after.agents.cc.status, 'running'); // Remaining agent intact
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('eval works after signal-based agent readiness (no synthesis needed)', async () => {
  const tmp = makeTmpDir();
  try {
    // Simulate full flow: start → agent-started → agent-ready → eval
    await engine.startFeature(tmp, '15', 'solo_worktree', ['cc']);
    await engine.emitSignal(tmp, '15', 'agent-started', 'cc');
    await engine.emitSignal(tmp, '15', 'agent-ready', 'cc');

    await engine.requestFeatureEval(tmp, '15');
    const snapshot = await engine.showFeature(tmp, '15');
    assert.strictEqual(snapshot.currentSpecState, 'evaluating');
    assert.strictEqual(snapshot.agents.cc.status, 'ready');
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// Projector replay of signals
// ===========================================================================

console.log('\n🎬 Projector replay');

testAsync('projector correctly replays signal events from event log', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '20', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '20', 'agent-started', 'cc');
    await engine.emitSignal(tmp, '20', 'heartbeat', 'cc');
    await engine.emitSignal(tmp, '20', 'agent-ready', 'cc');
    await engine.emitSignal(tmp, '20', 'agent-failed', 'gg');

    // Read raw events and replay through projector
    const events = await readEvents(getEventsPath(tmp, '20'));
    const context = projectContext(events);
    assert.strictEqual(context.agents.cc.status, 'ready');
    assert.strictEqual(context.agents.gg.status, 'failed');
    assert.ok(context.agents.cc.lastHeartbeatAt); // Heartbeat updated timestamp
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// Snapshot adapter
// ===========================================================================

console.log('\n📊 Snapshot adapter');

testAsync('snapshotAgentStatuses maps engine status to dashboard status', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '30', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '30', 'agent-started', 'cc');
    await engine.emitSignal(tmp, '30', 'agent-ready', 'gg');

    const snapshot = readFeatureSnapshotSync(tmp, '30');
    assert.ok(snapshot, 'Snapshot should exist');

    const statuses = snapshotAgentStatuses(snapshot);
    assert.strictEqual(statuses.cc, 'implementing'); // running → implementing
    assert.strictEqual(statuses.gg, 'submitted');    // ready → submitted
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('snapshotAgentStatuses maps failed/lost to error', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '31', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '31', 'agent-failed', 'cc');
    await engine.emitSignal(tmp, '31', 'session-lost', 'gg');

    const snapshot = readFeatureSnapshotSync(tmp, '31');
    const statuses = snapshotAgentStatuses(snapshot);
    assert.strictEqual(statuses.cc, 'error'); // failed → error
    assert.strictEqual(statuses.gg, 'error'); // lost → error
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('readFeatureEventsSync reads event log', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '32', 'solo_worktree', ['cc']);
    await engine.emitSignal(tmp, '32', 'agent-started', 'cc');
    await engine.emitSignal(tmp, '32', 'agent-ready', 'cc');

    const events = readFeatureEventsSync(tmp, '32');
    assert.ok(events.length >= 3); // started + agent_started + agent_ready
    assert.strictEqual(events[0].type, 'feature.started');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('filterAgentSignalEvents filters to signal events only', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '33', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '33', 'agent-started', 'cc');
    await engine.emitSignal(tmp, '33', 'heartbeat', 'cc');
    await engine.emitSignal(tmp, '33', 'agent-ready', 'cc');

    const allEvents = readFeatureEventsSync(tmp, '33');
    const signals = filterAgentSignalEvents(allEvents);
    assert.ok(signals.length === 3); // agent_started, heartbeat, agent_ready
    assert.ok(signals.every(e => e.type.startsWith('signal.')));
  } finally {
    cleanTmpDir(tmp);
  }
});

test('readFeatureEventsSync returns empty array for missing feature', () => {
  const events = readFeatureEventsSync('/nonexistent/repo', '99');
  assert.deepStrictEqual(events, []);
});

test('readFeatureSnapshotSync returns null for missing feature', () => {
  const snapshot = readFeatureSnapshotSync('/nonexistent/repo', '99');
  assert.strictEqual(snapshot, null);
});

// ===========================================================================
// Heartbeat module
// ===========================================================================

console.log('\n💓 Heartbeat mechanism');

test('getHeartbeatConfig returns defaults when no config', () => {
  const config = getHeartbeatConfig();
  assert.strictEqual(config.intervalMs, DEFAULT_HEARTBEAT_INTERVAL_MS);
  assert.strictEqual(config.timeoutMs, DEFAULT_HEARTBEAT_TIMEOUT_MS);
});

test('getHeartbeatConfig reads from project config', () => {
  const config = getHeartbeatConfig({
    workflow: { heartbeatIntervalMs: 15000, heartbeatTimeoutMs: 45000 },
  });
  assert.strictEqual(config.intervalMs, 15000);
  assert.strictEqual(config.timeoutMs, 45000);
});

testAsync('emitHeartbeat updates agent lastHeartbeatAt', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '40', 'solo_worktree', ['cc']);
    await engine.emitSignal(tmp, '40', 'agent-started', 'cc');

    await emitHeartbeat(tmp, '40', 'cc');
    const snapshot = await engine.showFeature(tmp, '40');
    assert.ok(snapshot.agents.cc.lastHeartbeatAt);
    assert.strictEqual(snapshot.agents.cc.status, 'running'); // Status unchanged
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('sweepExpiredHeartbeats detects expired agent', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '41', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '41', 'agent-started', 'cc');
    await engine.emitSignal(tmp, '41', 'agent-started', 'gg');

    // Sweep with 0ms timeout — everything is expired
    const expired = await sweepExpiredHeartbeats(tmp, '41', { timeoutMs: 0 });
    assert.ok(expired.length === 2, `Expected 2 expired, got ${expired.length}`);
    assert.ok(expired.includes('cc'));
    assert.ok(expired.includes('gg'));

    const snapshot = await engine.showFeature(tmp, '41');
    assert.strictEqual(snapshot.agents.cc.status, 'lost');
    assert.strictEqual(snapshot.agents.gg.status, 'lost');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('sweepExpiredHeartbeats skips ready agents', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '42', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '42', 'agent-ready', 'cc');
    await engine.emitSignal(tmp, '42', 'agent-started', 'gg');

    // Sweep with 0ms timeout — only gg should be expired (cc is ready)
    const expired = await sweepExpiredHeartbeats(tmp, '42', { timeoutMs: 0 });
    assert.ok(expired.length === 1, `Expected 1 expired, got ${expired.length}`);
    assert.strictEqual(expired[0], 'gg');

    const snapshot = await engine.showFeature(tmp, '42');
    assert.strictEqual(snapshot.agents.cc.status, 'ready'); // Unchanged
    assert.strictEqual(snapshot.agents.gg.status, 'lost');  // Expired
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('sweepExpiredHeartbeats returns empty for non-engine features', async () => {
  const expired = await sweepExpiredHeartbeats('/nonexistent', '99', { timeoutMs: 0 });
  assert.deepStrictEqual(expired, []);
});

testAsync('sweepExpiredHeartbeats with recent heartbeat does not expire', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '43', 'solo_worktree', ['cc']);
    await engine.emitSignal(tmp, '43', 'agent-started', 'cc');
    await emitHeartbeat(tmp, '43', 'cc');

    // Sweep with very high timeout — nothing should expire
    const expired = await sweepExpiredHeartbeats(tmp, '43', { timeoutMs: 999999999 });
    assert.deepStrictEqual(expired, []);

    const snapshot = await engine.showFeature(tmp, '43');
    assert.strictEqual(snapshot.agents.cc.status, 'running');
  } finally {
    cleanTmpDir(tmp);
  }
});

// ===========================================================================
// AGENT_STATUS_TO_DASHBOARD mapping
// ===========================================================================

console.log('\n🗺️  Status mapping constants');

test('AGENT_STATUS_TO_DASHBOARD covers all engine agent statuses', () => {
  assert.strictEqual(AGENT_STATUS_TO_DASHBOARD.idle, 'implementing');
  assert.strictEqual(AGENT_STATUS_TO_DASHBOARD.running, 'implementing');
  assert.strictEqual(AGENT_STATUS_TO_DASHBOARD.waiting, 'waiting');
  assert.strictEqual(AGENT_STATUS_TO_DASHBOARD.ready, 'submitted');
  assert.strictEqual(AGENT_STATUS_TO_DASHBOARD.failed, 'error');
  assert.strictEqual(AGENT_STATUS_TO_DASHBOARD.lost, 'error');
  assert.strictEqual(AGENT_STATUS_TO_DASHBOARD.needs_attention, 'needs-attention');
});

// ===========================================================================
// Recovery: restartCount tracking, needs-attention, auto-restart sweep
// ===========================================================================

console.log('\n♻️  Recovery and enforcement');

testAsync('restartAgent increments restartCount in projector', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '50', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '50', 'session-lost', 'cc');

    await engine.restartAgent(tmp, '50', 'cc');
    let snapshot = await engine.showFeature(tmp, '50');
    assert.strictEqual(snapshot.agents.cc.status, 'running');
    assert.strictEqual(snapshot.agents.cc.restartCount, 1);

    // Lose and restart again
    await engine.emitSignal(tmp, '50', 'agent-failed', 'cc');
    await engine.restartAgent(tmp, '50', 'cc');
    snapshot = await engine.showFeature(tmp, '50');
    assert.strictEqual(snapshot.agents.cc.restartCount, 2);
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('escalateAgent transitions agent to needs_attention', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '51', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '51', 'session-lost', 'cc');

    await engine.escalateAgent(tmp, '51', 'cc');
    const snapshot = await engine.showFeature(tmp, '51');
    assert.strictEqual(snapshot.agents.cc.status, 'needs_attention');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('needs_attention agent can be force-readied', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '52', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '52', 'session-lost', 'cc');
    await engine.escalateAgent(tmp, '52', 'cc');

    await engine.forceAgentReady(tmp, '52', 'cc');
    const snapshot = await engine.showFeature(tmp, '52');
    assert.strictEqual(snapshot.agents.cc.status, 'ready');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('needs_attention agent can be dropped', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '53', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '53', 'session-lost', 'cc');
    await engine.escalateAgent(tmp, '53', 'cc');

    await engine.dropAgent(tmp, '53', 'cc');
    const snapshot = await engine.showFeature(tmp, '53');
    assert.strictEqual(snapshot.agents.cc, undefined);
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('sweepAgentRecovery auto-restarts lost agent under max retries', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '54', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '54', 'session-lost', 'cc');

    const result = await sweepAgentRecovery(tmp, '54', {
      recoveryConfig: { autoRestart: true, maxRetries: 2 },
    });
    assert.deepStrictEqual(result.restarted, ['cc']);
    assert.deepStrictEqual(result.escalated, []);

    const snapshot = await engine.showFeature(tmp, '54');
    assert.strictEqual(snapshot.agents.cc.status, 'running');
    assert.strictEqual(snapshot.agents.cc.restartCount, 1);
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('sweepAgentRecovery escalates after max retries exhausted', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '55', 'fleet', ['cc', 'gg']);

    // Simulate 2 prior restarts
    await engine.emitSignal(tmp, '55', 'session-lost', 'cc');
    await engine.restartAgent(tmp, '55', 'cc');
    await engine.emitSignal(tmp, '55', 'session-lost', 'cc');
    await engine.restartAgent(tmp, '55', 'cc');
    await engine.emitSignal(tmp, '55', 'session-lost', 'cc');

    // Now sweep — should escalate, not restart
    const result = await sweepAgentRecovery(tmp, '55', {
      recoveryConfig: { autoRestart: true, maxRetries: 2 },
    });
    assert.deepStrictEqual(result.restarted, []);
    assert.deepStrictEqual(result.escalated, ['cc']);

    const snapshot = await engine.showFeature(tmp, '55');
    assert.strictEqual(snapshot.agents.cc.status, 'needs_attention');
  } finally {
    cleanTmpDir(tmp);
  }
});

testAsync('sweepAgentRecovery escalates immediately when autoRestart is disabled', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '56', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '56', 'session-lost', 'cc');

    const result = await sweepAgentRecovery(tmp, '56', {
      recoveryConfig: { autoRestart: false, maxRetries: 2 },
    });
    assert.deepStrictEqual(result.restarted, []);
    assert.deepStrictEqual(result.escalated, ['cc']);

    const snapshot = await engine.showFeature(tmp, '56');
    assert.strictEqual(snapshot.agents.cc.status, 'needs_attention');
  } finally {
    cleanTmpDir(tmp);
  }
});

test('getRecoveryConfig returns defaults when no config provided', () => {
  const config = getRecoveryConfig({});
  assert.strictEqual(config.autoRestart, true);
  assert.strictEqual(config.maxRetries, 2);
});

test('getRecoveryConfig respects overrides', () => {
  const config = getRecoveryConfig({ recovery: { autoRestart: false, maxRetries: 5 } });
  assert.strictEqual(config.autoRestart, false);
  assert.strictEqual(config.maxRetries, 5);
});

test('recovery events appear in filterAgentSignalEvents', () => {
  const events = [
    { type: 'feature.started' },
    { type: 'agent.restarted', agentId: 'cc' },
    { type: 'agent.needs_attention', agentId: 'cc' },
    { type: 'agent.force_ready', agentId: 'cc' },
    { type: 'agent.dropped', agentId: 'gg' },
    { type: 'signal.heartbeat', agentId: 'cc' },
  ];
  const filtered = filterAgentSignalEvents(events);
  assert.strictEqual(filtered.length, 5); // all except feature.started
});

// ===========================================================================
// Summary
// ===========================================================================

Promise.all(asyncTests).then(() => {
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
});
