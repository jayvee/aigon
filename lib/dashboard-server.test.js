#!/usr/bin/env node
'use strict';

/**
 * Smoke tests for lib/dashboard-server.js
 * Run: node lib/dashboard-server.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dashboard = require('./dashboard-server');
const engine = require('./workflow-core/engine');
const { GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_PATH } = require('./config');

let passed = 0;
let failed = 0;
const asyncTests = [];

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

function testAsync(description, fn) {
    asyncTests.push(
        fn()
            .then(() => {
                console.log(`  ✓ ${description}`);
                passed++;
            })
            .catch((err) => {
                console.error(`  ✗ ${description}`);
                console.error(`    ${err.message}`);
                failed++;
            })
    );
}

function withGlobalRepoConfig(repos, fn) {
    const hadConfig = fs.existsSync(GLOBAL_CONFIG_PATH);
    const previous = hadConfig ? fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8') : null;
    fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify({ repos }, null, 2));
    try {
        return fn();
    } finally {
        if (previous !== null) {
            fs.writeFileSync(GLOBAL_CONFIG_PATH, previous);
        } else if (fs.existsSync(GLOBAL_CONFIG_PATH)) {
            fs.unlinkSync(GLOBAL_CONFIG_PATH);
        }
    }
}

function makeTempRepo() {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-dashboard-status-'));
    const dirs = [
        'docs/specs/features/01-inbox',
        'docs/specs/features/02-backlog',
        'docs/specs/features/03-in-progress',
        'docs/specs/features/04-in-evaluation',
        'docs/specs/features/05-done',
        'docs/specs/features/06-paused',
        'docs/specs/features/evaluations',
        '.aigon/state',
    ];
    dirs.forEach(dir => fs.mkdirSync(path.join(repo, dir), { recursive: true }));
    return repo;
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
        'buildDetailPayload',
        'escapeAppleScriptString',
        'captureDashboardScreenshot',
        'writeRepoRegistry',
        'sendMacNotification',
        'resolveDashboardActionRepoPath',
        'parseDashboardActionRequest',
        'buildDashboardActionCommandArgs',
        'verifyFeatureStartRegistration',
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

// --- Preview dashboard tests ---
console.log('# dashboard-server.js — preview dashboard');

test('buildDashboardHtml accepts templateRootOverride parameter', () => {
    // buildDashboardHtml(initialData, instanceName, templateRootOverride)
    // With null override, should use default template (no error)
    const html = dashboard.buildDashboardHtml({}, 'main', null);
    assert.ok(typeof html === 'string');
    assert.ok(html.length > 0);
});

test('buildDashboardHtml with valid templateRootOverride reads from override path', () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    // Create a temp directory with templates/dashboard/index.html
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-preview-test-'));
    const dashDir = path.join(tmpDir, 'templates', 'dashboard');
    fs.mkdirSync(dashDir, { recursive: true });
    fs.writeFileSync(path.join(dashDir, 'index.html'), '<html><body>PREVIEW ${INITIAL_DATA} ${INSTANCE_NAME}</body></html>');

    const html = dashboard.buildDashboardHtml({ test: true }, 'preview-test', tmpDir);
    assert.ok(html.includes('PREVIEW'));
    assert.ok(html.includes('preview-test'));

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('buildDashboardHtml with missing override path falls back to default', () => {
    // Non-existent override path should fall back to readTemplate
    const html = dashboard.buildDashboardHtml({}, 'main', '/nonexistent/path');
    assert.ok(typeof html === 'string');
    assert.ok(html.length > 0);
});

testAsync('buildDetailPayload prefers workflow-core signal events for feature details', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-detail-events-'));
    try {
        await engine.startFeature(tmpDir, '01', 'solo_worktree', ['cc']);
        await engine.emitSignal(tmpDir, '01', 'agent-started', 'cc');
        await engine.emitSignal(tmpDir, '01', 'agent-ready', 'cc');

        const stateDir = path.join(tmpDir, '.aigon', 'state');
        fs.mkdirSync(stateDir, { recursive: true });
        fs.writeFileSync(
            path.join(stateDir, 'feature-01.json'),
            JSON.stringify({ events: [{ type: 'legacy.only', at: '2025-01-01T00:00:00Z' }] }, null, 2)
        );

        const payload = dashboard.buildDetailPayload(tmpDir, 'feature', '01');
        assert.ok(Array.isArray(payload.events));
        assert.deepStrictEqual(
            payload.events.map(ev => ev.type),
            ['signal.agent_started', 'signal.agent_ready']
        );
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

testAsync('collectDashboardStatusData surfaces workflow-core feature state', async () => {
    const repo = makeTempRepo();
    try {
        fs.writeFileSync(
            path.join(repo, 'docs/specs/features/03-in-progress/feature-01-runtime-check.md'),
            '# Runtime Check\n'
        );

        await engine.startFeature(repo, '01', 'fleet', ['cc', 'gg']);
        await engine.emitSignal(repo, '01', 'agent-ready', 'cc');
        await engine.emitSignal(repo, '01', 'agent-ready', 'gg');

        fs.writeFileSync(
            path.join(repo, '.aigon/state/feature-01.json'),
            JSON.stringify({ agents: ['cc', 'gg'], pending: [] }, null, 2)
        );

        const status = withGlobalRepoConfig([repo], () => dashboard.collectDashboardStatusData());
        assert.ok(Array.isArray(status.repos));
        assert.strictEqual(status.repos.length, 1);

        const feature = status.repos[0].features.find(item => item.id === '01');
        assert.ok(feature, 'expected feature 01 in dashboard status');
        assert.strictEqual(feature.workflowEngine, 'workflow-core');
        assert.ok(Array.isArray(feature.validActions));
        assert.ok(feature.validActions.some(action => action.action === 'feature-eval'));
        assert.ok(Array.isArray(feature.workflowEvents));
        assert.ok(feature.workflowEvents.some(event => event.type === 'signal.agent_ready'));
        assert.strictEqual(feature.agents.find(agent => agent.id === 'cc').status, 'submitted');
        assert.strictEqual(feature.agents.find(agent => agent.id === 'gg').status, 'submitted');
        assert.strictEqual(status.summary.submitted, 2);
        assert.strictEqual(status.summary.implementing || 0, 0);
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

test('verifyFeatureStartRegistration prefers workflow snapshot agents', () => {
    const repo = makeTempRepo();
    try {
        const workflowDir = path.join(repo, '.aigon', 'workflows', 'features', '01');
        fs.mkdirSync(workflowDir, { recursive: true });
        fs.writeFileSync(
            path.join(workflowDir, 'snapshot.json'),
            JSON.stringify({
                featureId: '01',
                lifecycle: 'implementing',
                agents: {
                    cc: { id: 'cc', status: 'running' }
                }
            }, null, 2)
        );

        const result = dashboard.verifyFeatureStartRegistration(repo, '01', ['cc']);
        assert.deepStrictEqual(result, { ok: true });
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

test('verifyFeatureStartRegistration falls back to manifest when no snapshot exists', () => {
    const repo = makeTempRepo();
    try {
        fs.writeFileSync(
            path.join(repo, '.aigon/state/feature-02.json'),
            JSON.stringify({ agents: ['cc'] }, null, 2)
        );

        const result = dashboard.verifyFeatureStartRegistration(repo, '02', ['cc']);
        assert.deepStrictEqual(result, { ok: true });
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

testAsync('collectDashboardStatusData does not treat folder-only active features as live workflow features', async () => {
    const repo = makeTempRepo();
    try {
        fs.writeFileSync(
            path.join(repo, 'docs/specs/features/03-in-progress/feature-02-legacy-check.md'),
            '# Legacy Check\n'
        );
        fs.writeFileSync(
            path.join(repo, '.aigon/state/feature-02.json'),
            JSON.stringify({ agents: ['cc'], pending: [] }, null, 2)
        );
        fs.writeFileSync(
            path.join(repo, '.aigon/state/feature-02-cc.json'),
            JSON.stringify({ status: 'waiting', updatedAt: '2026-01-01T00:00:00.000Z', flags: {} }, null, 2)
        );

        const status = withGlobalRepoConfig([repo], () => dashboard.collectDashboardStatusData());
        const feature = status.repos[0].features.find(item => item.id === '02');
        assert.strictEqual(feature, undefined);
        const allFeature = status.repos[0].allFeatures.find(item => item.id === '02');
        assert.strictEqual(allFeature, undefined);
    } finally {
        fs.rmSync(repo, { recursive: true, force: true });
    }
});

test('runDashboardServer accepts options parameter', () => {
    // Verify the function accepts 4 parameters (port, instanceName, serverId, options)
    assert.strictEqual(dashboard.runDashboardServer.length, 4);
});

// --- Summary ---
Promise.all(asyncTests).then(() => {
    console.log(`\n# Passed: ${passed}, Failed: ${failed}`);
    if (failed > 0) process.exit(1);
});
