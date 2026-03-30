#!/usr/bin/env node
/**
 * Dashboard E2E tests — HTTP API layer.
 *
 * Verifies the dashboard server endpoints against a real brewboard seed repo.
 * Catches the string-handoff bugs (session names, mode values, endpoint bodies)
 * that have repeatedly broken the dashboard without needing Playwright.
 *
 * Run:  node --test tests/api/dashboard-e2e.test.js
 * Or:   node tests/api/dashboard-e2e.test.js
 *
 * Prerequisites:
 *   - tmux installed
 *   - ~/src/brewboard seed repo exists (will be reset by the suite)
 *   - brewboard registered in ~/.aigon/config.json repos
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync, execSync } = require('child_process');

// ─── constants ───────────────────────────────────────────────────────────────

const CLI_PATH = path.join(__dirname, '../..', 'aigon-cli.js');
const DASHBOARD_PORT = 4199;
const DASHBOARD_URL = `http://127.0.0.1:${DASHBOARD_PORT}`;
const BREWBOARD_PATH = path.join(process.env.HOME, 'src', 'brewboard');
const BREWBOARD_WORKTREES = BREWBOARD_PATH + '-worktrees';

// ─── helpers ─────────────────────────────────────────────────────────────────

/** POST JSON to a dashboard endpoint and return parsed response. */
function dashboardPost(endpoint, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = http.request(`${DASHBOARD_URL}${endpoint}`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(data),
            },
        }, (res) => {
            let chunks = '';
            res.on('data', chunk => { chunks += chunk; });
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(chunks) });
                } catch (e) {
                    resolve({ status: res.statusCode, body: chunks });
                }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

