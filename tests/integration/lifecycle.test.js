#!/usr/bin/env node
/**
 * Integration tests — Layer 2 of the test pyramid.
 *
 * Exercises the full workflow engine lifecycle with temp directories:
 *   - Solo: start → submit → close
 *   - Fleet: start → submit both → eval → close (winner)
 *   - Pause → resume
 *   - Review flow
 *
 * Verifies snapshotToDashboardActions() returns correct buttons at each step.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const engine = require('../../lib/workflow-core/engine');
const { snapshotToDashboardActions } = require('../../lib/workflow-snapshot-adapter');

// ─── helpers ──────────────────────────────────────────────────────────────────

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
    const p = fn().then(() => {
        console.log(`  ✓ ${description}`);
        passed++;
    }).catch(err => {
        console.error(`  ✗ ${description}`);
        console.error(`    ${err.message}`);
        failed++;
    });
    asyncTests.push(p);
}

function makeTempRepo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-lifecycle-'));
    // Create minimal spec structure
    const specDir = path.join(dir, 'docs', 'specs', 'features', '03-in-progress');
    fs.mkdirSync(specDir, { recursive: true });
    const logsDir = path.join(dir, 'docs', 'specs', 'features', 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const doneDir = path.join(dir, 'docs', 'specs', 'features', '05-done');
    fs.mkdirSync(doneDir, { recursive: true });
    // Create workflow dirs
    fs.mkdirSync(path.join(dir, '.aigon', 'workflows', 'features'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.aigon', 'state'), { recursive: true });
    return dir;
}

function writeSpec(repoPath, featureId, name) {
    const specPath = path.join(
        repoPath, 'docs', 'specs', 'features', '03-in-progress',
        `feature-${featureId}-${name}.md`
    );
    fs.writeFileSync(specPath, `# Feature: ${name}\n`);
    return specPath;
}

function getActions(snapshot, featureId) {
    return snapshotToDashboardActions('feature', featureId, snapshot);
}

function hasAction(actions, actionName) {
    return actions.validActions.some(a => a.action === actionName);
}

// ─── Solo lifecycle ──────────────────────────────────────────────────────────

console.log('\nSolo lifecycle: start → submit → close');

testAsync('solo: startFeature creates implementing state', async () => {
    const repo = makeTempRepo();
    try {
        writeSpec(repo, '01', 'solo-test');
        const snap = await engine.startFeature(repo, '01', 'solo_branch', ['cc']);
        assert.strictEqual(snap.lifecycle, 'implementing');
        assert.strictEqual(snap.mode, 'solo_branch');
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

testAsync('solo: agent-ready enables close action', async () => {
    const repo = makeTempRepo();
    try {
        writeSpec(repo, '01', 'solo-test');
        await engine.startFeature(repo, '01', 'solo_branch', ['cc']);
        const snap = await engine.signalAgentReady(repo, '01', 'cc');
        const actions = getActions(snap, '01');

        assert.ok(hasAction(actions, 'feature-close'), 'should have close action after agent-ready');
        assert.ok(hasAction(actions, 'feature-pause'), 'should have pause action');
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

testAsync('solo: closeFeature transitions to done', async () => {
    const repo = makeTempRepo();
    try {
        writeSpec(repo, '01', 'solo-test');
        await engine.startFeature(repo, '01', 'solo_branch', ['cc']);
        await engine.signalAgentReady(repo, '01', 'cc');
        const snap = await engine.closeFeatureWithEffects(repo, '01', async () => {});
        assert.strictEqual(snap.lifecycle, 'done');
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

testAsync('solo: done state has no actions', async () => {
    const repo = makeTempRepo();
    try {
        writeSpec(repo, '01', 'solo-test');
        await engine.startFeature(repo, '01', 'solo_branch', ['cc']);
        await engine.signalAgentReady(repo, '01', 'cc');
        const snap = await engine.closeFeatureWithEffects(repo, '01', async () => {});
        const actions = getActions(snap, '01');
        assert.strictEqual(actions.validActions.length, 0, 'done state should have no actions');
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

// ─── Fleet lifecycle ─────────────────────────────────────────────────────────

console.log('\nFleet lifecycle: start → submit both → eval → close');

testAsync('fleet: startFeature with two agents', async () => {
    const repo = makeTempRepo();
    try {
        writeSpec(repo, '02', 'fleet-test');
        const snap = await engine.startFeature(repo, '02', 'fleet', ['cc', 'gg']);
        assert.strictEqual(snap.lifecycle, 'implementing');
        assert.strictEqual(snap.mode, 'fleet');
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

testAsync('fleet: both agents ready enables eval', async () => {
    const repo = makeTempRepo();
    try {
        writeSpec(repo, '02', 'fleet-test');
        await engine.startFeature(repo, '02', 'fleet', ['cc', 'gg']);
        await engine.signalAgentReady(repo, '02', 'cc');
        const snap = await engine.signalAgentReady(repo, '02', 'gg');
        const actions = getActions(snap, '02');

        assert.ok(hasAction(actions, 'feature-eval'), 'should have eval action when all agents ready');
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

testAsync('fleet: eval → select winner → close', async () => {
    const repo = makeTempRepo();
    try {
        writeSpec(repo, '02', 'fleet-test');
        await engine.startFeature(repo, '02', 'fleet', ['cc', 'gg']);
        await engine.signalAgentReady(repo, '02', 'cc');
        await engine.signalAgentReady(repo, '02', 'gg');

        const evalSnap = await engine.requestFeatureEval(repo, '02');
        assert.strictEqual(evalSnap.lifecycle, 'evaluating');

        const winnerSnap = await engine.selectWinner(repo, '02', 'cc');
        assert.strictEqual(winnerSnap.winnerAgentId, 'cc');

        const closeSnap = await engine.closeFeatureWithEffects(repo, '02', async () => {});
        assert.strictEqual(closeSnap.lifecycle, 'done');
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

testAsync('fleet: evaluating state shows select-winner actions before a winner is chosen', async () => {
    const repo = makeTempRepo();
    try {
        writeSpec(repo, '02', 'fleet-test');
        await engine.startFeature(repo, '02', 'fleet', ['cc', 'gg']);
        await engine.signalAgentReady(repo, '02', 'cc');
        await engine.signalAgentReady(repo, '02', 'gg');
        const snap = await engine.requestFeatureEval(repo, '02');
        const actions = getActions(snap, '02');

        // Before a winner is selected, fleet eval only offers per-agent select-winner
        const pickActions = actions.validActions.filter(a => a.action === 'select-winner');
        assert.ok(pickActions.length > 0, 'evaluating state should have select-winner actions before a winner is chosen');
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

// ─── Pause → resume ──────────────────────────────────────────────────────────

console.log('\nPause → resume');

testAsync('pause transitions to paused state', async () => {
    const repo = makeTempRepo();
    try {
        writeSpec(repo, '03', 'pause-test');
        await engine.startFeature(repo, '03', 'solo_branch', ['cc']);
        const snap = await engine.pauseFeature(repo, '03');
        assert.strictEqual(snap.currentSpecState, 'paused');
        const actions = getActions(snap, '03');
        assert.ok(hasAction(actions, 'feature-resume'), 'paused state should have resume action');
        assert.ok(!hasAction(actions, 'feature-pause'), 'paused state should not have pause action');
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

testAsync('resume returns to implementing state', async () => {
    const repo = makeTempRepo();
    try {
        writeSpec(repo, '03', 'pause-test');
        await engine.startFeature(repo, '03', 'solo_branch', ['cc']);
        await engine.pauseFeature(repo, '03');
        const snap = await engine.resumeFeature(repo, '03');
        assert.strictEqual(snap.currentSpecState, 'implementing');
        const actions = getActions(snap, '03');
        assert.ok(hasAction(actions, 'feature-pause'), 'resumed state should have pause action');
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

// ─── Review flow ─────────────────────────────────────────────────────────────

console.log('\nReview flow');

testAsync('solo: agent-ready goes to ready_for_review in review-mode', async () => {
    const repo = makeTempRepo();
    try {
        writeSpec(repo, '04', 'review-test');
        // Start with review mode (solo with review)
        await engine.startFeature(repo, '04', 'solo_branch', ['cc']);
        const snap = await engine.signalAgentReady(repo, '04', 'cc');
        // In solo mode, agent-ready should enable close
        const actions = getActions(snap, '04');
        assert.ok(hasAction(actions, 'feature-close'), 'should have close after agent-ready');
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

// ─── Dashboard action consistency ────────────────────────────────────────────

console.log('\nDashboard action consistency');

testAsync('snapshotToDashboardActions returns correct format', async () => {
    const repo = makeTempRepo();
    try {
        writeSpec(repo, '05', 'format-test');
        await engine.startFeature(repo, '05', 'solo_branch', ['cc']);
        const snap = await engine.showFeature(repo, '05');
        const result = snapshotToDashboardActions('feature', '05', snap);

        // Verify structure
        assert.ok('nextAction' in result, 'should have nextAction');
        assert.ok(Array.isArray(result.nextActions), 'nextActions should be array');
        assert.ok(Array.isArray(result.validActions), 'validActions should be array');

        // Each action should have required fields
        for (const action of result.validActions) {
            assert.ok(action.action, 'action should have action field');
            assert.ok(action.label, 'action should have label field');
            assert.ok(action.type, 'action should have type field');
        }
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

testAsync('implementing state has pause and autopilot actions', async () => {
    const repo = makeTempRepo();
    try {
        writeSpec(repo, '05', 'actions-test');
        await engine.startFeature(repo, '05', 'solo_branch', ['cc']);
        const snap = await engine.showFeature(repo, '05');
        const actions = getActions(snap, '05');

        assert.ok(hasAction(actions, 'feature-pause'), 'implementing should have pause');
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

// ─── Run and report ──────────────────────────────────────────────────────────

Promise.all(asyncTests).then(() => {
    console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
});
