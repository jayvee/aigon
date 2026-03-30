'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const git = require('./git');

// Lazy require config to avoid load-order issues
function _loadProjectConfig() {
    return require('./config').loadProjectConfig();
}

// --- Dev Proxy System ---

const DEV_PROXY_DIR = path.join(os.homedir(), '.aigon', 'dev-proxy');
const DEV_PROXY_REGISTRY = path.join(DEV_PROXY_DIR, 'servers.json');
const DEV_PROXY_LOGS_DIR = path.join(DEV_PROXY_DIR, 'logs');
const DEV_PROXY_PID_FILE = path.join(DEV_PROXY_DIR, 'proxy.pid');

// --- Global Port Registry ---
const PORT_REGISTRY_PATH = path.join(os.homedir(), '.aigon', 'ports.json');
const PORT_BLOCK_SIZE = 10; // Each project reserves a block of 10 ports
const PORT_START = 3000;    // First allocatable base port
const RESERVED_PORTS = [4100]; // Dashboard port — never allocated to a project

// Dashboard port range constants (stable, defined here to avoid circular deps)
const DASHBOARD_DYNAMIC_PORT_START = 4101;
const DASHBOARD_DYNAMIC_PORT_END = 4199;
const AIGON_SERVER_APP_ID = 'aigon';

/**
 * Sanitize a string for use as a DNS label.
 * Lowercase, strip npm scope, replace non-alphanumeric with hyphens.
 * @param {string} name - Raw name
 * @returns {string} DNS-safe label
 */
function sanitizeForDns(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/^@[^/]+\//, '')          // strip npm scope
        .replace(/[^a-z0-9]+/g, '-')       // replace non-alphanumeric
        .replace(/^-+|-+$/g, '')           // trim leading/trailing hyphens
        .replace(/-{2,}/g, '-');           // collapse multiple hyphens
}

/**
 * Get the app ID for dev proxy URLs.
 * Priority: .aigon/config.json appId > package.json name > main repo dirname (worktree) > dirname
 * @param {string} [repoPath] - Path to the repository root (defaults to process.cwd())
 * @returns {string} DNS-safe app ID
 */
function getAppId(repoPath) {
    const cwd = repoPath ? path.resolve(repoPath) : process.cwd();

    // 1. Explicit config
    const configPath = path.join(cwd, '.aigon', 'config.json');
    if (fs.existsSync(configPath)) {
        try {
            const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (cfg.appId) return sanitizeForDns(cfg.appId);
        } catch (_) { /* ignore */ }
    }

    // 2. package.json name
    const pkgPath = path.join(cwd, 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg.name) return sanitizeForDns(pkg.name);
        } catch (e) { /* ignore */ }
    }

    // 3. If in a git worktree, use the main repo's directory name
    try {
        const commonDir = git.getCommonDir(cwd);
        if (commonDir && path.isAbsolute(commonDir)) {
            return sanitizeForDns(path.basename(path.dirname(commonDir)));
        }
    } catch (e) { /* not in git */ }

    // 4. Directory name
    return sanitizeForDns(path.basename(cwd));
}

/**
 * Fixed app ID for the AIGON server process.
 * The server identity must not depend on cwd.
 * @returns {string}
 */
function getAigonServerAppId() {
    return AIGON_SERVER_APP_ID;
}

/**
 * Check if a port is available by attempting to listen on it.
 * @param {number} port - Port to check
 * @returns {Promise<boolean>} True if available
 */
function isPortAvailable(port) {
    return new Promise((resolve) => {
        const net = require('net');
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close(() => resolve(true));
        });
        server.listen(port, '127.0.0.1');
    });
}

/**
 * Find an available port, starting from preferred.
 * @param {number} preferred - Preferred port to try first
 * @returns {Promise<number>} Available port
 */
async function allocatePort(preferred) {
    for (let port = preferred; port < preferred + 100; port++) {
        if (await isPortAvailable(port)) return port;
    }
    throw new Error(`No available port found in range ${preferred}-${preferred + 99}`);
}

/**
 * Check if the aigon-proxy daemon is running.
 * @returns {boolean} True if proxy is running
 */
function isProxyAvailable() {
    if (!fs.existsSync(DEV_PROXY_PID_FILE)) return false;
    try {
        const pid = parseInt(fs.readFileSync(DEV_PROXY_PID_FILE, 'utf8').trim(), 10);
        if (!pid || isNaN(pid)) return false;
        return isProcessAlive(pid);
    } catch (e) {
        return false;
    }
}

