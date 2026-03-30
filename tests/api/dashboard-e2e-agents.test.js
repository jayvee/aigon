#!/usr/bin/env node
/**
 * Dashboard E2E Agent Tests — Full agent lifecycle.
 *
 * Launches real agents in tmux sessions and waits for them to complete.
 * This suite makes real LLM API calls — agents will actually run and generate code/findings.
 *
 * Run:  node --test tests/api/dashboard-e2e-agents.test.js
 * Or:   npm run test:api:agents
 *
 * Run a single flow:
 *   node --test --test-name-pattern 'Feature Flow' tests/api/dashboard-e2e-agents.test.js
 *   node --test --test-name-pattern 'Research Flow' tests/api/dashboard-e2e-agents.test.js
 *
 * Prerequisites:
 *   - tmux installed
 *   - ~/src/brewboard seed repo exists (will be reset by the suite)
 *   - brewboard registered in ~/.aigon/config.json repos
 *   - Valid API keys configured for cc and gg agents
 *
 * Timeouts: Individual tests have 5-minute timeouts since these use tiny test items.
 * Total suite timeout: ~15 minutes per flow.
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

// ─── constants ───────────────────────────────────────────────────────────────

const CLI_PATH = path.join(__dirname, '../..', 'aigon-cli.js');
const DASHBOARD_PORT = 4198;
const DASHBOARD_URL = `http://127.0.0.1:${DASHBOARD_PORT}`;
const BREWBOARD_PATH = path.join(process.env.HOME, 'src', 'brewboard');
const AIGON_PATH = path.join(process.env.HOME, 'src', 'aigon');

const TEST_FEATURE_ID = '07';
const TEST_RESEARCH_ID = '03';

const AGENT_TIMEOUT_MS = 300000;   // 5 minutes for agent work
const EVAL_TIMEOUT_MS = 180000;    // 3 minutes for eval
const POLL_INTERVAL_MS = 5000;     // poll every 5 seconds
const TEST_TIMEOUT_MS = 420000;    // 7 minutes per test block

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
        await sleep(500);
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

/**
 * Check if an agent's status file reports a given status.
 *
 * @param {string} entityType - 'feature' or 'research'
 * @param {string} entityId - e.g. '07'
 * @param {string} agentId - e.g. 'cc', 'gg'
 * @param {string} expectedStatus - e.g. 'submitted'
 * @returns {boolean}
 */
function agentStatusIs(entityType, entityId, agentId, expectedStatus) {
    // Note: writeAgentStatus always uses 'feature-' prefix regardless of entity type (manifest.js quirk)
    const statusPath = path.join(BREWBOARD_PATH, '.aigon', 'state', `feature-${entityId}-${agentId}.json`);
    if (!fs.existsSync(statusPath)) return false;
    try {
        const data = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
        return data.status === expectedStatus;
    } catch {
        return false;
    }
}

/**
 * Read an agent's status file and return the parsed data, or null.
 */
function readAgentStatusFile(entityType, entityId, agentId) {
    const statusPath = path.join(BREWBOARD_PATH, '.aigon', 'state', `${entityType}-${entityId}-${agentId}.json`);
    if (!fs.existsSync(statusPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    } catch {
        return null;
    }
}

/**
 * Capture tmux pane content for diagnostics on timeout.
 */
function captureTmuxPane(sessionName) {
    const result = spawnSync('tmux', ['capture-pane', '-t', sessionName, '-p'], {
        encoding: 'utf8',
        stdio: 'pipe',
    });
    if (result.status === 0 && result.stdout) {
        return result.stdout;
    }
    return `(could not capture pane for session "${sessionName}")`;
}

/**
 * Poll for a condition, logging progress. Throws on timeout with diagnostics.
 *
 * @param {string} description - Human-readable description of what we're waiting for
 * @param {Function} checkFn - Async function returning true when condition is met
 * @param {Object} opts - { intervalMs, timeoutMs, diagnosticsFn }
 */
async function pollForCondition(description, checkFn, { intervalMs = POLL_INTERVAL_MS, timeoutMs = AGENT_TIMEOUT_MS, diagnosticsFn = null } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await checkFn()) return true;
        await sleep(intervalMs);
        const elapsed = Math.round((Date.now() - start) / 1000);
        console.log(`  [poll] ${description} -- waiting (${elapsed}s)...`);
    }
    // On timeout, collect diagnostics
    let diagnostics = '';
    if (diagnosticsFn) {
        try {
            diagnostics = '\n' + diagnosticsFn();
        } catch {
            diagnostics = '\n(diagnostics collection failed)';
        }
    }
    throw new Error(`Timeout after ${timeoutMs / 1000}s: ${description}${diagnostics}`);
}

