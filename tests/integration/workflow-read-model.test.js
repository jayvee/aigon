#!/usr/bin/env node
// REGRESSION: the dashboard read model must prefer the snapshot's lifecycle
// over the visible folder stage — otherwise a feature whose engine state
// advanced to implementing but whose spec file is still in 02-backlog (mid-
// transition) shows up in the wrong column and loses its workflow actions.
// Legacy numeric features with no snapshot stay visible but read-only; no-id
// inbox entries stay on the compat path without the legacy marker; and the
// board must re-bucket snapshot-backed items into their snapshot-derived
// column so users don't see the same feature in two places.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const wrm = require('../../lib/workflow-read-model');
const board = require('../../lib/board');

const FOLDERS = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];
const seedRepo = (repo) => {
    for (const kind of ['features', 'research-topics'])
        for (const f of FOLDERS) fs.mkdirSync(path.join(repo, 'docs', 'specs', kind, f), { recursive: true });
};
const writeSpec = (repo, kind, folder, file) => {
    const p = path.join(repo, 'docs', 'specs', kind, folder, file);
    fs.writeFileSync(p, `# ${file}\n`);
};
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

test('feature snapshot lifecycle overrides visible folder stage', () => withTempDir('aigon-rm-', (repo) => {
    seedRepo(repo);
    writeSpec(repo, 'features', '02-backlog', 'feature-12-x.md');
    writeSnap(repo, 'features', '12', 'implementing');
    const s = wrm.getFeatureDashboardState(repo, '12', 'backlog', []);
    assert.strictEqual(s.stage, 'in-progress');
    assert.strictEqual(s.readModelSource, wrm.WORKFLOW_SOURCE.SNAPSHOT);
    assert.ok(s.validActions.length > 0);
}));

test('legacy numeric feature without a snapshot is visible but read-only', () => withTempDir('aigon-rm-', (repo) => {
    seedRepo(repo);
    writeSpec(repo, 'features', '02-backlog', 'feature-13-x.md');
    const s = wrm.getFeatureDashboardState(repo, '13', 'backlog', []);
    assert.strictEqual(s.stage, 'backlog');
    assert.strictEqual(s.readModelSource, wrm.WORKFLOW_SOURCE.LEGACY_MISSING_WORKFLOW);
    assert.strictEqual(s.readOnly, true);
    assert.strictEqual(s.validActions.length, 0);
}));

test('no-id inbox feature stays on compat path without the legacy marker', () => withTempDir('aigon-rm-', (repo) => {
    seedRepo(repo);
    writeSpec(repo, 'features', '01-inbox', 'feature-untriaged.md');
    const s = wrm.getFeatureDashboardState(repo, 'untriaged', 'inbox', []);
    assert.strictEqual(s.readModelSource, wrm.WORKFLOW_SOURCE.COMPAT_INBOX);
    assert.strictEqual(s.readOnly, false);
    assert.strictEqual(s.missingWorkflowState, false);
}));

test('research snapshot lifecycle also overrides visible folder stage', () => withTempDir('aigon-rm-', (repo) => {
    seedRepo(repo);
    writeSpec(repo, 'research-topics', '02-backlog', 'research-21-x.md');
    writeSnap(repo, 'research', '21', 'implementing');
    const s = wrm.getResearchDashboardState(repo, '21', 'backlog', []);
    assert.strictEqual(s.stage, 'in-progress');
    assert.strictEqual(s.readModelSource, wrm.WORKFLOW_SOURCE.SNAPSHOT);
}));

test('read model exposes detect-only spec drift relative paths by default', () => withTempDir('aigon-rm-', (repo) => {
    seedRepo(repo);
    writeSpec(repo, 'features', '02-backlog', 'feature-16-x.md');
    writeSnap(repo, 'features', '16', 'implementing');
    delete process.env.AIGON_AUTO_RECONCILE;
    const s = wrm.getFeatureDashboardState(repo, '16', 'backlog', []);
    assert.deepStrictEqual(s.specDrift, {
        currentPath: 'docs/specs/features/02-backlog/feature-16-x.md',
        expectedPath: 'docs/specs/features/03-in-progress/feature-16-x.md',
        lifecycle: 'implementing',
    });
    assert.ok(fs.existsSync(path.join(repo, 'docs/specs/features/02-backlog/feature-16-x.md')));
    assert.ok(!fs.existsSync(path.join(repo, 'docs/specs/features/03-in-progress/feature-16-x.md')));
}));

test('auto reconcile stays opt-in via AIGON_AUTO_RECONCILE=1', () => withTempDir('aigon-rm-', (repo) => {
    seedRepo(repo);
    writeSpec(repo, 'features', '02-backlog', 'feature-17-x.md');
    writeSnap(repo, 'features', '17', 'implementing');
    process.env.AIGON_AUTO_RECONCILE = '1';
    try {
        const s = wrm.getFeatureDashboardState(repo, '17', 'backlog', []);
        assert.strictEqual(s.specDrift, null);
        assert.ok(!fs.existsSync(path.join(repo, 'docs/specs/features/02-backlog/feature-17-x.md')));
        assert.ok(fs.existsSync(path.join(repo, 'docs/specs/features/03-in-progress/feature-17-x.md')));
    } finally {
        delete process.env.AIGON_AUTO_RECONCILE;
    }
}));

test('board re-buckets snapshot-backed features and keeps legacy items in original column', () => withTempDir('aigon-rm-', (repo) => {
    seedRepo(repo);
    writeSpec(repo, 'features', '02-backlog', 'feature-14-x.md');
    writeSpec(repo, 'features', '02-backlog', 'feature-15-legacy.md');
    writeSnap(repo, 'features', '14', 'implementing');
    const items = board.collectBoardItems(
        { root: path.join(repo, 'docs', 'specs', 'features'), prefix: 'feature', folders: FOLDERS },
        new Set(FOLDERS), repo
    );
    const ids = (col) => (items[col] || []).map(i => i.id);
    assert.ok(!ids('02-backlog').includes('14'));
    assert.ok(ids('03-in-progress').includes('14'));
    const legacy = (items['02-backlog'] || []).find(i => i.id === '15');
    assert.strictEqual(legacy.missingWorkflowState, true);
    assert.strictEqual(legacy.boardAction, null);
}));

test('board marks drifted items in its column output', () => withTempDir('aigon-rm-', (repo) => {
    seedRepo(repo);
    writeSpec(repo, 'features', '02-backlog', 'feature-18-x.md');
    writeSnap(repo, 'features', '18', 'implementing');
    const logs = [];
    const origLog = console.log;
    const origCwd = process.cwd();
    console.log = (...args) => logs.push(args.join(' '));
    try {
        process.chdir(repo);
        board.displayBoardListView({
            includeFeatures: true,
            includeResearch: false,
            showAll: true,
            showActive: false,
            showInbox: false,
            showBacklog: false,
            showDone: false,
            showActions: false,
        });
    } finally {
        process.chdir(origCwd);
        console.log = origLog;
    }
    assert.ok(logs.some(line => line.includes('⚠ drift')));
}));

report();
