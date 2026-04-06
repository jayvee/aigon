#!/usr/bin/env node
// REGRESSION: prevents the legacy --autonomous/--ralph flags from silently
// running the iterate loop after the 2026-04-07 rename to --iterate. The CLI
// must hard-error with a migration hint and exit 1 (feature 227).
'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');
const { test, report } = require('../_helpers');

const CLI = path.join(__dirname, '..', '..', 'aigon-cli.js');
const run = (args) => spawnSync('node', [CLI, ...args], { encoding: 'utf8' });

console.log('iterate-flag-rename');

test('--autonomous prints migration hint and exits 1', () => {
    const r = run(['feature-do', '1', '--autonomous']);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /--autonomous\/--ralph was renamed to --iterate/);
    assert.match(r.stderr, /aigon feature-do 1 --iterate/);
});

test('--ralph prints migration hint and exits 1', () => {
    const r = run(['feature-do', '7', '--ralph']);
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /--autonomous\/--ralph was renamed to --iterate/);
});

test('templates argHints uses [--iterate], not [--autonomous]', () => {
    const { COMMAND_REGISTRY } = require('../../lib/templates');
    const hints = COMMAND_REGISTRY['feature-do'].argHints;
    assert.ok(hints.includes('[--iterate]'), `expected [--iterate] in: ${hints}`);
    assert.ok(!hints.includes('[--autonomous]'), `unexpected [--autonomous] in: ${hints}`);
});

report();
