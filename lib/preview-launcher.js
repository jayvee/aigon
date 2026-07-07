'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const { deriveServerIdFromBranch } = require('./proxy');
const { getDashboardRuntimeEntry, stopDashboardProcess, waitForServerHealthy } = require('./server-runtime');
const { provisionEphemeralSeededInstance, destroyEphemeralSeededInstance } = require('./ephemeral-seeded-instance');
const {
    readSandboxState,
    writeSandboxState,
    removeSandboxState,
    listSandboxStates,
    readSandboxRuntimeEntry,
} = require('./preview-sandbox');

function worktreeBaseDir(repoPath) {
    return path.join(os.homedir(), '.aigon', 'worktrees', path.basename(path.resolve(repoPath)));
}

/**
 * Scan ~/.aigon/worktrees/<repo>/ for feature worktrees.
 * @param {string} repoPath
 * @returns {Array<{ path: string, featureId: string, agent: string, desc: string, mtime: Date }>}
 */
function listFeatureWorktrees(repoPath) {
    const baseDir = worktreeBaseDir(repoPath);
    const worktrees = [];
    if (!fs.existsSync(baseDir)) return worktrees;
    try {
        for (const dirName of fs.readdirSync(baseDir)) {
            const m = dirName.match(/^feature-(\d+)-([a-z]{2})-(.+)$/);
            if (!m) continue;
            const wtPath = path.join(baseDir, dirName);
            worktrees.push({
                path: wtPath,
                featureId: m[1],
                agent: m[2],
                desc: m[3],
                mtime: fs.existsSync(wtPath) ? fs.statSync(wtPath).mtime : new Date(0),
            });
        }
    } catch (_) { /* non-fatal */ }
    return worktrees;
}

/**
 * @param {string} repoPath
 * @param {string|number} featureId
 * @param {string} [agentId]
 * @returns {Array<{ path: string, featureId: string, agent: string, desc: string, mtime: Date }>}
 */
function findFeatureWorktrees(repoPath, featureId, agentId) {
    const paddedId = String(featureId).padStart(2, '0');
    const unpaddedId = String(parseInt(featureId, 10));
    let matches = listFeatureWorktrees(repoPath).filter(wt =>
        wt.featureId === paddedId || wt.featureId === unpaddedId
    );
    if (agentId) {
        matches = matches.filter(wt => wt.agent === agentId);
    }
    return matches.sort((a, b) => b.mtime - a.mtime);
}

function getPreviewInstanceId(worktreePath) {
    return deriveServerIdFromBranch(path.basename(worktreePath));
}

function resolvePreviewIdentity(worktreePath) {
    const { resolveInstanceIdentity } = require('./instance-identity');
    return resolveInstanceIdentity({ codeRoot: worktreePath, cwd: worktreePath });
}

function getPreviewUrl(worktreePath, actualPort) {
    const identity = resolvePreviewIdentity(worktreePath);
    const { isProxyAvailable, getDevProxyUrl, getAigonServerAppId } = require('./proxy');
    if (isProxyAvailable()) {
        return getDevProxyUrl(getAigonServerAppId(), identity.caddyServerId);
    }
    return `http://localhost:${actualPort || identity.port}`;
}

function getPreviewLogPath(instanceId) {
    return path.join(os.homedir(), '.aigon', 'logs', `preview-${instanceId}.log`);
}

function getPreviewRegistryEntry(worktreePath, deps = {}) {
    const instanceId = getPreviewInstanceId(worktreePath);
    if (!instanceId) return null;
    const isProcessAlive = deps.isProcessAlive || require('./proxy').isProcessAlive;
    return getDashboardRuntimeEntry({ instanceId, isProcessAlive });
}

async function stopPreviewForWorktree(worktreePath, deps = {}) {
    const instanceId = getPreviewInstanceId(worktreePath);
    if (!instanceId) return false;
    const sandboxState = readSandboxState(instanceId);
    if (sandboxState) {
        return stopSandboxPreviewForWorktree(worktreePath, deps);
    }
    const isProcessAlive = deps.isProcessAlive || require('./proxy').isProcessAlive;
    const cliPath = path.join(worktreePath, 'aigon-cli.js');
    if (fs.existsSync(cliPath)) {
        await new Promise((resolve) => {
            const child = spawn(process.execPath, [cliPath, 'server', 'stop'], {
                cwd: worktreePath,
                stdio: 'inherit',
            });
            child.on('close', () => resolve());
            child.on('error', () => resolve());
        });
    }
    const entry = getDashboardRuntimeEntry({ instanceId, isProcessAlive });
    if (!entry) return false;
    return stopDashboardProcess(entry, `preview ${instanceId}`, { isProcessAlive });
}

