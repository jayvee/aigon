#!/usr/bin/env node
// REGRESSION F561: feature-autonomous-stop must persist stopped sidecar state
// without mutating workflow lifecycle, and expose Stop automation in read-model.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, testAsync, withTempDir, withTempDirAsync, report, seedEntityDirs, writeSpec, writeSnap } = require('../_helpers');
const { stop } = require('../../lib/feature-autonomous');
const { readFeatureAutoState } = require('../../lib/auto-session-state');
const workflowSnapshotAdapter = require('../../lib/workflow-snapshot-adapter');
const wrm = require('../../lib/workflow-read-model');
const {
    appendFeatureAutonomousDashboardActions,
    isFeatureAutonomousActive,
} = require('../../lib/feature-autonomous-dashboard-actions');

function buildStopDeps(repo) {
    return {
        resolveMainRepoPath: () => repo,
        ctx: {
            git: {},
            utils: {
                assertTmuxAvailable: () => { throw new Error('tmux unavailable'); },
            },
        },
    };
}

testAsync('feature-autonomous-stop writes stopped sidecar without changing workflow snapshot', () => withTempDirAsync('aigon-f561-stop-', async (repo) => {
    const prevForce = process.env.AIGON_FORCE_PRO;
    process.env.AIGON_FORCE_PRO = 'true';
    seedEntityDirs(repo, 'features');
    writeSpec(repo, 'features', '03-in-progress', 'feature-561-autonomous-review-takeover.md');
    writeSnap(repo, 'features', '561', 'code_review_in_progress');
    const autoPath = path.join(repo, '.aigon', 'state', 'feature-561-auto.json');
    fs.mkdirSync(path.dirname(autoPath), { recursive: true });
    fs.writeFileSync(autoPath, JSON.stringify({
        featureId: '561',
        status: 'running',
        running: true,
        sessionName: 'aigon-f561-auto',
        agents: ['cu'],
        stopAfter: 'close',
    }, null, 2));

    const before = workflowSnapshotAdapter.readFeatureSnapshotSync(repo, '561');
    await stop(['561'], buildStopDeps(repo));
    if (prevForce === undefined) delete process.env.AIGON_FORCE_PRO;
    else process.env.AIGON_FORCE_PRO = prevForce;
    const after = workflowSnapshotAdapter.readFeatureSnapshotSync(repo, '561');
    assert.strictEqual(after.currentSpecState, before.currentSpecState, 'workflow lifecycle unchanged');
    const auto = readFeatureAutoState(repo, '561');
    assert.strictEqual(auto.status, 'stopped');
    assert.strictEqual(auto.running, false);
    assert.strictEqual(auto.reason, 'stopped-by-user');
    assert.ok(auto.endedAt);
    assert.strictEqual(auto.sessionName, 'aigon-f561-auto', 'prior session metadata preserved');
}));

test('read-model exposes Stop automation while autonomous state is active', () => withTempDir('aigon-f561-stop-', (repo) => {
    seedEntityDirs(repo, 'features');
    writeSpec(repo, 'features', '03-in-progress', 'feature-561-autonomous-review-takeover.md');
    writeSnap(repo, 'features', '561', 'implementing');
    const autoPath = path.join(repo, '.aigon', 'state', 'feature-561-auto.json');
    fs.mkdirSync(path.dirname(autoPath), { recursive: true });
    fs.writeFileSync(autoPath, JSON.stringify({
        featureId: '561',
        status: 'running',
        running: true,
        sessionName: 'aigon-f561-auto',
    }, null, 2));

    const autoState = readFeatureAutoState(repo, '561');
    assert.strictEqual(isFeatureAutonomousActive(repo, '561', autoState), true);
    const actions = appendFeatureAutonomousDashboardActions(repo, '561', autoState, []);
    const stopAction = actions.find((a) => a.action === 'feature-autonomous-stop');
    assert.ok(stopAction, 'stop action present');
    assert.strictEqual(stopAction.label, 'Stop automation');
    assert.strictEqual(stopAction.priority, undefined);

    const state = wrm.getFeatureDashboardState(repo, '561', 'in-progress', []);
    assert.ok(state.validActions.some((a) => a.action === 'feature-autonomous-stop'));
}));

test('stopped autonomous state no longer offers Stop automation', () => withTempDir('aigon-f561-stop-', (repo) => {
    const autoState = {
        featureId: '561',
        status: 'stopped',
        running: false,
        reason: 'stopped-by-user',
    };
    assert.strictEqual(isFeatureAutonomousActive(repo, '561', autoState), false);
    const actions = appendFeatureAutonomousDashboardActions(repo, '561', autoState, []);
    assert.strictEqual(actions.length, 0);
}));

report();
