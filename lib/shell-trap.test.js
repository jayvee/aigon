#!/usr/bin/env node
'use strict';

/**
 * Tests for shell trap signal infrastructure (feature 169).
 *
 * Covers: buildAgentCommand shell trap wrapping, signal capability reading,
 * heartbeat config changes, and buildRawAgentCommand preservation.
 *
 * Run: node lib/shell-trap.test.js
 */

const assert = require('assert');

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`  \u2713 ${description}`);
    passed++;
  } catch (err) {
    console.error(`  \u2717 ${description}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

const {
  buildAgentCommand,
  buildRawAgentCommand,
  getAgentSignalCapabilities,
} = require('./worktree');

const {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  getHeartbeatConfig,
} = require('./workflow-heartbeat');

// ===========================================================================
// getAgentSignalCapabilities
// ===========================================================================

console.log('\n\ud83d\udee1\ufe0f  Agent signal capabilities');

test('cc agent has shellTrap, heartbeatSidecar, and cliHooks', () => {
  const caps = getAgentSignalCapabilities('cc');
  assert.strictEqual(caps.shellTrap, true);
  assert.strictEqual(caps.heartbeatSidecar, true);
  assert.ok(caps.cliHooks !== null, 'cc should have cliHooks');
  assert.strictEqual(caps.cliHooks.heartbeatTouch, 'PostToolUse');
  assert.strictEqual(caps.cliHooks.exitEnforcement, 'Stop');
});

test('gg agent has shellTrap, heartbeatSidecar, and cliHooks with AfterAgent', () => {
  const caps = getAgentSignalCapabilities('gg');
  assert.strictEqual(caps.shellTrap, true);
  assert.strictEqual(caps.heartbeatSidecar, true);
  assert.ok(caps.cliHooks !== null, 'gg should have cliHooks');
  assert.strictEqual(caps.cliHooks.heartbeatTouch, 'AfterAgent');
});

test('mv agent has shellTrap and heartbeatSidecar but no cliHooks', () => {
  const caps = getAgentSignalCapabilities('mv');
  assert.strictEqual(caps.shellTrap, true);
  assert.strictEqual(caps.heartbeatSidecar, true);
  assert.strictEqual(caps.cliHooks, null);
});

test('cx agent has shellTrap and heartbeatSidecar but no cliHooks', () => {
  const caps = getAgentSignalCapabilities('cx');
  assert.strictEqual(caps.shellTrap, true);
  assert.strictEqual(caps.heartbeatSidecar, true);
  assert.strictEqual(caps.cliHooks, null);
});

test('cu agent has shellTrap and heartbeatSidecar but no cliHooks', () => {
  const caps = getAgentSignalCapabilities('cu');
  assert.strictEqual(caps.shellTrap, true);
  assert.strictEqual(caps.heartbeatSidecar, true);
  assert.strictEqual(caps.cliHooks, null);
});

test('unknown agent gets default capabilities (shellTrap + heartbeat, no cliHooks)', () => {
  const caps = getAgentSignalCapabilities('zz');
  assert.strictEqual(caps.shellTrap, true);
  assert.strictEqual(caps.heartbeatSidecar, true);
  assert.strictEqual(caps.cliHooks, null);
});

// ===========================================================================
// buildAgentCommand shell trap wrapping
// ===========================================================================

console.log('\n\ud83d\udee0\ufe0f  buildAgentCommand shell trap');

test('buildAgentCommand wraps with trap EXIT handler', () => {
  const cmd = buildAgentCommand({ agent: 'cc', featureId: '01', desc: 'test' });
  assert.ok(cmd.includes('trap _aigon_cleanup EXIT'), 'should include trap EXIT');
  assert.ok(cmd.includes('_aigon_cleanup()'), 'should define cleanup function');
});

test('buildAgentCommand includes implementing signal on start', () => {
  const cmd = buildAgentCommand({ agent: 'cc', featureId: '01', desc: 'test' });
  assert.ok(cmd.includes('aigon agent-status implementing'), 'should signal implementing on start');
});

test('buildAgentCommand includes submitted on exit 0', () => {
  const cmd = buildAgentCommand({ agent: 'cc', featureId: '01', desc: 'test' });
  assert.ok(cmd.includes('aigon agent-status submitted'), 'should signal submitted');
});

test('buildAgentCommand includes error on non-zero exit', () => {
  const cmd = buildAgentCommand({ agent: 'cc', featureId: '01', desc: 'test' });
  assert.ok(cmd.includes('aigon agent-status error'), 'should signal error');
});

test('buildAgentCommand includes heartbeat sidecar', () => {
  const cmd = buildAgentCommand({ agent: 'cc', featureId: '01', desc: 'test' });
  assert.ok(cmd.includes('heartbeat-01-cc'), 'should touch heartbeat file with featureId-agentId');
  assert.ok(cmd.includes('kill -0 $$'), 'heartbeat should be tied to parent PID');
  assert.ok(cmd.includes('mkdir -p .aigon/state'), 'should create state dir');
});

test('buildAgentCommand heartbeat kills sidecar in cleanup', () => {
  const cmd = buildAgentCommand({ agent: 'cc', featureId: '01', desc: 'test' });
  assert.ok(cmd.includes('kill $_aigon_hb_pid'), 'cleanup should kill heartbeat sidecar');
});

test('buildAgentCommand includes the raw agent command at the end', () => {
  const raw = buildRawAgentCommand({ agent: 'cc', featureId: '01', desc: 'test' });
  const wrapped = buildAgentCommand({ agent: 'cc', featureId: '01', desc: 'test' });
  assert.ok(wrapped.includes(raw), 'wrapped command should contain the raw command');
});

test('buildAgentCommand uses correct feature ID and agent ID in heartbeat path', () => {
  const cmd = buildAgentCommand({ agent: 'gg', featureId: '42', desc: 'thing' });
  assert.ok(cmd.includes('heartbeat-42-gg'), 'heartbeat file should use correct IDs');
});

// ===========================================================================
// buildRawAgentCommand (unchanged behavior)
// ===========================================================================

console.log('\n\ud83d\udd27 buildRawAgentCommand preserves original behavior');

test('buildRawAgentCommand does not include trap handler or heartbeat', () => {
  const cmd = buildRawAgentCommand({ agent: 'cc', featureId: '01', desc: 'test' });
  assert.ok(!cmd.includes('trap _aigon_cleanup'), 'raw command should not include trap handler');
  assert.ok(!cmd.includes('heartbeat-'), 'raw command should not include heartbeat file');
  assert.ok(!cmd.includes('_aigon_cleanup'), 'raw command should not include cleanup function');
});

test('buildRawAgentCommand includes the agent CLI command', () => {
  const cmd = buildRawAgentCommand({ agent: 'cc', featureId: '01', desc: 'test' });
  assert.ok(cmd.includes('claude'), 'should include claude command for cc agent');
  assert.ok(cmd.includes('/aigon:feature-do 01'), 'should include the prompt');
});

// ===========================================================================
// Heartbeat config
// ===========================================================================

console.log('\n\u2764\ufe0f  Heartbeat configuration');

test('default heartbeat timeout is 120s (updated from 90s)', () => {
  assert.strictEqual(DEFAULT_HEARTBEAT_TIMEOUT_MS, 120000);
});

test('default heartbeat interval is 30s', () => {
  assert.strictEqual(DEFAULT_HEARTBEAT_INTERVAL_MS, 30000);
});

test('getHeartbeatConfig reads from heartbeat.* config path', () => {
  const config = { heartbeat: { intervalMs: 15000, timeoutMs: 60000 } };
  const result = getHeartbeatConfig(config);
  assert.strictEqual(result.intervalMs, 15000);
  assert.strictEqual(result.timeoutMs, 60000);
});

test('getHeartbeatConfig falls back to workflow.* config path', () => {
  const config = { workflow: { heartbeatIntervalMs: 20000, heartbeatTimeoutMs: 80000 } };
  const result = getHeartbeatConfig(config);
  assert.strictEqual(result.intervalMs, 20000);
  assert.strictEqual(result.timeoutMs, 80000);
});

test('getHeartbeatConfig prefers heartbeat.* over workflow.*', () => {
  const config = {
    heartbeat: { intervalMs: 10000, timeoutMs: 50000 },
    workflow: { heartbeatIntervalMs: 20000, heartbeatTimeoutMs: 80000 },
  };
  const result = getHeartbeatConfig(config);
  assert.strictEqual(result.intervalMs, 10000);
  assert.strictEqual(result.timeoutMs, 50000);
});

test('getHeartbeatConfig returns defaults for empty config', () => {
  const result = getHeartbeatConfig({});
  assert.strictEqual(result.intervalMs, DEFAULT_HEARTBEAT_INTERVAL_MS);
  assert.strictEqual(result.timeoutMs, DEFAULT_HEARTBEAT_TIMEOUT_MS);
});

test('getHeartbeatConfig returns defaults for undefined config', () => {
  const result = getHeartbeatConfig(undefined);
  assert.strictEqual(result.intervalMs, DEFAULT_HEARTBEAT_INTERVAL_MS);
  assert.strictEqual(result.timeoutMs, DEFAULT_HEARTBEAT_TIMEOUT_MS);
});

// ===========================================================================
// Results
// ===========================================================================

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
