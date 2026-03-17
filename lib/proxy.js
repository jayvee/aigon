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
const DEV_PROXY_CADDYFILE = path.join(DEV_PROXY_DIR, 'Caddyfile');
const DEV_PROXY_LOGS_DIR = path.join(DEV_PROXY_DIR, 'logs');

// --- Global Port Registry ---
const PORT_REGISTRY_PATH = path.join(os.homedir(), '.aigon', 'ports.json');

// --- Caddy Admin API ---
const CADDY_ADMIN_URL = 'http://localhost:2019';

// Dashboard port range constants (stable, defined here to avoid circular deps)
const DASHBOARD_DYNAMIC_PORT_START = 4101;
const DASHBOARD_DYNAMIC_PORT_END = 4199;

/**
 * Sanitize a string for use as a DNS label.
 * Lowercase, strip npm scope, replace non-alphanumeric with hyphens.
 * @param {string} name - Raw name
 * @returns {string} DNS-safe label
 */
function sanitizeForDns(name) {
    return name
        .toLowerCase()
        .replace(/^@[^/]+\//, '')          // strip npm scope
        .replace(/[^a-z0-9]+/g, '-')       // replace non-alphanumeric
        .replace(/^-+|-+$/g, '')           // trim leading/trailing hyphens
        .replace(/-{2,}/g, '-');           // collapse multiple hyphens
}

/**
 * Get the app ID for dev proxy URLs.
 * Priority: .aigon/config.json appId > package.json name > main repo dirname (worktree) > dirname
 * @returns {string} DNS-safe app ID
 */
function getAppId() {
    // 1. Explicit config
    const projectConfig = _loadProjectConfig();
    if (projectConfig.appId) return sanitizeForDns(projectConfig.appId);

    // 2. package.json name
    const pkgPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg.name) return sanitizeForDns(pkg.name);
        } catch (e) { /* ignore */ }
    }

    // 3. If in a git worktree, use the main repo's directory name
    // git rev-parse --git-common-dir returns an absolute path in worktrees, relative '.git' in main repo
    try {
        const commonDir = git.getCommonDir();
        if (commonDir && path.isAbsolute(commonDir)) {
            return sanitizeForDns(path.basename(path.dirname(commonDir)));
        }
    } catch (e) { /* not in git */ }

    // 4. Directory name
    return sanitizeForDns(path.basename(process.cwd()));
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
 * Check if the dev proxy (Caddy) is available via the admin API.
 * @returns {boolean} True if Caddy's admin API responds at localhost:2019
 */
