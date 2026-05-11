#!/usr/bin/env node
// @smoke
'use strict';

// F513: aigon remove command — preserves spec folders, --purge wipes .aigon/,
// --dry-run is no-op, refuses in worktree, apply/remove/apply cycle works.
//
// Three independent --flag behaviours (spec preserved / --purge / --dry-run)
// run on a single apply+install fixture to avoid 6 redundant CLI spawns.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { testAsync, withTempDirAsync, report, GIT_SAFE_ENV } = require('../_helpers');
const installManifestLib = require('../../lib/install-manifest');

const CLI = path.join(__dirname, '..', '..', 'aigon-cli.js');

function runAigon(repo, args, expectFail = false) {
    const result = spawnSync(process.execPath, [CLI, ...args], {
        cwd: repo,
        env: { ...process.env, ...GIT_SAFE_ENV, HOME: repo, USERPROFILE: repo, AIGON_NONINTERACTIVE: '1' },
        stdio: 'pipe',
    });
    const combined = (result.stdout || '').toString() + (result.stderr || '').toString();
    if (!expectFail && result.status !== 0) {
        throw new Error(`aigon ${args.join(' ')} failed (status ${result.status}): ${combined}`);
    }
    return { status: result.status, output: combined };
}

function gitInit(repo) {
    spawnSync('git', ['init', '-q'], { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' });
    spawnSync('git', ['config', 'user.email', 'test@aigon.test'], { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' });
    spawnSync('git', ['config', 'user.name', 'Aigon Test'], { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' });
    spawnSync('git', ['checkout', '-qb', 'main'], { cwd: repo, env: { ...process.env, ...GIT_SAFE_ENV }, stdio: 'pipe' });
}

// Combined: spec preservation + --dry-run no-op (share one apply+install fixture).
testAsync('remove + remove --dry-run: spec folders + manifest preserved', () => withTempDirAsync('aigon-f513-rm-flags-', async (repo) => {
    gitInit(repo);
    runAigon(repo, ['apply']);
    runAigon(repo, ['install-agent', 'cc']);

    const inboxDir = path.join(repo, 'docs', 'specs', 'features', '01-inbox');
    fs.writeFileSync(path.join(inboxDir, 'feature-my-spec.md'), '# My spec');

    // --dry-run first: must not touch anything
    const manifestBefore = installManifestLib.readManifest(repo);
    assert.ok(manifestBefore && manifestBefore.files.length > 0, 'pre-condition: manifest populated');
    runAigon(repo, ['remove', '--dry-run']);
    for (const entry of manifestBefore.files) {
        assert.ok(fs.existsSync(path.join(repo, entry.path)), `${entry.path} must still exist after --dry-run`);
    }
    assert.ok(installManifestLib.readManifest(repo), 'manifest must still exist after --dry-run');

    // Now the real remove: spec must survive, spec folder must survive
    runAigon(repo, ['remove', '--force']);
    assert.ok(fs.existsSync(path.join(inboxDir, 'feature-my-spec.md')), 'spec file must survive remove');
    assert.ok(fs.existsSync(inboxDir), 'spec folder must survive remove');
}));

// Combined: --purge wipes .aigon/ + full apply→remove→apply round-trip
// (each step's invariants are checked along the way).
testAsync('remove --purge: wipes .aigon/, second apply re-bootstraps (F513 cycle)', () => withTempDirAsync('aigon-f513-cycle-', async (repo) => {
    gitInit(repo);
    runAigon(repo, ['apply']);
    runAigon(repo, ['install-agent', 'cc']);
    assert.ok(fs.existsSync(path.join(repo, '.aigon')), 'pre-condition: .aigon/ exists');

    runAigon(repo, ['remove', '--purge', '--force']);
    assert.ok(!fs.existsSync(path.join(repo, '.aigon')), '.aigon/ must be gone after --purge');

    // Second apply should bootstrap as first-time again
    const { output } = runAigon(repo, ['apply']);
    assert.ok(output.includes('First-time setup'), `banner must appear after remove+re-apply: ${output}`);
    assert.ok(fs.existsSync(path.join(repo, 'docs', 'specs', 'features', '01-inbox')), 'spec folders must be recreated');
}));

// F513: remove refuses to run in worktree (no apply needed — synthesises the marker).
testAsync('remove: refuses to run in worktree', () => withTempDirAsync('aigon-f513-wt-', async (repo) => {
    gitInit(repo);
    runAigon(repo, ['apply']);

    fs.mkdirSync(path.join(repo, '.aigon'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.aigon', 'worktree.json'), JSON.stringify({ mainRepo: '/tmp/main-repo' }));

    const { status, output } = runAigon(repo, ['remove', '--force'], true);
    assert.notStrictEqual(status, 0, 'remove must exit non-zero in worktree');
    assert.ok(output.includes('worktree'), `must mention worktree: ${output}`);
}));

report();
