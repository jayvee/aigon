#!/usr/bin/env node
'use strict';

/**
 * Tests for lib/workflow-snapshot-adapter.js
 * Run: node lib/workflow-snapshot-adapter.test.js
 *
 * Tests that the adapter correctly maps workflow-core snapshots to
 * dashboard/board data formats and falls back gracefully when absent.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const adapter = require('./workflow-snapshot-adapter');
const { LifecycleState, AgentStatus, ManualActionKind } = require('./workflow-core/types');

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

// --- Helpers ---

function makeTmpRepo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-snap-test-'));
    return dir;
}

function writeSnapshot(repoPath, featureId, snapshot) {
    const dir = path.join(repoPath, '.aigon', 'workflows', 'features', featureId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify(snapshot, null, 2));
}

function buildSnapshot(overrides = {}) {
    return {
        featureId: '42',
        lifecycle: LifecycleState.IMPLEMENTING,
        mode: 'fleet',
        winnerAgentId: null,
        agents: {
            cc: { id: 'cc', status: AgentStatus.RUNNING, lastHeartbeatAt: null },
            gg: { id: 'gg', status: AgentStatus.RUNNING, lastHeartbeatAt: null },
        },
        currentSpecState: 'implementing',
        specPath: '/repo/docs/specs/features/03-in-progress/feature-42-foo.md',
        effects: [],
        lastEffectError: null,
        availableActions: [
            { kind: ManualActionKind.PAUSE_FEATURE, label: 'Pause feature', eventType: 'feature.pause', recommendedOrder: 40 },
            { kind: ManualActionKind.RESTART_AGENT, label: 'Restart agent cc', eventType: 'restart-agent', recommendedOrder: 10, agentId: 'cc' },
        ],
        eventCount: 3,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T01:00:00Z',
        ...overrides,
    };
}

// --- Tests ---

console.log('# workflow-snapshot-adapter.js — exports');

test('exports required functions', () => {
    const required = [
        'readFeatureSnapshot',
        'readFeatureSnapshotSync',
        'readWorkflowSnapshotSync',
        'snapshotToStage',
        'snapshotAgentStatuses',
        'snapshotToDashboardActions',
        'snapshotToBoardCommand',
        'mapSnapshotActionToDashboard',
        'mapSnapshotActionToBoard',
        'LIFECYCLE_TO_STAGE',
        'AGENT_STATUS_TO_DASHBOARD',
    ];
    for (const name of required) {
        assert.ok(adapter[name] !== undefined, `missing export: ${name}`);
    }
});

// --- Lifecycle → Stage Mapping ---

console.log('\n# snapshotToStage');

test('maps implementing to in-progress', () => {
    const snap = buildSnapshot({ lifecycle: LifecycleState.IMPLEMENTING });
    assert.strictEqual(adapter.snapshotToStage(snap), 'in-progress');
});

test('maps evaluating to in-evaluation', () => {
    const snap = buildSnapshot({ lifecycle: LifecycleState.EVALUATING });
    assert.strictEqual(adapter.snapshotToStage(snap), 'in-evaluation');
});

test('maps ready_for_review to in-evaluation', () => {
    const snap = buildSnapshot({ lifecycle: LifecycleState.READY_FOR_REVIEW });
    assert.strictEqual(adapter.snapshotToStage(snap), 'in-evaluation');
});

test('maps closing to in-evaluation', () => {
    const snap = buildSnapshot({ lifecycle: LifecycleState.CLOSING });
    assert.strictEqual(adapter.snapshotToStage(snap), 'in-evaluation');
});

test('maps done to done', () => {
    const snap = buildSnapshot({ lifecycle: LifecycleState.DONE });
    assert.strictEqual(adapter.snapshotToStage(snap), 'done');
});

test('maps paused to paused', () => {
    const snap = buildSnapshot({ lifecycle: LifecycleState.PAUSED });
    assert.strictEqual(adapter.snapshotToStage(snap), 'paused');
});

test('returns null for null snapshot', () => {
    assert.strictEqual(adapter.snapshotToStage(null), null);
});

test('returns null for unknown lifecycle', () => {
    assert.strictEqual(adapter.snapshotToStage({ lifecycle: 'unknown_state' }), null);
});

// --- Agent Status Mapping ---

console.log('\n# snapshotAgentStatuses');

test('maps running → implementing', () => {
    const snap = buildSnapshot({ agents: { cc: { id: 'cc', status: 'running', lastHeartbeatAt: null } } });
    const statuses = adapter.snapshotAgentStatuses(snap);
    assert.strictEqual(statuses.cc, 'implementing');
});

test('maps ready → submitted', () => {
    const snap = buildSnapshot({ agents: { cc: { id: 'cc', status: 'ready', lastHeartbeatAt: null } } });
    const statuses = adapter.snapshotAgentStatuses(snap);
    assert.strictEqual(statuses.cc, 'submitted');
});

test('maps waiting → waiting', () => {
    const snap = buildSnapshot({ agents: { cc: { id: 'cc', status: 'waiting', lastHeartbeatAt: null } } });
    const statuses = adapter.snapshotAgentStatuses(snap);
    assert.strictEqual(statuses.cc, 'waiting');
});

test('maps failed → error', () => {
    const snap = buildSnapshot({ agents: { cc: { id: 'cc', status: 'failed', lastHeartbeatAt: null } } });
    const statuses = adapter.snapshotAgentStatuses(snap);
    assert.strictEqual(statuses.cc, 'error');
});

test('maps lost → error', () => {
    const snap = buildSnapshot({ agents: { cc: { id: 'cc', status: 'lost', lastHeartbeatAt: null } } });
    const statuses = adapter.snapshotAgentStatuses(snap);
    assert.strictEqual(statuses.cc, 'error');
});

test('maps idle → implementing', () => {
    const snap = buildSnapshot({ agents: { cc: { id: 'cc', status: 'idle', lastHeartbeatAt: null } } });
    const statuses = adapter.snapshotAgentStatuses(snap);
    assert.strictEqual(statuses.cc, 'implementing');
});

test('handles multiple agents', () => {
    const snap = buildSnapshot({
        agents: {
            cc: { id: 'cc', status: 'running', lastHeartbeatAt: null },
            gg: { id: 'gg', status: 'ready', lastHeartbeatAt: null },
        },
    });
    const statuses = adapter.snapshotAgentStatuses(snap);
    assert.strictEqual(statuses.cc, 'implementing');
    assert.strictEqual(statuses.gg, 'submitted');
});

test('returns empty object for null snapshot', () => {
    assert.deepStrictEqual(adapter.snapshotAgentStatuses(null), {});
});

// --- Dashboard Actions ---

console.log('\n# snapshotToDashboardActions');

test('converts available actions to dashboard format', () => {
    const snap = buildSnapshot();
    const result = adapter.snapshotToDashboardActions('feature', '42', snap);
    assert.ok(result.nextAction !== null, 'should have a nextAction');
    assert.ok(result.nextActions.length > 0, 'should have nextActions');
    assert.ok(result.validActions.length > 0, 'should have validActions');
});

test('nextAction is the first action', () => {
    const snap = buildSnapshot({
        availableActions: [
            { kind: ManualActionKind.PAUSE_FEATURE, label: 'Pause', eventType: 'feature.pause', recommendedOrder: 40 },
        ],
    });
    const result = adapter.snapshotToDashboardActions('feature', '42', snap);
    assert.strictEqual(result.nextAction.command, 'aigon feature-pause 42');
    assert.strictEqual(result.nextAction.reason, 'Pause feature execution');
});

test('validActions are dashboard action objects', () => {
    const snap = buildSnapshot({
        agents: {
            cc: { id: 'cc', status: AgentStatus.READY, lastHeartbeatAt: null },
            gg: { id: 'gg', status: AgentStatus.READY, lastHeartbeatAt: null },
        },
        currentSpecState: 'implementing',
    });
    const result = adapter.snapshotToDashboardActions('feature', '42', snap);
    assert.ok(Array.isArray(result.validActions));
    assert.ok(result.validActions.some(action => action.action === 'feature-eval'));
    assert.ok(result.validActions.every(action => typeof action.label === 'string'));
});

test('returns empty results for null snapshot', () => {
    const result = adapter.snapshotToDashboardActions('feature', '42', null);
    assert.strictEqual(result.nextAction, null);
    assert.deepStrictEqual(result.nextActions, []);
    assert.deepStrictEqual(result.validActions, []);
});

test('returns empty results for snapshot with no actions', () => {
    const snap = buildSnapshot({
        lifecycle: LifecycleState.DONE,
        currentSpecState: 'done',
        agents: {
            cc: { id: 'cc', status: AgentStatus.READY, lastHeartbeatAt: null },
            gg: { id: 'gg', status: AgentStatus.READY, lastHeartbeatAt: null },
        },
    });
    const result = adapter.snapshotToDashboardActions('feature', '42', snap);
    assert.strictEqual(result.nextAction, null);
    assert.deepStrictEqual(result.nextActions, []);
    assert.deepStrictEqual(result.validActions, []);
});

test('maps research actions to research commands', () => {
    const snap = {
        ...buildSnapshot(),
        entityType: 'research',
        lifecycle: LifecycleState.IMPLEMENTING,
        currentSpecState: 'implementing',
        availableActions: [
            { kind: ManualActionKind.RESEARCH_EVAL, label: 'Start evaluation', eventType: 'research.eval', recommendedOrder: 50 },
            { kind: ManualActionKind.RESEARCH_CLOSE, label: 'Close research', eventType: 'research.close', recommendedOrder: 70 },
        ],
    };
    const result = adapter.snapshotToDashboardActions('research', '42', snap);
    assert.ok(result.nextActions.some(action => action.action === 'research-eval'));
});

test('pads feature ID in commands', () => {
    const snap = buildSnapshot({
        agents: {
            cc: { id: 'cc', status: AgentStatus.READY, lastHeartbeatAt: null },
            gg: { id: 'gg', status: AgentStatus.READY, lastHeartbeatAt: null },
        },
        currentSpecState: 'implementing',
    });
    const result = adapter.snapshotToDashboardActions('feature', '5', snap);
    assert.ok(result.nextAction.command.includes('05'));
});

test('includes agentId in action output', () => {
    const snap = buildSnapshot({
        agents: {
            cc: { id: 'cc', status: AgentStatus.LOST, lastHeartbeatAt: null },
            gg: { id: 'gg', status: AgentStatus.RUNNING, lastHeartbeatAt: null },
        },
        currentSpecState: 'implementing',
    });
    const result = adapter.snapshotToDashboardActions('feature', '42', snap);
    assert.ok(result.nextActions.some(action => action.agentId === 'cc'));
});

// --- Board Actions ---

console.log('\n# snapshotToBoardCommand');

test('returns first valid board command from snapshot', () => {
    const snap = buildSnapshot({
        availableActions: [
            { kind: ManualActionKind.RESTART_AGENT, label: 'Restart cc', eventType: 'restart-agent', recommendedOrder: 10, agentId: 'cc' },
            { kind: ManualActionKind.PAUSE_FEATURE, label: 'Pause', eventType: 'feature.pause', recommendedOrder: 40 },
        ],
    });
    const cmd = adapter.snapshotToBoardCommand('feature', '42', snap);
    assert.strictEqual(cmd, 'aigon feature-open 42 cc');
});

test('skips non-board actions (force-ready, drop)', () => {
    const snap = buildSnapshot({
        availableActions: [
            { kind: ManualActionKind.FORCE_AGENT_READY, label: 'Force cc', eventType: 'force-agent-ready', recommendedOrder: 20, agentId: 'cc' },
            { kind: ManualActionKind.DROP_AGENT, label: 'Drop cc', eventType: 'drop-agent', recommendedOrder: 30, agentId: 'cc' },
            { kind: ManualActionKind.PAUSE_FEATURE, label: 'Pause', eventType: 'feature.pause', recommendedOrder: 40 },
        ],
    });
    const cmd = adapter.snapshotToBoardCommand('feature', '42', snap);
    assert.strictEqual(cmd, 'aigon feature-pause 42');
});

test('returns null for null snapshot', () => {
    assert.strictEqual(adapter.snapshotToBoardCommand('feature', '42', null), null);
});

test('returns null for snapshot with no actions', () => {
    const snap = buildSnapshot({ availableActions: [] });
    assert.strictEqual(adapter.snapshotToBoardCommand('feature', '42', snap), null);
});

test('solo restart maps to feature-do', () => {
    const snap = buildSnapshot({
        availableActions: [
            { kind: ManualActionKind.RESTART_AGENT, label: 'Restart', eventType: 'restart-agent', recommendedOrder: 10 },
        ],
    });
    const cmd = adapter.snapshotToBoardCommand('feature', '42', snap);
    assert.strictEqual(cmd, 'aigon feature-do 42');
});

// --- Snapshot Read (Sync) ---

console.log('\n# readFeatureSnapshotSync');

test('reads existing snapshot', () => {
    const repo = makeTmpRepo();
    try {
        const snap = buildSnapshot();
        writeSnapshot(repo, '42', snap);
        const result = adapter.readFeatureSnapshotSync(repo, '42');
        assert.strictEqual(result.featureId, '42');
        assert.strictEqual(result.lifecycle, 'implementing');
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

test('returns null for missing snapshot', () => {
    const repo = makeTmpRepo();
    try {
        const result = adapter.readFeatureSnapshotSync(repo, '999');
        assert.strictEqual(result, null);
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

test('returns null for corrupted snapshot', () => {
    const repo = makeTmpRepo();
    try {
        const dir = path.join(repo, '.aigon', 'workflows', 'features', '42');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'snapshot.json'), '{not valid json');
        const result = adapter.readFeatureSnapshotSync(repo, '42');
        assert.strictEqual(result, null);
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

// --- Snapshot Read (Async) ---

console.log('\n# readFeatureSnapshot (async)');

test('reads existing snapshot asynchronously', async () => {
    const repo = makeTmpRepo();
    try {
        const snap = buildSnapshot();
        writeSnapshot(repo, '42', snap);
        const result = await adapter.readFeatureSnapshot(repo, '42');
        assert.strictEqual(result.featureId, '42');
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

test('returns null for missing snapshot asynchronously', async () => {
    const repo = makeTmpRepo();
    try {
        const result = await adapter.readFeatureSnapshot(repo, '999');
        assert.strictEqual(result, null);
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

// --- Consistency: dashboard and board see same state ---

console.log('\n# Consistency between dashboard and board');

test('dashboard and board derive consistent actions from same snapshot', () => {
    const snap = buildSnapshot({
        lifecycle: LifecycleState.IMPLEMENTING,
        agents: {
            cc: { id: 'cc', status: AgentStatus.LOST, lastHeartbeatAt: null },
            gg: { id: 'gg', status: AgentStatus.RUNNING, lastHeartbeatAt: null },
        },
        currentSpecState: 'implementing',
        availableActions: [
            { kind: ManualActionKind.RESTART_AGENT, label: 'Restart cc', eventType: 'restart-agent', recommendedOrder: 10, agentId: 'cc' },
            { kind: ManualActionKind.PAUSE_FEATURE, label: 'Pause', eventType: 'feature.pause', recommendedOrder: 40 },
        ],
    });

    const dashActions = adapter.snapshotToDashboardActions('feature', '42', snap);
    const boardCmd = adapter.snapshotToBoardCommand('feature', '42', snap);

    // Both should see restart-agent as the first action (lowest recommendedOrder)
    assert.ok(dashActions.nextActions[0].action === 'feature-open', 'dashboard first action should be restart mapped to feature-open');
    assert.ok(boardCmd.includes('feature-open'), 'board command should be feature-open');
});

test('dashboard and board agree on feature-close with winner', () => {
    const snap = buildSnapshot({
        lifecycle: LifecycleState.EVALUATING,
        winnerAgentId: 'cc',
        currentSpecState: 'ready_for_review',
        agents: {
            cc: { id: 'cc', status: AgentStatus.READY, lastHeartbeatAt: null },
            gg: { id: 'gg', status: AgentStatus.READY, lastHeartbeatAt: null },
        },
        availableActions: [
            { kind: ManualActionKind.SELECT_WINNER, label: 'Select cc', eventType: 'select-winner', recommendedOrder: 60, agentId: 'cc' },
            { kind: ManualActionKind.FEATURE_CLOSE, label: 'Close', eventType: 'feature.close', recommendedOrder: 70 },
        ],
    });

    const dashActions = adapter.snapshotToDashboardActions('feature', '42', snap);
    const boardCmd = adapter.snapshotToBoardCommand('feature', '42', snap);

    // Both see select-winner first
    assert.ok(dashActions.nextActions[0].action === 'feature-close', 'dashboard maps select-winner to feature-close action');
    assert.ok(boardCmd.includes('feature-close'), 'board command should be feature-close');
    assert.ok(boardCmd.includes('cc'), 'board command should include winner agent');
});

// --- Side-effect freedom ---

console.log('\n# Side-effect freedom');

test('reading snapshot does not create or modify files', () => {
    const repo = makeTmpRepo();
    try {
        const snap = buildSnapshot();
        writeSnapshot(repo, '42', snap);

        // Snapshot the file state before read
        const snapshotPath = path.join(repo, '.aigon', 'workflows', 'features', '42', 'snapshot.json');
        const beforeMtime = fs.statSync(snapshotPath).mtimeMs;
        const beforeContent = fs.readFileSync(snapshotPath, 'utf8');

        // Do multiple reads
        adapter.readFeatureSnapshotSync(repo, '42');
        adapter.readFeatureSnapshotSync(repo, '42');

        // File unchanged
        const afterMtime = fs.statSync(snapshotPath).mtimeMs;
        const afterContent = fs.readFileSync(snapshotPath, 'utf8');
        assert.strictEqual(beforeMtime, afterMtime, 'mtime should not change');
        assert.strictEqual(beforeContent, afterContent, 'content should not change');

        // No lock file created
        const lockPath = path.join(repo, '.aigon', 'workflows', 'features', '42', 'lock');
        assert.ok(!fs.existsSync(lockPath), 'no lock file should be created during reads');
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

// --- Run async tests ---

async function runAsyncTests() {
    const repo1 = makeTmpRepo();
    try {
        const snap = buildSnapshot();
        writeSnapshot(repo1, '42', snap);
        const result = await adapter.readFeatureSnapshot(repo1, '42');
        assert.strictEqual(result.featureId, '42');
        console.log('  ✓ reads existing snapshot asynchronously');
        passed++;
    } catch (err) {
        console.error('  ✗ reads existing snapshot asynchronously');
        console.error(`    ${err.message}`);
        failed++;
    } finally {
        fs.rmSync(repo1, { recursive: true, force: true });
    }

    const repo2 = makeTmpRepo();
    try {
        const result = await adapter.readFeatureSnapshot(repo2, '999');
        assert.strictEqual(result, null);
        console.log('  ✓ returns null for missing snapshot asynchronously');
        passed++;
    } catch (err) {
        console.error('  ✗ returns null for missing snapshot asynchronously');
        console.error(`    ${err.message}`);
        failed++;
    } finally {
        fs.rmSync(repo2, { recursive: true, force: true });
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed > 0 ? 1 : 0;
}

runAsyncTests();
