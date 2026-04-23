#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report, seedEntityDirs, withRepoCwd } = require('../_helpers');
const engine = require('../../lib/workflow-core/engine');

function freshEntityModules() {
    delete require.cache[require.resolve('../../lib/templates')];
    delete require.cache[require.resolve('../../lib/utils')];
    delete require.cache[require.resolve('../../lib/entity')];
    return {
        utils: require('../../lib/utils'),
        entity: require('../../lib/entity'),
    };
}

function buildCtx(utils) {
    return {
        utils,
        git: {
            getCurrentBranch: () => 'main',
            getDefaultBranch: () => 'main',
            getCommonDir: () => null,
            runGit: () => {},
        },
        board: { loadBoardMapping: () => null },
    };
}

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const normalizePath = (filePath) => (fs.realpathSync.native ? fs.realpathSync.native(filePath) : fs.realpathSync(filePath));
const wrm = require('../../lib/workflow-read-model');

function freshRequire(modPath) {
    delete require.cache[require.resolve(modPath)];
    return require(modPath);
}

// REGRESSION: F296 must not leave a snapshotless inbox spec behind when create bootstrapping fails.
test('entityCreate bootstraps inbox workflow state and rolls back the spec on bootstrap failure', () => withTempDir('aigon-f296-create-', (repo) => {
    seedEntityDirs(repo, 'features');
    withRepoCwd(repo, () => {
        const { utils, entity } = freshEntityModules();
        const created = entity.entityCreate(entity.FEATURE_DEF, 'foo', buildCtx(utils));
        assert.ok(created);
        assert.ok(fs.existsSync(path.join(repo, 'docs/specs/features/01-inbox/feature-foo.md')));
        const snapshot = readJson(path.join(repo, '.aigon/workflows/features/foo/snapshot.json'));
        assert.strictEqual(snapshot.featureId, 'foo');
        assert.strictEqual(snapshot.currentSpecState, 'inbox');
        assert.strictEqual(normalizePath(snapshot.specPath), normalizePath(path.join(repo, 'docs/specs/features/01-inbox/feature-foo.md')));

        const original = engine.ensureEntityBootstrappedSync;
        const originalError = console.error;
        const errors = [];
        console.error = (...args) => { errors.push(args.join(' ')); };
        engine.ensureEntityBootstrappedSync = () => { throw new Error('bootstrap exploded'); };
        try {
            const failed = entity.entityCreate(entity.FEATURE_DEF, 'bar', buildCtx(utils));
            assert.strictEqual(failed, null);
        } finally {
            engine.ensureEntityBootstrappedSync = original;
            console.error = originalError;
        }

        assert.ok(!fs.existsSync(path.join(repo, 'docs/specs/features/01-inbox/feature-bar.md')));
        assert.ok(!fs.existsSync(path.join(repo, '.aigon/workflows/features/bar')));
        assert.ok(errors.some((line) => line.includes('bootstrap exploded')));
    });
}));

// REGRESSION: spec-review-check needs the original create-time author from workflow bootstrap state.
test('entityCreate stores authorAgentId on the inbox workflow snapshot when created by an agent', () => withTempDir('aigon-author-bootstrap-', (repo) => {
    seedEntityDirs(repo, 'features');
    const prevAgentId = process.env.AIGON_AGENT_ID;
    process.env.AIGON_AGENT_ID = 'cx';
    try {
        withRepoCwd(repo, () => {
            const { utils, entity } = freshEntityModules();
            const created = entity.entityCreate(entity.FEATURE_DEF, 'authored-by-cx', buildCtx(utils));
            assert.ok(created);
        });
    } finally {
        if (prevAgentId == null) delete process.env.AIGON_AGENT_ID;
        else process.env.AIGON_AGENT_ID = prevAgentId;
    }

    const snapshot = readJson(path.join(repo, '.aigon/workflows/features/authored-by-cx/snapshot.json'));
    const events = fs.readFileSync(path.join(repo, '.aigon/workflows/features/authored-by-cx/events.jsonl'), 'utf8');
    assert.strictEqual(snapshot.authorAgentId, 'cx');
    assert.ok(events.includes('"authorAgentId":"cx"'));
}));

