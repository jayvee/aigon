#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { test, report, withTempDir, GIT_SAFE_ENV } = require('../_helpers');
const staleStashes = require('../../lib/doctor/stale-stashes');

function sh(cmd, cwd) {
    return execSync(cmd, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_SAFE_ENV }, stdio: ['ignore', 'pipe', 'ignore'] });
}

function initRepo(dir) {
    sh('git init -q', dir);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'line1\nline2\n');
    sh('git add -A', dir);
    sh('git commit -qm init', dir);
}

function makeStash(dir, content, message) {
    fs.writeFileSync(path.join(dir, 'a.txt'), content);
    sh(`git stash push -qm "${message}"`, dir);
}

test('findAutoStashes matches only feature-close auto-stashes', () => {
    withTempDir('aigon-stash-', (dir) => {
        initRepo(dir);
        makeStash(dir, 'x\n', 'aigon-feature-close-auto-stash');
        makeStash(dir, 'y\n', 'pre-rollback manual keep');
        makeStash(dir, 'z\n', 'aigon-feature-close-auto-stash');
        const found = staleStashes.findAutoStashes(dir);
        assert.strictEqual(found.length, 2, 'should find exactly the two auto-stashes');
        assert.ok(found.every(s => s.subject.includes('aigon-feature-close-auto-stash')));
        assert.ok(found.every(s => /^stash@\{\d+\}$/.test(s.ref)));
        assert.ok(found.every(s => /^[0-9a-f]{40}$/.test(s.sha)), 'each has a full sha');
    });
});

test('findAutoStashes returns empty on a repo with no stashes', () => {
    withTempDir('aigon-stash-', (dir) => {
        initRepo(dir);
        assert.deepStrictEqual(staleStashes.findAutoStashes(dir), []);
    });
});

test('archiveAndDropAutoStashes archives + drops auto-stashes, keeps manual ones', () => {
    withTempDir('aigon-stash-', (dir) => {
        initRepo(dir);
        makeStash(dir, 'line1\nAAA\n', 'aigon-feature-close-auto-stash');
        makeStash(dir, 'line1\nBBB\n', 'aigon-feature-close-auto-stash');
        makeStash(dir, 'line1\nMANUAL\n', 'pre-rollback manual keep');

        const res = staleStashes.archiveAndDropAutoStashes(dir);
        assert.strictEqual(res.archived, 2);
        assert.strictEqual(res.dropped, 2);
        assert.deepStrictEqual(res.errors, []);

        // Manual stash survives; auto-stashes gone.
        const remaining = sh('git stash list', dir).trim().split('\n').filter(Boolean);
        assert.strictEqual(remaining.length, 1, 'only the manual stash remains');
        assert.ok(remaining[0].includes('pre-rollback manual keep'));

        // Patches written and are non-empty valid diffs.
        assert.strictEqual(res.patches.length, 2);
        for (const p of res.patches) {
            assert.ok(fs.existsSync(p), `patch exists: ${p}`);
            const body = fs.readFileSync(p, 'utf8');
            assert.ok(body.includes('diff --git') && body.includes('a.txt'), 'patch is a real diff');
        }
    });
});

test('archiveAndDropAutoStashes is a no-op when nothing leaked', () => {
    withTempDir('aigon-stash-', (dir) => {
        initRepo(dir);
        makeStash(dir, 'line1\nMANUAL\n', 'pre-rollback manual keep');
        const res = staleStashes.archiveAndDropAutoStashes(dir);
        assert.strictEqual(res.archived, 0);
        assert.strictEqual(res.dropped, 0);
        assert.strictEqual(sh('git stash list', dir).trim().split('\n').filter(Boolean).length, 1);
    });
});

report();
