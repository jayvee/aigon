#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const { reconcileWorktreeJson, resolveHeartbeatStateDir } = require('../../lib/worktree');

test('reconcileWorktreeJson writes or repairs mainRepo pointer', () => withTempDir('aigon-wtjson-', (tmp) => {
    // REGRESSION: feature-start skip branch left no worktree.json; wrong mainRepo broke heartbeat vs dashboard.
    const main = path.join(tmp, 'main');
    const other = path.join(tmp, 'other');
    const wt = path.join(tmp, 'wt');
    fs.mkdirSync(path.join(wt, '.aigon'), { recursive: true });
    reconcileWorktreeJson(wt, main);
    assert.strictEqual(path.resolve(JSON.parse(fs.readFileSync(path.join(wt, '.aigon', 'worktree.json'), 'utf8')).mainRepo), main);
    fs.writeFileSync(path.join(wt, '.aigon', 'worktree.json'), JSON.stringify({ mainRepo: other }, null, 2));
    reconcileWorktreeJson(wt, main);
    assert.strictEqual(path.resolve(JSON.parse(fs.readFileSync(path.join(wt, '.aigon', 'worktree.json'), 'utf8')).mainRepo), main);
}));

test('resolveHeartbeatStateDir: AIGON_PROJECT_PATH when no worktree.json; file wins over env', () => withTempDir('aigon-hb-', (tmp) => {
    // REGRESSION: sidecar touched worktree .aigon/state while readers used main repo.
    const mainA = path.join(tmp, 'a');
    const mainB = path.join(tmp, 'b');
    fs.mkdirSync(mainA, { recursive: true });
    fs.mkdirSync(mainB, { recursive: true });
    const wt = path.join(tmp, 'wt');
    fs.mkdirSync(wt, { recursive: true });
    const prev = process.env.AIGON_PROJECT_PATH;
    process.env.AIGON_PROJECT_PATH = mainA;
    try {
        assert.strictEqual(resolveHeartbeatStateDir({ path: wt }), path.join(mainA, '.aigon', 'state'));
    } finally {
        if (prev === undefined) delete process.env.AIGON_PROJECT_PATH;
        else process.env.AIGON_PROJECT_PATH = prev;
    }
    fs.mkdirSync(path.join(wt, '.aigon'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.aigon', 'worktree.json'), JSON.stringify({ mainRepo: mainA }, null, 2));
    process.env.AIGON_PROJECT_PATH = mainB;
    try {
        assert.strictEqual(resolveHeartbeatStateDir({ path: wt }), path.join(mainA, '.aigon', 'state'));
    } finally {
        if (prev === undefined) delete process.env.AIGON_PROJECT_PATH;
        else process.env.AIGON_PROJECT_PATH = prev;
    }
}));

report();
