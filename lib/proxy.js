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
function _getConfiguredServerPort() {
    return require('./config').getConfiguredServerPort();
}

// --- Dev Proxy System ---

const DEV_PROXY_DIR = path.join(os.homedir(), '.aigon', 'dev-proxy');
const DEV_PROXY_LOGS_DIR = path.join(DEV_PROXY_DIR, 'logs');
const CADDYFILE_PATH = path.join(DEV_PROXY_DIR, 'Caddyfile');

// --- Global Port Registry ---
const PORT_REGISTRY_PATH = path.join(os.homedir(), '.aigon', 'ports.json');
const PORT_BLOCK_SIZE = 10; // Each project reserves a block of 10 ports
const PORT_START = 3000;    // First allocatable base port
// Ports never allocated to a project (computed at check-time via getReservedPorts).
// Currently just the aigon server's port, read from config so future configurable-port
// work doesn't need to touch the allocator.
function getReservedPorts() {
    return [_getConfiguredServerPort()];
}

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

// --- Caddy Proxy Management ---

/**
 * Check if Caddy is installed on the system.
 * @returns {boolean}
 */
function isCaddyInstalled() {
    try {
        execSync('which caddy', { stdio: 'pipe', timeout: 3000 });
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Get the HTTP port Caddy is configured to use.
 * Reads from the Caddyfile if it exists, defaults to 4080.
 * @returns {number}
 */
function getCaddyPort() {
    if (fs.existsSync(CADDYFILE_PATH)) {
        try {
            const content = fs.readFileSync(CADDYFILE_PATH, 'utf8');
            const match = content.match(/http_port\s+(\d+)/);
            if (match) return parseInt(match[1], 10);
        } catch (_) {}
    }
    return 4080;
}

/**
 * Check if Caddy is installed and running (admin API on port 2019).
 * @returns {boolean} True if Caddy proxy is available
 */
function isProxyAvailable() {
    if (!isCaddyInstalled()) return false;
    if (!fs.existsSync(CADDYFILE_PATH)) return false;
    try {
        // Caddy's default admin API listens on localhost:2019
        execSync('curl -sf http://localhost:2019/ > /dev/null 2>&1', { stdio: 'pipe', timeout: 2000 });
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Run structured diagnostics on the Caddy proxy.
 * @returns {{ healthy: boolean, proxy: { running: boolean, installed: boolean }, routes: { total: number }, fix: string|null }}
 */
function proxyDiagnostics() {
    const installed = isCaddyInstalled();
    const running = isProxyAvailable();
    const routes = parseCaddyRoutes();

    let fix = null;
    if (!installed) fix = 'brew install caddy  # then: aigon proxy start';
    else if (!running) fix = 'aigon proxy start';

    return {
        healthy: running,
        proxy: { running, installed },
        routes: { total: routes.length },
        fix,
    };
}

/**
 * Parse the Caddyfile to extract route hostname → port mappings.
 * @returns {Array<{hostname: string, port: number, comment: string|null}>}
 */
function parseCaddyRoutes() {
    if (!fs.existsSync(CADDYFILE_PATH)) return [];
    try {
        const content = fs.readFileSync(CADDYFILE_PATH, 'utf8');
        const routes = [];
        // Match comment + site block pairs
        const regex = /(?:# *([^\n]*)\n)?(?:http:\/\/)?([a-z0-9._-]+(?:\.localhost))(?::\d+)?\s*\{[^}]*reverse_proxy\s+localhost:(\d+)[^}]*\}/gi;
        let m;
        while ((m = regex.exec(content)) !== null) {
            routes.push({
                comment: m[1] ? m[1].trim() : null,
                hostname: m[2].toLowerCase(),
                port: parseInt(m[3], 10),
            });
        }
        return routes;
    } catch (_) {
        return [];
    }
}

/**
 * Write the Caddyfile from a list of routes.
 * @param {Array<{hostname: string, port: number, comment: string|null}>} routes
 */
function writeCaddyfile(routes) {
    const caddyPort = getCaddyPort();
    const lines = [
        '{',
        '    auto_https off',
        `    http_port ${caddyPort}`,
        '}',
        '',
    ];
    for (const route of routes) {
        if (route.comment) lines.push(`# ${route.comment}`);
        lines.push(`${route.hostname}:${caddyPort} {`);
        lines.push(`    reverse_proxy localhost:${route.port}`);
        lines.push('}');
        lines.push('');
    }
    fs.mkdirSync(DEV_PROXY_DIR, { recursive: true });
    fs.writeFileSync(CADDYFILE_PATH, lines.join('\n'));
}

/**
 * Add or update a route in the Caddyfile and reload Caddy.
 * @param {string} hostname - e.g. "aigon.localhost" or "cc-119.brewboard.localhost"
 * @param {number} port - backend port
 * @param {string} [comment] - optional comment for the route block
 */
function addCaddyRoute(hostname, port, comment) {
    const routes = parseCaddyRoutes();
    const filtered = routes.filter(r => r.hostname !== hostname);
    filtered.push({ hostname, port, comment: comment || null });
    writeCaddyfile(filtered);
    reloadCaddy();
}

/**
 * Remove a route from the Caddyfile and reload Caddy.
 * @param {string} hostname - hostname to remove
 */
function removeCaddyRoute(hostname) {
    const routes = parseCaddyRoutes();
    const filtered = routes.filter(r => r.hostname !== hostname);
    if (filtered.length !== routes.length) {
        writeCaddyfile(filtered);
        reloadCaddy();
    }
}

/**
 * Reload Caddy's configuration. No-op if Caddy is not running.
 */
function reloadCaddy() {
    if (!isCaddyInstalled()) return;
    try {
        execSync(`caddy reload --config ${JSON.stringify(CADDYFILE_PATH)}`, { stdio: 'pipe', timeout: 5000 });
    } catch (_) {
        // Caddy not running — reload fails silently, route will take effect on next start
    }
}

/**
 * Build the Caddy hostname for a given app/server context.
 * @param {string} appId
 * @param {string|null} serverId
 * @returns {string} e.g. "aigon.localhost" or "cc-119.brewboard.localhost"
 */
function buildCaddyHostname(appId, serverId) {
    if (serverId) return `${serverId}.${appId}.localhost`;
    return `${appId}.localhost`;
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
    for (const reserved of getReservedPorts()) {
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
 * Remove Caddy routes whose backend ports are not in use.
 * Replacement for the old gcDevServers() that cleaned dead entries from servers.json.
 * @returns {number} Number of routes removed
 */
function gcCaddyRoutes() {
    const routes = parseCaddyRoutes();
    let removed = 0;
    const kept = [];
    for (const route of routes) {
        const isPersistentDashboardRoute = !!(route.comment && /^Dashboard(?:[: ]|$)/.test(route.comment));
        if (isPersistentDashboardRoute || isPortInUseSync(route.port)) {
            kept.push(route);
        } else {
            removed++;
        }
    }
    if (removed > 0) {
        writeCaddyfile(kept);
        reloadCaddy();
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
        return e.code === 'EPERM';
    }
}

/**
 * Check if a port is in use (synchronous, uses lsof).
 * @param {number} port
 * @returns {boolean}
 */
function isPortInUseSync(port) {
    try {
        execSync(`lsof -ti tcp:${port}`, { stdio: 'pipe' });
        return true;
    } catch (_e) {
        return false;
    }
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
 * Includes the Caddy port when not 80.
 * @param {string} appId - App identifier
 * @param {string} serverId - Server identifier
 * @returns {string} URL (e.g., "http://cc-119.farline.localhost:4080")
 */
function getDevProxyUrl(appId, serverId) {
    const hostname = buildCaddyHostname(appId, serverId);
    const port = getCaddyPort();
    return port === 80 ? `http://${hostname}` : `http://${hostname}:${port}`;
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
    DEV_PROXY_LOGS_DIR,
    CADDYFILE_PATH,
    PORT_REGISTRY_PATH,
    PORT_BLOCK_SIZE,
    PORT_START,
    getReservedPorts,

    // Port/DNS functions
    sanitizeForDns,
    getAppId,
    getAigonServerAppId,
    isPortAvailable,
    allocatePort,
    allocateBasePort,
    isReservedPort,
    reallocatePort,

    // Caddy proxy management
    isCaddyInstalled,
    isProxyAvailable,
    proxyDiagnostics,
    getCaddyPort,
    parseCaddyRoutes,
    writeCaddyfile,
    addCaddyRoute,
    removeCaddyRoute,
    reloadCaddy,
    buildCaddyHostname,
    gcCaddyRoutes,

    // Port registry
    loadPortRegistry,
    savePortRegistry,
    registerPort,
    deregisterPort,
    scanPortsFromFilesystem,

    // Process/port utilities
    isProcessAlive,
    isPortInUseSync,

    // Dev server functions
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
