#!/usr/bin/env node
'use strict';

/**
 * Tests for feature 184: Engine-driven actions for all interfaces.
 *
 * Covers: OPEN_SESSION action derivation, action metadata (category),
 * command mapper, bypass-machine actions, and snapshot adapter mapping.
 */

const assert = require('assert');
const { deriveAvailableActions } = require('../../lib/workflow-core/actions');
const { ManualActionKind, LifecycleState, AgentStatus } = require('../../lib/workflow-core/types');
const { formatActionCommand } = require('../../lib/action-command-mapper');
const adapter = require('../../lib/workflow-snapshot-adapter');

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
// Helpers
// ---------------------------------------------------------------------------

function buildContext(overrides = {}) {
  return {
    featureId: '42',
    lifecycle: LifecycleState.IMPLEMENTING,
    mode: 'solo_worktree',
    agents: {
      cc: { id: 'cc', status: AgentStatus.RUNNING, lastHeartbeatAt: new Date().toISOString() },
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    winnerAgentId: null,
    effects: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\n--- engine-driven actions tests (feature 184) ---\n');

// -- OPEN_SESSION in ManualActionKind --

test('ManualActionKind includes OPEN_SESSION', () => {
  assert.strictEqual(ManualActionKind.OPEN_SESSION, 'open-session');
});

// -- OPEN_SESSION derivation for running agents --

test('deriveAvailableActions includes open-session for running agent', () => {
  const ctx = buildContext();
  const actions = deriveAvailableActions(ctx, 'feature');
  const openActions = actions.filter(a => a.kind === ManualActionKind.OPEN_SESSION);
  assert.strictEqual(openActions.length, 1);
  assert.strictEqual(openActions[0].agentId, 'cc');
  assert.strictEqual(openActions[0].category, 'session');
});

test('deriveAvailableActions includes open-session for idle agent', () => {
  const ctx = buildContext({
    agents: { cc: { id: 'cc', status: AgentStatus.IDLE, lastHeartbeatAt: null } },
  });
  const actions = deriveAvailableActions(ctx, 'feature');
  const openActions = actions.filter(a => a.kind === ManualActionKind.OPEN_SESSION);
  assert.strictEqual(openActions.length, 1);
});

test('deriveAvailableActions excludes open-session for ready agent', () => {
  const ctx = buildContext({
    agents: { cc: { id: 'cc', status: AgentStatus.READY, lastHeartbeatAt: null } },
  });
  const actions = deriveAvailableActions(ctx, 'feature');
  const openActions = actions.filter(a => a.kind === ManualActionKind.OPEN_SESSION);
  assert.strictEqual(openActions.length, 0);
});

test('deriveAvailableActions excludes open-session for lost agent', () => {
  const ctx = buildContext({
    agents: { cc: { id: 'cc', status: AgentStatus.LOST, lastHeartbeatAt: null } },
  });
  const actions = deriveAvailableActions(ctx, 'feature');
  const openActions = actions.filter(a => a.kind === ManualActionKind.OPEN_SESSION);
  assert.strictEqual(openActions.length, 0);
});

test('deriveAvailableActions includes open-session per agent in fleet', () => {
  const ctx = buildContext({
    mode: 'fleet',
    agents: {
      cc: { id: 'cc', status: AgentStatus.RUNNING, lastHeartbeatAt: new Date().toISOString() },
      gg: { id: 'gg', status: AgentStatus.RUNNING, lastHeartbeatAt: new Date().toISOString() },
    },
  });
  const actions = deriveAvailableActions(ctx, 'feature');
  const openActions = actions.filter(a => a.kind === ManualActionKind.OPEN_SESSION);
  assert.strictEqual(openActions.length, 2);
  const agentIds = openActions.map(a => a.agentId).sort();
  assert.deepStrictEqual(agentIds, ['cc', 'gg']);
});

// -- OPEN_SESSION for research --

test('deriveAvailableActions includes open-session for research', () => {
  const ctx = buildContext({ lifecycle: LifecycleState.IMPLEMENTING });
  const actions = deriveAvailableActions(ctx, 'research');
  const openActions = actions.filter(a => a.kind === ManualActionKind.OPEN_SESSION);
  assert.strictEqual(openActions.length, 1);
  assert.strictEqual(openActions[0].category, 'session');
});

// -- Action metadata: category --

test('lifecycle actions have category lifecycle', () => {
  const ctx = buildContext();
  const actions = deriveAvailableActions(ctx, 'feature');
  const pause = actions.find(a => a.kind === ManualActionKind.PAUSE_FEATURE);
  assert.ok(pause, 'pause action should exist');
  assert.strictEqual(pause.category, 'lifecycle');
});

test('agent-control actions have category agent-control', () => {
  const ctx = buildContext({
    agents: { cc: { id: 'cc', status: AgentStatus.LOST, lastHeartbeatAt: null } },
  });
  const actions = deriveAvailableActions(ctx, 'feature');
  const restart = actions.find(a => a.kind === ManualActionKind.RESTART_AGENT);
  assert.ok(restart, 'restart action should exist for lost agent');
  assert.strictEqual(restart.category, 'agent-control');
});

test('session actions have category session', () => {
  const ctx = buildContext();
  const actions = deriveAvailableActions(ctx, 'feature');
  const open = actions.find(a => a.kind === ManualActionKind.OPEN_SESSION);
  assert.ok(open);
  assert.strictEqual(open.category, 'session');
});

// -- open-session has null eventType (not a state transition) --

test('open-session action has null eventType', () => {
  const ctx = buildContext();
  const actions = deriveAvailableActions(ctx, 'feature');
  const open = actions.find(a => a.kind === ManualActionKind.OPEN_SESSION);
  assert.strictEqual(open.eventType, null);
});

// -- open-session is sorted first (recommendedOrder: 5) --

test('open-session actions sort before lifecycle actions', () => {
  const ctx = buildContext();
  const actions = deriveAvailableActions(ctx, 'feature');
  const firstAction = actions[0];
  assert.strictEqual(firstAction.kind, ManualActionKind.OPEN_SESSION);
});

// -- Command mapper --

test('formatActionCommand handles open-session', () => {
  const cmd = formatActionCommand('open-session', '42', { agentId: 'cc' });
  assert.strictEqual(cmd, 'aigon terminal-attach 42 cc');
});

test('formatActionCommand handles open-session without agent', () => {
  const cmd = formatActionCommand('open-session', '42');
  assert.strictEqual(cmd, 'aigon terminal-attach 42');
});

// -- Snapshot adapter: mapSnapshotActionToDashboard --

test('mapSnapshotActionToDashboard handles open-session', () => {
  const action = {
    kind: ManualActionKind.OPEN_SESSION,
    label: 'Open cc',
    eventType: null,
    recommendedOrder: 5,
    agentId: 'cc',
    category: 'session',
  };
  const result = adapter.mapSnapshotActionToDashboard('feature', '42', action);
  assert.ok(result, 'should return a result');
  assert.strictEqual(result.action, 'open-session');
  assert.strictEqual(result.agentId, 'cc');
  assert.strictEqual(result.category, 'session');
  assert.strictEqual(result.kind, ManualActionKind.OPEN_SESSION);
  assert.ok(result.command.includes('terminal-attach'));
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
