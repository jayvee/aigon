#!/usr/bin/env node
/**
 * API tests — Layer 3 of the test pyramid.
 *
 * Tests /api/status returns correct validActions for each feature state.
 * Starts a dashboard server against a temp repo, creates features via the
 * workflow engine, then verifies the HTTP API responses.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const engine = require('../../lib/workflow-core/engine');
const { runDashboardServer } = require('../../lib/dashboard-server');
const { GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_PATH } = require('../../lib/config');

// ─── constants ───────────────────────────────────────────────────────────────

const PORT = 4198;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// ─── helpers ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const asyncTests = [];

function testAsync(description, fn) {
    const p = fn().then(() => {
        console.log(`  ✓ ${description}`);
        passed++;
    }).catch(err => {
        console.error(`  ✗ ${description}`);
        console.error(`    ${err.message}`);
        failed++;
    });
    asyncTests.push(p);
}

function httpGet(endpoint) {
    return new Promise((resolve, reject) => {
        http.get(`${BASE_URL}${endpoint}`, (res) => {
            let chunks = '';
            res.on('data', chunk => { chunks += chunk; });
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(chunks) });
                } catch (e) {
                    resolve({ status: res.statusCode, body: chunks });
                }
            });
        }).on('error', reject);
    });
}

async function waitForServer(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const resp = await httpGet('/api/status');
            if (resp.status === 200) return;
        } catch (_) { /* not ready */ }
        await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`Server did not become healthy within ${timeoutMs}ms`);
}

function makeTempRepo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aigon-api-test-'));
    for (const sub of [
        'docs/specs/features/01-inbox',
        'docs/specs/features/02-backlog',
        'docs/specs/features/03-in-progress',
        'docs/specs/features/05-done',
        'docs/specs/features/logs',
        '.aigon/workflows/features',
        '.aigon/state',
    ]) {
        fs.mkdirSync(path.join(dir, sub), { recursive: true });
    }
    // Write a minimal .aigon/config.json so the server recognizes this repo
    fs.writeFileSync(path.join(dir, '.aigon', 'config.json'), JSON.stringify({ profile: 'generic' }));
    return dir;
}

function writeSpec(repoPath, featureId, name) {
    fs.writeFileSync(
        path.join(repoPath, 'docs', 'specs', 'features', '03-in-progress', `feature-${featureId}-${name}.md`),
        `# Feature: ${name}\n`
    );
}

// ─── test setup ──────────────────────────────────────────────────────────────

let server = null;
let repoPath = null;
let origGlobalConfig = null;
let globalConfigExisted = false;

async function setup() {
    repoPath = makeTempRepo();

    // Create features in different states
    writeSpec(repoPath, '01', 'implementing-feature');
    await engine.startFeature(repoPath, '01', 'solo_branch', ['cc']);

    writeSpec(repoPath, '02', 'ready-feature');
    await engine.startFeature(repoPath, '02', 'solo_branch', ['cc']);
    await engine.signalAgentReady(repoPath, '02', 'cc');

    writeSpec(repoPath, '03', 'paused-feature');
    await engine.startFeature(repoPath, '03', 'solo_branch', ['cc']);
    await engine.pauseFeature(repoPath, '03');

    writeSpec(repoPath, '04', 'fleet-evaluating');
    await engine.startFeature(repoPath, '04', 'fleet', ['cc', 'gg']);
    await engine.signalAgentReady(repoPath, '04', 'cc');
    await engine.signalAgentReady(repoPath, '04', 'gg');
    await engine.requestFeatureEval(repoPath, '04');

    // Temporarily override global config to point at our temp repo
    origGlobalConfig = null;
    globalConfigExisted = fs.existsSync(GLOBAL_CONFIG_PATH);
    try { origGlobalConfig = fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8'); } catch (_) {}
    fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify({ repos: [repoPath] }));

    // Start dashboard server in-process
    server = runDashboardServer(PORT, 'api-test', 'api-test-server');

    // Wait for the server to start
    await waitForServer();
}

async function teardown() {
    if (server) {
        await new Promise((resolve) => server.close(resolve));
        server = null;
    }
    // Restore global config
    if (origGlobalConfig !== null) {
        fs.writeFileSync(GLOBAL_CONFIG_PATH, origGlobalConfig);
    } else if (!globalConfigExisted && fs.existsSync(GLOBAL_CONFIG_PATH)) {
        fs.rmSync(GLOBAL_CONFIG_PATH, { force: true });
    }
    if (repoPath) {
        fs.rmSync(repoPath, { recursive: true, force: true });
    }
}

// ─── tests ───────────────────────────────────────────────────────────────────

async function runTests() {
    console.log('\nAPI tests: /api/status validActions');

    testAsync('/api/status returns 200 with repos array', async () => {
        const resp = await httpGet('/api/status');
        assert.strictEqual(resp.status, 200);
        assert.ok(Array.isArray(resp.body.repos), 'should have repos array');
    });

    testAsync('implementing feature has pause action', async () => {
        const resp = await httpGet('/api/status');
        const repo = resp.body.repos[0];
        const feature = repo.features.find(f => f.id === '01');
        assert.ok(feature, 'implementing feature should exist');
        const hasPause = feature.validActions.some(a => a.action === 'feature-pause');
        assert.ok(hasPause, 'implementing feature should have pause action');
    });

    testAsync('ready feature (agent-ready) has close action', async () => {
        const resp = await httpGet('/api/status');
        const repo = resp.body.repos[0];
        const feature = repo.features.find(f => f.id === '02');
        assert.ok(feature, 'ready feature should exist');
        const hasClose = feature.validActions.some(a => a.action === 'feature-close');
        assert.ok(hasClose, 'ready feature should have close action');
    });

    testAsync('paused feature has resume action', async () => {
        const resp = await httpGet('/api/status');
        const repo = resp.body.repos[0];
        const feature = repo.features.find(f => f.id === '03');
        assert.ok(feature, 'paused feature should exist');
        const hasResume = feature.validActions.some(a => a.action === 'feature-resume');
        assert.ok(hasResume, 'paused feature should have resume action');
    });

    testAsync('evaluating fleet feature has close actions', async () => {
        const resp = await httpGet('/api/status');
        const repo = resp.body.repos[0];
        const feature = repo.features.find(f => f.id === '04');
        assert.ok(feature, 'evaluating feature should exist');
        const hasClose = feature.validActions.some(a => a.action === 'feature-close');
        assert.ok(hasClose, 'evaluating feature should have close action');
    });

    await Promise.all(asyncTests);
}

// ─── run ─────────────────────────────────────────────────────────────────────

setup()
    .then(() => runTests())
    .catch(err => {
        console.error('Setup failed:', err.message);
        failed++;
    })
    .finally(async () => {
        await teardown();
        console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
        process.exit(failed > 0 ? 1 : 0);
    });
