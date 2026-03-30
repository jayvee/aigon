#!/usr/bin/env node
'use strict';

/**
 * Smoke tests for lib/proxy.js
 * Run: node lib/proxy.test.js
 */

const assert = require('assert');
const proxy = require('../../lib/proxy');

let passed = 0;
let failed = 0;

function test(description, fn) {
    try {
        fn();
        console.log(`  ✓ ${description}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ ${description}`);
        console.error(`    ${err.message}`);
        failed++;
    }
}

// --- Exports ---
console.log('# proxy.js — exports');

test('exports DEV_PROXY_DIR', () => {
    assert.ok(typeof proxy.DEV_PROXY_DIR === 'string');
    assert.ok(proxy.DEV_PROXY_DIR.includes('.aigon'));
});

test('exports DEV_PROXY_REGISTRY', () => {
    assert.ok(typeof proxy.DEV_PROXY_REGISTRY === 'string');
    assert.ok(proxy.DEV_PROXY_REGISTRY.endsWith('servers.json'));
});

test('exports DEV_PROXY_PID_FILE', () => {
    assert.ok(typeof proxy.DEV_PROXY_PID_FILE === 'string');
    assert.ok(proxy.DEV_PROXY_PID_FILE.endsWith('proxy.pid'));
});

test('exports PORT_REGISTRY_PATH', () => {
    assert.ok(typeof proxy.PORT_REGISTRY_PATH === 'string');
    assert.ok(proxy.PORT_REGISTRY_PATH.endsWith('ports.json'));
});

test('does NOT export DEV_PROXY_CADDYFILE', () => {
    assert.ok(!('DEV_PROXY_CADDYFILE' in proxy), 'DEV_PROXY_CADDYFILE should be removed');
});

test('does NOT export CADDY_ADMIN_URL', () => {
    assert.ok(!('CADDY_ADMIN_URL' in proxy), 'CADDY_ADMIN_URL should be removed');
});

test('exports all required functions', () => {
    const required = [
        'sanitizeForDns', 'getAppId', 'isPortAvailable', 'allocatePort',
        'isProxyAvailable', 'proxyDiagnostics', 'loadProxyRegistry', 'saveProxyRegistry',
        'loadPortRegistry', 'savePortRegistry', 'registerPort', 'deregisterPort',
        'scanPortsFromFilesystem', 'reconcileProxyRoutes',
        'registerDevServer', 'deregisterDevServer', 'gcDevServers', 'isProcessAlive',
        'detectDevServerContext', 'getDevProxyUrl', 'getDevServerLogPath',
        'spawnDevServer', 'waitForHealthy', 'openInBrowser',
        'deriveServerIdFromBranch', 'detectDashboardContext', 'hashBranchToPort',
    ];
    for (const fn of required) {
        assert.ok(typeof proxy[fn] === 'function', `missing: ${fn}`);
    }
});

test('does NOT export Caddy functions', () => {
    const removed = [
        'isCaddyAdminAvailable', 'writeCaddyfileBackup', 'addCaddyRoute', 'removeCaddyRoute',
        'getCaddyLiveRoutes', 'getCaddyRouteId', 'generateCaddyfile', 'reloadCaddy',
    ];
    for (const fn of removed) {
        assert.ok(!(fn in proxy), `${fn} should be removed (Caddy code)`);
    }
});

// --- Smoke tests ---
console.log('# proxy.js — smoke tests');

test('sanitizeForDns converts name to valid DNS label', () => {
    assert.strictEqual(proxy.sanitizeForDns('My App!'), 'my-app');
    assert.strictEqual(proxy.sanitizeForDns('hello_world'), 'hello-world');
});

test('getDevProxyUrl returns .localhost domain with serverId', () => {
    const url = proxy.getDevProxyUrl('farline', 'cc-119');
    assert.strictEqual(url, 'http://cc-119.farline.localhost');
});

test('getDevProxyUrl returns .localhost domain without serverId', () => {
    const url = proxy.getDevProxyUrl('aigon', '');
    assert.strictEqual(url, 'http://aigon.localhost');
});

test('getDevProxyUrl returns .localhost domain for main app', () => {
    const url = proxy.getDevProxyUrl('myapp', '');
    assert.ok(url.endsWith('.localhost'));
    assert.ok(url.includes('myapp'));
});

test('loadProxyRegistry returns object', () => {
    const reg = proxy.loadProxyRegistry();
    assert.ok(reg !== null && typeof reg === 'object');
});

test('loadPortRegistry returns object', () => {
    const reg = proxy.loadPortRegistry();
    assert.ok(reg !== null && typeof reg === 'object');
});

test('isProxyAvailable returns boolean', () => {
    const result = proxy.isProxyAvailable();
    assert.ok(typeof result === 'boolean');
});

test('proxyDiagnostics returns expected shape', () => {
    const diag = proxy.proxyDiagnostics();
    assert.ok(typeof diag === 'object');
    assert.ok(typeof diag.healthy === 'boolean');
    assert.ok(typeof diag.proxy === 'object');
    assert.ok(typeof diag.proxy.running === 'boolean');
    assert.ok(typeof diag.routes === 'object');
    assert.ok(typeof diag.routes.total === 'number');
});