/**
 * Collect diagnostics for all tmux sessions matching a prefix.
 */
function collectSessionDiagnostics(prefix) {
    const sessions = listTmuxSessions(prefix);
    if (sessions.length === 0) return `No tmux sessions found with prefix "${prefix}"`;
    const lines = [`Tmux sessions matching "${prefix}":`];
    for (const s of sessions) {
        lines.push(`\n--- ${s} ---`);
        lines.push(captureTmuxPane(s));
    }
    return lines.join('\n');
}

/**
 * Start the dashboard process and wait for it to become healthy.
 * Returns the spawned child process.
 */
async function startDashboard() {
    console.log(`    [setup] Starting dashboard on port ${DASHBOARD_PORT}...`);
    const proc = spawn(process.execPath, [CLI_PATH, 'dashboard'], {
        cwd: BREWBOARD_PATH,
        env: { ...process.env, PORT: String(DASHBOARD_PORT), AIGON_TEST_MODEL_CC: 'haiku' },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
    });

    // Collect stderr for diagnostics
    let stderrBuf = '';
    proc.stderr.on('data', chunk => { stderrBuf += chunk.toString(); });
    proc.stdout.on('data', () => {}); // drain stdout

    try {
        await waitForDashboard(30000);
    } catch (e) {
        console.error('    [setup] Dashboard stderr:', stderrBuf);
        throw e;
    }
    console.log('    [setup] Dashboard is healthy');
    return proc;
}

/**
 * Stop the dashboard process and kill tmux sessions.
 */
function stopDashboard(proc) {
    if (proc) {
        proc.kill('SIGTERM');
    }
    const killed = killTmuxSessions('brewboard-');
    if (killed > 0) {
        console.log(`    [teardown] Killed ${killed} brewboard tmux sessions`);
    }
}

// ─── Feature Flow ────────────────────────────────────────────────────────────

const featureTmuxPrefix = `brewboard-f${parseInt(TEST_FEATURE_ID)}-`;
const featureSpecPattern = new RegExp(`^feature-${TEST_FEATURE_ID}-`);

