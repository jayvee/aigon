#!/usr/bin/env node
// @smoke
'use strict';

// F513: aigon apply bootstraps spec folders, second run is silent, non-git dir
// fails loudly, init alias still works (with deprecation), uninstall alias redirects.
//
// Fresh-apply + silent-second-apply share one gitInit + first apply (saves a
// process spawn per fixture).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { testAsync, withTempDirAsync, report, GIT_SAFE_ENV } = require('../_helpers');

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

// Combined: first apply bootstraps (banner + folders + applied-digest);
// second apply is silent. One gitInit + one extra apply shared.
testAsync('apply-bootstrap: first apply bootstraps, second is silent', () => withTempDirAsync('aigon-f513-apply-', async (repo) => {
    gitInit(repo);
    assert.ok(!fs.existsSync(path.join(repo, '.aigon')), 'pre-condition: no .aigon/');

    const first = runAigon(repo, ['apply']);
    assert.ok(first.output.includes('First-time setup'), `banner must appear: ${first.output}`);
    assert.ok(fs.existsSync(path.join(repo, 'docs', 'specs', 'features', '01-inbox')), 'features/01-inbox must be created');
    assert.ok(fs.existsSync(path.join(repo, 'docs', 'specs', 'research-topics', '01-inbox')), 'research-topics/01-inbox must be created');
    assert.ok(fs.existsSync(path.join(repo, '.aigon', 'applied-digest')), 'applied-digest must be written');

    const second = runAigon(repo, ['apply']);
    assert.ok(!second.output.includes('First-time setup'), `banner must NOT appear on second run: ${second.output}`);
}));

testAsync('apply-bootstrap: non-git dir exits non-zero and creates nothing', () => withTempDirAsync('aigon-f513-nogit-', async (repo) => {
    const { status, output } = runAigon(repo, ['apply'], true);
    assert.notStrictEqual(status, 0, 'must exit non-zero in non-git dir');
    assert.ok(output.includes('Not a Git repository'), `must say "Not a Git repository": ${output}`);
    assert.ok(!fs.existsSync(path.join(repo, '.aigon')), '.aigon must not be created');
}));

testAsync('init-deprecation: aigon init prints deprecation warning and forwards', () => withTempDirAsync('aigon-f513-init-dep-', async (repo) => {
    gitInit(repo);
    const { output } = runAigon(repo, ['init']);
    assert.ok(output.toLowerCase().includes('deprecated') || output.includes('aigon apply'), `must mention deprecation: ${output}`);
    assert.ok(fs.existsSync(path.join(repo, 'docs', 'specs', 'features', '01-inbox')), 'init must still bootstrap the repo');
}));

testAsync('uninstall-alias: aigon uninstall exits non-zero with redirect hint', () => withTempDirAsync('aigon-f513-uninst-', async (repo) => {
    gitInit(repo);
    const { status, output } = runAigon(repo, ['uninstall'], true);
    assert.notStrictEqual(status, 0, 'uninstall must exit non-zero');
    assert.ok(output.includes('aigon remove'), `must say "aigon remove": ${output}`);
}));

// Stable-spec-layout default (F666–F670): a fresh repo comes up on the stable
// layout with a canonical `00-specs` home; a repo that already holds legacy
// stage-folder specs is left on legacy for deliberate migration.
testAsync('apply-bootstrap: fresh repo defaults to stable spec layout', () => withTempDirAsync('aigon-stable-fresh-', async (repo) => {
    gitInit(repo);
    const { output } = runAigon(repo, ['apply']);
    const cfg = JSON.parse(fs.readFileSync(path.join(repo, '.aigon', 'config.json'), 'utf8'));
    assert.strictEqual(cfg.specLayout, 'stable', `fresh repo must default to stable: ${JSON.stringify(cfg)}`);
    assert.ok(fs.existsSync(path.join(repo, 'docs', 'specs', 'features', '00-specs')), 'features/00-specs must exist');
    assert.ok(fs.existsSync(path.join(repo, 'docs', 'specs', 'research-topics', '00-specs')), 'research-topics/00-specs must exist');
    assert.ok(output.includes('stable spec layout'), `should announce the default: ${output}`);

    // Idempotent: a second apply must not disturb the recorded layout.
    runAigon(repo, ['apply']);
    const cfg2 = JSON.parse(fs.readFileSync(path.join(repo, '.aigon', 'config.json'), 'utf8'));
    assert.strictEqual(cfg2.specLayout, 'stable', 'second apply must leave specLayout=stable');
}));

testAsync('apply-bootstrap: repo with legacy specs stays on legacy layout', () => withTempDirAsync('aigon-stable-legacy-', async (repo) => {
    gitInit(repo);
    // Seed a real legacy stage-folder spec before the first apply.
    const inbox = path.join(repo, 'docs', 'specs', 'features', '01-inbox');
    fs.mkdirSync(inbox, { recursive: true });
    fs.writeFileSync(path.join(inbox, 'feature-1-legacy-thing.md'), '---\naigon_id: F1\n---\n\n# Feature: legacy thing\n\n## Summary\nreal content\n');

    runAigon(repo, ['apply']);
    const cfgPath = path.join(repo, '.aigon', 'config.json');
    const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
    assert.notStrictEqual(cfg.specLayout, 'stable', `repo with legacy specs must NOT be flipped to stable: ${JSON.stringify(cfg)}`);
    assert.ok(!fs.existsSync(path.join(repo, 'docs', 'specs', 'features', '00-specs')), '00-specs must not be created for a legacy repo');
}));

report();
