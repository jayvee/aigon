#!/usr/bin/env node
'use strict';

// F545: every session-spawning path (agent, research, autonomous orchestrator,
// Set conductor) must apply HOME/env hygiene so a poisoned parent environment
// (e.g. a dashboard daemon that inherited a stale e2e HOME) cannot leak into the
// spawned session. These tests pin the hygiene helper's behaviour.

const assert = require('assert');
const os = require('os');
const path = require('path');
const { test, report } = require('../_helpers');
const {
    buildAgentWrapperEnvironmentLines,
    resolveSafeHome,
    looksLikePoisonedHome,
} = require('../../lib/worktree');

const realHome = os.userInfo().homedir;

function withEnv(overrides, fn) {
    const saved = {};
    for (const key of Object.keys(overrides)) {
        saved[key] = Object.prototype.hasOwnProperty.call(process.env, key)
            ? process.env[key] : undefined;
        if (overrides[key] === undefined) delete process.env[key];
        else process.env[key] = overrides[key];
    }
    try { return fn(); }
    finally {
        for (const key of Object.keys(saved)) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    }
}

test('looksLikePoisonedHome flags e2e + tmpdir homes, accepts the real home', () => {
    assert.strictEqual(looksLikePoisonedHome(path.join(os.tmpdir(), 'aigon-e2e-home-abc123')), true);
    assert.strictEqual(looksLikePoisonedHome(path.join(os.tmpdir(), 'whatever')), true);
    assert.strictEqual(looksLikePoisonedHome(''), true);
    assert.strictEqual(looksLikePoisonedHome(null), true);
    assert.strictEqual(looksLikePoisonedHome(realHome), false);
});

test('resolveSafeHome corrects a poisoned parent HOME (production: no AIGON_TEST_MODE)', () => {
    const poisoned = path.join(os.tmpdir(), 'aigon-e2e-home-deadbeef');
    withEnv({ HOME: poisoned, AIGON_TEST_MODE: undefined }, () => {
        assert.strictEqual(resolveSafeHome(), realHome);
    });
});

test('resolveSafeHome PRESERVES a temp HOME when AIGON_TEST_MODE is set (e2e isolation)', () => {
    // The e2e harness deliberately runs under HOME=<temp>; correcting it to the
    // real home would leak the run into the developer's ~/.aigon. Must NOT happen.
    const harnessHome = path.join(os.tmpdir(), 'aigon-e2e-home-cafe');
    withEnv({ HOME: harnessHome, AIGON_TEST_MODE: '1' }, () => {
        assert.strictEqual(resolveSafeHome(), harnessHome);
    });
});

test('resolveSafeHome keeps a sane inherited HOME', () => {
    withEnv({ HOME: realHome, AIGON_TEST_MODE: undefined }, () => {
        assert.strictEqual(resolveSafeHome(), realHome);
    });
});

test('buildAgentWrapperEnvironmentLines overrides poisoned HOME and unsets absent test vars', () => {
    const poisoned = path.join(os.tmpdir(), 'aigon-e2e-home-cafe');
    // Production poison scenario: bad HOME, AIGON_TEST_MODE NOT set in parent.
    const lines = withEnv({
        HOME: poisoned,
        AIGON_TEST_MODE: undefined,
        PLAYWRIGHT_TEST: undefined,
        MOCK_DELAY: undefined,
        AIGON_FORCE_PRO: undefined,
    }, () => buildAgentWrapperEnvironmentLines());

    const joined = lines.join('\n');
    // HOME must be re-exported to the real home, never the poisoned temp path.
    assert.ok(lines.includes(`export HOME='${realHome}'`), `expected real HOME export, got:\n${joined}`);
    assert.ok(!joined.includes(poisoned), `poisoned HOME must not appear:\n${joined}`);
    // Leaked test vars (absent in this clean parent) must be explicitly unset.
    for (const key of ['AIGON_TEST_MODE', 'PLAYWRIGHT_TEST', 'MOCK_DELAY', 'AIGON_FORCE_PRO']) {
        assert.ok(lines.includes(`unset ${key}`), `expected unset ${key}, got:\n${joined}`);
    }
});

report();
