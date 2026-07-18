#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    test,
    withTempDir,
    seedEntityDirs,
    initGitRepo,
    runAigonCli,
    report,
} = require('../_helpers');

function onlySpec(repo, kind) {
    const inbox = path.join(repo, 'docs', 'specs', kind, '01-inbox');
    const files = fs.readdirSync(inbox).filter(file => file.endsWith('.md'));
    assert.strictEqual(files.length, 1);
    return fs.readFileSync(path.join(inbox, files[0]), 'utf8');
}

// REGRESSION: F686 — --quick is valueless and must not leak into feature description text.
test('feature-create strips --quick without consuming adjacent description words', () => withTempDir('aigon-deepen-feature-', repo => {
    initGitRepo(repo, { branch: 'main' });
    seedEntityDirs(repo, 'features');
    runAigonCli(repo, ['feature-create', 'quick-feature', 'first', '--quick', 'second']);
    const spec = onlySpec(repo, 'features');
    assert.ok(spec.includes('first second'));
    assert.ok(!spec.includes('--quick'));
}));

// REGRESSION: F686 — research-create follows the same valueless --quick parser contract.
test('research-create strips --quick without consuming adjacent description words', () => withTempDir('aigon-deepen-research-', repo => {
    initGitRepo(repo, { branch: 'main' });
    seedEntityDirs(repo, 'research-topics');
    runAigonCli(repo, ['research-create', 'quick-research', 'first', '--quick', 'second']);
    const spec = onlySpec(repo, 'research-topics');
    assert.ok(spec.includes('first second'));
    assert.ok(!spec.includes('--quick'));
}));

// REGRESSION: F686 — deepen.enabled resolves project > global > built-in true with provenance.
test('deepen.enabled has shared precedence and appears in effective config', () => withTempDir('aigon-deepen-config-', repo => {
    const globalPath = path.join(repo, 'user-config.json');
    const env = { GLOBAL_CONFIG_PATH: globalPath };

    let result = runAigonCli(repo, ['config', 'get', 'deepen.enabled'], { extraEnv: env });
    assert.ok(result.output.includes('true (from default)'));

    fs.writeFileSync(globalPath, JSON.stringify({ deepen: { enabled: false } }));
    result = runAigonCli(repo, ['config', 'get', 'deepen.enabled'], { extraEnv: env });
    assert.ok(result.output.includes('false (from ~/.aigon/config.json)'));

    fs.mkdirSync(path.join(repo, '.aigon'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.aigon', 'config.json'), JSON.stringify({ deepen: { enabled: true } }));
    result = runAigonCli(repo, ['config', 'get', 'deepen.enabled'], { extraEnv: env });
    assert.ok(result.output.includes('true (from .aigon/config.json)'));

    result = runAigonCli(repo, ['config', 'show'], { extraEnv: env });
    assert.ok(/"deepen"\s*:\s*\{[\s\S]*?"enabled"\s*:\s*true/.test(result.output));
}));

// REGRESSION: F686 — both config scopes accept boolean deepen.enabled writes.
test('config set writes project and global deepen.enabled booleans', () => withTempDir('aigon-deepen-set-', repo => {
    const globalPath = path.join(repo, 'user-config.json');
    const env = { GLOBAL_CONFIG_PATH: globalPath };

    runAigonCli(repo, ['config', 'set', 'deepen.enabled', 'false'], { extraEnv: env });
    const project = JSON.parse(fs.readFileSync(path.join(repo, '.aigon', 'config.json'), 'utf8'));
    assert.strictEqual(project.deepen.enabled, false);

    runAigonCli(repo, ['config', 'init', '--global'], { extraEnv: env });
    runAigonCli(repo, ['config', 'set', '--global', 'deepen.enabled', 'true'], { extraEnv: env });
    const global = JSON.parse(fs.readFileSync(globalPath, 'utf8'));
    assert.strictEqual(global.deepen.enabled, true);
}));

report();
