#!/usr/bin/env node
// REGRESSION feature 227: legacy --autonomous/--ralph flags must hard-error
// with a migration hint (exit 1); templates argHints use --iterate.
const a = require('assert'), { spawnSync } = require('child_process'), path = require('path');
const CLI = path.join(__dirname, '..', '..', 'aigon-cli.js');
const run = args => spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
const r1 = run(['feature-do', '1', '--autonomous']);
a.strictEqual(r1.status, 1); a.match(r1.stderr, /--autonomous\/--ralph was renamed to --iterate/); a.match(r1.stderr, /aigon feature-do 1 --iterate/);
const r2 = run(['feature-do', '7', '--ralph']);
a.strictEqual(r2.status, 1); a.match(r2.stderr, /--autonomous\/--ralph was renamed to --iterate/);
const { COMMAND_REGISTRY } = require('../../lib/templates');
const hints = COMMAND_REGISTRY['feature-do'].argHints;
a.ok(hints.includes('[--iterate]')); a.ok(!hints.includes('[--autonomous]'));