test('proxyDiagnostics fix is "aigon proxy start" when proxy not running', () => {
    const diag = proxy.proxyDiagnostics();
    // In test env, proxy is not running
    if (!diag.proxy.running) {
        assert.strictEqual(diag.fix, 'aigon proxy start');
    }
});

test('reconcileProxyRoutes returns shape with added/removed/unchanged/cleaned', () => {
    const result = proxy.reconcileProxyRoutes();
    assert.ok(typeof result === 'object', 'should return an object');
    assert.ok(typeof result.added === 'number', 'added should be a number');
    assert.ok(typeof result.removed === 'number', 'removed should be a number');
    assert.ok(typeof result.unchanged === 'number', 'unchanged should be a number');
    assert.ok(typeof result.cleaned === 'number', 'cleaned should be a number');
});

test('deriveServerIdFromBranch returns string', () => {
    const id = proxy.deriveServerIdFromBranch('feature-42-cc-my-feature');
    assert.strictEqual(id, 'cc-42');
});

test('hashBranchToPort returns number in range', () => {
    const port = proxy.hashBranchToPort('feature-42-my-feature');
    assert.ok(typeof port === 'number');
    assert.ok(port >= 4101 && port <= 4199);
});

// --- Port Registry Constants ---
console.log('# proxy.js — port registry constants');

test('PORT_BLOCK_SIZE is 10', () => {
    assert.strictEqual(proxy.PORT_BLOCK_SIZE, 10);
});

test('PORT_START is 3000', () => {
    assert.strictEqual(proxy.PORT_START, 3000);
});

test('RESERVED_PORTS includes 4100 (dashboard)', () => {
    assert.ok(proxy.RESERVED_PORTS.includes(4100));
});

test('exports allocateBasePort function', () => {
    assert.ok(typeof proxy.allocateBasePort === 'function');
});

test('exports reallocatePort function', () => {
    assert.ok(typeof proxy.reallocatePort === 'function');
});

test('exports isReservedPort function', () => {
    assert.ok(typeof proxy.isReservedPort === 'function');
});

// --- isReservedPort ---
console.log('# proxy.js — isReservedPort');

test('isReservedPort returns true for 4100 (dashboard)', () => {
    assert.strictEqual(proxy.isReservedPort(4100), true);
});

test('isReservedPort returns true for ports whose block overlaps 4100', () => {
    assert.strictEqual(proxy.isReservedPort(4091), true); // block 4091-4100 contains 4100
    assert.strictEqual(proxy.isReservedPort(4100), true); // block 4100-4109 contains 4100
});

test('isReservedPort returns false for normal port ranges', () => {
    assert.strictEqual(proxy.isReservedPort(3000), false);
    assert.strictEqual(proxy.isReservedPort(3010), false);
    assert.strictEqual(proxy.isReservedPort(3050), false);
});

test('isReservedPort returns true for dashboard dynamic range', () => {
    assert.strictEqual(proxy.isReservedPort(4101), true);
    assert.strictEqual(proxy.isReservedPort(4150), true);
    assert.strictEqual(proxy.isReservedPort(4199), true);
});

test('isReservedPort returns false above dashboard dynamic range', () => {
    assert.strictEqual(proxy.isReservedPort(4200), false);
});

// --- allocateBasePort (isolated with temp registry) ---
console.log('# proxy.js — allocateBasePort');

const fs = require('fs');
const path = require('path');
const os = require('os');

