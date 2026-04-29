#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    test, withTempDir, report, seedEntityDirs, writeSpec, writeSnap,
} = require('../_helpers');

const { isEntityDone, engineDirExists } = require('../../lib/workflow-core/entity-lifecycle');
const { checkUnmetDependencies } = require('../../lib/feature-dependencies');
const setConductor = require('../../lib/set-conductor');
const { collectDoneSpecs } = require('../../lib/dashboard-status-collector');
const workflowReadModel = require('../../lib/workflow-read-model');

function makeFeaturePaths(repo) {
    return {
        root: path.join(repo, 'docs', 'specs', 'features'),
        folders: ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'],
        repoPath: repo,
    };
}

// ---------------------------------------------------------------------------
// isEntityDone — engine-first precedence rule
// ---------------------------------------------------------------------------

test('isEntityDone: snapshot.lifecycle=done overrides folder when spec drifted out of 05-done', () => withTempDir('aigon-isdone-engine-', (repo) => {
    seedEntityDirs(repo, 'features');
    writeSpec(repo, 'features', '04-in-evaluation', 'feature-01-x.md');
    writeSnap(repo, 'features', '01', 'done');
    assert.strictEqual(isEntityDone(repo, 'feature', '01', '04-in-evaluation'), true);
}));

test('isEntityDone: snapshot.lifecycle=implementing overrides folder when spec sits in 05-done', () => withTempDir('aigon-isdone-handmoved-', (repo) => {
    seedEntityDirs(repo, 'features');
    writeSpec(repo, 'features', '05-done', 'feature-02-x.md');
    writeSnap(repo, 'features', '02', 'implementing');
    assert.strictEqual(isEntityDone(repo, 'feature', '02', '05-done'), false);
}));

test('isEntityDone: legacy pre-engine done feature trusts folder fallback when no engine dir exists', () => withTempDir('aigon-isdone-legacy-', (repo) => {
    seedEntityDirs(repo, 'features');
    writeSpec(repo, 'features', '05-done', 'feature-03-legacy.md');
    assert.strictEqual(engineDirExists(repo, 'feature', '03'), false);
    assert.strictEqual(isEntityDone(repo, 'feature', '03', '05-done'), true);
}));

test('isEntityDone: drift case (engine dir but no snapshot) refuses to trust folder', () => withTempDir('aigon-isdone-drift-', (repo) => {
    seedEntityDirs(repo, 'features');
    writeSpec(repo, 'features', '05-done', 'feature-04-drift.md');
    fs.mkdirSync(path.join(repo, '.aigon', 'workflows', 'features', '04'), { recursive: true });
    assert.strictEqual(isEntityDone(repo, 'feature', '04', '05-done'), false);
}));

// ---------------------------------------------------------------------------
// checkUnmetDependencies — engine-first
// ---------------------------------------------------------------------------

test('checkUnmetDependencies: dependency met when engine says done but spec drifted', () => withTempDir('aigon-deps-met-', (repo) => {
    seedEntityDirs(repo, 'features');
    const paths = makeFeaturePaths(repo);
    writeSpec(repo, 'features', '04-in-evaluation', 'feature-10-dep.md');
    writeSnap(repo, 'features', '10', 'done');
    const dependentPath = path.join(paths.root, '02-backlog', 'feature-11-dependent.md');
    fs.writeFileSync(dependentPath, '---\ntitle: Dependent\ndepends_on: [10]\n---\n# Dependent\n');

    const unmet = checkUnmetDependencies(dependentPath, paths);
    assert.deepStrictEqual(unmet, []);
}));

test('checkUnmetDependencies: dependency unmet when engine says implementing even if spec sits in 05-done', () => withTempDir('aigon-deps-unmet-', (repo) => {
    seedEntityDirs(repo, 'features');
    const paths = makeFeaturePaths(repo);
    writeSpec(repo, 'features', '05-done', 'feature-20-dep.md');
    writeSnap(repo, 'features', '20', 'implementing');
    const dependentPath = path.join(paths.root, '02-backlog', 'feature-21-dependent.md');
    fs.writeFileSync(dependentPath, '---\ntitle: Dependent\ndepends_on: [20]\n---\n# Dependent\n');

    const unmet = checkUnmetDependencies(dependentPath, paths);
    assert.strictEqual(unmet.length, 1);
    assert.strictEqual(unmet[0].id, '20');
    assert.strictEqual(unmet[0].stage, 'implementing');
}));