/**
 * Run structured diagnostics on the dev proxy.
 * @returns {{ healthy: boolean, proxy: { running: boolean }, routes: { total: number }, fix: string|null }}
 */
function proxyDiagnostics() {
    const running = isProxyAvailable();

    const registry = loadProxyRegistry();
    let totalRoutes = 0;
    for (const servers of Object.values(registry)) {
        totalRoutes += Object.keys(servers).length;
    }

    const fix = running ? null : 'aigon proxy start';

    return {
        healthy: running,
        proxy: { running },
        routes: { total: totalRoutes },
        fix,
    };
}

/**
 * Load the dev proxy server registry.
 * @returns {Object} Registry object { appId: { serverId: { port, worktree, pid, started } } }
 */
function loadProxyRegistry() {
    if (!fs.existsSync(DEV_PROXY_REGISTRY)) return {};
    try {
        return JSON.parse(fs.readFileSync(DEV_PROXY_REGISTRY, 'utf8'));
    } catch (e) {
        return {};
    }
}

/**
 * Save the dev proxy server registry.
 * @param {Object} registry - Registry object
 */
function saveProxyRegistry(registry) {
    if (!fs.existsSync(DEV_PROXY_DIR)) {
        fs.mkdirSync(DEV_PROXY_DIR, { recursive: true });
    }
    fs.writeFileSync(DEV_PROXY_REGISTRY, JSON.stringify(registry, null, 2) + '\n');
}

/**
 * Load the global port registry.
 * @returns {Object} Registry object { name: { basePort, path } }
 */
function loadPortRegistry() {
    if (!fs.existsSync(PORT_REGISTRY_PATH)) return {};
    try {
        return JSON.parse(fs.readFileSync(PORT_REGISTRY_PATH, 'utf8'));
    } catch (e) {
        return {};
    }
}

/**
 * Save the global port registry.
 * @param {Object} registry - Registry object
 */