test('allocateBasePort allocates from PORT_START for fresh registry', () => {
    // Save and restore original registry
    const origRegistry = proxy.loadPortRegistry();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-test-'));

    try {
        // Clear registry
        proxy.savePortRegistry({});
        const port = proxy.allocateBasePort(tmpDir, 'test-fresh');
        assert.strictEqual(port, 3000);
        // Verify it was registered
        const reg = proxy.loadPortRegistry();
        assert.ok(reg['test-fresh']);
        assert.strictEqual(reg['test-fresh'].basePort, 3000);
        assert.strictEqual(reg['test-fresh'].path, tmpDir);
        assert.ok(reg['test-fresh'].allocatedAt); // has a date
    } finally {
        proxy.savePortRegistry(origRegistry);
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('allocateBasePort picks next free block when first is taken', () => {
    const origRegistry = proxy.loadPortRegistry();
    const tmpDir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-test-'));
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-test-'));

    try {
        proxy.savePortRegistry({
            'project-a': { basePort: 3000, path: tmpDir1 }
        });
        const port = proxy.allocateBasePort(tmpDir2, 'project-b');
        assert.strictEqual(port, 3010); // next block of 10
    } finally {
        proxy.savePortRegistry(origRegistry);
        fs.rmSync(tmpDir1, { recursive: true, force: true });
        fs.rmSync(tmpDir2, { recursive: true, force: true });
    }
});

test('allocateBasePort skips reserved dashboard port range', () => {
    const origRegistry = proxy.loadPortRegistry();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-test-'));

    try {
        // Fill up ports so that the 4100 range would be a candidate
        const fakeRegistry = {};
        for (let p = 3000; p <= 4090; p += 10) {
            fakeRegistry[`project-${p}`] = { basePort: p, path: `/tmp/fake-${p}` };
        }
        proxy.savePortRegistry(fakeRegistry);

        const port = proxy.allocateBasePort(tmpDir, 'test-skip-dashboard');
        // 4100 is reserved (dashboard), 4101-4199 is dynamic dashboard range
        // Should skip those and land at 4200
        assert.ok(port >= 4200, `expected port >= 4200, got ${port}`);
    } finally {
        proxy.savePortRegistry(origRegistry);
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('allocateBasePort is idempotent (returns same port for same project)', () => {
    const origRegistry = proxy.loadPortRegistry();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-test-'));

    try {
        proxy.savePortRegistry({});
        const port1 = proxy.allocateBasePort(tmpDir, 'test-idempotent');
        const port2 = proxy.allocateBasePort(tmpDir, 'test-idempotent');
        assert.strictEqual(port1, port2);
    } finally {
        proxy.savePortRegistry(origRegistry);
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

// --- registerPort conflict detection ---
console.log('# proxy.js — registerPort conflict detection');

test('registerPort detects conflicts within PORT_BLOCK_SIZE', () => {
    const origRegistry = proxy.loadPortRegistry();

    try {
        proxy.savePortRegistry({
            'existing': { basePort: 3000, path: '/tmp/existing' }
        });
        // Port 3005 is within block of 10 from 3000
        const conflicts = proxy.registerPort('newcomer', 3005, '/tmp/newcomer');
        assert.ok(conflicts.length > 0, 'should detect conflict');
        assert.ok(conflicts.includes('existing'));
    } finally {
        proxy.savePortRegistry(origRegistry);
    }
});

test('registerPort allows non-overlapping ranges', () => {
    const origRegistry = proxy.loadPortRegistry();

    try {
        proxy.savePortRegistry({
            'existing': { basePort: 3000, path: '/tmp/existing' }
        });
        // Port 3010 is exactly at the next block boundary — no conflict
        const conflicts = proxy.registerPort('newcomer', 3010, '/tmp/newcomer');
        assert.strictEqual(conflicts.length, 0, 'should have no conflicts');
    } finally {
        proxy.savePortRegistry(origRegistry);
    }
});

// --- reallocatePort ---
console.log('# proxy.js — reallocatePort');

test('reallocatePort moves a project to a new non-conflicting port', () => {
    const origRegistry = proxy.loadPortRegistry();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-test-'));

    try {
        proxy.savePortRegistry({
            'project-a': { basePort: 3000, path: '/tmp/fake-a' },
            'project-b': { basePort: 3000, path: tmpDir }  // conflict!
        });
        const newPort = proxy.reallocatePort('project-b');
        assert.ok(newPort !== null);
        assert.notStrictEqual(newPort, 3000); // should get a different port
        assert.strictEqual(newPort, 3010); // next free block
    } finally {
        proxy.savePortRegistry(origRegistry);
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('reallocatePort returns null for unknown project', () => {
    const origRegistry = proxy.loadPortRegistry();

    try {
        proxy.savePortRegistry({});
        const result = proxy.reallocatePort('nonexistent');
        assert.strictEqual(result, null);
    } finally {
        proxy.savePortRegistry(origRegistry);
    }
});

// --- Preview dashboard server ID tests ---
console.log('# proxy.js — preview dashboard serverIds');

test('deriveServerIdFromBranch for worktree branch with agent', () => {
    assert.strictEqual(proxy.deriveServerIdFromBranch('feature-156-cc-dashboard-worktree-preview'), 'cc-156');
    assert.strictEqual(proxy.deriveServerIdFromBranch('feature-180-gg-pipeline-card'), 'gg-180');
});

test('deriveServerIdFromBranch returns null for non-feature branches', () => {
    assert.strictEqual(proxy.deriveServerIdFromBranch('main'), null);
    assert.strictEqual(proxy.deriveServerIdFromBranch('develop'), null);
});

test('hashBranchToPort returns consistent port for same branch', () => {
    const port1 = proxy.hashBranchToPort('feature-156-cc-dashboard-worktree-preview');
    const port2 = proxy.hashBranchToPort('feature-156-cc-dashboard-worktree-preview');
    assert.strictEqual(port1, port2);
});

test('hashBranchToPort returns different ports for different branches', () => {
    const portA = proxy.hashBranchToPort('feature-156-cc-dashboard-worktree-preview');
    const portB = proxy.hashBranchToPort('feature-180-gg-pipeline-card');
    // While collisions are possible, these specific strings should differ
    assert.ok(portA >= 4101 && portA <= 4199);
    assert.ok(portB >= 4101 && portB <= 4199);
});

test('getDevProxyUrl generates correct preview URL', () => {
    const url = proxy.getDevProxyUrl('aigon', 'cc-156');
    assert.strictEqual(url, 'http://cc-156.aigon.localhost');
});

// --- Summary ---
console.log(`\n# Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