// ---------------------------------------------------------------------------
// Set conductor — engine-first done check
// ---------------------------------------------------------------------------

test('set-conductor.isFeatureDone: advances past engine-done member whose spec drifted from 05-done', () => withTempDir('aigon-conductor-drift-', (repo) => {
    seedEntityDirs(repo, 'features');
    writeSpec(repo, 'features', '04-in-evaluation', 'feature-30-x.md');
    writeSnap(repo, 'features', '30', 'done');
    assert.strictEqual(setConductor.isFeatureDone(repo, '30'), true);
}));

test('set-conductor.isFeatureDone: refuses to advance for drift case (engine dir, no snapshot)', () => withTempDir('aigon-conductor-driftcase-', (repo) => {
    seedEntityDirs(repo, 'features');
    writeSpec(repo, 'features', '05-done', 'feature-31-drift.md');
    fs.mkdirSync(path.join(repo, '.aigon', 'workflows', 'features', '31'), { recursive: true });
    assert.strictEqual(setConductor.isFeatureDone(repo, '31'), false);
}));

// ---------------------------------------------------------------------------
// collectDoneSpecs — F459 folder-only display (F397 isEntityDone unchanged)
// ---------------------------------------------------------------------------

test('collectDoneSpecs: filename-only — 05-done only; engine-done without folder file omitted', () => withTempDir('aigon-done-f459-', (repo) => {
    // REGRESSION: F459 drops per-poll snapshot/events reads; kanban done list is 05-done filenames.
    // Engine-first lifecycle for deps/set-conductor remains isEntityDone() (tests above).
    seedEntityDirs(repo, 'features');
    writeSnap(repo, 'features', '40', 'done');
    const eventsPath = path.join(repo, '.aigon', 'workflows', 'features', '40', 'events.jsonl');
    fs.writeFileSync(eventsPath, JSON.stringify({ type: 'feature.closed', at: '2026-04-26T12:00:00Z' }) + '\n');
    writeSpec(repo, 'features', '05-done', 'feature-41-legacy.md');

    const doneDir = path.join(repo, 'docs', 'specs', 'features', '05-done');
    const out = collectDoneSpecs(doneDir, /^feature-\d+-.+\.md$/, 10, { entityType: 'feature' });
    const ids = out.all.map(item => (item.file.match(/^feature-(\d+)/) || [])[1]).filter(Boolean);
    assert.ok(!ids.includes('40'), `transient engine-only done 40 should not appear: ${ids.join(',')}`);
    assert.ok(ids.includes('41'), `folder done feature 41 missing: ${ids.join(',')}`);
}));

// ---------------------------------------------------------------------------
// Read-model — drift discriminator
// ---------------------------------------------------------------------------

test('workflow-read-model: drift case (engine dir, no snapshot) flags MISSING_SNAPSHOT and emits no synthesised actions', () => withTempDir('aigon-readmodel-drift-', (repo) => {
    seedEntityDirs(repo, 'features');
    fs.mkdirSync(path.join(repo, '.aigon', 'workflows', 'features', '50'), { recursive: true });
    writeSpec(repo, 'features', '01-inbox', 'feature-50-drift.md');
    const state = workflowReadModel.getFeatureDashboardState(repo, '50', 'inbox', []);
    assert.strictEqual(state.readModelSource, 'missing-snapshot');
    assert.strictEqual(state.engineDirExists, true);
    assert.strictEqual(state.nextAction, null);
    assert.deepStrictEqual(state.validActions, []);
}));

test('workflow-read-model: pre-start inbox spec (no engine dir) keeps its synthesised pre-engine actions', () => withTempDir('aigon-readmodel-prestart-', (repo) => {
    seedEntityDirs(repo, 'features');
    writeSpec(repo, 'features', '01-inbox', 'feature-pre-start.md');
    const state = workflowReadModel.getFeatureDashboardState(repo, 'pre-start', 'inbox', []);
    assert.strictEqual(state.readModelSource, 'missing-snapshot');
    assert.strictEqual(state.engineDirExists, false);
    assert.ok(Array.isArray(state.validActions) && state.validActions.length > 0,
        'pre-start inbox should retain its synthesised actions');
}));

report();
