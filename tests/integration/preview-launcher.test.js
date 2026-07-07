#!/usr/bin/env node
'use strict';

// REGRESSION F601: preview launcher resolves feature worktrees and instance ids.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');

const {
    listFeatureWorktrees,
    findFeatureWorktrees,
    getPreviewInstanceId,
} = require('../../lib/preview-launcher');

test('findFeatureWorktrees matches padded and unpadded feature ids', () => withTempDir('aigon-f601-wt-', (tmp) => {
    const prevHome = process.env.HOME;
    process.env.HOME = tmp;
    try {
        const repoPath = path.join(tmp, 'aigon');
        const base = path.join(tmp, '.aigon', 'worktrees', 'aigon');
        const wtPath = path.join(base, 'feature-601-cu-worktree-dashboard-preview-launcher');
        fs.mkdirSync(wtPath, { recursive: true });
        fs.writeFileSync(path.join(wtPath, 'aigon-cli.js'), '// stub');

        const listed = listFeatureWorktrees(repoPath);
        assert.strictEqual(listed.length, 1);
        assert.strictEqual(listed[0].agent, 'cu');
        assert.strictEqual(listed[0].featureId, '601');

        assert.strictEqual(findFeatureWorktrees(repoPath, '601').length, 1);
        assert.strictEqual(findFeatureWorktrees(repoPath, '06').length, 0);
        assert.strictEqual(findFeatureWorktrees(repoPath, '601', 'cu').length, 1);
        assert.strictEqual(findFeatureWorktrees(repoPath, '601', 'cc').length, 0);
    } finally {
        if (prevHome === undefined) delete process.env.HOME;
        else process.env.HOME = prevHome;
    }
}));

test('getPreviewInstanceId derives agent-feature server id from worktree dirname', () => {
    const wt = '/tmp/feature-601-cu-worktree-dashboard-preview-launcher';
    assert.strictEqual(getPreviewInstanceId(wt), 'cu-601');
});

report();