function savePortRegistry(registry) {
    const dir = path.dirname(PORT_REGISTRY_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(PORT_REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
}

/**
 * Register a project's base port in the global registry.
 * Warns if another project is already using the same port range.
 * @param {string} name - Project name
 * @param {number} basePort - Base port number
 * @param {string} repoPath - Absolute path to the repo
 * @returns {string[]} Names of conflicting projects (empty if none)
 */
function registerPort(name, basePort, repoPath) {
    const registry = loadPortRegistry();
    const conflicts = [];

    for (const [existingName, entry] of Object.entries(registry)) {
        if (existingName === name) continue;
        // Conflict if port ranges overlap (each project claims a block of PORT_BLOCK_SIZE ports)
        if (Math.abs(entry.basePort - basePort) < PORT_BLOCK_SIZE) {
            conflicts.push(existingName);
        }
    }

    registry[name] = { basePort, path: repoPath };
    savePortRegistry(registry);

    if (conflicts.length > 0) {
        console.warn(`\n⚠️  Port conflict: ${name} (port ${basePort}) overlaps with: ${conflicts.join(', ')}`);
        console.warn(`   Run \`aigon doctor\` to see all port assignments.`);
    }

    return conflicts;
}

/**
 * Deregister a project from the global port registry.
 * @param {string} name - Project name to remove
 */
function deregisterPort(name) {
    const registry = loadPortRegistry();
    if (registry[name]) {
        delete registry[name];
        savePortRegistry(registry);
    }
}

/**
 * Auto-allocate a unique base port for a project from the global registry.
 * If the project already has an allocation, returns the existing one.
 * Respects explicit devProxy.basePort in .aigon/config.json (won't override).
 * @param {string} repoPath - Absolute path to the repo
 * @param {string} [name] - Project name (defaults to basename of repoPath)
 * @returns {number} Allocated base port
 */
function allocateBasePort(repoPath, name) {
    repoPath = path.resolve(repoPath);
    name = name || path.basename(repoPath);
    const registry = loadPortRegistry();

    // Check if already allocated in registry
    if (registry[name] && registry[name].path === repoPath) {
        return registry[name].basePort;
    }

    // Check for explicit basePort in project config (respect manual config)
    const projectConfigPath = path.join(repoPath, '.aigon', 'config.json');
    if (fs.existsSync(projectConfigPath)) {
        try {
            const config = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
            if (config.devProxy?.basePort) {
                // Register the explicit port but don't override it
                registerPort(name, config.devProxy.basePort, repoPath);
                return config.devProxy.basePort;
            }
        } catch (e) { /* ignore parse errors */ }
    }

    // Check .env.local / .env for PORT=
    for (const envFile of ['.env.local', '.env']) {
        const envPath = path.join(repoPath, envFile);
        if (!fs.existsSync(envPath)) continue;
        try {
            const content = fs.readFileSync(envPath, 'utf8');
            const match = content.match(/^PORT=(\d+)/m);
            if (match) {
                const port = parseInt(match[1], 10);
                registerPort(name, port, repoPath);
                return port;
            }
        } catch (e) { /* ignore read errors */ }
    }

    // Auto-allocate: find next free slot in blocks of PORT_BLOCK_SIZE
    const usedPorts = Object.values(registry).map(r => r.basePort);
    let candidate = PORT_START;
    while (usedPorts.includes(candidate) || isReservedPort(candidate)) {
        candidate += PORT_BLOCK_SIZE;
    }

    // Register and persist
    registry[name] = { basePort: candidate, path: repoPath, allocatedAt: new Date().toISOString().split('T')[0] };
    savePortRegistry(registry);

    return candidate;
}

/**
 * Check if a base port's block would overlap with a reserved range.
 * A block spans [port, port + PORT_BLOCK_SIZE - 1].
 * @param {number} port - Base port to check
 * @returns {boolean} True if any port in the block is reserved
 */
function isReservedPort(port) {
    const blockEnd = port + PORT_BLOCK_SIZE - 1;
    for (const reserved of RESERVED_PORTS) {
        // Block overlaps if it contains the reserved port or is within the reserved port's block
        if (port <= reserved && blockEnd >= reserved) return true;
        if (reserved <= port && reserved + PORT_BLOCK_SIZE - 1 >= port) return true;
    }
    // Also skip the dashboard dynamic port range (4101-4199)
    if (blockEnd >= DASHBOARD_DYNAMIC_PORT_START && port <= DASHBOARD_DYNAMIC_PORT_END) return true;
    return false;
}

/**
 * Re-allocate a project to the next free port range (for conflict resolution).
 * @param {string} name - Project name in the registry
 * @returns {number|null} New base port, or null if project not found
 */
function reallocatePort(name) {
    const registry = loadPortRegistry();
    if (!registry[name]) return null;

    const repoPath = registry[name].path;
    // Remove current allocation so it doesn't block itself
    delete registry[name];
    savePortRegistry(registry);

    // Re-allocate using the fresh registry
    return allocateBasePort(repoPath, name);
}

/**
 * Scan filesystem for projects with port configurations.
 * Checks sibling directories for .aigon/config.json and .env.local/.env files.
 * @param {string} [scanDir] - Directory to scan (default: parent of cwd)
 * @returns {Array<{name: string, basePort: number, path: string, source: string}>}
 */
function scanPortsFromFilesystem(scanDir) {
    scanDir = scanDir || path.dirname(process.cwd());
    const results = [];

    let entries;
    try {
        entries = fs.readdirSync(scanDir, { withFileTypes: true });
    } catch (e) {
        return results;
    }

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirPath = path.join(scanDir, entry.name);

        // Check .aigon/config.json for devProxy.basePort
        const aigonConfigPath = path.join(dirPath, '.aigon', 'config.json');
        if (fs.existsSync(aigonConfigPath)) {
            try {
                const config = JSON.parse(fs.readFileSync(aigonConfigPath, 'utf8'));
                if (config.devProxy?.basePort) {
                    results.push({
                        name: entry.name,
                        basePort: config.devProxy.basePort,
                        path: dirPath,
                        source: '.aigon/config.json'
                    });
                    continue; // Config takes precedence, skip env files
                }
            } catch (e) { /* ignore parse errors */ }
        }

        // Check .env.local and .env for PORT=
        for (const envFile of ['.env.local', '.env']) {
            const envPath = path.join(dirPath, envFile);
            if (!fs.existsSync(envPath)) continue;
            try {
                const content = fs.readFileSync(envPath, 'utf8');
                const match = content.match(/^PORT=(\d+)/m);
                if (match) {
                    results.push({
                        name: entry.name,
                        basePort: parseInt(match[1], 10),
                        path: dirPath,
                        source: envFile
                    });
                    break; // .env.local takes precedence over .env
                }
            } catch (e) { /* ignore read errors */ }
        }
    }

    return results;
}

/**
 * Reconcile proxy routes — cleans dead entries from servers.json.
 * The proxy reads servers.json live, so no Caddy sync is needed.
 * @returns {{ added: number, removed: number, unchanged: number, cleaned: number }}
 */
function reconcileProxyRoutes() {
    const registry = loadProxyRegistry();
    const results = { added: 0, removed: 0, unchanged: 0, cleaned: 0 };

    for (const [appId, servers] of Object.entries(registry)) {
        for (const [serverId, info] of Object.entries(servers)) {
            // Check if process is alive (handle both nested and regular entries)
            let isAlive;
            if (info.service && info.dashboard) {
                const svcAlive = info.service.pid > 0 && isProcessAlive(info.service.pid);
                const dashAlive = info.dashboard.pid > 0 && isProcessAlive(info.dashboard.pid);
                isAlive = svcAlive && dashAlive;
            } else {
                const pidAlive = info.pid > 0 && isProcessAlive(info.pid);
                const portAlive = info.port > 0 && isPortInUseSync(info.port);
                isAlive = pidAlive || portAlive;
            }

            if (!isAlive) {
                delete servers[serverId];
                results.cleaned++;
            } else {
                results.unchanged++;
            }
        }
        // Clean empty app entries
        if (Object.keys(servers).length === 0) delete registry[appId];
    }

    saveProxyRegistry(registry);
    return results;
}

/**
 * Register a dev server with the proxy.
 * Writes to servers.json — the proxy daemon reads it live.
 * @param {string} appId - App identifier
 * @param {string} serverId - Server identifier (e.g., "cc-119" or "" for main)
 * @param {number} port - Port number
 * @param {string} worktreePath - Worktree or repo path
 * @param {number} pid - Process ID (0 if not started yet)
 */
function registerDevServer(appId, serverId, port, worktreePath, pid) {
    const registry = loadProxyRegistry();
    if (!registry[appId]) registry[appId] = {};
    registry[appId][serverId] = {
        port,
        worktree: worktreePath,
        pid: pid || 0,
        started: new Date().toISOString()
    };
    saveProxyRegistry(registry);
}

/**
 * Deregister a dev server from the proxy.
 * @param {string} appId - App identifier
 * @param {string} serverId - Server identifier
 */
function deregisterDevServer(appId, serverId) {
    const registry = loadProxyRegistry();
    if (registry[appId]) {
        delete registry[appId][serverId];
        if (Object.keys(registry[appId]).length === 0) {
            delete registry[appId];
        }
    }
    saveProxyRegistry(registry);
}

/**
 * Remove registry entries for dead processes.
 * @returns {number} Number of entries removed
 */
function gcDevServers() {
    const registry = loadProxyRegistry();
    let removed = 0;

    for (const [appId, servers] of Object.entries(registry)) {
        for (const [serverId, info] of Object.entries(servers)) {
            // Legacy entries have nested service/dashboard PIDs
            if (info.service && info.dashboard) {
                const serviceDead = info.service.pid > 0 && !isProcessAlive(info.service.pid);
                const dashboardDead = info.dashboard.pid > 0 && !isProcessAlive(info.dashboard.pid);
                if (serviceDead || dashboardDead) {
                    delete registry[appId][serverId];
                    removed++;
                }
            } else if (info.pid && info.pid > 0) {
                const pidAlive = isProcessAlive(info.pid);
                const portAlive = info.port > 0 && isPortInUseSync(info.port);
                if (!pidAlive && !portAlive) {
                    delete registry[appId][serverId];
                    removed++;
                }
            } else if (info.port && info.port > 0) {
                if (!isPortInUseSync(info.port)) {
                    delete registry[appId][serverId];
                    removed++;
                }
            }
        }
        if (Object.keys(registry[appId]).length === 0) {
            delete registry[appId];
        }
    }

    if (removed > 0) {
        saveProxyRegistry(registry);
    }

    return removed;
}

/**
 * Check if a process is alive.
 * @param {number} pid - Process ID
 * @returns {boolean}
 */
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        // EPERM = process exists but we don't have permission to signal it (still alive)
        // ESRCH = process does not exist
        return e.code === 'EPERM';
    }
}