async function stopSandboxPreviewForWorktree(worktreePath, deps = {}) {
    const instanceId = getPreviewInstanceId(worktreePath);
    if (!instanceId) return false;
    const isProcessAlive = deps.isProcessAlive || require('./proxy').isProcessAlive;
    const state = readSandboxState(instanceId);
    if (!state) return false;

    let stopped = false;
    const entry = state.tempHome
        ? readSandboxRuntimeEntry(state.tempHome, isProcessAlive)
        : null;
    if (entry) {
        stopped = await stopDashboardProcess(entry, `sandbox preview ${instanceId}`, { isProcessAlive });
    } else if (state.pid && isProcessAlive(state.pid)) {
        stopped = await stopDashboardProcess({ pid: state.pid, port: state.port }, `sandbox preview ${instanceId}`, { isProcessAlive });
    }

    destroyEphemeralSeededInstance({ tempHome: state.tempHome, repoPath: state.repoPath });
    removeSandboxState(instanceId);
    return stopped || !!state.tempHome;
}

function resolveSandboxFixture(sandboxOption) {
    if (sandboxOption === true || sandboxOption === 'true' || sandboxOption === '1') return 'brewboard';
    if (!sandboxOption || sandboxOption === false) return null;
    return String(sandboxOption);
}

async function gcPreviewSandboxes(deps = {}) {
    const isProcessAlive = deps.isProcessAlive || require('./proxy').isProcessAlive;
    let removed = 0;
    for (const state of listSandboxStates()) {
        const entry = state.tempHome
            ? readSandboxRuntimeEntry(state.tempHome, isProcessAlive)
            : null;
        const alive = entry || (state.pid && isProcessAlive(state.pid));
        if (!alive) {
            destroyEphemeralSeededInstance({ tempHome: state.tempHome, repoPath: state.repoPath });
            removeSandboxState(state.instanceId);
            removed++;
        }
    }
    return removed;
}

async function startPreviewForWorktree(worktreePath, options = {}) {
    const cliPath = path.join(worktreePath, 'aigon-cli.js');
    if (!fs.existsSync(cliPath)) {
        throw new Error(`No aigon-cli.js in worktree: ${worktreePath}`);
    }
    const dashDir = path.join(worktreePath, 'templates', 'dashboard');
    if (!fs.existsSync(dashDir)) {
        throw new Error(`No templates/dashboard/ in worktree: ${worktreePath}`);
    }

    const instanceId = getPreviewInstanceId(worktreePath);
    const isProcessAlive = options.isProcessAlive || require('./proxy').isProcessAlive;
    const existing = getDashboardRuntimeEntry({ instanceId, isProcessAlive });

    if (existing && existing.pid && isProcessAlive(existing.pid)) {
        return { alreadyRunning: true, url: getPreviewUrl(worktreePath, existing.port), instanceId, port: existing.port, pid: existing.pid, sandbox: false };
    }

    const logPath = getPreviewLogPath(instanceId);
    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logFd = fs.openSync(logPath, 'a');

    spawn(process.execPath, [cliPath, 'server', 'start', '--preview'], {
        cwd: worktreePath,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: process.env,
    }).unref();

    const identity = resolvePreviewIdentity(worktreePath);
    const preferredPort = identity.port;
    const timeoutMs = options.timeoutMs || 15000;
    // The server may bind a different port than the preferred hash (collision → allocatePort),
    // so wait for the runtime entry to learn the actual bound port before health-checking.
    const deadline = Date.now() + timeoutMs;
    let entry = getDashboardRuntimeEntry({ instanceId, isProcessAlive });
    while (!entry && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 250));
        entry = getDashboardRuntimeEntry({ instanceId, isProcessAlive });
    }
    const actualPort = entry && entry.port ? entry.port : preferredPort;
    const healthy = entry
        ? await waitForServerHealthy(actualPort, Math.max(1000, deadline - Date.now()))
        : await waitForServerHealthy(preferredPort, Math.max(1000, deadline - Date.now()));

    return {
        alreadyRunning: false,
        url: getPreviewUrl(worktreePath, actualPort),
        instanceId,
        port: actualPort,
        pid: entry && entry.pid ? entry.pid : null,
        healthy,
        logPath,
        sandbox: false,
    };
}

