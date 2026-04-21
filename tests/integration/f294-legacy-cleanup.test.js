#!/usr/bin/env node
// REGRESSION F294: three producer-drift incidents, one deletion each.
//   - jvbot 2026-04-20: `listVisibleSpecMatches` permissive `/^\d+-/` regex
//     matched stale sibling dirs → duplicate-match hard error on resolve.
//   - F285 → F293 recurrence: COMPAT_INBOX / LEGACY_MISSING_WORKFLOW half
//     states kept surfacing silent read-only degrades → collapsed to
//     MISSING_SNAPSHOT with zero actions.
//   - F283 follow-through: `applySpecReviewStatus` git-log scanner deleted;
//     engine snapshot is sole authority for pending-review state.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const paths = require('../../lib/workflow-core/paths');
const wrm = require('../../lib/workflow-read-model');
const collector = require('../../lib/dashboard-status-collector');

const FOLDERS = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];
const seedFeatureFolders = (repo) => {
    for (const folder of FOLDERS) {
        fs.mkdirSync(path.join(repo, 'docs', 'specs', 'features', folder), { recursive: true });
    }
};
const writeSpec = (repo, folder, file) =>
    fs.writeFileSync(path.join(repo, 'docs', 'specs', 'features', folder, file), `# ${file}\n`);

test('listVisibleSpecMatches ignores non-canonical sibling dirs (jvbot duplicate-match guard)', () => withTempDir('aigon-f294-paths-', (repo) => {
    seedFeatureFolders(repo);
    writeSpec(repo, '02-backlog', 'feature-12-x.md');
    // Stale pre-rename `04-done` + a `99-archive` sibling — both start with
    // `\d+-` so the old permissive regex matched them and raised a
    // duplicate-match error instead of resolving the backlog copy.
    for (const stale of ['04-done', '99-archive']) {
        fs.mkdirSync(path.join(repo, 'docs/specs/features', stale), { recursive: true });
        fs.writeFileSync(path.join(repo, 'docs/specs/features', stale, 'feature-12-x.md'), '# stale\n');
    }
    const resolved = paths.getSpecPathForEntity(repo, 'feature', '12', 'backlog');
    assert.ok(resolved.endsWith('/02-backlog/feature-12-x.md'), `expected backlog resolution, got ${resolved}`);
}));

test('CANONICAL_STAGE_DIRS is the single source of truth and exported frozen', () => {
    assert.deepStrictEqual([...paths.CANONICAL_STAGE_DIRS], FOLDERS);
    assert.ok(Object.isFrozen(paths.CANONICAL_STAGE_DIRS));
});

test('snapshotless feature read-model carries no legacy flags (F294)', () => withTempDir('aigon-f294-wrm-', (repo) => {
    seedFeatureFolders(repo);
    writeSpec(repo, '02-backlog', 'feature-13-x.md');
    const state = wrm.getFeatureDashboardState(repo, '13', 'backlog', []);
    assert.strictEqual(state.readModelSource, wrm.WORKFLOW_SOURCE.MISSING_SNAPSHOT);
    assert.strictEqual(state.validActions.length, 0);
    assert.strictEqual(state.nextAction, null);
    // Deleted fields must not reappear: these were the half-state signals
    // that kept regenerating the F285 → F293 bug class.
    for (const ghostField of ['readOnly', 'legacy', 'missingWorkflowState', 'compatibilityLabel']) {
        assert.ok(!(ghostField in state), `ghost legacy field "${ghostField}" must not be present on the read-model output`);
    }
}));

test('WORKFLOW_SOURCE enum is the new tight set (no COMPAT_INBOX, no LEGACY_MISSING_WORKFLOW)', () => {
    const keys = Object.keys(wrm.WORKFLOW_SOURCE).sort();
    assert.deepStrictEqual(keys, ['MISSING_SNAPSHOT', 'SNAPSHOT']);
});

test('dashboard-status-collector no longer exports applySpecReviewStatus / getSpecReviewEntries', () => {
    assert.strictEqual(typeof collector.applySpecReviewStatus, 'undefined');
    assert.strictEqual(typeof collector.getSpecReviewEntries, 'undefined');
    // The F283 engine-snapshot-backed path is the only authority now.
    assert.strictEqual(typeof collector.applySpecReviewFromSnapshots, 'function');
});

report();
