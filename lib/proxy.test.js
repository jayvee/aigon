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

// --- Summary ---
console.log(`\n# Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