function isPortInUseSync(port) {
    try {
        execSync(`lsof -ti tcp:${port}`, { stdio: 'pipe' });
        return true;
    } catch (_e) {
        return false;
    }
}

function validateRegistry() {
    const registry = loadProxyRegistry();
    let live = 0;
    let staleRemoved = 0;

    for (const [appId, servers] of Object.entries(registry)) {
        if (appId === '_portRegistry') continue;
        for (const [serverId, info] of Object.entries(servers)) {
            const pid = info.pid || (info.service && info.service.pid) || 0;
            const port = info.port || (info.service && info.service.port) || 0;

            let alive = false;
            if (pid > 0) {
                alive = isProcessAlive(pid);
            } else if (port > 0) {
                alive = isPortInUseSync(port);
            }

            if (alive) {
                live++;
            } else {
                delete registry[appId][serverId];
                staleRemoved++;
            }
        }
        if (Object.keys(registry[appId]).length === 0) {
            delete registry[appId];
        }
    }

    if (staleRemoved > 0) {
        saveProxyRegistry(registry);
    }

    return { live, staleRemoved };
}

/**
 * Detect the dev server context from the current directory.
 * Returns appId, agentId, featureId based on worktree path or branch name.
 * @returns {{ appId: string, agentId: string|null, featureId: string|null, serverId: string }}
 */
