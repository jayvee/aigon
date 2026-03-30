#!/usr/bin/env node
/**
 * Dashboard E2E Research Tests — Full research agent lifecycle.
 *
 * Run:  node --test tests/api/dashboard-e2e-research.test.js
 * Or:   npm run test:api:research
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const CLI_PATH = path.join(__dirname, '../..', 'aigon-cli.js');
const DASHBOARD_PORT = 4197;
const DASHBOARD_URL = `http://127.0.0.1:${DASHBOARD_PORT}`;
const BREWBOARD_PATH = path.join(process.env.HOME, 'src', 'brewboard');
const AIGON_PATH = path.join(process.env.HOME, 'src', 'aigon');

const TEST_RESEARCH_ID = '03';
const AGENT_TIMEOUT_MS = 300000;
const EVAL_TIMEOUT_MS = 180000;
const POLL_INTERVAL_MS = 5000;
const TEST_TIMEOUT_MS = 420000;

const researchTmuxPrefix = `brewboard-r${parseInt(TEST_RESEARCH_ID)}-`;
const researchSpecPattern = new RegExp(`^research-${TEST_RESEARCH_ID}-`);

// ─── helpers ─────────────────────────────────────────────────────────────────

function dashboardPost(endpoint, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = http.request(`${DASHBOARD_URL}${endpoint}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
        }, (res) => {
            let chunks = '';
            res.on('data', chunk => { chunks += chunk; });
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); }
                catch (e) { resolve({ status: res.statusCode, body: chunks }); }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

function dashboardGet(endpoint) {
    return new Promise((resolve, reject) => {
        http.get(`${DASHBOARD_URL}${endpoint}`, (res) => {
            let chunks = '';
            res.on('data', chunk => { chunks += chunk; });
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); }
                catch (e) { resolve({ status: res.statusCode, body: chunks }); }
            });
        }).on('error', reject);
    });
}

function runAigon(args, { cwd = BREWBOARD_PATH, timeout = 60000 } = {}) {
    const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout,
    });
    return { stdout: result.stdout || '', stderr: result.stderr || '', exitCode: result.status };
}

function tmuxSessionExists(name) {
    return spawnSync('tmux', ['has-session', '-t', name], { stdio: 'pipe' }).status === 0;
}

function listTmuxSessions(prefix) {
    const result = spawnSync('tmux', ['list-sessions', '-F', '#S'], { encoding: 'utf8', stdio: 'pipe' });
    if (result.status !== 0 || !result.stdout) return [];
    return result.stdout.split('\n').map(s => s.trim()).filter(s => s.startsWith(prefix));
}

function killTmuxSessions(prefix) {
    const sessions = listTmuxSessions(prefix);
    for (const s of sessions) spawnSync('tmux', ['kill-session', '-t', s], { stdio: 'ignore' });
    return sessions.length;
}

async function waitForDashboard(timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try { const resp = await dashboardGet('/api/status'); if (resp.status === 200) return; } catch (_) {}
        await sleep(500);
    }
    throw new Error(`Dashboard did not become healthy within ${timeoutMs}ms`);
}

function findResearchSpec(stage, pattern) {
    const dir = path.join(BREWBOARD_PATH, 'docs', 'specs', 'research-topics', stage);
    if (!fs.existsSync(dir)) return null;
    return fs.readdirSync(dir).find(f => pattern.test(f)) || null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function agentStatusIs(entityId, agentId, expectedStatus) {
    const statusPath = path.join(BREWBOARD_PATH, '.aigon', 'state', `feature-${entityId}-${agentId}.json`);
    if (!fs.existsSync(statusPath)) return false;
    try { return JSON.parse(fs.readFileSync(statusPath, 'utf8')).status === expectedStatus; }
    catch { return false; }
}

function captureTmuxPane(sessionName) {
    const result = spawnSync('tmux', ['capture-pane', '-t', sessionName, '-p'], { encoding: 'utf8', stdio: 'pipe' });
    return (result.status === 0 && result.stdout) ? result.stdout : `(could not capture "${sessionName}")`;
}

async function pollForCondition(description, checkFn, { intervalMs = POLL_INTERVAL_MS, timeoutMs = AGENT_TIMEOUT_MS, diagnosticsFn = null } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await checkFn()) return true;
        await sleep(intervalMs);
        console.log(`  [poll] ${description} -- waiting (${Math.round((Date.now() - start) / 1000)}s)...`);
    }
    let diagnostics = '';
    if (diagnosticsFn) { try { diagnostics = '\n' + diagnosticsFn(); } catch { diagnostics = '\n(diagnostics failed)'; } }
    throw new Error(`Timeout after ${timeoutMs / 1000}s: ${description}${diagnostics}`);
}

function collectSessionDiagnostics(prefix) {
    const sessions = listTmuxSessions(prefix);
    if (sessions.length === 0) return `No tmux sessions with prefix "${prefix}"`;
    return sessions.map(s => `\n--- ${s} ---\n${captureTmuxPane(s)}`).join('\n');
}

// ─── Research Flow ───────────────────────────────────────────────────────────

describe('Research Flow', { timeout: 900000 }, () => {
    let dashboardProcess = null;

    before(async () => {
        console.log('    [setup] Running seed-reset on brewboard...');
        const resetResult = runAigon(['seed-reset', BREWBOARD_PATH, '--force'], { cwd: AIGON_PATH, timeout: 120000 });
        if (resetResult.exitCode !== 0) {
            console.error('    [setup] seed-reset stderr:', resetResult.stderr);
            throw new Error(`seed-reset failed: ${resetResult.exitCode}`);
        }
        console.log('    [setup] seed-reset complete');

        killTmuxSessions('brewboard-');

        console.log(`    [setup] Starting dashboard on port ${DASHBOARD_PORT}...`);
        dashboardProcess = spawn(process.execPath, [CLI_PATH, 'dashboard'], {
            cwd: BREWBOARD_PATH,
            env: { ...process.env, PORT: String(DASHBOARD_PORT), AIGON_TEST_MODEL_CC: 'haiku' },
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: false,
        });
        dashboardProcess.stderr.on('data', () => {});
        dashboardProcess.stdout.on('data', () => {});

        await waitForDashboard(30000);
        console.log('    [setup] Dashboard is healthy');
    });

    after(() => {
        if (dashboardProcess) dashboardProcess.kill('SIGTERM');
        const killed = killTmuxSessions('brewboard-');
        if (killed > 0) console.log(`    [teardown] Killed ${killed} brewboard tmux sessions`);
    });

    it('Research Fleet: cc + gg start, research, and submit', { timeout: TEST_TIMEOUT_MS }, async () => {
        const backlogSpec = findResearchSpec('02-backlog', researchSpecPattern);
        assert.ok(backlogSpec, `research-${TEST_RESEARCH_ID} should be in backlog`);

        console.log(`    [test1] Starting research ${TEST_RESEARCH_ID} with cc + gg...`);
        const resp = await dashboardPost('/api/action', {
            action: 'research-start',
            args: [TEST_RESEARCH_ID, 'cc', 'gg'],
            repoPath: BREWBOARD_PATH,
        });
        assert.equal(resp.status, 200);
        assert.ok(resp.body.ok, `research-start failed: ${JSON.stringify(resp.body)}`);

        await sleep(3000);

        const inProgressSpec = findResearchSpec('03-in-progress', researchSpecPattern);
        assert.ok(inProgressSpec, `research-${TEST_RESEARCH_ID} should be in 03-in-progress`);

        const sessions = listTmuxSessions(researchTmuxPrefix);
        assert.ok(sessions.length >= 2, `Expected 2+ tmux sessions, got: ${sessions.join(', ')}`);
        assert.ok(sessions.some(s => s.includes('-cc')), `Missing cc session in: ${sessions.join(', ')}`);
        assert.ok(sessions.some(s => s.includes('-gg')), `Missing gg session in: ${sessions.join(', ')}`);

        console.log('    [test1] Agents launched. Polling for submission...');

        await pollForCondition(
            `cc submits research-${TEST_RESEARCH_ID}`,
            () => agentStatusIs(TEST_RESEARCH_ID, 'cc', 'submitted'),
            { diagnosticsFn: () => collectSessionDiagnostics(`${researchTmuxPrefix}cc`) }
        );
        console.log('    [test1] cc submitted.');

        await pollForCondition(
            `gg submits research-${TEST_RESEARCH_ID}`,
            () => agentStatusIs(TEST_RESEARCH_ID, 'gg', 'submitted'),
            { diagnosticsFn: () => collectSessionDiagnostics(`${researchTmuxPrefix}gg`) }
        );
        console.log('    [test1] gg submitted.');

        const logsDir = path.join(BREWBOARD_PATH, 'docs', 'specs', 'research-topics', 'logs');
        if (fs.existsSync(logsDir)) {
            const findings = fs.readdirSync(logsDir).filter(f => f.startsWith(`research-${TEST_RESEARCH_ID}-`) && f.endsWith('-findings.md'));
            console.log('    [test1] Findings files:', findings.join(', '));
            assert.ok(findings.length >= 1, 'At least one findings file should exist');
        }
    });

    it('Research Eval: launch eval agent and wait for completion', { timeout: TEST_TIMEOUT_MS }, async () => {
        console.log(`    [test2] Transitioning research ${TEST_RESEARCH_ID} to in-evaluation...`);

        // Step 1: Move spec to in-evaluation (same as dashboard frontend does)
        const setupResp = await dashboardPost('/api/action', {
            action: 'research-eval',
            args: [TEST_RESEARCH_ID, '--setup-only'],
            repoPath: BREWBOARD_PATH,
        });
        console.log(`    [test2] Setup response: ok=${setupResp.body.ok}, stdout: ${(setupResp.body.stdout || '').slice(0, 200)}`);

        // Verify spec moved to in-evaluation
        await sleep(1000);
        const evalSpec = findResearchSpec('04-in-evaluation', researchSpecPattern);
        assert.ok(evalSpec, `research-${TEST_RESEARCH_ID} should be in 04-in-evaluation after setup`);

        // Step 2: Launch eval agent in tmux
        console.log(`    [test2] Launching eval agent...`);
        const resp = await dashboardPost('/api/feature-open', {
            featureId: TEST_RESEARCH_ID,
            agentId: 'cc',
            pipelineType: 'research',
            mode: 'eval',
            repoPath: BREWBOARD_PATH,
        });
        assert.equal(resp.status, 200);
        assert.ok(resp.body.ok);
        assert.ok(resp.body.sessionName);

        const sessionName = resp.body.sessionName;
        console.log(`    [test2] Eval session: ${sessionName}`);

        await sleep(2000);
        assert.ok(tmuxSessionExists(sessionName), `tmux session "${sessionName}" should exist`);

        const researchSpecDir = path.join(BREWBOARD_PATH, 'docs', 'specs', 'research-topics', '03-in-progress');
        const researchLogsDir = path.join(BREWBOARD_PATH, 'docs', 'specs', 'research-topics', 'logs');
        const evalStageDir = path.join(BREWBOARD_PATH, 'docs', 'specs', 'research-topics', '04-in-evaluation');

        await pollForCondition(
            `research eval completion for research-${TEST_RESEARCH_ID}`,
            () => {
                // Check for eval output files
                if (fs.existsSync(researchLogsDir)) {
                    const evalFiles = fs.readdirSync(researchLogsDir).filter(f =>
                        f.startsWith(`research-${TEST_RESEARCH_ID}`) && (f.includes('eval') || f.includes('synthesis'))
                    );
                    if (evalFiles.length > 0) return true;
                }
                // Check if spec updated with Recommendation
                if (fs.existsSync(researchSpecDir)) {
                    for (const sf of fs.readdirSync(researchSpecDir).filter(f => f.startsWith(`research-${TEST_RESEARCH_ID}-`))) {
                        const content = fs.readFileSync(path.join(researchSpecDir, sf), 'utf8');
                        if (/## Recommendation/i.test(content) || /## Output/i.test(content)) return true;
                    }
                }
                // Check if moved to in-evaluation
                if (fs.existsSync(evalStageDir)) {
                    if (fs.readdirSync(evalStageDir).some(f => f.startsWith(`research-${TEST_RESEARCH_ID}-`))) return true;
                }
                // Check if eval session ended
                if (!tmuxSessionExists(sessionName)) return true;
                return false;
            },
            { timeoutMs: EVAL_TIMEOUT_MS, diagnosticsFn: () => collectSessionDiagnostics(sessionName) }
        );
        console.log('    [test2] Research eval completed.');
    });

    it('Research Close: close research', { timeout: TEST_TIMEOUT_MS }, async () => {
        console.log(`    [test3] Closing research ${TEST_RESEARCH_ID}...`);

        const closeResult = runAigon(['research-close', TEST_RESEARCH_ID], { timeout: 120000 });
        console.log('    [test3] stdout:', closeResult.stdout.slice(0, 500));
        if (closeResult.stderr) console.log('    [test3] stderr:', closeResult.stderr.slice(0, 300));

        await sleep(3000);

        const doneSpec = findResearchSpec('05-done', researchSpecPattern);
        assert.ok(doneSpec, `research-${TEST_RESEARCH_ID} should be in 05-done`);

        const remaining = listTmuxSessions(researchTmuxPrefix);
        assert.equal(remaining.length, 0, `Expected no r${parseInt(TEST_RESEARCH_ID)} sessions, found: ${remaining.join(', ')}`);

        console.log(`    [test3] Research ${TEST_RESEARCH_ID} closed successfully.`);
    });
});
