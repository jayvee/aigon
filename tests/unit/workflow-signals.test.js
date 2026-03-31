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

const engine = require('../../lib/workflow-core/engine');
const { projectContext } = require('../../lib/workflow-core/projector');
const { readEvents } = require('../../lib/workflow-core/event-store');
const { getEventsPath, getSnapshotPath } = require('../../lib/workflow-core/paths');
const {
  readFeatureSnapshotSync,
  snapshotAgentStatuses,
  readFeatureEventsSync,
  filterAgentSignalEvents,
  AGENT_STATUS_TO_DASHBOARD,
} = require('../../lib/workflow-snapshot-adapter');
const {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  DEFAULT_HEARTBEAT_DEAD_MS,
  LIVENESS,
  getHeartbeatConfig,
  emitHeartbeat,
  computeAgentLiveness,
} = require('../../lib/workflow-heartbeat');
const { getRecoveryConfig } = require('../../lib/config');

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

testAsync('emitSignal session-lost records timestamp without changing status', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '03', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '03', 'agent-started', 'cc');
    await engine.emitSignal(tmp, '03', 'session-lost', 'cc');
    const snapshot = await engine.showFeature(tmp, '03');
    // Status should NOT change to 'lost' — liveness is display-only
    assert.strictEqual(snapshot.agents.cc.status, 'running');
    assert.ok(snapshot.agents.cc.lastHeartbeatExpiredAt, 'Should record lastHeartbeatExpiredAt');
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

testAsync('emitSignal heartbeat-expired records timestamp without changing status', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '07', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '07', 'agent-started', 'cc');
    await engine.emitSignal(tmp, '07', 'heartbeat-expired', 'cc');
    const snapshot = await engine.showFeature(tmp, '07');
    // Status should NOT change to 'lost' — liveness is display-only
    assert.strictEqual(snapshot.agents.cc.status, 'running');
    assert.ok(snapshot.agents.cc.lastHeartbeatExpiredAt, 'Should record lastHeartbeatExpiredAt');
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

testAsync('agentRecoverable guard allows restart of failed agent (was lost)', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '12', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '12', 'agent-failed', 'cc');
    const snapshot = await engine.showFeature(tmp, '12');
    assert.strictEqual(snapshot.agents.cc.status, 'failed');

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

testAsync('agentDroppable guard allows dropping failed agent in fleet', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '14', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '14', 'agent-failed', 'gg');

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

testAsync('snapshotAgentStatuses maps failed to error', async () => {
  const tmp = makeTmpDir();
  try {
    await engine.startFeature(tmp, '31', 'fleet', ['cc', 'gg']);
    await engine.emitSignal(tmp, '31', 'agent-failed', 'cc');
    // session-lost no longer changes status — gg stays running
    await engine.emitSignal(tmp, '31', 'session-lost', 'gg');

    const snapshot = readFeatureSnapshotSync(tmp, '31');
    const statuses = snapshotAgentStatuses(snapshot);
    assert.strictEqual(statuses.cc, 'error');         // failed → error
    assert.strictEqual(statuses.gg, 'implementing');  // running → implementing (session-lost is display-only)
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

// ===========================================================================
// computeAgentLiveness (display-only liveness computation)
// ===========================================================================

console.log('\n💓 computeAgentLiveness');

test('computeAgentLiveness returns alive when heartbeat is fresh', () => {
  const config = { timeoutMs: 120000, deadMs: 300000 };
  const result = computeAgentLiveness({
    heartbeatFileMs: Date.now() - 10000, // 10s ago
    lastHeartbeatAt: null,
    tmuxAlive: false,
    config,
  });
  assert.strictEqual(result.liveness, LIVENESS.ALIVE);
  assert.ok(result.lastSeenAt);
  assert.ok(result.heartbeatAgeMs < 120000);
});

test('computeAgentLiveness returns stale when past timeout but within dead', () => {
  const config = { timeoutMs: 120000, deadMs: 300000 };
  const result = computeAgentLiveness({
    heartbeatFileMs: Date.now() - 180000, // 3 min ago
    lastHeartbeatAt: null,
    tmuxAlive: false,
    config,
  });
  assert.strictEqual(result.liveness, LIVENESS.STALE);
});

test('computeAgentLiveness returns dead when past dead threshold', () => {
  const config = { timeoutMs: 120000, deadMs: 300000 };
  const result = computeAgentLiveness({
    heartbeatFileMs: Date.now() - 400000, // 6+ min ago
    lastHeartbeatAt: null,
    tmuxAlive: false,
    config,
  });
  assert.strictEqual(result.liveness, LIVENESS.DEAD);
});

test('computeAgentLiveness returns alive when tmux is alive regardless of heartbeat', () => {
  const config = { timeoutMs: 120000, deadMs: 300000 };
  const result = computeAgentLiveness({
    heartbeatFileMs: Date.now() - 400000, // way past dead
    lastHeartbeatAt: null,
    tmuxAlive: true, // but tmux is alive
    config,
  });
  assert.strictEqual(result.liveness, LIVENESS.ALIVE);
});

test('computeAgentLiveness returns unknown when no heartbeat and no tmux', () => {
  const config = { timeoutMs: 120000, deadMs: 300000 };
  const result = computeAgentLiveness({
    heartbeatFileMs: null,
    lastHeartbeatAt: null,
    tmuxAlive: false,
    config,
  });
  assert.strictEqual(result.liveness, LIVENESS.UNKNOWN);
  assert.strictEqual(result.lastSeenAt, null);
});

test('computeAgentLiveness uses most recent of file and engine timestamps', () => {
  const config = { timeoutMs: 120000, deadMs: 300000 };
  const recentEngine = new Date(Date.now() - 5000).toISOString(); // 5s ago
  const oldFile = Date.now() - 200000; // 3+ min ago
  const result = computeAgentLiveness({
    heartbeatFileMs: oldFile,
    lastHeartbeatAt: recentEngine,
    tmuxAlive: false,
    config,
  });
  // Should use the more recent engine timestamp
  assert.strictEqual(result.liveness, LIVENESS.ALIVE);
});

test('LIVENESS constants are correct', () => {
  assert.strictEqual(LIVENESS.ALIVE, 'alive');
  assert.strictEqual(LIVENESS.STALE, 'stale');
  assert.strictEqual(LIVENESS.DEAD, 'dead');
  assert.strictEqual(LIVENESS.UNKNOWN, 'unknown');
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
    await engine.emitSignal(tmp, '50', 'agent-failed', 'cc');

    await engine.restartAgent(tmp, '50', 'cc');
    let snapshot = await engine.showFeature(tmp, '50');
    assert.strictEqual(snapshot.agents.cc.status, 'running');
    assert.strictEqual(snapshot.agents.cc.restartCount, 1);

    // Fail and restart again
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
    await engine.emitSignal(tmp, '51', 'agent-failed', 'cc');

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
    await engine.emitSignal(tmp, '52', 'agent-failed', 'cc');
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
    await engine.emitSignal(tmp, '53', 'agent-failed', 'cc');
    await engine.escalateAgent(tmp, '53', 'cc');

    await engine.dropAgent(tmp, '53', 'cc');
    const snapshot = await engine.showFeature(tmp, '53');
    assert.strictEqual(snapshot.agents.cc, undefined);
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
