#!/usr/bin/env node
'use strict';

// REGRESSION F538: iterate/browser-smoke must not kill the operator's live dashboard
// by lsof-scanning port 4100. Registry reads are scoped to AIGON_HOME.

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { test, testAsync, withTempDir, report } = require('../_helpers');
const { getDashboardRuntimeEntry } = require('../../lib/server-runtime');

const ROOT = path.join(__dirname, '..', '..');
const CLI_PATH = path.join(ROOT, 'aigon-cli.js');
const FIXTURE_PORT = 4299;

function isAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (_) {
        return false;
    }
}

function waitForServer(url, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        const attempt = () => {
            http.get(url, (res) => { res.resume(); resolve(); })
                .on('error', () => {
                    if (Date.now() > deadline) reject(new Error(`Server at ${url} did not start`));
                    else setTimeout(attempt, 200);
                });
        };
        attempt();
    });
}

test('getDashboardRuntimeEntry is scoped to AIGON_HOME, not lsof on port 4100', () => withTempDir('aigon-f538-home-a-', (homeA) => withTempDir('aigon-f538-home-b-', (homeB) => {
    const sentinel = spawn('sleep', ['120'], { stdio: 'ignore' });
    const sentinelPid = sentinel.pid;
    assert.ok(sentinelPid > 0);

    const startedAt = '2026-05-22T01:00:00.000Z';
    const runtimeA = path.join(homeA, '.aigon', 'dashboard-runtime.json');
    fs.mkdirSync(path.dirname(runtimeA), { recursive: true });
    fs.writeFileSync(runtimeA, JSON.stringify({ pid: sentinelPid, startedAt, port: 4100 }));

    const prevHome = process.env.AIGON_HOME;
    process.env.AIGON_HOME = homeB;
    try {
        assert.strictEqual(getDashboardRuntimeEntry({ isProcessAlive: isAlive }), null);
    } finally {
        if (prevHome === undefined) delete process.env.AIGON_HOME;
        else process.env.AIGON_HOME = prevHome;
    }

    process.env.AIGON_HOME = homeA;
    try {
        const entry = getDashboardRuntimeEntry({ isProcessAlive: isAlive });
        assert.ok(entry);
        assert.strictEqual(entry.pid, sentinelPid);
        assert.strictEqual(entry.startedAt, startedAt);
    } finally {
        if (prevHome === undefined) delete process.env.AIGON_HOME;
        else process.env.AIGON_HOME = prevHome;
    }

    try { process.kill(sentinelPid, 'SIGTERM'); } catch (_) {}
})));

testAsync('server start with isolated AIGON_HOME does not stop foreign dashboard-runtime pid', async () => {
    const homeA = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-f538-user-'));
    const homeB = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-f538-fixture-'));
    const sentinel = spawn('sleep', ['120'], { stdio: 'ignore' });
    const startedAt = '2026-05-22T01:14:41.000Z';
    const runtimeAPath = path.join(homeA, '.aigon', 'dashboard-runtime.json');
    fs.mkdirSync(path.dirname(runtimeAPath), { recursive: true });
    fs.writeFileSync(runtimeAPath, JSON.stringify({ pid: sentinel.pid, startedAt, port: 4100 }));
    const before = JSON.parse(fs.readFileSync(runtimeAPath, 'utf8'));

    const dashProc = spawn(process.execPath, [CLI_PATH, 'server', 'start'], {
        cwd: ROOT,
        env: {
            ...process.env,
            HOME: homeB,
            AIGON_HOME: homeB,
            PORT: String(FIXTURE_PORT),
            AIGON_TEST_MODE: '1',
            AIGON_E2E_SERVER: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    try {
        await waitForServer(`http://127.0.0.1:${FIXTURE_PORT}`);
        assert.ok(isAlive(sentinel.pid), 'foreign sentinel pid must survive fixture server start');
        const after = JSON.parse(fs.readFileSync(runtimeAPath, 'utf8'));
        assert.strictEqual(after.pid, before.pid);
        assert.strictEqual(after.startedAt, before.startedAt);
        const fixtureRuntimePath = path.join(homeB, '.aigon', 'dashboard-runtime.json');
        const fixtureRuntime = JSON.parse(fs.readFileSync(fixtureRuntimePath, 'utf8'));
        assert.strictEqual(fixtureRuntime.pid, dashProc.pid);
        assert.strictEqual(fixtureRuntime.port, FIXTURE_PORT);
    } finally {
        try { dashProc.kill('SIGTERM'); } catch (_) {}
        try { sentinel.kill('SIGTERM'); } catch (_) {}
        await new Promise((r) => setTimeout(r, 250));
        const rmOpts = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 };
        fs.rmSync(homeA, rmOpts);
        fs.rmSync(homeB, rmOpts);
    }
});

report();
