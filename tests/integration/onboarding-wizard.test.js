'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
let failed = 0;
function test(name, fn) {
    try { fn(); console.log(`  ✓ ${name}`); }
    catch (error) { failed++; console.error(`  ✗ ${name}\n    ${error.message}`); }
}

function run(args, home) {
    return spawnSync(process.execPath, ['aigon-cli.js', ...args], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, HOME: home, CI: '1', AIGON_NO_UPDATE_NOTIFIER: '1' },
    });
}

// REGRESSION: setup --yes must retain conservative defaults in a clean home.
test('safe setup writes private config without cloning or starting a server', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-onboarding-'));
    try {
        const result = run(['setup', '--yes'], home);
        assert.strictEqual(result.status, 0, result.stderr);
        assert.ok(!fs.existsSync(path.join(home, 'src', 'brewboard')), 'must not clone Brewboard');
        const configPath = path.join(home, '.aigon', 'config.json');
        assert.strictEqual(fs.statSync(configPath).mode & 0o777, 0o600, 'config must be private');
        const state = JSON.parse(fs.readFileSync(path.join(home, '.aigon', 'onboarding-state.json'), 'utf8'));
        assert.strictEqual(state.steps['seed-repo'], 'skipped');
        assert.strictEqual(state.steps.server, 'skipped');
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

// REGRESSION: saving a credential-bearing config must never loosen 0400 permissions.
test('global config writer preserves stricter existing permissions', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-config-mode-'));
    try {
        const configDir = path.join(home, '.aigon');
        fs.mkdirSync(configDir);
        const configPath = path.join(configDir, 'config.json');
        fs.writeFileSync(configPath, '{"repos":[]}\n', { mode: 0o400 });
        fs.chmodSync(configPath, 0o400);
        const result = spawnSync(process.execPath, ['-e', "require('./lib/config').saveGlobalConfig({ repos: [], terminalApp: 'apple-terminal' })"], {
            cwd: ROOT, encoding: 'utf8', env: { ...process.env, HOME: home },
        });
        assert.strictEqual(result.status, 0, result.stderr);
        assert.strictEqual(fs.statSync(configPath).mode & 0o777, 0o400);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

// REGRESSION: command-local help must not execute setup or create onboarding files.
test('setup command-local help is read-only', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-onboarding-help-'));
    try {
        const result = run(['setup', '--help'], home);
        assert.strictEqual(result.status, 0, result.stderr);
        assert.match(result.stdout, /Usage: aigon/);
        assert.ok(!fs.existsSync(path.join(home, '.aigon')), 'help must not write onboarding state');
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

if (failed) process.exit(1);
