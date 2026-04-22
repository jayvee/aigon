#!/usr/bin/env node
// REGRESSION F275: snapshot lifecycle overrides visible folder stage.
// REGRESSION F271 `936d2da7`: research read-model tolerates null entityId.
// REGRESSION F276: detect-only spec drift; AIGON_AUTO_RECONCILE=1 opts into moves.
// Snapshotless-spec coverage lives in tests/integration/f294-legacy-cleanup.test.js.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, testAsync, withTempDir, withTempDirAsync, report, ENTITY_STAGE_DIRS, seedEntityDirs, writeSpec, writeSnap } = require('../_helpers');
const wrm = require('../../lib/workflow-read-model');
const board = require('../../lib/board');
const workflowEngine = require('../../lib/workflow-core/engine');

const seed = (repo) => {
    for (const kind of ['features', 'research-topics']) seedEntityDirs(repo, kind);
};
const writeFeatureAuto = (repo, id, payload) => {
    const file = path.join(repo, '.aigon', 'state', `feature-${String(id).padStart(2, '0')}-auto.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
};

for (const [kind, getState] of [['features', wrm.getFeatureDashboardState], ['research-topics', wrm.getResearchDashboardState]]) {
    const id = kind === 'features' ? '12' : '21';
    test(`${kind}: snapshot lifecycle overrides visible folder stage`, () => withTempDir('aigon-rm-', (repo) => {
        seed(repo);
        writeSpec(repo, kind, '02-backlog', `${kind === 'features' ? 'feature' : 'research'}-${id}-x.md`);
        writeSnap(repo, kind === 'features' ? 'features' : 'research', id, 'implementing');
        const s = getState(repo, id, 'backlog', []);
        assert.strictEqual(s.stage, 'in-progress');
        assert.strictEqual(s.readModelSource, wrm.WORKFLOW_SOURCE.SNAPSHOT);
        if (kind === 'features') assert.ok(s.validActions.length > 0);
    }));
}

test('spec drift is detect-only by default; AIGON_AUTO_RECONCILE=1 moves the file', () => withTempDir('aigon-rm-', (repo) => {
    seed(repo);
    writeSpec(repo, 'features', '02-backlog', 'feature-16-x.md');
    writeSnap(repo, 'features', '16', 'implementing');
    delete process.env.AIGON_AUTO_RECONCILE;
    const detect = wrm.getFeatureDashboardState(repo, '16', 'backlog', []);
    assert.deepStrictEqual(detect.specDrift, {
        currentPath: 'docs/specs/features/02-backlog/feature-16-x.md',
        expectedPath: 'docs/specs/features/03-in-progress/feature-16-x.md',
        lifecycle: 'implementing',
    });
    assert.ok(fs.existsSync(path.join(repo, 'docs/specs/features/02-backlog/feature-16-x.md')));

    writeSpec(repo, 'features', '02-backlog', 'feature-17-x.md');
    writeSnap(repo, 'features', '17', 'implementing');
    process.env.AIGON_AUTO_RECONCILE = '1';
    try {
        const moved = wrm.getFeatureDashboardState(repo, '17', 'backlog', []);
        assert.strictEqual(moved.specDrift, null);
        assert.ok(!fs.existsSync(path.join(repo, 'docs/specs/features/02-backlog/feature-17-x.md')));
        assert.ok(fs.existsSync(path.join(repo, 'docs/specs/features/03-in-progress/feature-17-x.md')));
    } finally { delete process.env.AIGON_AUTO_RECONCILE; }
}));

test('board re-buckets snapshot-backed features and carries spec drift', () => withTempDir('aigon-rm-', (repo) => {
    seed(repo);
    writeSpec(repo, 'features', '02-backlog', 'feature-14-x.md');
    writeSpec(repo, 'features', '02-backlog', 'feature-15-legacy.md');
    writeSpec(repo, 'features', '02-backlog', 'feature-18-x.md');
    writeSnap(repo, 'features', '14', 'implementing');
    writeSnap(repo, 'features', '18', 'implementing');
    const items = board.collectBoardItems(
        { root: path.join(repo, 'docs', 'specs', 'features'), prefix: 'feature', folders: ENTITY_STAGE_DIRS },
        new Set(ENTITY_STAGE_DIRS), repo
    );
    const ids = (col) => (items[col] || []).map(i => i.id);
    assert.ok(!ids('02-backlog').includes('14') && ids('03-in-progress').includes('14'));
    const legacy = (items['02-backlog'] || []).find(i => i.id === '15');
    assert.strictEqual(legacy.readModelSource, wrm.WORKFLOW_SOURCE.MISSING_SNAPSHOT);
    const drifted = (items['03-in-progress'] || []).find(i => i.id === '18');
    assert.deepStrictEqual(drifted.specDrift, {
        currentPath: 'docs/specs/features/02-backlog/feature-18-x.md',
        expectedPath: 'docs/specs/features/03-in-progress/feature-18-x.md',
        lifecycle: 'implementing',
    });
}));

test('autonomous plan exposes future reviewed solo stages before they start', () => withTempDir('aigon-rm-', (repo) => {
    // REGRESSION F297: autonomous cards must show the full planned stage sequence from run start.
    seed(repo);
    writeSpec(repo, 'features', '03-in-progress', 'feature-12-auto-plan.md');
    writeSnap(repo, 'features', '12', 'implementing');
    writeFeatureAuto(repo, '12', {
        featureId: '12',
        status: 'running',
        running: true,
        mode: 'solo_worktree',
        workflowSlug: 'solo-cc-reviewed-cx',
        agents: ['cc'],
        reviewAgent: 'cx',
        stopAfter: 'close',
        startedAt: '2026-04-01T10:00:00Z',
        updatedAt: '2026-04-01T10:01:00Z',
    });
    const state = wrm.getFeatureDashboardState(repo, '12', 'in-progress', [{ id: 'cc', status: 'implementing' }]);
    assert.ok(state.autonomousPlan);
    assert.strictEqual(state.autonomousPlan.error, undefined);
    assert.deepStrictEqual(
        state.autonomousPlan.stages.map(stage => ({ type: stage.type, status: stage.status, agents: stage.agents.map(agent => agent.id) })),
        [
            { type: 'implement', status: 'running', agents: ['cc'] },
            { type: 'review', status: 'waiting', agents: ['cx'] },
            { type: 'counter-review', status: 'waiting', agents: ['cc'] },
            { type: 'close', status: 'waiting', agents: [] },
        ]
    );
}));

test('autonomous plan fails loudly when workflow metadata cannot be resolved', () => withTempDir('aigon-rm-', (repo) => {
    // REGRESSION F297: do not silently omit future autonomous stages when the plan metadata is broken.
    seed(repo);
    writeSpec(repo, 'features', '03-in-progress', 'feature-13-auto-error.md');
    writeSnap(repo, 'features', '13', 'implementing');
    writeFeatureAuto(repo, '13', {
        featureId: '13',
        status: 'running',
        running: true,
        mode: 'solo_worktree',
        workflowSlug: 'missing-workflow',
        agents: ['cc'],
        stopAfter: 'close',
        startedAt: '2026-04-01T10:00:00Z',
        updatedAt: '2026-04-01T10:01:00Z',
    });
    const state = wrm.getFeatureDashboardState(repo, '13', 'in-progress', [{ id: 'cc', status: 'implementing' }]);
    assert.ok(state.autonomousPlan && state.autonomousPlan.error);
    assert.match(state.autonomousPlan.error.message, /aigon doctor --fix/);
}));

// REGRESSION feature 295: operator.nudge_sent must survive projection onto the workflow snapshot.
testAsync('nudge event is recorded and surfaced on snapshot', () => withTempDirAsync('aigon-rm-', async (repo) => {
    const specPath = path.join(repo, 'docs', 'specs', 'features', '03-in-progress', 'feature-07-test.md');
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.writeFileSync(specPath, '# test\n');
    workflowEngine.ensureEntityBootstrappedSync(repo, 'feature', '07', 'implementing', specPath);
    const at = new Date().toISOString();
    await workflowEngine.persistEntityEvents(repo, 'feature', '07', [{ type: 'operator.nudge_sent', featureId: '07', agentId: 'cc', role: 'do', text: 'follow up', at, atISO: at }]);
    const snapshot = await workflowEngine.showFeature(repo, '07');
    assert.deepStrictEqual(snapshot.nudges, [{ agentId: 'cc', role: 'do', text: 'follow up', atISO: at }]);
}));

report();
