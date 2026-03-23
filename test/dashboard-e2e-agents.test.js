#!/usr/bin/env node
/**
 * Dashboard E2E Agent Tests — Full agent lifecycle.
 *
 * Launches real agents in tmux sessions and waits for them to complete.
 * This suite makes real LLM API calls — agents will actually run and generate code/findings.
 *
 * Run:  node --test test/dashboard-e2e-agents.test.js
 * Or:   npm run test:dashboard:agents
 *
 * Prerequisites:
 *   - tmux installed
 *   - ~/src/brewboard seed repo exists (will be reset by the suite)
 *   - brewboard registered in ~/.aigon/config.json repos
 *   - Valid API keys configured for cc and gg agents
 *
 * Timeouts: Individual tests have 12-minute timeouts since agents make real LLM calls.
 * Total suite timeout: ~60 minutes.
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

// ─── constants ───────────────────────────────────────────────────────────────

const CLI_PATH = path.join(__dirname, '..', 'aigon-cli.js');
const DASHBOARD_PORT = 4198;
const DASHBOARD_URL = `http://127.0.0.1:${DASHBOARD_PORT}`;
const BREWBOARD_PATH = path.join(process.env.HOME, 'src', 'brewboard');
const AIGON_PATH = path.join(process.env.HOME, 'src', 'aigon');

const AGENT_TIMEOUT_MS = 600000;   // 10 minutes for agent work
const EVAL_TIMEOUT_MS = 300000;    // 5 minutes for eval
const POLL_INTERVAL_MS = 10000;    // poll every 10 seconds
const TEST_TIMEOUT_MS = 720000;    // 12 minutes per test block

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
 * @param {string} entityId - e.g. '01'
 * @param {string} agentId - e.g. 'cc', 'gg'
 * @param {string} expectedStatus - e.g. 'submitted'
 * @returns {boolean}
 */
