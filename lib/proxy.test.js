#!/usr/bin/env node
'use strict';

/**
 * Smoke tests for lib/proxy.js
 * Run: node lib/proxy.test.js
 */

const assert = require('assert');
const proxy = require('./proxy');

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

test('exports DEV_PROXY_CADDYFILE', () => {
    assert.ok(typeof proxy.DEV_PROXY_CADDYFILE === 'string');
});

test('exports PORT_REGISTRY_PATH', () => {
    assert.ok(typeof proxy.PORT_REGISTRY_PATH === 'string');
    assert.ok(proxy.PORT_REGISTRY_PATH.endsWith('ports.json'));
});

test('exports CADDY_ADMIN_URL', () => {
    assert.ok(typeof proxy.CADDY_ADMIN_URL === 'string');
    assert.ok(proxy.CADDY_ADMIN_URL.startsWith('http'));
});

test('exports all required functions', () => {
    const required = [
        'sanitizeForDns', 'getAppId', 'isPortAvailable', 'allocatePort',
        'isProxyAvailable', 'proxyDiagnostics', 'loadProxyRegistry', 'saveProxyRegistry',
        'loadPortRegistry', 'savePortRegistry', 'registerPort', 'deregisterPort',
        'scanPortsFromFilesystem', 'getCaddyRouteId', 'getCaddyLiveRoutes',
        'registryHasRoute', 'reconcileProxyRoutes', 'generateCaddyfile', 'reloadCaddy',
        'registerDevServer', 'deregisterDevServer', 'gcDevServers', 'isProcessAlive',
        'detectDevServerContext', 'getDevProxyUrl', 'getDevServerLogPath',
        'spawnDevServer', 'waitForHealthy', 'openInBrowser',
        'deriveServerIdFromBranch', 'detectDashboardContext', 'hashBranchToPort',
    ];
    for (const fn of required) {
        assert.ok(typeof proxy[fn] === 'function', `missing: ${fn}`);
    }
});

test('does NOT export dead functions', () => {
    assert.ok(!('isCaddyAdminAvailable' in proxy), 'isCaddyAdminAvailable should be dead');
    assert.ok(!('writeCaddyfileBackup' in proxy), 'writeCaddyfileBackup should be dead');
    assert.ok(!('addCaddyRoute' in proxy), 'addCaddyRoute should be dead');
    assert.ok(!('removeCaddyRoute' in proxy), 'removeCaddyRoute should be dead');
});

// --- Smoke tests ---
console.log('# proxy.js — smoke tests');

test('sanitizeForDns converts name to valid DNS label', () => {
    assert.strictEqual(proxy.sanitizeForDns('My App!'), 'my-app');
    assert.strictEqual(proxy.sanitizeForDns('hello_world'), 'hello-world');
});

test('generateCaddyfile returns string with reverse_proxy blocks', () => {
    const registry = {
        'app1': { serverId: 's1', port: 3001, worktreePath: '/tmp/wt' }
    };
    const result = proxy.generateCaddyfile(registry);
    assert.ok(typeof result === 'string');
    assert.ok(result.includes('reverse_proxy'));
});

test('getCaddyRouteId returns deterministic string', () => {
    const id1 = proxy.getCaddyRouteId('myapp', 'feature-1');
    const id2 = proxy.getCaddyRouteId('myapp', 'feature-1');
    assert.strictEqual(id1, id2);
    assert.ok(typeof id1 === 'string');
    assert.ok(id1.length > 0);
});

test('registryHasRoute returns false for missing route', () => {
    const result = proxy.registryHasRoute({}, 'nonexistent-route-id');
    assert.strictEqual(result, false);
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

test('deriveServerIdFromBranch returns string', () => {
    const id = proxy.deriveServerIdFromBranch('feature-42-my-feature');
    assert.ok(typeof id === 'string');
    assert.ok(id.length > 0);
});

test('hashBranchToPort returns number in range', () => {
    const port = proxy.hashBranchToPort('feature-42-my-feature');
    assert.ok(typeof port === 'number');
    assert.ok(port >= 4101 && port <= 4199);
});

// --- Summary ---
console.log(`\n# Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
