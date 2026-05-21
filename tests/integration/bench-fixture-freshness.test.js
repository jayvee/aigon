#!/usr/bin/env node
'use strict';
// Class-fix for the 2026-05-20 cu sweep incident: bench-mode runs must never
// extract a gold image built against a different aigon version. The runner
// auto-rebuilds via `aigon bench-snapshot` instead of silently using a stale
// fixture.

const assert = require('assert');
const { test, report } = require('../_helpers');

const perfBench = require('../../lib/perf-bench');

function fakeWriter() {
    const chunks = [];
    return { write: (s) => chunks.push(String(s)), text: () => chunks.join('') };
}

function fakeSeedReset({ exists, meta }) {
    return {
        goldImageExists: () => exists,
        readGoldMeta: () => meta,
        goldImagePath: (s) => `/fake/${s}-gold.tar.gz`,
    };
}

test('ensureFreshGoldImage: noop when image exists and version matches', () => {
    let spawnCount = 0;
    const result = perfBench.ensureFreshGoldImage('brewboard', {
        seedReset: fakeSeedReset({ exists: true, meta: { aigonVersion: '2.66.0-beta.2' } }),
        getInstalledAigonVersion: () => '2.66.0-beta.2',
        runShellFn: () => { spawnCount += 1; return { status: 0 }; },
        out: fakeWriter(),
    });
    assert.strictEqual(result.action, 'noop');
    assert.strictEqual(spawnCount, 0, 'no rebuild should fire when fresh');
});

test('ensureFreshGoldImage: rebuilds when image is missing', () => {
    let spawnArgs = null;
    const out = fakeWriter();
    const result = perfBench.ensureFreshGoldImage('brewboard', {
        seedReset: fakeSeedReset({ exists: false, meta: null }),
        getInstalledAigonVersion: () => '2.66.0-beta.2',
        runShellFn: (cmd, args) => { spawnArgs = { cmd, args }; return { status: 0 }; },
        out,
    });
    assert.strictEqual(result.action, 'rebuilt');
    assert.deepStrictEqual(spawnArgs, { cmd: 'aigon', args: ['bench-snapshot', 'brewboard'] });
    assert.match(out.text(), /missing at \/fake\/brewboard-gold\.tar\.gz/);
});

test('ensureFreshGoldImage: rebuilds when aigon version no longer matches', () => {
    let spawnArgs = null;
    const out = fakeWriter();
    const result = perfBench.ensureFreshGoldImage('brewboard', {
        seedReset: fakeSeedReset({ exists: true, meta: { aigonVersion: '2.65.0-beta.1' } }),
        getInstalledAigonVersion: () => '2.66.0-beta.2',
        runShellFn: (cmd, args) => { spawnArgs = { cmd, args }; return { status: 0 }; },
        out,
    });
    assert.strictEqual(result.action, 'rebuilt');
    assert.match(result.reason, /stale.*v2\.65\.0-beta\.1.*v2\.66\.0-beta\.2/);
    assert.deepStrictEqual(spawnArgs, { cmd: 'aigon', args: ['bench-snapshot', 'brewboard'] });
});

test('ensureFreshGoldImage: throws when bench-snapshot fails', () => {
    assert.throws(
        () => perfBench.ensureFreshGoldImage('brewboard', {
            seedReset: fakeSeedReset({ exists: false, meta: null }),
            getInstalledAigonVersion: () => '2.66.0-beta.2',
            runShellFn: () => ({ status: 1 }),
            out: fakeWriter(),
        }),
        /bench-snapshot brewboard failed \(exit 1\)/,
    );
});

test('ensureFreshGoldImage: treats missing meta as stale even if tarball exists', () => {
    let spawnArgs = null;
    perfBench.ensureFreshGoldImage('brewboard', {
        seedReset: {
            goldImageExists: () => true,
            readGoldMeta: () => null,
            goldImagePath: () => '/fake/brewboard-gold.tar.gz',
        },
        getInstalledAigonVersion: () => '2.66.0-beta.2',
        runShellFn: (cmd, args) => { spawnArgs = { cmd, args }; return { status: 0 }; },
        out: fakeWriter(),
    });
    assert.deepStrictEqual(spawnArgs, { cmd: 'aigon', args: ['bench-snapshot', 'brewboard'] });
});

report();
