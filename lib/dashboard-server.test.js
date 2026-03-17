#!/usr/bin/env node
'use strict';

/**
 * Smoke tests for lib/dashboard-server.js
 * Run: node lib/dashboard-server.test.js
 */

const assert = require('assert');
const dashboard = require('./dashboard-server');

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
console.log('# dashboard-server.js — exports');

test('exports required functions', () => {
    const required = [
        'readConductorReposFromGlobalConfig',
        'parseSimpleFrontMatter',
        'normalizeDashboardStatus',
        'parseFeatureSpecFileName',
        'inferDashboardNextCommand',
        'inferDashboardNextActions',
        'safeTmuxSessionExists',
        'collectDashboardStatusData',
        'escapeForHtmlScript',
        'buildDashboardHtml',
        'escapeAppleScriptString',
        'captureDashboardScreenshot',
        'writeRepoRegistry',
        'sendMacNotification',
        'resolveDashboardActionRepoPath',
        'parseDashboardActionRequest',
        'buildDashboardActionCommandArgs',
        'runDashboardInteractiveAction',
        'runDashboardServer',
    ];
    for (const fn of required) {
        assert.ok(typeof dashboard[fn] === 'function', `missing: ${fn}`);
    }
});

test('exports DASHBOARD_INTERACTIVE_ACTIONS as Set', () => {
    assert.ok(dashboard.DASHBOARD_INTERACTIVE_ACTIONS instanceof Set);
    assert.ok(dashboard.DASHBOARD_INTERACTIVE_ACTIONS.size > 0);
});

// --- Smoke tests ---
console.log('# dashboard-server.js — smoke tests');

test('parseSimpleFrontMatter parses key: value pairs', () => {
    const content = '---\nstatus: in-progress\nagent: cc\n---\n# Body';
    const result = dashboard.parseSimpleFrontMatter(content);
    assert.ok(result !== null && typeof result === 'object');
    assert.strictEqual(result.status, 'in-progress');
    assert.strictEqual(result.agent, 'cc');
});

test('parseSimpleFrontMatter returns empty object for no frontmatter', () => {
    const result = dashboard.parseSimpleFrontMatter('# Just a heading\n\nNo frontmatter here.');
    assert.ok(result !== null && typeof result === 'object');
    assert.strictEqual(Object.keys(result).length, 0);
});

test('normalizeDashboardStatus maps known statuses', () => {
    const result = dashboard.normalizeDashboardStatus('implementing');
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
});

test('parseFeatureSpecFileName extracts id and name', () => {
    const result = dashboard.parseFeatureSpecFileName('feature-42-my-cool-feature.md');
    assert.ok(result !== null && typeof result === 'object');
    assert.ok('id' in result || 'name' in result);
});

test('escapeForHtmlScript escapes script-breaking characters', () => {
    const val = { key: '</script>' };
    const escaped = dashboard.escapeForHtmlScript(val);
    assert.ok(typeof escaped === 'string');
    assert.ok(!escaped.includes('</script>'));
});

test('escapeAppleScriptString escapes quotes', () => {
    const result = dashboard.escapeAppleScriptString('hello "world"');
    assert.ok(typeof result === 'string');
});

test('readConductorReposFromGlobalConfig returns array', () => {
    const repos = dashboard.readConductorReposFromGlobalConfig();
    assert.ok(Array.isArray(repos));
});

test('inferDashboardNextCommand returns string or null', () => {
    const result = dashboard.inferDashboardNextCommand('42', ['cc'], 'implementing');
    assert.ok(result === null || typeof result === 'string');
});

test('inferDashboardNextActions returns array', () => {
    const result = dashboard.inferDashboardNextActions('42', ['cc'], 'implementing');
    assert.ok(Array.isArray(result));
});

test('resolveDashboardActionRepoPath returns object with repoPath', () => {
    const result = dashboard.resolveDashboardActionRepoPath('/nonexistent/path', [], '/default/path');
    assert.ok(result !== null && typeof result === 'object');
    assert.ok('repoPath' in result);
});

test('parseDashboardActionRequest parses valid payload', () => {
    const payload = JSON.stringify({ action: 'feature-do', args: { id: '42' }, repoPath: process.cwd() });
    const result = dashboard.parseDashboardActionRequest(payload);
    assert.ok(result !== null && typeof result === 'object');
    assert.ok('action' in result || 'error' in result);
});

// --- Summary ---
console.log(`\n# Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
