#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { testAsync, withTempDirAsync, report } = require('../_helpers');
const featureNow = require('../../lib/feature-now');
const workflow = require('../../lib/workflow-core');

testAsync('feature-now persists canonical Drive workflow state', () => withTempDirAsync('aigon-feature-now-', async (repo) => {
    const previous = process.cwd();
    process.chdir(repo);
    try {
        const root = path.join(repo, 'docs/specs/features');
        const folders = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];
        folders.forEach(folder => fs.mkdirSync(path.join(root, folder), { recursive: true }));
        await featureNow.run(['workflow state'], {
            PATHS: { features: { root, folders, repoPath: repo } },
            findFile: () => null,
            getNextId: () => 1,
            runPreHook: () => true,
            runPostHook: () => {},
            readTemplate: () => '# Feature: {{NAME}}\n',
            runGit: () => '',
            loadProjectConfig: () => ({ logging_level: 'never' }),
            u: {},
            workflow,
        });
        const snapshot = await workflow.showFeatureOrNull(repo, '01');
        assert.strictEqual(snapshot.currentSpecState, 'implementing');
        assert.strictEqual(snapshot.mode, workflow.FeatureMode.SOLO_BRANCH);
        assert.deepStrictEqual(Object.keys(snapshot.agents), ['solo']);
        assert.ok(fs.existsSync(path.join(root, '03-in-progress/feature-01-workflow-state.md')));
    } finally {
        process.chdir(previous);
        process.exitCode = 0;
    }
}));

report();
