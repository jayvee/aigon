#!/usr/bin/env node
'use strict';
// REGRESSION F493: check-version must be non-mutating; hooks must always exit 0.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, withTempDir, report, GIT_SAFE_ENV } = require('../_helpers');

const CLI = path.join(__dirname, '..', '..', 'aigon-cli.js');
const SETUP_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'commands', 'setup.js'), 'utf8');

function runAigon(args, opts = {}) {
    return spawnSync(process.execPath, [CLI, ...args], {
        env: { ...process.env, ...GIT_SAFE_ENV, AIGON_NONINTERACTIVE: '1', ...(opts.env || {}) },
        cwd: opts.cwd || process.cwd(),
        stdio: 'pipe',
        timeout: 30000,
    });
}

// Static-grep: check-version body must not call mutating functions
test('check-version source body does not call mutating functions', () => {
    const cvStart = SETUP_SRC.indexOf("'check-version': async");
    const cvEnd = SETUP_SRC.indexOf("\n        'update':", cvStart);
    assert.ok(cvStart !== -1 && cvEnd !== -1, 'check-version command body not found in setup.js');
    const body = SETUP_SRC.slice(cvStart, cvEnd);
    assert.ok(!body.includes("commands['update']"), "check-version must not call commands['update']");
    assert.ok(!body.includes('upgradeAigonCli'), 'check-version must not call upgradeAigonCli');
    // runPendingMigrations (repo migration) must not be called — runPendingGlobalConfigMigrations
    // is allowed inside the runGlobalConfigMigrations helper which writes to ~/.aigon/ only.
    assert.ok(!body.includes("require('../migration')"), 'check-version must not require the repo migration module');
    assert.ok(!body.includes('runPendingMigrations('), 'check-version must not call runPendingMigrations');
});

// Integration: check-version makes no writes in a repo with a stale .aigon/version
test('check-version leaves .aigon/ unchanged with stale .aigon/version', () => withTempDir('aigon-f493-cv-', (dir) => {
    spawnSync('git', ['init', '-q'], { cwd: dir, env: { ...process.env, ...GIT_SAFE_ENV } });
    spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir, env: { ...process.env, ...GIT_SAFE_ENV } });

    fs.mkdirSync(path.join(dir, '.aigon'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.aigon', 'version'), '0.0.0');

    // Snapshot only the .aigon/ directory (npm registry check may write ~/.npm cache)
    const beforeFiles = fs.readdirSync(path.join(dir, '.aigon')).sort().join(',');

    const result = runAigon(['check-version'], {
        cwd: dir,
        env: { HOME: dir, USERPROFILE: dir, npm_config_cache: path.join(dir, '.npm-cache') },
    });

    const afterFiles = fs.readdirSync(path.join(dir, '.aigon')).sort().join(',');
    const versionAfter = fs.readFileSync(path.join(dir, '.aigon', 'version'), 'utf8').trim();

    assert.strictEqual(result.status, 0, `check-version exited non-zero:\n${result.stderr.toString()}`);
    assert.strictEqual(afterFiles, beforeFiles, 'check-version must not add files to .aigon/');
    assert.strictEqual(versionAfter, '0.0.0', 'check-version must not update .aigon/version');
    const output = result.stdout.toString() + result.stderr.toString();
    assert.ok(output.includes('aigon apply'), 'check-version should prompt the user to run aigon apply');
}));

// Integration: hooks (capture-*, check-agent-signal) must always exit 0 — they are advisory.
test('hooks exit 0 on error/missing-state (capture-session-telemetry, capture-gemini-telemetry, check-agent-signal)', () => withTempDir('aigon-f493-hooks-', (dir) => {
    const cst = runAigon(['capture-session-telemetry', '/nonexistent/transcript.jsonl']);
    assert.strictEqual(cst.status, 0, `capture-session-telemetry: ${cst.status}`);

    const cgt = runAigon(['capture-gemini-telemetry'], {
        cwd: dir,
        env: { HOME: dir, AIGON_PROJECT_PATH: dir, AIGON_ENTITY_TYPE: 'feature', AIGON_ENTITY_ID: '07', AIGON_AGENT_ID: 'gg' },
    });
    assert.strictEqual(cgt.status, 0, `capture-gemini-telemetry: ${cgt.status}`);

    const cas = runAigon(['check-agent-signal', '--json'], { cwd: dir });
    assert.strictEqual(cas.status, 0, `check-agent-signal: ${cas.stderr.toString()}`);
}));

report();