function isProxyAvailable() {
    try {
        execSync(`curl -sf --max-time 1 "${CADDY_ADMIN_URL}/config/" > /dev/null 2>&1`, { stdio: 'pipe' });
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Run structured diagnostics on the dev proxy (Caddy + dnsmasq).
 * @returns {{ healthy: boolean, caddy: { installed: boolean, running: boolean, adminApi: boolean }, dnsmasq: { installed: boolean, running: boolean }, routes: { total: number, live: number, stale: number }, fix: string|null }}
 */
function proxyDiagnostics() {
    // Caddy installed?
    let caddyInstalled = false;
    try { execSync('caddy version', { stdio: 'pipe' }); caddyInstalled = true; } catch (e) { /* not installed */ }

    // Caddy admin API responding?
    let caddyAdminApi = false;
    try {
        execSync(`curl -sf --max-time 1 "${CADDY_ADMIN_URL}/config/"`, { stdio: 'pipe' });
        caddyAdminApi = true;
    } catch (e) { /* not responding */ }

    // dnsmasq installed?
    let dnsmasqInstalled = false;
    try { execSync('brew list dnsmasq', { stdio: 'pipe' }); dnsmasqInstalled = true; } catch (e) { /* not installed */ }

    // dnsmasq running?
    let dnsmasqRunning = false;
    try {
        const out = execSync('brew services list', { stdio: 'pipe' }).toString();
        dnsmasqRunning = /dnsmasq\s+started/.test(out);
    } catch (e) { /* can't check */ }

    // Route counts
    const registry = loadProxyRegistry();
    let totalRoutes = 0;
    for (const servers of Object.values(registry)) {
        totalRoutes += Object.keys(servers).length;
    }

    let liveCount = 0;
    let staleCount = 0;
    if (caddyAdminApi) {
        const liveRoutes = getCaddyLiveRoutes();
        liveCount = liveRoutes.size;
        // Stale: in servers.json but not in Caddy live config
        for (const [appId, servers] of Object.entries(registry)) {
            for (const serverId of Object.keys(servers)) {
                const routeId = getCaddyRouteId(appId, serverId);
                if (!liveRoutes.has(routeId)) staleCount++;
            }
        }
    }

    // Determine fix command based on priority
    let fix = null;
    if (!caddyInstalled) {
        fix = 'brew install caddy';
    } else if (!caddyAdminApi) {
        if (!fs.existsSync(DEV_PROXY_CADDYFILE)) {
            fix = 'aigon proxy-setup';
        } else {
            fix = `sudo brew services start caddy`;
        }
    } else if (!dnsmasqRunning) {
        fix = 'sudo brew services start dnsmasq';
    } else if (staleCount > 0) {
        fix = 'aigon proxy-reconcile';
    }

    const healthy = caddyInstalled && caddyAdminApi && dnsmasqRunning && staleCount === 0;

    return {
        healthy,
        caddy: {
            installed: caddyInstalled,
            running: caddyAdminApi,
            adminApi: caddyAdminApi,
        },
        dnsmasq: {
            installed: dnsmasqInstalled,
            running: dnsmasqRunning,
        },
        routes: {
            total: totalRoutes,
            live: liveCount,
            stale: staleCount,
        },
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
        // Conflict if port ranges overlap (each project claims base + 0..4)
        if (Math.abs(entry.basePort - basePort) < 5) {
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
 * Get the @id tag for a Caddy route.
 * @param {string} appId - App identifier
 * @param {string} serverId - Server identifier (empty string for main)
 * @returns {string} Route ID like "aigon-aigon-cc-74" or "aigon-aigon"
 */
function getCaddyRouteId(appId, serverId) {
    return serverId ? `aigon-${appId}-${serverId}` : `aigon-${appId}`;
}

/**
 * Check if Caddy admin API is available.
 * INTERNAL ONLY — not exported.
 * @returns {boolean}
 */
function isCaddyAdminAvailable() {
    try {
        execSync(`curl -sf --max-time 1 "${CADDY_ADMIN_URL}/config/"`, { stdio: 'pipe' });
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Write Caddyfile as a backup/reference without reloading Caddy.
 * INTERNAL ONLY — not exported.
 * @param {Object} registry - Registry object
 */
function writeCaddyfileBackup(registry) {
    if (!fs.existsSync(DEV_PROXY_DIR)) {
        fs.mkdirSync(DEV_PROXY_DIR, { recursive: true });
    }
    fs.writeFileSync(DEV_PROXY_CADDYFILE, generateCaddyfile(registry));
}

/**
 * Add a route to Caddy via the admin API.
 * Falls back to full Caddyfile reload if the admin API is unreachable.
 * INTERNAL ONLY — not exported.
 * @param {string} hostname - Virtual hostname (e.g. "cc-74.aigon.test")
 * @param {number} port - Upstream port
 * @param {string} routeId - @id tag (e.g. "aigon-aigon-cc-74")
 * @returns {boolean} True if the route was applied
 */
function addCaddyRoute(hostname, port, routeId) {
    if (isCaddyAdminAvailable()) {
        const route = {
            '@id': routeId,
            match: [{ host: [hostname] }],
            handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: `localhost:${port}` }] }]
        };
        const tmpFile = path.join(os.tmpdir(), `aigon-caddy-add-${Date.now()}.json`);
        try {
            fs.writeFileSync(tmpFile, JSON.stringify(route));
            execSync(
                `curl -sf -X POST -H "Content-Type: application/json" -d @"${tmpFile}" "${CADDY_ADMIN_URL}/config/apps/http/servers/srv0/routes"`,
                { stdio: 'pipe' }
            );
            writeCaddyfileBackup(loadProxyRegistry());
            return true;
        } catch (e) {
            // Fall through to Caddyfile fallback
        } finally {
            try { fs.unlinkSync(tmpFile); } catch (e2) { /* ignore */ }
        }
    }
    // Fallback: full Caddyfile reload
    return reloadCaddy(loadProxyRegistry());
}

/**
 * Remove a route from Caddy via the admin API.
 * Falls back to full Caddyfile reload if the admin API is unreachable.
 * INTERNAL ONLY — not exported.
 * @param {string} routeId - @id tag to remove (e.g. "aigon-aigon-cc-74")
 * @returns {boolean} True if the route was removed
 */
function removeCaddyRoute(routeId) {
    if (isCaddyAdminAvailable()) {
        try {
            execSync(`curl -sf -X DELETE "${CADDY_ADMIN_URL}/id/${routeId}"`, { stdio: 'pipe' });
            writeCaddyfileBackup(loadProxyRegistry());
            return true;
        } catch (e) {
            // Fall through to Caddyfile fallback
        }
    }
    // Fallback: full Caddyfile reload
    return reloadCaddy(loadProxyRegistry());
}

/**
 * Fetch live routes from Caddy's admin API.
 * @returns {Map<string, Object>} Map from @id to route config for all aigon-* routes
 */
function getCaddyLiveRoutes() {
    const result = new Map();
    try {
        const output = execSync(
            `curl -sf --max-time 2 "${CADDY_ADMIN_URL}/config/apps/http/servers/srv0/routes"`,
            { stdio: 'pipe' }
        ).toString().trim();
        const routes = JSON.parse(output);
        if (Array.isArray(routes)) {
            for (const route of routes) {
                const id = route['@id'];
                if (id) result.set(id, route);
            }
        }
    } catch (e) {
        // Caddy not available or no http config yet — return empty Map
    }
    return result;
}

/**
 * Check if a route ID exists in the proxy registry.
 * @param {Object} registry - Registry object
 * @param {string} routeId - Route ID to look up
 * @returns {boolean}
 */
function registryHasRoute(registry, routeId) {
    for (const [appId, servers] of Object.entries(registry)) {
        for (const serverId of Object.keys(servers)) {
            if (getCaddyRouteId(appId, serverId) === routeId) return true;
        }
    }
    return false;
}

/**
 * Reconcile proxy routes between servers.json and Caddy's live config.
 * - Re-adds routes for alive processes that are missing from Caddy (e.g. after crash/reboot)
 * - Removes orphan Caddy routes (aigon-* prefix but not in servers.json)
 * - Cleans dead entries (PID not running) from servers.json
 * @returns {{ added: number, removed: number, unchanged: number, cleaned: number }}
 */
function reconcileProxyRoutes() {
    if (!isProxyAvailable()) return { added: 0, removed: 0, unchanged: 0, cleaned: 0 };

    const registry = loadProxyRegistry();
    const liveRoutes = getCaddyLiveRoutes();
    const results = { added: 0, removed: 0, unchanged: 0, cleaned: 0 };

    // 1. Check each servers.json entry against live Caddy routes
    for (const [appId, servers] of Object.entries(registry)) {
        for (const [serverId, info] of Object.entries(servers)) {
            const routeId = getCaddyRouteId(appId, serverId);
            const isLive = liveRoutes.has(routeId);

            // Check if process is alive (handle both nested and regular entries)
            let isAlive;
            if (info.service && info.dashboard) {
                const svcAlive = info.service.pid > 0 && isProcessAlive(info.service.pid);
                const dashAlive = info.dashboard.pid > 0 && isProcessAlive(info.dashboard.pid);
                isAlive = svcAlive && dashAlive;
            } else {
                isAlive = info.pid > 0 && isProcessAlive(info.pid);
            }

            if (!isAlive) {
                // Dead process — clean from registry; remove from Caddy if route is live
                delete servers[serverId];
                if (isLive) removeCaddyRoute(routeId);
                results.cleaned++;
            } else if (!isLive) {
                // Process alive but route missing in Caddy — re-add
                const hostname = serverId ? `${serverId}.${appId}.test` : `${appId}.test`;
                const port = info.dashboard ? info.dashboard.port : info.port;
                addCaddyRoute(hostname, port, routeId);
                results.added++;
            } else {
                results.unchanged++;
            }
        }
        // Clean empty app entries
        if (Object.keys(servers).length === 0) delete registry[appId];
    }

    // 2. Remove orphan Caddy routes (aigon-* prefix but not in registry)
    for (const routeId of liveRoutes.keys()) {
        if (routeId.startsWith('aigon-') && !registryHasRoute(registry, routeId)) {
            removeCaddyRoute(routeId);
            results.removed++;
        }
    }

    saveProxyRegistry(registry);
    return results;
}

/**
 * Generate a Caddyfile from the registry.
 * @param {Object} registry - Registry object
 * @returns {string} Caddyfile content
 */
function generateCaddyfile(registry) {
    let caddyfile = '# Auto-generated by aigon — do not edit manually\n';
    caddyfile += '{\n    auto_https off\n}\n';

    for (const [appId, servers] of Object.entries(registry)) {
        if (Object.keys(servers).length === 0) continue;
        caddyfile += `\n# ${appId}\n`;
        for (const [serverId, info] of Object.entries(servers)) {
            const hostname = serverId ? `${serverId}.${appId}.test` : `${appId}.test`;
            // Legacy entries have nested dashboard.port; regular entries have port directly
            const port = info.dashboard ? info.dashboard.port : info.port;
            caddyfile += `http://${hostname} {\n    reverse_proxy localhost:${port}\n}\n`;
        }
    }

    return caddyfile;
}

/**
 * Write Caddyfile and reload Caddy.
 * @param {Object} registry - Registry object to generate from
 * @returns {boolean} True if reload succeeded
 */
function reloadCaddy(registry) {
    if (!fs.existsSync(DEV_PROXY_DIR)) {
        fs.mkdirSync(DEV_PROXY_DIR, { recursive: true });
    }
    const caddyfile = generateCaddyfile(registry);
    fs.writeFileSync(DEV_PROXY_CADDYFILE, caddyfile);

    try {
        // Try admin API reload first (works when Caddy is running)
        execSync(`caddy reload --config "${DEV_PROXY_CADDYFILE}"`, { stdio: 'pipe' });
        return true;
    } catch (e) {
        // Fall back to brew services restart (sudo for port 80)
        try {
            execSync('sudo brew services restart caddy', { stdio: 'pipe' });
            return true;
        } catch (e2) {
            console.warn(`⚠️  Could not reload Caddy: ${e2.message}`);
            return false;
        }
    }
}

/**
 * Register a dev server with the proxy.
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
    const hostname = serverId ? `${serverId}.${appId}.test` : `${appId}.test`;
    const routeId = getCaddyRouteId(appId, serverId);
    addCaddyRoute(hostname, port, routeId);
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
    if (isProxyAvailable()) {
        const routeId = getCaddyRouteId(appId, serverId);
        removeCaddyRoute(routeId);
    }
}

/**
 * Remove registry entries for dead processes.
 * @returns {number} Number of entries removed
 */
function gcDevServers() {
    const registry = loadProxyRegistry();
    let removed = 0;
    const removedRouteIds = [];

    for (const [appId, servers] of Object.entries(registry)) {
        for (const [serverId, info] of Object.entries(servers)) {
            // Legacy entries have nested service/dashboard PIDs
            if (info.service && info.dashboard) {
                const serviceDead = info.service.pid > 0 && !isProcessAlive(info.service.pid);
                const dashboardDead = info.dashboard.pid > 0 && !isProcessAlive(info.dashboard.pid);
                if (serviceDead || dashboardDead) {
                    removedRouteIds.push(getCaddyRouteId(appId, serverId));
                    delete registry[appId][serverId];
                    removed++;
                }
            } else if (info.pid && info.pid > 0) {
                if (!isProcessAlive(info.pid)) {
                    removedRouteIds.push(getCaddyRouteId(appId, serverId));
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
        if (isProxyAvailable()) {
            for (const routeId of removedRouteIds) {
                removeCaddyRoute(routeId);
            }
        }
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
 * @param {string} appId - App identifier
 * @param {string} serverId - Server identifier
 * @returns {string} URL (e.g., "http://cc-119.farline.test")
 */
function getDevProxyUrl(appId, serverId) {
    if (serverId) {
        return `http://${serverId}.${appId}.test`;
    }
    return `http://${appId}.test`;
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
    DEV_PROXY_CADDYFILE,
    DEV_PROXY_LOGS_DIR,
    PORT_REGISTRY_PATH,
    CADDY_ADMIN_URL,

    // Port/DNS functions
    sanitizeForDns,
    getAppId,
    isPortAvailable,
    allocatePort,

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

    // Caddy functions (public)
    getCaddyRouteId,
    getCaddyLiveRoutes,
    registryHasRoute,
    reconcileProxyRoutes,
    generateCaddyfile,
    reloadCaddy,

    // Dev server registration
    registerDevServer,
    deregisterDevServer,
    gcDevServers,
    isProcessAlive,
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