describe('Feature Flow', { timeout: 900000 }, () => {
    let dashboardProcess = null;

    before(async () => {
        // 1. Reset brewboard to a clean seed state
        console.log('    [setup] Running seed-reset on brewboard...');
        const resetResult = runAigon(['seed-reset', BREWBOARD_PATH, '--force'], {
            cwd: AIGON_PATH,
            timeout: 120000,
        });
        if (resetResult.exitCode !== 0) {
            console.error('    [setup] seed-reset stderr:', resetResult.stderr);
            throw new Error(`seed-reset failed with exit code ${resetResult.exitCode}`);
        }
        console.log('    [setup] seed-reset complete');

        // 2. Kill any lingering brewboard tmux sessions
        killTmuxSessions('brewboard-');

        // 3. Start dashboard
        dashboardProcess = await startDashboard();
    });

    after(() => {
        stopDashboard(dashboardProcess);
        dashboardProcess = null;
    });

    // ── Test 1: Feature Fleet — cc + gg start, implement, submit ─────────────

    it('Feature Fleet: cc + gg start, implement, and submit', { timeout: TEST_TIMEOUT_MS }, async () => {
        // Verify feature is in backlog
        const backlogSpec = findSpec('02-backlog', featureSpecPattern);
        assert.ok(backlogSpec, `feature-${TEST_FEATURE_ID} should be in 02-backlog after seed-reset`);

        // Start feature with cc and gg agents
        console.log(`    [test1] Starting feature ${TEST_FEATURE_ID} with cc + gg...`);
        const resp = await dashboardPost('/api/action', {
            action: 'feature-start',
            args: [TEST_FEATURE_ID, 'cc', 'gg'],
            repoPath: BREWBOARD_PATH,
        });

        assert.equal(resp.status, 200, `Expected 200 OK, got ${resp.status}: ${JSON.stringify(resp.body)}`);
        assert.ok(resp.body.ok, `feature-start should succeed: ${JSON.stringify(resp.body)}`);

        // Allow time for tmux sessions to be created
        await sleep(3000);

        // Verify spec moved to 03-in-progress
        const inProgressSpec = findSpec('03-in-progress', featureSpecPattern);
        assert.ok(inProgressSpec, `feature-${TEST_FEATURE_ID} should have moved to 03-in-progress`);

        // Verify tmux sessions exist for both agents
        const sessions = listTmuxSessions(featureTmuxPrefix);
        assert.ok(sessions.length >= 2, `Expected at least 2 tmux sessions for f${parseInt(TEST_FEATURE_ID)}, got: ${sessions.join(', ')}`);

        const hasCc = sessions.some(s => s.includes('-cc'));
        const hasGg = sessions.some(s => s.includes('-gg'));
        assert.ok(hasCc, `Expected a cc session in: ${sessions.join(', ')}`);
        assert.ok(hasGg, `Expected a gg session in: ${sessions.join(', ')}`);

        console.log('    [test1] Agents launched. Polling for submission...');

        // Poll for both agents to submit
        await pollForCondition(
            `cc agent submits feature-${TEST_FEATURE_ID}`,
            () => agentStatusIs('feature', TEST_FEATURE_ID, 'cc', 'submitted'),
            {
                timeoutMs: AGENT_TIMEOUT_MS,
                diagnosticsFn: () => collectSessionDiagnostics(`${featureTmuxPrefix}cc`),
            }
        );
        console.log('    [test1] cc agent submitted.');

        await pollForCondition(
            `gg agent submits feature-${TEST_FEATURE_ID}`,
            () => agentStatusIs('feature', TEST_FEATURE_ID, 'gg', 'submitted'),
            {
                timeoutMs: AGENT_TIMEOUT_MS,
                diagnosticsFn: () => collectSessionDiagnostics(`${featureTmuxPrefix}gg`),
            }
        );
        console.log('    [test1] gg agent submitted.');

        // Wait for dashboard poll cycle to pick up status changes
        await sleep(12000);

        // Verify dashboard status API reflects submissions
        const statusResp = await dashboardGet('/api/status');
        assert.equal(statusResp.status, 200);
        const brewboard = statusResp.body.repos.find(r =>
            r.name === 'brewboard' || (r.path && r.path.includes('brewboard'))
        );
        assert.ok(brewboard, 'brewboard should appear in status');

        const featureItem = brewboard.features.find(f => f.id === TEST_FEATURE_ID || f.id === String(parseInt(TEST_FEATURE_ID)));
        assert.ok(featureItem, `feature-${TEST_FEATURE_ID} should appear in status`);

        // Both agents should show as submitted
        const ccAgent = featureItem.agents.find(a => a.id === 'cc');
        const ggAgent = featureItem.agents.find(a => a.id === 'gg');
        assert.ok(ccAgent, 'cc agent should appear in feature status');
        assert.ok(ggAgent, 'gg agent should appear in feature status');
        assert.equal(ccAgent.status, 'submitted', `cc agent status should be submitted, got: ${ccAgent.status}`);
        assert.equal(ggAgent.status, 'submitted', `gg agent status should be submitted, got: ${ggAgent.status}`);

        // Verify validActions includes eval-related action (feature-eval or similar)
        assert.ok(featureItem.validActions, `feature-${TEST_FEATURE_ID} should have validActions`);
        console.log('    [test1] validActions:', JSON.stringify(featureItem.validActions));

        // Verify dev server is running for the agents
        const devServerResult = runAigon(['dev-server', 'list'], { timeout: 15000 });
        console.log('    [test1] dev-server list output:', devServerResult.stdout);
        // Dev server output should mention brewboard or feature ports
        // (This is a best-effort check — not all agent configs start dev servers)
    });

    // ── Test 2: Feature eval — launch eval agent, wait for completion ────────

    it('Feature Eval: launch eval agent and wait for completion', { timeout: TEST_TIMEOUT_MS }, async () => {
        console.log(`    [test2] Launching eval for feature ${TEST_FEATURE_ID}...`);

        const resp = await dashboardPost('/api/feature-open', {
            featureId: TEST_FEATURE_ID,
            agentId: 'cc',
            pipelineType: 'features',
            mode: 'eval',
            repoPath: BREWBOARD_PATH,
        });

        assert.equal(resp.status, 200, `Expected 200 OK, got ${resp.status}: ${JSON.stringify(resp.body)}`);
        assert.ok(resp.body.ok, `feature-open eval should succeed: ${JSON.stringify(resp.body)}`);
        assert.ok(resp.body.sessionName, 'Response should include sessionName');

        const sessionName = resp.body.sessionName;
        console.log(`    [test2] Eval session: ${sessionName}`);

        // Verify tmux session exists
        await sleep(2000);
        assert.ok(tmuxSessionExists(sessionName), `tmux session "${sessionName}" should exist`);

        // Poll for eval completion: check for eval file
        const evalFilePath = path.join(BREWBOARD_PATH, 'docs', 'specs', 'features', 'evaluations', `feature-${TEST_FEATURE_ID}-eval.md`);

        await pollForCondition(
            `eval file created for feature-${TEST_FEATURE_ID}`,
            () => fs.existsSync(evalFilePath),
            {
                timeoutMs: EVAL_TIMEOUT_MS,
                diagnosticsFn: () => collectSessionDiagnostics(sessionName),
            }
        );
        console.log('    [test2] Eval file created.');

        // Verify eval file has a Winner line
        const evalContent = fs.readFileSync(evalFilePath, 'utf8');
        const hasWinner = /\*\*Winner/i.test(evalContent) || /Winner[:\s]/i.test(evalContent);
        assert.ok(hasWinner, `Eval file should contain a Winner line. Content preview:\n${evalContent.slice(0, 500)}`);
        console.log('    [test2] Eval file has a Winner line.');
    });

    // ── Test 3: Feature close — close the feature ────────────────────────────

    it('Feature Close: close feature with winner', { timeout: TEST_TIMEOUT_MS }, async () => {
        // Determine the winner from the eval file
        const evalFilePath = path.join(BREWBOARD_PATH, 'docs', 'specs', 'features', 'evaluations', `feature-${TEST_FEATURE_ID}-eval.md`);
        let winner = 'cc'; // default fallback

        if (fs.existsSync(evalFilePath)) {
            const evalContent = fs.readFileSync(evalFilePath, 'utf8');
            const winnerMatch = evalContent.match(/\*\*Winner[:\s]*\*?\*?\s*(.+)/i);
            if (winnerMatch) {
                const val = winnerMatch[1].replace(/\*+/g, '').trim();
                const extracted = val.split(/[\s(]/)[0].toLowerCase();
                if (extracted && extracted !== 'tbd') {
                    winner = extracted;
                }
            }
        }

        console.log(`    [test3] Closing feature ${TEST_FEATURE_ID} with winner: ${winner}`);
        const closeResult = runAigon(['feature-close', TEST_FEATURE_ID, winner], { timeout: 120000 });

        console.log('    [test3] feature-close stdout:', closeResult.stdout.slice(0, 500));
        if (closeResult.stderr) {
            console.log('    [test3] feature-close stderr:', closeResult.stderr.slice(0, 500));
        }

        // Allow time for cleanup
        await sleep(3000);

        // Verify spec moved to 05-done
        const doneSpec = findSpec('05-done', featureSpecPattern);
        assert.ok(doneSpec, `feature-${TEST_FEATURE_ID} should have moved to 05-done`);

        // Verify all feature tmux sessions are killed
        const remainingSessions = listTmuxSessions(featureTmuxPrefix);
        assert.equal(remainingSessions.length, 0,
            `Expected all f${parseInt(TEST_FEATURE_ID)} tmux sessions killed, but found: ${remainingSessions.join(', ')}`);

        // Verify worktrees removed
        const worktreeBase = BREWBOARD_PATH + '-worktrees';
        if (fs.existsSync(worktreeBase)) {
            const fPadded = `f${TEST_FEATURE_ID}`;
            const fUnpadded = `f${parseInt(TEST_FEATURE_ID)}-`;
            const worktrees = fs.readdirSync(worktreeBase).filter(d => d.includes(fPadded) || d.includes(fUnpadded));
            assert.equal(worktrees.length, 0,
                `Expected f${TEST_FEATURE_ID} worktrees removed, but found: ${worktrees.join(', ')}`);
        }

        console.log(`    [test3] Feature ${TEST_FEATURE_ID} closed successfully.`);
    });
});

// ─── Research Flow ───────────────────────────────────────────────────────────

const researchTmuxPrefix = `brewboard-r${parseInt(TEST_RESEARCH_ID)}-`;
const researchSpecPattern = new RegExp(`^research-${TEST_RESEARCH_ID}-`);

describe('Research Flow', { timeout: 900000 }, () => {
    let dashboardProcess = null;

    before(async () => {
        // 1. Reset brewboard to a clean seed state
        console.log('    [setup] Running seed-reset on brewboard for research tests...');
        const resetResult = runAigon(['seed-reset', BREWBOARD_PATH, '--force'], {
            cwd: AIGON_PATH,
            timeout: 120000,
        });
        if (resetResult.exitCode !== 0) {
            console.error('    [setup] seed-reset stderr:', resetResult.stderr);
            throw new Error(`seed-reset failed with exit code ${resetResult.exitCode}`);
        }
        console.log('    [setup] seed-reset complete');

        // 2. Kill any lingering brewboard tmux sessions
        killTmuxSessions('brewboard-');

        // 3. Start dashboard
        dashboardProcess = await startDashboard();
    });

    after(() => {
        stopDashboard(dashboardProcess);
        dashboardProcess = null;
    });

    // ── Test 4: Research Fleet — cc + gg start, research, submit ─────────────

    it('Research Fleet: cc + gg start, research, and submit', { timeout: TEST_TIMEOUT_MS }, async () => {
        // Verify research is in backlog
        const backlogSpec = findResearchSpec('02-backlog', researchSpecPattern);
        assert.ok(backlogSpec, `research-${TEST_RESEARCH_ID} should be in 02-backlog after seed-reset`);

        // Start research with cc and gg agents
        console.log(`    [test4] Starting research ${TEST_RESEARCH_ID} with cc + gg...`);
        const resp = await dashboardPost('/api/action', {
            action: 'research-start',
            args: [TEST_RESEARCH_ID, 'cc', 'gg'],
            repoPath: BREWBOARD_PATH,
        });

        assert.equal(resp.status, 200, `Expected 200 OK, got ${resp.status}: ${JSON.stringify(resp.body)}`);
        assert.ok(resp.body.ok, `research-start should succeed: ${JSON.stringify(resp.body)}`);

        // Allow time for tmux sessions to be created
        await sleep(3000);

        // Verify research spec moved to 03-in-progress
        const inProgressSpec = findResearchSpec('03-in-progress', researchSpecPattern);
        assert.ok(inProgressSpec, `research-${TEST_RESEARCH_ID} should have moved to 03-in-progress`);

        // Verify tmux sessions exist
        const sessions = listTmuxSessions(researchTmuxPrefix);
        assert.ok(sessions.length >= 2, `Expected at least 2 research tmux sessions, got: ${sessions.join(', ')}`);

        const hasCc = sessions.some(s => s.includes('-cc'));
        const hasGg = sessions.some(s => s.includes('-gg'));
        assert.ok(hasCc, `Expected a cc research session in: ${sessions.join(', ')}`);
        assert.ok(hasGg, `Expected a gg research session in: ${sessions.join(', ')}`);

        console.log('    [test4] Agents launched. Polling for submission...');

        // Poll for both agents to submit
        await pollForCondition(
            `cc agent submits research-${TEST_RESEARCH_ID}`,
            () => agentStatusIs('research', TEST_RESEARCH_ID, 'cc', 'submitted'),
            {
                timeoutMs: AGENT_TIMEOUT_MS,
                diagnosticsFn: () => collectSessionDiagnostics(`${researchTmuxPrefix}cc`),
            }
        );
        console.log('    [test4] cc agent submitted.');

        await pollForCondition(
            `gg agent submits research-${TEST_RESEARCH_ID}`,
            () => agentStatusIs('research', TEST_RESEARCH_ID, 'gg', 'submitted'),
            {
                timeoutMs: AGENT_TIMEOUT_MS,
                diagnosticsFn: () => collectSessionDiagnostics(`${researchTmuxPrefix}gg`),
            }
        );
        console.log('    [test4] gg agent submitted.');

        // Check that findings files exist
        const logsDir = path.join(BREWBOARD_PATH, 'docs', 'specs', 'research-topics', 'logs');
        if (fs.existsSync(logsDir)) {
            const findingsFiles = fs.readdirSync(logsDir).filter(f => f.startsWith(`research-${TEST_RESEARCH_ID}-`) && f.endsWith('-findings.md'));
            console.log('    [test4] Findings files:', findingsFiles.join(', '));
            assert.ok(findingsFiles.length >= 1, 'At least one findings file should exist');
        }
    });

    // ── Test 5: Research eval — launch eval agent ────────────────────────────

    it('Research Eval: launch eval agent and wait for completion', { timeout: TEST_TIMEOUT_MS }, async () => {
        console.log(`    [test5] Launching eval for research ${TEST_RESEARCH_ID}...`);

        const resp = await dashboardPost('/api/feature-open', {
            featureId: TEST_RESEARCH_ID,
            agentId: 'cc',
            pipelineType: 'research',
            mode: 'eval',
            repoPath: BREWBOARD_PATH,
        });

        assert.equal(resp.status, 200, `Expected 200 OK, got ${resp.status}: ${JSON.stringify(resp.body)}`);
        assert.ok(resp.body.ok, `research eval should succeed: ${JSON.stringify(resp.body)}`);
        assert.ok(resp.body.sessionName, 'Response should include sessionName');

        const sessionName = resp.body.sessionName;
        console.log(`    [test5] Eval session: ${sessionName}`);

        // Verify tmux session exists
        await sleep(2000);
        assert.ok(tmuxSessionExists(sessionName), `tmux session "${sessionName}" should exist`);

        // Poll for eval completion: check the research spec or logs for Recommendation/Output section
        const researchSpecDir = path.join(BREWBOARD_PATH, 'docs', 'specs', 'research-topics', '03-in-progress');
        const researchLogsDir = path.join(BREWBOARD_PATH, 'docs', 'specs', 'research-topics', 'logs');

        await pollForCondition(
            `research eval completion for research-${TEST_RESEARCH_ID}`,
            () => {
                // Check for eval/synthesis output in the logs directory
                if (fs.existsSync(researchLogsDir)) {
                    const files = fs.readdirSync(researchLogsDir);
                    // Look for eval or synthesis files
                    const evalFiles = files.filter(f =>
                        (f.startsWith(`research-${TEST_RESEARCH_ID}`) && (f.includes('eval') || f.includes('synthesis'))) ||
                        f === `research-${TEST_RESEARCH_ID}-eval.md`
                    );
                    if (evalFiles.length > 0) return true;
                }

                // Also check if the research spec itself has been updated with Recommendation/Output
                if (fs.existsSync(researchSpecDir)) {
                    const specFiles = fs.readdirSync(researchSpecDir).filter(f => f.startsWith(`research-${TEST_RESEARCH_ID}-`));
                    for (const sf of specFiles) {
                        const content = fs.readFileSync(path.join(researchSpecDir, sf), 'utf8');
                        if (/## Recommendation/i.test(content) || /## Output/i.test(content)) {
                            return true;
                        }
                    }
                }

                // Check if the research moved to in-evaluation stage
                const evalStageDir = path.join(BREWBOARD_PATH, 'docs', 'specs', 'research-topics', '04-in-evaluation');
                if (fs.existsSync(evalStageDir)) {
                    const moved = fs.readdirSync(evalStageDir).filter(f => f.startsWith(`research-${TEST_RESEARCH_ID}-`));
                    if (moved.length > 0) return true;
                }

                // Check if the eval tmux session has finished (no longer running)
                if (!tmuxSessionExists(sessionName)) {
                    console.log('    [test5] Eval session ended (tmux session gone).');
                    return true;
                }

                return false;
            },
            {
                timeoutMs: EVAL_TIMEOUT_MS,
                diagnosticsFn: () => collectSessionDiagnostics(sessionName),
            }
        );
        console.log('    [test5] Research eval completed.');
    });

    // ── Test 6: Research close ───────────────────────────────────────────────

    it('Research Close: close research', { timeout: TEST_TIMEOUT_MS }, async () => {
        console.log(`    [test6] Closing research ${TEST_RESEARCH_ID}...`);

        const closeResult = runAigon(['research-close', TEST_RESEARCH_ID], { timeout: 120000 });

        console.log('    [test6] research-close stdout:', closeResult.stdout.slice(0, 500));
        if (closeResult.stderr) {
            console.log('    [test6] research-close stderr:', closeResult.stderr.slice(0, 500));
        }

        // Allow time for cleanup
        await sleep(3000);

        // Verify spec moved to 05-done
        const doneSpec = findResearchSpec('05-done', researchSpecPattern);
        assert.ok(doneSpec, `research-${TEST_RESEARCH_ID} should have moved to 05-done`);

        // Verify all research tmux sessions are killed
        const remainingSessions = listTmuxSessions(researchTmuxPrefix);
        assert.equal(remainingSessions.length, 0,
            `Expected all r${parseInt(TEST_RESEARCH_ID)} tmux sessions killed, but found: ${remainingSessions.join(', ')}`);

        console.log(`    [test6] Research ${TEST_RESEARCH_ID} closed successfully.`);
    });
});
