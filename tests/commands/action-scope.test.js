#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { test, report } = require('../_helpers');
const {
    buildActionContext,
    assertActionAllowed,
    withActionDelegate,
} = require('../../lib/action-scope');

// REGRESSION F312: withActionDelegate must invoke the handler body when the gatekeeper allows local execution (no re-delegate to main).
test('withActionDelegate runs inner fn on default branch', () => {
    let ran = false;
    const ctx = {
        git: {
            getCurrentBranch: () => 'main',
            getDefaultBranch: () => 'main',
            getCommonDir: () => '.git',
        },
    };
    withActionDelegate('feature-start', ['42', 'cc'], ctx, () => {
        ran = true;
    });
    assert.strictEqual(ran, true);
});

// REGRESSION F312: main-only commands from a worktree on a feature branch must get a delegate target (shape relied on by withActionDelegate).
test('assertActionAllowed returns delegate for main-only command from worktree', () => {
    const actionCtx = buildActionContext({
        getCurrentBranch: () => 'feature-1-cc-demo',
        getDefaultBranch: () => 'main',
        getCommonDir: () => path.join(path.sep, 'tmp', 'mainrepo', '.git'),
    });
    const featureStart = assertActionAllowed('feature-start', actionCtx);
    const setPrioritise = assertActionAllowed('set-prioritise', actionCtx);
    assert.ok(featureStart && featureStart.delegate);
    assert.ok(setPrioritise && setPrioritise.delegate);
    assert.strictEqual(featureStart.delegate, path.join(path.sep, 'tmp', 'mainrepo'));
    assert.strictEqual(setPrioritise.delegate, featureStart.delegate);
});

report();