// REGRESSION: F296 re-keys slug inbox workflow state to the numeric backlog id instead of silently minting a fresh snapshot.
test('entityPrioritise migrates slug-keyed workflow state to the numeric id', () => withTempDir('aigon-f296-prio-', (repo) => {
    seedEntityDirs(repo, 'features');
    const specPath = path.join(repo, 'docs/specs/features/01-inbox/feature-foo.md');
    fs.writeFileSync(specPath, '# Feature: foo\n');
    engine.ensureEntityBootstrappedSync(repo, 'feature', 'foo', 'inbox', specPath);

    withRepoCwd(repo, () => {
        const { utils, entity } = freshEntityModules();
        entity.entityPrioritise(entity.FEATURE_DEF, 'foo', buildCtx(utils));
    });

    assert.ok(!fs.existsSync(path.join(repo, '.aigon/workflows/features/foo')));
    assert.ok(fs.existsSync(path.join(repo, '.aigon/workflows/features/01/snapshot.json')));
    const snapshot = readJson(path.join(repo, '.aigon/workflows/features/01/snapshot.json'));
    const events = fs.readFileSync(path.join(repo, '.aigon/workflows/features/01/events.jsonl'), 'utf8');
    assert.strictEqual(snapshot.featureId, '01');
    assert.strictEqual(snapshot.currentSpecState, 'backlog');
    assert.strictEqual(normalizePath(snapshot.specPath), normalizePath(path.join(repo, 'docs/specs/features/02-backlog/feature-01-foo.md')));
    assert.ok(events.includes('"featureId":"01"'));
    assert.ok(events.includes('"lifecycle":"backlog"'));
    assert.ok(!events.includes('"featureId":"foo"'));
}));

// REGRESSION: F296 doctor migration must scan research 01-inbox, not only backlog-and-later stages.
test('findEntitiesMissingWorkflowState discovers snapshotless research inbox specs', () => withTempDir('aigon-f296-rinbox-', (repo) => {
    seedEntityDirs(repo, 'research-topics');
    const specPath = path.join(repo, 'docs/specs/research-topics/01-inbox/research-wizardry.md');
    fs.writeFileSync(specPath, '# Research: wizardry\n');

    const setup = freshRequire('../../lib/commands/setup')._test;
    const missing = setup.findEntitiesMissingWorkflowState(repo);
    assert.deepStrictEqual(missing.research, [{ id: 'wizardry', stage: 'inbox', specPath }]);
    assert.strictEqual(setup.bootstrapMissingWorkflowSnapshots(repo, missing.research, 'research'), 1);

    const snapshot = readJson(path.join(repo, '.aigon/workflows/research/wizardry/snapshot.json'));
    assert.strictEqual(snapshot.researchId, 'wizardry');
    assert.strictEqual(snapshot.currentSpecState, 'inbox');
}));

// REGRESSION: F296 moves legacy inbox migration to explicit doctor/init bootstrap, not dashboard reads.
test('bootstrapMissingWorkflowSnapshots migrates slug-keyed inbox specs', () => withTempDir('aigon-f296-doctor-', (repo) => {
    seedEntityDirs(repo, 'features');
    const specPath = path.join(repo, 'docs/specs/features/01-inbox/feature-foo.md');
    fs.writeFileSync(specPath, '# Feature: foo\n');

    const setup = freshRequire('../../lib/commands/setup')._test;
    const missing = setup.findEntitiesMissingWorkflowState(repo);
    assert.deepStrictEqual(missing.features, [{ id: 'foo', stage: 'inbox', specPath }]);
    assert.strictEqual(setup.bootstrapMissingWorkflowSnapshots(repo, missing.features, 'feature'), 1);

    const snapshot = readJson(path.join(repo, '.aigon/workflows/features/foo/snapshot.json'));
    assert.strictEqual(snapshot.featureId, 'foo');
    assert.strictEqual(snapshot.currentSpecState, 'inbox');
}));

// REGRESSION: F296 inbox cards derive actions from a real slug-backed snapshot, not the missing-snapshot fallback.
test('workflow read model exposes prioritise for slug-backed inbox snapshots', () => withTempDir('aigon-f296-read-', (repo) => {
    seedEntityDirs(repo, 'features');
    const inboxSpecPath = path.join(repo, 'docs/specs/features/01-inbox/feature-foo.md');
    const backlogSpecPath = path.join(repo, 'docs/specs/features/02-backlog/feature-01-bar.md');
    fs.writeFileSync(inboxSpecPath, '# Feature: foo\n');
    fs.writeFileSync(backlogSpecPath, '# Feature: bar\n');
    engine.ensureEntityBootstrappedSync(repo, 'feature', 'foo', 'inbox', inboxSpecPath);
    engine.ensureEntityBootstrappedSync(repo, 'feature', '01', 'backlog', backlogSpecPath);

    const inboxState = wrm.getFeatureDashboardState(repo, 'foo', 'inbox', []);
    const backlogState = wrm.getFeatureDashboardState(repo, '01', 'backlog', []);
    assert.strictEqual(inboxState.readModelSource, wrm.WORKFLOW_SOURCE.SNAPSHOT);
    assert.ok(inboxState.validActions.some((action) => action.action === 'feature-prioritise'));
    assert.strictEqual(backlogState.readModelSource, wrm.WORKFLOW_SOURCE.SNAPSHOT);
    assert.ok(backlogState.validActions.some((action) => action.action === 'feature-start'));
}));

report();