/** GET a dashboard endpoint and return parsed response. */
function dashboardGet(endpoint) {
    return new Promise((resolve, reject) => {
        http.get(`${DASHBOARD_URL}${endpoint}`, (res) => {
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

/** Run aigon CLI synchronously. */
function runAigon(args, { cwd = BREWBOARD_PATH, timeout = 60000 } = {}) {
    const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout,
    });
    return {
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: result.status,
    };
}

/** Check if a tmux session exists by name. Returns true/false. */
function tmuxSessionExists(name) {
    const result = spawnSync('tmux', ['has-session', '-t', name], {
        encoding: 'utf8',
        stdio: 'pipe',
    });
    return result.status === 0;
}

/** List all tmux sessions matching a prefix. */
function listTmuxSessions(prefix) {
    const result = spawnSync('tmux', ['list-sessions', '-F', '#S'], {
        encoding: 'utf8',
        stdio: 'pipe',
    });
    if (result.status !== 0 || !result.stdout) return [];
    return result.stdout.split('\n').map(s => s.trim()).filter(s => s.startsWith(prefix));
}

/** Kill all tmux sessions matching a prefix. */
function killTmuxSessions(prefix) {
    const sessions = listTmuxSessions(prefix);
    for (const s of sessions) {
        spawnSync('tmux', ['kill-session', '-t', s], { stdio: 'ignore' });
    }
    return sessions.length;
}

/** Wait for the dashboard server to respond to /api/status. */
async function waitForDashboard(timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const resp = await dashboardGet('/api/status');
            if (resp.status === 200) return;
        } catch (_) {
            // not ready yet
        }
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`Dashboard did not become healthy within ${timeoutMs}ms`);
}

/** Find a spec file matching a pattern in a stage directory. */
function findSpec(stage, pattern) {
    const dir = path.join(BREWBOARD_PATH, 'docs', 'specs', 'features', stage);
    if (!fs.existsSync(dir)) return null;
    return fs.readdirSync(dir).find(f => pattern.test(f)) || null;
}

/** Find a research spec file matching a pattern in a stage directory. */
function findResearchSpec(stage, pattern) {
    const dir = path.join(BREWBOARD_PATH, 'docs', 'specs', 'research-topics', stage);
    if (!fs.existsSync(dir)) return null;
    return fs.readdirSync(dir).find(f => pattern.test(f)) || null;
}

/** Wait a fixed number of milliseconds. */
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ─── suite ───────────────────────────────────────────────────────────────────

let dashboardProcess = null;

describe('Dashboard E2E — HTTP API Layer', { timeout: 300000 }, () => {

    before(async () => {
        // 1. Reset brewboard to a clean seed state
        console.log('    [setup] Running seed-reset on brewboard...');
        const resetResult = runAigon(['seed-reset', BREWBOARD_PATH, '--force'], {
            cwd: path.join(process.env.HOME, 'src', 'aigon'),
            timeout: 120000,
        });
        if (resetResult.exitCode !== 0) {
            console.error('    [setup] seed-reset stderr:', resetResult.stderr);
            throw new Error(`seed-reset failed with exit code ${resetResult.exitCode}`);
        }
        console.log('    [setup] seed-reset complete');

        // 2. Kill any lingering brewboard tmux sessions
        killTmuxSessions('brewboard-');

        // 3. Start dashboard server on test port
        console.log(`    [setup] Starting dashboard on port ${DASHBOARD_PORT}...`);
        dashboardProcess = spawn(process.execPath, [CLI_PATH, 'dashboard'], {
            cwd: BREWBOARD_PATH,
            env: { ...process.env, PORT: String(DASHBOARD_PORT) },
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
        });

        // Collect stderr for diagnostics
        let stderrBuf = '';
        dashboardProcess.stderr.on('data', chunk => { stderrBuf += chunk.toString(); });
        dashboardProcess.stdout.on('data', () => {}); // drain stdout

        // 4. Wait for healthy
        try {
            await waitForDashboard(30000);
        } catch (e) {
            console.error('    [setup] Dashboard stderr:', stderrBuf);
            throw e;
        }
        console.log('    [setup] Dashboard is healthy');
    });

    after(() => {
        // 5. Stop dashboard
        if (dashboardProcess) {
            dashboardProcess.kill('SIGTERM');
            dashboardProcess = null;
        }

        // 6. Kill brewboard tmux sessions
        const killed = killTmuxSessions('brewboard-');
        if (killed > 0) {
            console.log(`    [teardown] Killed ${killed} brewboard tmux sessions`);
        }
    });

    // ── Test 1: Status endpoint returns brewboard ─────────────────────────────

    it('GET /api/status returns brewboard with features and research', async () => {
        const resp = await dashboardGet('/api/status');
        assert.equal(resp.status, 200, 'Expected 200 OK');

        const data = resp.body;
        assert.ok(data.repos, 'Response should have repos array');
        assert.ok(Array.isArray(data.repos), 'repos should be an array');

        const brewboard = data.repos.find(r =>
            r.name === 'brewboard' || (r.path && r.path.includes('brewboard'))
        );
        assert.ok(brewboard, 'brewboard should appear in repos list');
        assert.ok(Array.isArray(brewboard.features), 'brewboard should have features array');
        assert.ok(Array.isArray(brewboard.research), 'brewboard should have research array');
        assert.ok(brewboard.features.length > 0, 'brewboard should have at least one feature');
    });

    // ── Test 2: Feature start dispatches correctly ────────────────────────────

    it('POST /api/action feature-start creates worktrees and tmux sessions', { timeout: 90000 }, async () => {
        // First, ensure feature 01 is in backlog (it should be after seed-reset)
        const backlogSpec = findSpec('02-backlog', /^feature-01-/);
        assert.ok(backlogSpec, 'feature-01 should be in 02-backlog after seed-reset');

        // Dispatch feature-start via the dashboard action endpoint
        const resp = await dashboardPost('/api/action', {
            action: 'feature-start',
            args: ['01', 'cc', 'gg'],
            repoPath: BREWBOARD_PATH,
        });

        assert.equal(resp.status, 200, `Expected 200 OK, got ${resp.status}: ${JSON.stringify(resp.body)}`);
        assert.ok(resp.body.ok, `Action should succeed: ${JSON.stringify(resp.body)}`);

        // Allow a moment for tmux sessions to be created
        await sleep(2000);

        // Verify spec moved to 03-in-progress
        const inProgressSpec = findSpec('03-in-progress', /^feature-01-/);
        assert.ok(inProgressSpec, 'feature-01 should have moved to 03-in-progress');

        // Verify tmux sessions exist
        // Session names follow: {repo}-f{num}-{agent}-{desc}
        const sessions = listTmuxSessions('brewboard-f1-');
        assert.ok(sessions.length >= 2, `Expected at least 2 tmux sessions for f1, got: ${sessions.join(', ')}`);

        // Check that both cc and gg have sessions
        const hasCc = sessions.some(s => s.includes('-cc'));
        const hasGg = sessions.some(s => s.includes('-gg'));
        assert.ok(hasCc, `Expected a cc session in: ${sessions.join(', ')}`);
        assert.ok(hasGg, `Expected a gg session in: ${sessions.join(', ')}`);

        // Verify manifest was created
        const manifestPath = path.join(BREWBOARD_PATH, '.aigon', 'state', 'feature-01.json');
        assert.ok(fs.existsSync(manifestPath), 'feature-01 manifest should exist');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        assert.ok(manifest.agents.includes('cc'), 'manifest should include cc agent');
        assert.ok(manifest.agents.includes('gg'), 'manifest should include gg agent');
    });

    // ── Test 3: Feature eval opens tmux session ───────────────────────────────

    it('POST /api/feature-open with mode=eval creates eval tmux session', { timeout: 60000 }, async () => {
        // Simulate agents submitting: write agent status files
        // The agent status files live in the main repo at .aigon/state/
        const stateDir = path.join(BREWBOARD_PATH, '.aigon', 'state');
        fs.mkdirSync(stateDir, { recursive: true });

        // Write submitted status for both agents
        for (const agent of ['cc', 'gg']) {
            const statusPath = path.join(stateDir, `feature-01-${agent}.json`);
            fs.writeFileSync(statusPath, JSON.stringify({
                agent,
                featureId: '01',
                status: 'submitted',
                updatedAt: new Date().toISOString(),
            }));
        }

        // POST to feature-open with eval mode
        const resp = await dashboardPost('/api/feature-open', {
            featureId: '01',
            agentId: 'cc',
            pipelineType: 'features',
            mode: 'eval',
            repoPath: BREWBOARD_PATH,
        });

        assert.equal(resp.status, 200, `Expected 200 OK, got ${resp.status}: ${JSON.stringify(resp.body)}`);
        assert.ok(resp.body.ok, `feature-open eval should succeed: ${JSON.stringify(resp.body)}`);
        assert.ok(resp.body.sessionName, 'Response should include sessionName');

        // The eval session name should match: brewboard-f{id}-eval (id may be zero-padded)
        const sessionName = resp.body.sessionName;
        assert.match(sessionName, /^brewboard-f0*1-eval$/,
            `Eval session name should match brewboard-f{01|1}-eval, got "${sessionName}"`);

        // Verify tmux session exists
        await sleep(1000);
        assert.ok(tmuxSessionExists(sessionName),
            `tmux session "${sessionName}" should exist`);
    });

    // ── Test 4: Research start dispatches correctly ───────────────────────────

    it('POST /api/action research-start creates research tmux sessions', { timeout: 90000 }, async () => {
        // Verify research-01 is in backlog
        const backlogSpec = findResearchSpec('02-backlog', /^research-01-/);
        assert.ok(backlogSpec, 'research-01 should be in 02-backlog after seed-reset');

        const resp = await dashboardPost('/api/action', {
            action: 'research-start',
            args: ['01', 'cc', 'gg'],
            repoPath: BREWBOARD_PATH,
        });

        assert.equal(resp.status, 200, `Expected 200 OK, got ${resp.status}: ${JSON.stringify(resp.body)}`);
        assert.ok(resp.body.ok, `research-start should succeed: ${JSON.stringify(resp.body)}`);

        await sleep(2000);

        // Research spec should have moved to 03-in-progress
        const inProgressSpec = findResearchSpec('03-in-progress', /^research-01-/);
        assert.ok(inProgressSpec, 'research-01 should have moved to 03-in-progress');

        // Verify tmux sessions: {repo}-r{num}-{agent}
        const sessions = listTmuxSessions('brewboard-r1-');
        assert.ok(sessions.length >= 2, `Expected at least 2 research tmux sessions, got: ${sessions.join(', ')}`);

        const hasCc = sessions.some(s => s.includes('-cc'));
        const hasGg = sessions.some(s => s.includes('-gg'));
        assert.ok(hasCc, `Expected a cc research session in: ${sessions.join(', ')}`);
        assert.ok(hasGg, `Expected a gg research session in: ${sessions.join(', ')}`);
    });

    // ── Test 5: Research eval opens tmux session (the critical test) ──────────

    it('POST /api/feature-open with pipelineType=research mode=eval creates research eval session', { timeout: 60000 }, async () => {
        // Simulate research agents submitting
        const stateDir = path.join(BREWBOARD_PATH, '.aigon', 'state');
        fs.mkdirSync(stateDir, { recursive: true });

        for (const agent of ['cc', 'gg']) {
            const statusPath = path.join(stateDir, `research-01-${agent}.json`);
            fs.writeFileSync(statusPath, JSON.stringify({
                agent,
                researchId: '01',
                status: 'submitted',
                updatedAt: new Date().toISOString(),
            }));
        }

        // Also create findings files so the eval has something to work with
        const logsDir = path.join(BREWBOARD_PATH, 'docs', 'specs', 'research-topics', 'logs');
        fs.mkdirSync(logsDir, { recursive: true });
        for (const agent of ['cc', 'gg']) {
            const findingsPath = path.join(logsDir, `research-01-${agent}-findings.md`);
            if (!fs.existsSync(findingsPath)) {
                fs.writeFileSync(findingsPath, `# Research 01 - ${agent} Findings\n\nMock findings for testing.\n`);
            }
        }

        // POST to feature-open with research eval mode
        // THIS is the test that catches the 'synthesize' vs 'eval' bug
        const resp = await dashboardPost('/api/feature-open', {
            featureId: '01',
            agentId: 'cc',
            pipelineType: 'research',
            mode: 'eval',
            repoPath: BREWBOARD_PATH,
        });

        assert.equal(resp.status, 200, `Expected 200 OK, got ${resp.status}: ${JSON.stringify(resp.body)}`);
        assert.ok(resp.body.ok, `research eval should succeed: ${JSON.stringify(resp.body)}`);
        assert.ok(resp.body.sessionName, 'Response should include sessionName');

        // Research eval session: brewboard-r1-eval-cc
        // The code uses: `${repo}-${label.toLowerCase()}${featureId}-${task.sessionSuffix}`
        // where label = 'R' (isResearch), sessionSuffix = `eval-${agentId}` for research
        // So: brewboard-r1-eval-cc
        // Research eval session: brewboard-r{01|1}-eval-cc (id may be zero-padded)
        const expectedSessionPattern = /^brewboard-r0*1-eval-cc$/;
        const sessionName = resp.body.sessionName;
        assert.match(sessionName, expectedSessionPattern,
            `Research eval session name should match pattern, got "${sessionName}"`);

        await sleep(1000);
        assert.ok(tmuxSessionExists(sessionName),
            `tmux session "${sessionName}" should exist`);
    });

    // ── Test 6: Feature close kills tmux sessions ─────────────────────────────

    it('feature-close kills feature tmux sessions', { timeout: 60000 }, async () => {
        // Ensure there are feature tmux sessions
        const beforeSessions = listTmuxSessions('brewboard-f1-');
        assert.ok(beforeSessions.length > 0,
            `Expected existing f1 tmux sessions before close, got: ${beforeSessions.join(', ')}`);

        // Run feature-close via CLI (not the dashboard, to test CLI integration)
        // Pick cc as the winner
        const closeResult = runAigon(['feature-close', '01', 'cc'], { timeout: 60000 });

        // feature-close may or may not succeed fully (depends on git state),
        // but it should at least clean up tmux sessions
        await sleep(2000);

        // Verify all f1 sessions are gone
        const afterSessions = listTmuxSessions('brewboard-f1-');
        assert.equal(afterSessions.length, 0,
            `Expected all f1 tmux sessions killed after close, but found: ${afterSessions.join(', ')}`);
    });

    // ── Test 7: Research close kills tmux sessions ────────────────────────────

    it('research-close kills research tmux sessions', { timeout: 60000 }, async () => {
        // Ensure there are research tmux sessions
        const beforeSessions = listTmuxSessions('brewboard-r1-');
        assert.ok(beforeSessions.length > 0,
            `Expected existing r1 tmux sessions before close, got: ${beforeSessions.join(', ')}`);

        // Run research-close via CLI
        const closeResult = runAigon(['research-close', '01'], { timeout: 60000 });

        await sleep(2000);

        // Verify all r1 sessions are gone
        const afterSessions = listTmuxSessions('brewboard-r1-');
        assert.equal(afterSessions.length, 0,
            `Expected all r1 tmux sessions killed after close, but found: ${afterSessions.join(', ')}`);
    });

    // ── Test 8: Seed reset during running dashboard ───────────────────────────

    it('seed-reset does not crash the running dashboard', { timeout: 120000 }, async () => {
        // Dashboard is still running from the before() hook
        // Run seed-reset again while the dashboard is serving
        const resetResult = runAigon(['seed-reset', BREWBOARD_PATH, '--force'], {
            cwd: path.join(process.env.HOME, 'src', 'aigon'),
            timeout: 120000,
        });

        // seed-reset should succeed
        assert.equal(resetResult.exitCode, 0,
            `seed-reset should succeed, stderr: ${resetResult.stderr.slice(0, 500)}`);

        // Wait a moment for the dashboard to detect the changes
        await sleep(3000);

        // Dashboard should still respond
        const resp = await dashboardGet('/api/status');
        assert.equal(resp.status, 200, 'Dashboard should still respond after seed-reset');
        assert.ok(resp.body.repos !== undefined, 'Response should still have repos');
    });

    // ── Test 9: Submitted agent view button works (attach mode) ───────────────

    it('POST /api/feature-open attaches to existing session without creating new one', { timeout: 90000 }, async () => {
        // Start a fresh feature after the seed-reset in test 8
        const startResp = await dashboardPost('/api/action', {
            action: 'feature-start',
            args: ['01', 'cc'],
            repoPath: BREWBOARD_PATH,
        });
        assert.equal(startResp.status, 200, `feature-start should succeed: ${JSON.stringify(startResp.body)}`);
        assert.ok(startResp.body.ok, `feature-start should be ok: ${JSON.stringify(startResp.body)}`);

        await sleep(2000);

        // Verify a tmux session was created
        const sessions = listTmuxSessions('brewboard-f1-cc');
        assert.ok(sessions.length > 0, `Expected cc session after feature-start, got: ${sessions.join(', ')}`);
        const originalSession = sessions[0];

        // Now POST to feature-open with no mode (normal attach)
        const openResp = await dashboardPost('/api/feature-open', {
            featureId: '01',
            agentId: 'cc',
            pipelineType: 'features',
            repoPath: BREWBOARD_PATH,
        });

        assert.equal(openResp.status, 200, `feature-open should succeed: ${JSON.stringify(openResp.body)}`);
        assert.ok(openResp.body.ok, `feature-open should be ok: ${JSON.stringify(openResp.body)}`);
        assert.ok(openResp.body.sessionName, 'Response should include sessionName');

        // Should reuse the existing session, not create a new one
        assert.ok(openResp.body.sessionName.startsWith('brewboard-f1-cc'),
            `Should attach to existing session, got: ${openResp.body.sessionName}`);

        // There should still be only one cc session (not a second one)
        const afterSessions = listTmuxSessions('brewboard-f1-cc');
        assert.equal(afterSessions.length, 1,
            `Should still have exactly 1 cc session, got: ${afterSessions.join(', ')}`);
    });
});
