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

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizePath(filePath) {
    return fs.realpathSync.native ? fs.realpathSync.native(filePath) : fs.realpathSync(filePath);
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

report();