function detectDevServerContext() {
    const appId = getAppId();
    let agentId = null;
    let featureId = null;

    // Try to detect from worktree path: .../feature-119-cc-description
    const dirname = path.basename(process.cwd());
    const wtMatch = dirname.match(/^feature-(\d+)-([a-z]{2})-/);
    if (wtMatch) {
        featureId = wtMatch[1];
        agentId = wtMatch[2];
    } else {
        // Try to detect from branch name: feature-119-description or feature-119-cc-description
        try {
            const branch = git.getCurrentBranch();
            const branchMatch = branch.match(/^feature-(\d+)(?:-([a-z]{2}))?-/);
            if (branchMatch) {
                featureId = branchMatch[1];
                agentId = branchMatch[2] || null;
            }
        } catch (e) { /* not in a git repo */ }
    }

    // If no agent detected, try from AIGON_AGENT_NAME env or default to 'dev'
    if (!agentId) {
        const envAgent = process.env.AIGON_AGENT_ID;
        agentId = envAgent || null;
    }

    const serverId = agentId && featureId ? `${agentId}-${featureId}` : '';

    return { appId, agentId, featureId, serverId };
}

/**
 * Get the dev proxy URL for a given context.
 * Uses .localhost domains (RFC 6761 — automatic OS resolution, no DNS config needed).
 * @param {string} appId - App identifier
 * @param {string} serverId - Server identifier
 * @returns {string} URL (e.g., "http://cc-119.farline.localhost")
 */
function getDevProxyUrl(appId, serverId) {
    if (serverId) {
        return `http://${serverId}.${appId}.localhost`;
    }
    return `http://${appId}.localhost`;
}

/**
 * Get the log file path for a dev server.
 * @param {string} appId - App identifier
 * @param {string} serverId - Server identifier
 * @returns {string} Log file path
 */
function getDevServerLogPath(appId, serverId) {
    const label = serverId ? `${appId}-${serverId}` : appId;
    return path.join(DEV_PROXY_LOGS_DIR, `${label}.log`);
}

/**
 * Spawn a dev server process in the background.
 * @param {string} command - Command to run (e.g., "npm run dev")
 * @param {number} port - Port number to pass as PORT env var
 * @param {string} logPath - Path to write stdout/stderr
 * @param {string} cwd - Working directory
 * @returns {number} PID of the spawned process
 */
function spawnDevServer(command, port, logPath, cwd) {
    const { spawn } = require('child_process');

    // Ensure log directory exists
    if (!fs.existsSync(DEV_PROXY_LOGS_DIR)) {
        fs.mkdirSync(DEV_PROXY_LOGS_DIR, { recursive: true });
    }

    // Open log file for writing
    const logFd = fs.openSync(logPath, 'w');

    // Parse command into parts
    const parts = command.split(/\s+/);
    const cmd = parts[0];
    const cmdArgs = parts.slice(1);

    // Spawn detached process with PORT in env
    const child = spawn(cmd, cmdArgs, {
        cwd,
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, PORT: String(port) },
        shell: true
    });

    child.unref();
    fs.closeSync(logFd);

    return child.pid;
}

/**
 * Wait for a dev server to become healthy by polling a URL.
 * @param {string} url - URL to poll (e.g., "http://localhost:3847/")
 * @param {number} timeoutMs - Maximum time to wait in ms
 * @param {number} intervalMs - Polling interval in ms
 * @returns {Promise<boolean>} True if healthy, false if timed out
 */