function agentStatusIs(entityType, entityId, agentId, expectedStatus) {
    const statusPath = path.join(BREWBOARD_PATH, '.aigon', 'state', `${entityType}-${entityId}-${agentId}.json`);
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

// ─── suite ───────────────────────────────────────────────────────────────────

let dashboardProcess = null;

describe('Dashboard E2E — Full Agent Lifecycle', { timeout: 3600000 }, () => {

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
        // Stop dashboard
        if (dashboardProcess) {
            dashboardProcess.kill('SIGTERM');
            dashboardProcess = null;
        }

        // Kill all brewboard tmux sessions
        const killed = killTmuxSessions('brewboard-');
        if (killed > 0) {
            console.log(`    [teardown] Killed ${killed} brewboard tmux sessions`);
        }
    });

    // ── Test 1: Feature Fleet — cc + gg start, implement, submit ─────────────

    it('Feature Fleet: cc + gg start, implement, and submit', { timeout: TEST_TIMEOUT_MS }, async () => {
        // Verify feature 01 is in backlog
        const backlogSpec = findSpec('02-backlog', /^feature-01-/);
        assert.ok(backlogSpec, 'feature-01 should be in 02-backlog after seed-reset');

        // Start feature 01 with cc and gg agents
        console.log('    [test1] Starting feature 01 with cc + gg...');
        const resp = await dashboardPost('/api/action', {
            action: 'feature-start',
            args: ['01', 'cc', 'gg'],
            repoPath: BREWBOARD_PATH,
        });

        assert.equal(resp.status, 200, `Expected 200 OK, got ${resp.status}: ${JSON.stringify(resp.body)}`);
        assert.ok(resp.body.ok, `feature-start should succeed: ${JSON.stringify(resp.body)}`);

        // Allow time for tmux sessions to be created
        await sleep(3000);

        // Verify spec moved to 03-in-progress
        const inProgressSpec = findSpec('03-in-progress', /^feature-01-/);
        assert.ok(inProgressSpec, 'feature-01 should have moved to 03-in-progress');

        // Verify tmux sessions exist for both agents
        const sessions = listTmuxSessions('brewboard-f1-');
        assert.ok(sessions.length >= 2, `Expected at least 2 tmux sessions for f1, got: ${sessions.join(', ')}`);

        const hasCc = sessions.some(s => s.includes('-cc'));
        const hasGg = sessions.some(s => s.includes('-gg'));
        assert.ok(hasCc, `Expected a cc session in: ${sessions.join(', ')}`);
        assert.ok(hasGg, `Expected a gg session in: ${sessions.join(', ')}`);

        console.log('    [test1] Agents launched. Polling for submission...');

        // Poll for both agents to submit
        await pollForCondition(
            'cc agent submits feature-01',
            () => agentStatusIs('feature', '01', 'cc', 'submitted'),
            {
                timeoutMs: AGENT_TIMEOUT_MS,
                diagnosticsFn: () => collectSessionDiagnostics('brewboard-f1-cc'),
            }
        );
        console.log('    [test1] cc agent submitted.');

        await pollForCondition(
            'gg agent submits feature-01',
            () => agentStatusIs('feature', '01', 'gg', 'submitted'),
            {
                timeoutMs: AGENT_TIMEOUT_MS,
                diagnosticsFn: () => collectSessionDiagnostics('brewboard-f1-gg'),
            }
        );
        console.log('    [test1] gg agent submitted.');

        // Verify dashboard status API reflects submissions
        const statusResp = await dashboardGet('/api/status');
        assert.equal(statusResp.status, 200);
        const brewboard = statusResp.body.repos.find(r =>
            r.name === 'brewboard' || (r.path && r.path.includes('brewboard'))
        );
        assert.ok(brewboard, 'brewboard should appear in status');

        const feature01 = brewboard.features.find(f => f.id === '01' || f.id === '1');
        assert.ok(feature01, 'feature-01 should appear in status');

        // Both agents should show as submitted
        const ccAgent = feature01.agents.find(a => a.id === 'cc');
        const ggAgent = feature01.agents.find(a => a.id === 'gg');
        assert.ok(ccAgent, 'cc agent should appear in feature status');
        assert.ok(ggAgent, 'gg agent should appear in feature status');
        assert.equal(ccAgent.status, 'submitted', `cc agent status should be submitted, got: ${ccAgent.status}`);
        assert.equal(ggAgent.status, 'submitted', `gg agent status should be submitted, got: ${ggAgent.status}`);

        // Verify validActions includes eval-related action (feature-eval or similar)
        assert.ok(feature01.validActions, 'feature-01 should have validActions');
        console.log('    [test1] validActions:', JSON.stringify(feature01.validActions));

        // Verify dev server is running for the agents
        const devServerResult = runAigon(['dev-server', 'list'], { timeout: 15000 });
        console.log('    [test1] dev-server list output:', devServerResult.stdout);
        // Dev server output should mention brewboard or feature ports
        // (This is a best-effort check — not all agent configs start dev servers)
    });

    // ── Test 2: Feature eval — launch eval agent, wait for completion ────────

    it('Feature Eval: launch eval agent and wait for completion', { timeout: TEST_TIMEOUT_MS }, async () => {
        console.log('    [test2] Launching eval for feature 01...');

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

        const sessionName = resp.body.sessionName;
        console.log(`    [test2] Eval session: ${sessionName}`);

        // Verify tmux session exists
        await sleep(2000);
        assert.ok(tmuxSessionExists(sessionName), `tmux session "${sessionName}" should exist`);

        // Poll for eval completion: check for eval file
        const evalFilePath = path.join(BREWBOARD_PATH, 'docs', 'specs', 'features', 'evaluations', 'feature-01-eval.md');

        await pollForCondition(
            'eval file created for feature-01',
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

    it('Feature Close: close feature 01 with winner', { timeout: TEST_TIMEOUT_MS }, async () => {
        // Determine the winner from the eval file
        const evalFilePath = path.join(BREWBOARD_PATH, 'docs', 'specs', 'features', 'evaluations', 'feature-01-eval.md');
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

        console.log(`    [test3] Closing feature 01 with winner: ${winner}`);
        const closeResult = runAigon(['feature-close', '01', winner], { timeout: 120000 });

        console.log('    [test3] feature-close stdout:', closeResult.stdout.slice(0, 500));
        if (closeResult.stderr) {
            console.log('    [test3] feature-close stderr:', closeResult.stderr.slice(0, 500));
        }

        // Allow time for cleanup
        await sleep(3000);

        // Verify spec moved to 05-done
        const doneSpec = findSpec('05-done', /^feature-01-/);
        assert.ok(doneSpec, 'feature-01 should have moved to 05-done');

        // Verify all feature tmux sessions are killed
        const remainingSessions = listTmuxSessions('brewboard-f1-');
        assert.equal(remainingSessions.length, 0,
            `Expected all f1 tmux sessions killed, but found: ${remainingSessions.join(', ')}`);

        // Verify worktrees removed
        const worktreeBase = BREWBOARD_PATH + '-worktrees';
        if (fs.existsSync(worktreeBase)) {
            const worktrees = fs.readdirSync(worktreeBase).filter(d => d.includes('f01') || d.includes('f1-'));
            assert.equal(worktrees.length, 0,
                `Expected f01 worktrees removed, but found: ${worktrees.join(', ')}`);
        }

        console.log('    [test3] Feature 01 closed successfully.');
    });

    // ── Test 4: Research Fleet — cc + gg start, research, submit ─────────────

    it('Research Fleet: cc + gg start, research, and submit', { timeout: TEST_TIMEOUT_MS }, async () => {
        // Seed-reset to get clean state for research tests
        console.log('    [test4] Running seed-reset for research tests...');
        const resetResult = runAigon(['seed-reset', BREWBOARD_PATH, '--force'], {
            cwd: AIGON_PATH,
            timeout: 120000,
        });
        assert.equal(resetResult.exitCode, 0,
            `seed-reset should succeed, stderr: ${resetResult.stderr.slice(0, 500)}`);

        // Wait for dashboard to pick up the reset
        await sleep(3000);

        // Verify research-01 is in backlog
        const backlogSpec = findResearchSpec('02-backlog', /^research-01-/);
        assert.ok(backlogSpec, 'research-01 should be in 02-backlog after seed-reset');

        // Start research 01 with cc and gg agents
        console.log('    [test4] Starting research 01 with cc + gg...');
        const resp = await dashboardPost('/api/action', {
            action: 'research-start',
            args: ['01', 'cc', 'gg'],
            repoPath: BREWBOARD_PATH,
        });

        assert.equal(resp.status, 200, `Expected 200 OK, got ${resp.status}: ${JSON.stringify(resp.body)}`);
        assert.ok(resp.body.ok, `research-start should succeed: ${JSON.stringify(resp.body)}`);

        // Allow time for tmux sessions to be created
        await sleep(3000);

        // Verify research spec moved to 03-in-progress
        const inProgressSpec = findResearchSpec('03-in-progress', /^research-01-/);
        assert.ok(inProgressSpec, 'research-01 should have moved to 03-in-progress');

        // Verify tmux sessions exist
        const sessions = listTmuxSessions('brewboard-r1-');
        assert.ok(sessions.length >= 2, `Expected at least 2 research tmux sessions, got: ${sessions.join(', ')}`);

        const hasCc = sessions.some(s => s.includes('-cc'));
        const hasGg = sessions.some(s => s.includes('-gg'));
        assert.ok(hasCc, `Expected a cc research session in: ${sessions.join(', ')}`);
        assert.ok(hasGg, `Expected a gg research session in: ${sessions.join(', ')}`);

        console.log('    [test4] Agents launched. Polling for submission...');

        // Poll for both agents to submit
        await pollForCondition(
            'cc agent submits research-01',
            () => agentStatusIs('research', '01', 'cc', 'submitted'),
            {
                timeoutMs: AGENT_TIMEOUT_MS,
                diagnosticsFn: () => collectSessionDiagnostics('brewboard-r1-cc'),
            }
        );
        console.log('    [test4] cc agent submitted.');

        await pollForCondition(
            'gg agent submits research-01',
            () => agentStatusIs('research', '01', 'gg', 'submitted'),
            {
                timeoutMs: AGENT_TIMEOUT_MS,
                diagnosticsFn: () => collectSessionDiagnostics('brewboard-r1-gg'),
            }
        );
        console.log('    [test4] gg agent submitted.');

        // Check that findings files exist
        const logsDir = path.join(BREWBOARD_PATH, 'docs', 'specs', 'research-topics', 'logs');
        if (fs.existsSync(logsDir)) {
            const findingsFiles = fs.readdirSync(logsDir).filter(f => f.startsWith('research-01-') && f.endsWith('-findings.md'));
            console.log('    [test4] Findings files:', findingsFiles.join(', '));
            assert.ok(findingsFiles.length >= 1, 'At least one findings file should exist');
        }
    });

    // ── Test 5: Research eval — launch eval agent ────────────────────────────

    it('Research Eval: launch eval agent and wait for completion', { timeout: TEST_TIMEOUT_MS }, async () => {
        console.log('    [test5] Launching eval for research 01...');

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

        const sessionName = resp.body.sessionName;
        console.log(`    [test5] Eval session: ${sessionName}`);

        // Verify tmux session exists
        await sleep(2000);
        assert.ok(tmuxSessionExists(sessionName), `tmux session "${sessionName}" should exist`);

        // Poll for eval completion: check the research spec or logs for Recommendation/Output section
        const researchSpecDir = path.join(BREWBOARD_PATH, 'docs', 'specs', 'research-topics', '03-in-progress');
        const researchLogsDir = path.join(BREWBOARD_PATH, 'docs', 'specs', 'research-topics', 'logs');

        await pollForCondition(
            'research eval completion for research-01',
            () => {
                // Check for eval/synthesis output in the logs directory
                if (fs.existsSync(researchLogsDir)) {
                    const files = fs.readdirSync(researchLogsDir);
                    // Look for eval or synthesis files
                    const evalFiles = files.filter(f =>
                        (f.startsWith('research-01') && (f.includes('eval') || f.includes('synthesis'))) ||
                        f === 'research-01-eval.md'
                    );
                    if (evalFiles.length > 0) return true;
                }

                // Also check if the research spec itself has been updated with Recommendation/Output
                if (fs.existsSync(researchSpecDir)) {
                    const specFiles = fs.readdirSync(researchSpecDir).filter(f => f.startsWith('research-01-'));
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
                    const moved = fs.readdirSync(evalStageDir).filter(f => f.startsWith('research-01-'));
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

    it('Research Close: close research 01', { timeout: TEST_TIMEOUT_MS }, async () => {
        console.log('    [test6] Closing research 01...');

        const closeResult = runAigon(['research-close', '01'], { timeout: 120000 });

        console.log('    [test6] research-close stdout:', closeResult.stdout.slice(0, 500));
        if (closeResult.stderr) {
            console.log('    [test6] research-close stderr:', closeResult.stderr.slice(0, 500));
        }

        // Allow time for cleanup
        await sleep(3000);

        // Verify spec moved to 05-done
        const doneSpec = findResearchSpec('05-done', /^research-01-/);
        assert.ok(doneSpec, 'research-01 should have moved to 05-done');

        // Verify all research tmux sessions are killed
        const remainingSessions = listTmuxSessions('brewboard-r1-');
        assert.equal(remainingSessions.length, 0,
            `Expected all r1 tmux sessions killed, but found: ${remainingSessions.join(', ')}`);

        console.log('    [test6] Research 01 closed successfully.');
    });
});
