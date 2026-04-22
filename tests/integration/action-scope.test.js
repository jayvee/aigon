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
    const result = assertActionAllowed('feature-start', actionCtx);
    assert.ok(result && result.delegate);
    assert.strictEqual(result.delegate, path.join(path.sep, 'tmp', 'mainrepo'));
});

report();