async function waitForHealthy(url, timeoutMs = 30000, intervalMs = 500) {
    const http = require('http');
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        try {
            const ok = await new Promise((resolve) => {
                const req = http.get(url, { timeout: 2000 }, (res) => {
                    // Any response means the server is up (even 404)
                    res.resume();
                    resolve(true);
                });
                req.on('error', () => resolve(false));
                req.on('timeout', () => { req.destroy(); resolve(false); });
            });
            if (ok) return true;
        } catch (e) {
            // ignore
        }
        await new Promise(r => setTimeout(r, intervalMs));
    }

    return false;
}

/**
 * Open a URL in the default browser (cross-platform).
 * @param {string} url - URL to open
 */
function openInBrowser(url) {
    const platform = process.platform;
    const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
    execSync(`${cmd} ${JSON.stringify(url)}`, { stdio: 'ignore' });
}

/**
 * Derive a dev-server serverId from a branch/directory name.
 * e.g. "feature-71-cc-some-name" → "cc-71", main/master → null
 * @param {string} name
 * @returns {string|null}
 */
function deriveServerIdFromBranch(name) {
    const m = name.match(/^feature-(\d+)-([a-z]+)-/);
    if (m) return `${m[2]}-${m[1]}`;
    return null;
}

/**
 * Detect the Dashboard context — is this the main repo or a worktree?
 * Returns instanceName ('main' for main repo, branch name for worktrees) and metadata.
 * @returns {{ isWorktree: boolean, instanceName: string, worktreePath: string|null, serverId: string|null }}
 */
function detectDashboardContext() {
    const dirname = path.basename(process.cwd());
    const wtMatch = dirname.match(/^feature-\d+-[a-z]{2}-.+$/);
    if (wtMatch) {
        return { isWorktree: true, instanceName: dirname, worktreePath: process.cwd(), serverId: deriveServerIdFromBranch(dirname) };
    }

    // Try branch name
    try {
        const branch = git.getCurrentBranch();
        if (branch && branch !== 'main' && branch !== 'master') {
            const branchMatch = branch.match(/^feature-\d+-[a-z]{2}-.+$/);
            if (branchMatch) {
                return { isWorktree: true, instanceName: branch, worktreePath: process.cwd(), serverId: deriveServerIdFromBranch(branch) };
            }
        }
    } catch (e) { /* not in a git repo */ }

    return { isWorktree: false, instanceName: 'main', worktreePath: null, serverId: null };
}

/**
 * Hash a branch name to a port in the dynamic dashboard port range.
 * @param {string} branchName
 * @returns {number} Port number between DASHBOARD_DYNAMIC_PORT_START and DASHBOARD_DYNAMIC_PORT_END
 */
function hashBranchToPort(branchName) {
    let hash = 0;
    for (let i = 0; i < branchName.length; i++) {
        hash = ((hash << 5) - hash + branchName.charCodeAt(i)) | 0;
    }
    const range = DASHBOARD_DYNAMIC_PORT_END - DASHBOARD_DYNAMIC_PORT_START + 1; // 99
    return DASHBOARD_DYNAMIC_PORT_START + (Math.abs(hash) % range);
}

module.exports = {
    // Constants
    DEV_PROXY_DIR,
    DEV_PROXY_REGISTRY,
    DEV_PROXY_LOGS_DIR,
    DEV_PROXY_PID_FILE,
    PORT_REGISTRY_PATH,
    PORT_BLOCK_SIZE,
    PORT_START,
    RESERVED_PORTS,

    // Port/DNS functions
    sanitizeForDns,
    getAppId,
    getAigonServerAppId,
    isPortAvailable,
    allocatePort,
    allocateBasePort,
    isReservedPort,
    reallocatePort,

    // Proxy availability
    isProxyAvailable,
    proxyDiagnostics,

    // Registry functions
    loadProxyRegistry,
    saveProxyRegistry,
    loadPortRegistry,
    savePortRegistry,
    registerPort,
    deregisterPort,
    scanPortsFromFilesystem,

    // Reconcile
    reconcileProxyRoutes,

    // Dev server registration
    registerDevServer,
    deregisterDevServer,
    gcDevServers,
    validateRegistry,
    isProcessAlive,
    isPortInUseSync,
    detectDevServerContext,
    getDevProxyUrl,
    getDevServerLogPath,
    spawnDevServer,
    waitForHealthy,
    openInBrowser,
    deriveServerIdFromBranch,
    detectDashboardContext,

    // Dashboard port utility
    hashBranchToPort,
};
