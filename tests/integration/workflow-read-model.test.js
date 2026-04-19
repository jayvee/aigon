#!/usr/bin/env node
// REGRESSION F275 `cbe3aeba-era`: snapshot lifecycle must override the visible
// folder (so in-flight features don't appear stuck in backlog on the dashboard)
// while legacy snapshot-less features stay visible but read-only.
// REGRESSION F271 `d015f7d1`: no-id inbox cards must stay on the compat path
// (NOT marked as missing-workflow) so they keep their prioritise action.
// REGRESSION F271 `936d2da7`: research read-model must not NPE on null entityId;
// the research parametrization here exercises that guard.
// REGRESSION F276: detect-only spec drift exposes currentPath/expectedPath;
// AIGON_AUTO_RECONCILE=1 is the only opt-in path that actually moves files.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const wrm = require('../../lib/workflow-read-model');
const board = require('../../lib/board');

const FOLDERS = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];
const seed = (repo) => {
    for (const kind of ['features', 'research-topics'])
        for (const f of FOLDERS) fs.mkdirSync(path.join(repo, 'docs', 'specs', kind, f), { recursive: true });
};
const writeSpec = (repo, kind, folder, file) => fs.writeFileSync(path.join(repo, 'docs', 'specs', kind, folder, file), `# ${file}\n`);
const writeSnap = (repo, kind, id, lifecycle) => {
    const dir = path.join(repo, '.aigon', 'workflows', kind, String(id));
    fs.mkdirSync(dir, { recursive: true });
    const entityType = kind === 'features' ? 'feature' : 'research';
    fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify({
        entityType, [`${entityType}Id`]: String(id), currentSpecState: lifecycle, lifecycle,
        mode: 'solo_branch', agents: { cx: { status: 'running' } },
        createdAt: '2026-04-01T10:00:00Z', updatedAt: '2026-04-01T10:05:00Z',
    }));
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

test('legacy numeric feature without a snapshot is visible but read-only', () => withTempDir('aigon-rm-', (repo) => {
    seed(repo);
    writeSpec(repo, 'features', '02-backlog', 'feature-13-x.md');
    const s = wrm.getFeatureDashboardState(repo, '13', 'backlog', []);
    assert.strictEqual(s.readModelSource, wrm.WORKFLOW_SOURCE.LEGACY_MISSING_WORKFLOW);
    assert.strictEqual(s.readOnly, true);
    assert.strictEqual(s.validActions.length, 0);
}));

test('no-id inbox feature stays on compat path (F271 d015f7d1)', () => withTempDir('aigon-rm-', (repo) => {
    seed(repo);
    writeSpec(repo, 'features', '01-inbox', 'feature-untriaged.md');
    const s = wrm.getFeatureDashboardState(repo, 'untriaged', 'inbox', []);
    assert.strictEqual(s.readModelSource, wrm.WORKFLOW_SOURCE.COMPAT_INBOX);
    assert.strictEqual(s.readOnly, false);
    assert.strictEqual(s.missingWorkflowState, false);
}));

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
        { root: path.join(repo, 'docs', 'specs', 'features'), prefix: 'feature', folders: FOLDERS },
        new Set(FOLDERS), repo
    );
    const ids = (col) => (items[col] || []).map(i => i.id);
    assert.ok(!ids('02-backlog').includes('14') && ids('03-in-progress').includes('14'));
    const legacy = (items['02-backlog'] || []).find(i => i.id === '15');
    assert.strictEqual(legacy.missingWorkflowState, true);
    assert.strictEqual(legacy.boardAction, null);
    const drifted = (items['03-in-progress'] || []).find(i => i.id === '18');
    assert.deepStrictEqual(drifted.specDrift, {
        currentPath: 'docs/specs/features/02-backlog/feature-18-x.md',
        expectedPath: 'docs/specs/features/03-in-progress/feature-18-x.md',
        lifecycle: 'implementing',
    });
}));

report();