async function startSandboxPreviewForWorktree(worktreePath, options = {}) {
    const cliPath = path.join(worktreePath, 'aigon-cli.js');
    if (!fs.existsSync(cliPath)) {
        throw new Error(`No aigon-cli.js in worktree: ${worktreePath}`);
    }
    const dashDir = path.join(worktreePath, 'templates', 'dashboard');
    if (!fs.existsSync(dashDir)) {
        throw new Error(`No templates/dashboard/ in worktree: ${worktreePath}`);
    }

    const instanceId = getPreviewInstanceId(worktreePath);
    const isProcessAlive = options.isProcessAlive || require('./proxy').isProcessAlive;
    const fixture = resolveSandboxFixture(options.sandbox);
    if (!fixture) {
        throw new Error('Sandbox preview requires --sandbox or --sandbox=<fixture>');
    }

    const existingState = readSandboxState(instanceId);
    if (existingState) {
        const entry = existingState.tempHome
            ? readSandboxRuntimeEntry(existingState.tempHome, isProcessAlive)
            : null;
        if (entry) {
            return {
                alreadyRunning: true,
                url: getPreviewUrl(worktreePath, entry.port),
                instanceId,
                port: entry.port,
                pid: entry.pid,
                healthy: true,
                logPath: getPreviewLogPath(instanceId),
                sandbox: true,
                fixture: existingState.fixture,
                repoPath: existingState.repoPath,
            };
        }
        destroyEphemeralSeededInstance({ tempHome: existingState.tempHome, repoPath: existingState.repoPath });
        removeSandboxState(instanceId);
    }

    const sandbox = provisionEphemeralSeededInstance({
        fixture,
        cliPath,
        repoPrefix: 'aigon-preview-sandbox-repo-',
        homePrefix: 'aigon-preview-sandbox-home-',
    });

    const logPath = getPreviewLogPath(instanceId);
    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logFd = fs.openSync(logPath, 'a');

    const childEnv = {
        ...process.env,
        HOME: sandbox.tempHome,
        AIGON_HOME: sandbox.tempHome,
        TMUX_TMPDIR: sandbox.tmuxTmpDir,
        AIGON_PREVIEW_SANDBOX_REPO: sandbox.repoPath,
    };

    spawn(process.execPath, [cliPath, 'server', 'start', '--preview'], {
        cwd: worktreePath,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: childEnv,
    }).unref();

    const timeoutMs = options.timeoutMs || 20000;
    const deadline = Date.now() + timeoutMs;
    let entry = readSandboxRuntimeEntry(sandbox.tempHome, isProcessAlive);
    while (!entry && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 250));
        entry = readSandboxRuntimeEntry(sandbox.tempHome, isProcessAlive);
    }
    const actualPort = entry && entry.port ? entry.port : null;
    const healthy = actualPort
        ? await waitForServerHealthy(actualPort, Math.max(1000, deadline - Date.now()))
        : false;

    writeSandboxState(instanceId, {
        worktreePath,
        tempHome: sandbox.tempHome,
        repoPath: sandbox.repoPath,
        fixture,
        pid: entry && entry.pid ? entry.pid : null,
        port: actualPort,
    });

    return {
        alreadyRunning: false,
        url: actualPort ? getPreviewUrl(worktreePath, actualPort) : getPreviewUrl(worktreePath),
        instanceId,
        port: actualPort,
        pid: entry && entry.pid ? entry.pid : null,
        healthy,
        logPath,
        sandbox: true,
        fixture,
        repoPath: sandbox.repoPath,
    };
}

module.exports = {
    worktreeBaseDir,
    listFeatureWorktrees,
    findFeatureWorktrees,
    getPreviewInstanceId,
    getPreviewUrl,
    getPreviewLogPath,
    getPreviewRegistryEntry,
    stopPreviewForWorktree,
    stopSandboxPreviewForWorktree,
    startPreviewForWorktree,
    startSandboxPreviewForWorktree,
    gcPreviewSandboxes,
    resolveSandboxFixture,
};
