#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { test, withTempDir, report } = require('../_helpers');
const { getDashboardRuntimeEntry } = require('../../lib/server-runtime');

test('getDashboardRuntimeEntry is scoped to AIGON_HOME', () => withTempDir('aigon-runtime-a-', (homeA) => withTempDir('aigon-runtime-b-', (homeB) => {
    const previous = process.env.AIGON_HOME;
    const runtimePath = path.join(homeA, '.aigon', 'dashboard-runtime.json');
    fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
    fs.writeFileSync(runtimePath, JSON.stringify({ pid: 424242, startedAt: '2026-05-22T01:00:00.000Z', port: 4100 }));
    try {
        process.env.AIGON_HOME = homeB;
        assert.strictEqual(getDashboardRuntimeEntry({ isProcessAlive: () => true }), null);
        process.env.AIGON_HOME = homeA;
        assert.deepStrictEqual(getDashboardRuntimeEntry({ isProcessAlive: () => true }), {
            pid: 424242,
            startedAt: '2026-05-22T01:00:00.000Z',
            port: 4100,
            version: undefined,
        });
    } finally {
        if (previous === undefined) delete process.env.AIGON_HOME;
        else process.env.AIGON_HOME = previous;
    }
})));

report();
