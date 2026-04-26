'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { readAgentStatus } = require('../agent-status');
const {
    stopDashboardProcess,
    launchDashboardServer,
} = require('../server-runtime');
const { parseCliOptions } = require('../cli-parse');

function resolveCurrentRepoRoot() {
    try {
        return execSync('git rev-parse --show-toplevel', {
            cwd: process.cwd(),
            encoding: 'utf8',
            stdio: 'pipe'
        }).trim();
    } catch (_) {
        return process.cwd();
    }
}

function isAigonRepo(repoPath) {
    if (!repoPath || !fs.existsSync(repoPath)) return false;
    return (
        fs.existsSync(path.join(repoPath, '.aigon')) ||
        fs.existsSync(path.join(repoPath, 'docs', 'specs', 'features'))
    );
}

function autoRegisterRepoIfNeeded(repoPath) {
    if (!isAigonRepo(repoPath)) return;
    const { readConductorReposFromGlobalConfig, writeRepoRegistry } = require('../dashboard-server');
    const repos = readConductorReposFromGlobalConfig();
    const abs = path.resolve(repoPath);
    if (!repos.map(r => path.resolve(r)).includes(abs)) {
        repos.push(abs);
        writeRepoRegistry(repos);
        console.log(`ℹ️  Registered repo: ${abs}`);
    }
}

module.exports = function infraCommands(ctx) {
    const u = ctx.utils;

    const {
        GLOBAL_CONFIG_DIR,
        GLOBAL_CONFIG_PATH,
        DASHBOARD_DYNAMIC_PORT_START,
        PROFILE_PRESETS,
        PROJECT_CONFIG_PATH,
        getEffectiveConfig,
        isProxyAvailable,
        isCaddyInstalled,
        getDevProxyUrl,
        getAigonServerAppId,
        isPortAvailable,
        allocatePort,
        isProcessAlive,
        hashBranchToPort,
        runDashboardServer,
        detectDashboardContext,
        readConductorReposFromGlobalConfig,
        writeRepoRegistry,
        getShellProfile,
        openInBrowser,
        findWorktrees,
        filterByFeatureId,
        buildResearchTmuxSessionName,
        tmuxSessionExists,
        openTerminalAppWithCommand,
        shellQuote,
        openSingleWorktree,
        buildAgentCommand,
        tileITerm2Windows,
        proxyDiagnostics,
        detectProjectProfile,
        getActiveProfile,
        loadProjectConfig,
        saveProjectConfig,
        addCaddyRoute,
        removeCaddyRoute,
        buildCaddyHostname,
        parseCaddyRoutes,
        getCaddyPort,
        CADDYFILE_PATH,
    } = u;

    const {
        displayBoardKanbanView,
        displayBoardListView,
    } = ctx.board;

    const SERVER_APP_ID = getAigonServerAppId();

    /**
     * Check if the AIGON server is running by checking its configured port.
     * Returns a minimal entry object { pid, port } or null.
     */
    function getServerRegistryEntry() {
        const { getConfiguredServerPort } = require('../config');
        const port = getConfiguredServerPort();
        try {
            const pids = require('child_process').execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8', stdio: 'pipe' }).trim();
            if (pids) {
                const pid = parseInt(pids.split('\n')[0], 10);
                return { pid, port };
            }
        } catch (_) {}
        return null;
    }

    function getServerUrl(entry) {
        if (isProxyAvailable()) {
            const hostname = buildCaddyHostname(SERVER_APP_ID, null);
            const route = parseCaddyRoutes().find(r => r.hostname === hostname);
            if (route && (!entry || !entry.port || route.port === entry.port)) {
                return getDevProxyUrl(SERVER_APP_ID, null);
            }
        }
        const { getConfiguredServerPort } = require('../config');
        const port = entry && entry.port ? entry.port : getConfiguredServerPort();
        return `http://localhost:${port}`;
    }

    function fetchServerJson(port, route) {
        const http = require('http');
        return new Promise((resolve, reject) => {
            const req = http.get(`http://127.0.0.1:${port}${route}`, (res) => {
                let body = '';
                res.on('data', chunk => { body += chunk; });
                res.on('end', () => {
                    try {
                        resolve({
                            statusCode: res.statusCode,
                            body: body ? JSON.parse(body) : {},
                        });
                    } catch (error) {
                        reject(error);
                    }
                });
            });
            req.on('error', reject);
            req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
        });
    }

    const commands = {

        'terminal-focus': (args) => {
            // Parse --repo and --research flags from args
            let repoFlag = null;
            let researchMode = false;
            const filteredArgs = [];
            for (let i = 0; i < args.length; i++) {
                if (args[i] === '--repo' && args[i + 1]) {
                    repoFlag = args[i + 1];
                    i++; // skip value
                } else if (args[i].startsWith('--repo=')) {
                    repoFlag = args[i].slice('--repo='.length);
                } else if (args[i] === '--research') {
                    researchMode = true;
                } else {
                    filteredArgs.push(args[i]);
                }
            }

            const entityId = filteredArgs[0];
            if (!entityId) {
                console.error('Usage: aigon terminal-focus <id> [agent] [--repo <path>] [--research]');
                console.error('  Opens or focuses the terminal for a running feature or research agent.');
                return;
            }
            const requestedAgent = filteredArgs[1] || null;

            if (researchMode) {
                if (!requestedAgent) {
                    console.error('Usage: aigon terminal-focus <researchId> <agent> --research [--repo <path>]');
                    console.error('  Research mode requires an agent (e.g. cc, cx, gg).');
                    return;
                }
                const repoPath = repoFlag || process.cwd();
                const repoName = path.basename(repoPath);
                const sessionName = buildResearchTmuxSessionName(entityId, requestedAgent, { repo: repoName });
                if (tmuxSessionExists(sessionName)) {
                    const cmd = `tmux attach-session -t ${shellQuote(sessionName)}`;
                    openTerminalAppWithCommand(repoPath, cmd, sessionName);
                } else {
                    console.error(`❌ No tmux session found: ${sessionName}`);
                    console.error('   Run: aigon research-open <id> to start research sessions.');
                }
                return;
            }

            const featureId = entityId;

            const repoPath = repoFlag || process.cwd();

            // Scan worktrees directory directly (works cross-repo, no git dependency)
            const worktreeBaseDir = path.join(os.homedir(), '.aigon', 'worktrees', path.basename(repoPath));
            const worktrees = [];
            if (fs.existsSync(worktreeBaseDir)) {
                try {
                    fs.readdirSync(worktreeBaseDir).forEach(dirName => {
                        const wtM = dirName.match(/^feature-(\d+)-([a-z]{2})-(.+)$/);
                        if (wtM) {
                            const wtPath = path.join(worktreeBaseDir, dirName);
                            worktrees.push({
                                path: wtPath,
                                featureId: wtM[1],
                                agent: wtM[2],
                                desc: wtM[3],
                                mtime: fs.existsSync(wtPath) ? fs.statSync(wtPath).mtime : new Date(0)
                            });
                        }
                    });
                } catch (e) { /* skip */ } // optional
            }

            // Also try git worktree list if in the right repo
            if (worktrees.length === 0) {
                try {
                    const found = findWorktrees();
                    worktrees.push(...found);
                } catch (e) { /* skip */ } // optional
            }

            const matching = filterByFeatureId(worktrees, featureId);

            if (matching.length > 0) {
                let target;
                if (requestedAgent) {
                    target = matching.find(wt => wt.agent === requestedAgent);
                    if (!target) {
                        console.error(`❌ No worktree found for feature #${featureId} agent ${requestedAgent}`);
                        console.error(`   Available: ${matching.map(wt => wt.agent).join(', ')}`);
                        return;
                    }
                } else {
                    // Pick most recently modified
                    target = matching.sort((a, b) => b.mtime - a.mtime)[0];
                }

                const focusCommand = buildAgentCommand(target);
                openSingleWorktree(target, focusCommand);
                return;
            }

            // No worktree — solo branch mode. Open terminal at repo root.
            const fakeWt = {
                path: repoPath,
                featureId: String(featureId).padStart(2, '0'),
                agent: requestedAgent || 'solo',
                desc: 'branch-mode'
            };
            const fallbackCommand = '';
            openSingleWorktree(fakeWt, fallbackCommand);
        },

        'board': (args) => {
            const flags = new Set(args.filter(a => a.startsWith('--')));
            const listMode = flags.has('--list');
            const showFeatures = flags.has('--features');
            const showResearch = flags.has('--research');
            const showAll = flags.has('--all');
            const showActive = flags.has('--active');
            const showInbox = flags.has('--inbox');
            const showBacklog = flags.has('--backlog');
            const showDone = flags.has('--done');
            const showActions = !flags.has('--no-actions');

            // If neither --features nor --research, show both
            const includeFeatures = !showResearch || showFeatures;
            const includeResearch = !showFeatures || showResearch;

            if (listMode) {
                // Detailed list view
                displayBoardListView({
                    includeFeatures,
                    includeResearch,
                    showAll,
                    showActive,
                    showInbox,
                    showBacklog,
                    showDone,
                    showActions
                });
            } else {
                // Kanban board view
                displayBoardKanbanView({
                    includeFeatures,
                    includeResearch,
                    showAll,
                    showActive,
                    showInbox,
                    showBacklog,
                    showDone,
                    showActions
                });
            }
        },

        'proxy-setup': async () => {
            const installed = isCaddyInstalled();
            const running = isProxyAvailable();
            const port80Available = await isPortAvailable(80);
            console.log('\nProxy Setup — Caddy + .localhost domains (RFC 6761)');
            console.log('────────────────────────────────────────────────────');
            console.log(`  *.localhost resolves to 127.0.0.1 automatically — no DNS config needed.`);
            console.log(`  ${installed ? '✅' : '❌'} Caddy: ${installed ? 'installed' : 'not installed'}`);
            console.log(`  ${running ? '✅' : '��'} Caddy running: ${running ? 'yes' : 'no'}`);
            console.log(`  ${port80Available ? '✅' : '⚠️ '} Port 80: ${port80Available ? 'available' : 'in use (proxy will use port 4080)'}`);
            if (!installed) {
                console.log('\n  Install: brew install caddy');
            } else if (!running) {
                console.log('\n  Start: aigon proxy start');
            }
        },

        'proxy': async (args) => {
            const subcommand = args[0];

            if (subcommand === 'start') {
                if (!isCaddyInstalled()) {
                    console.error('❌ Caddy is not installed.');
                    if (process.platform === 'darwin') {
                        console.error('   Install: brew install caddy');
                    } else {
                        console.error('   Install: https://caddyserver.com/docs/install');
                    }
                    return;
                }
                if (isProxyAvailable()) {
                    console.log('ℹ️  Caddy is already running.');
                    return;
                }
                // Ensure a Caddyfile exists (may be empty if no routes yet)
                const routes = parseCaddyRoutes();
                if (routes.length === 0) {
                    // Write a minimal Caddyfile with just the global block
                    const { writeCaddyfile: writeFn } = u;
                    writeFn([]);
                }
                try {
                    execSync(`caddy start --config ${JSON.stringify(CADDYFILE_PATH)}`, { stdio: 'pipe', timeout: 5000 });
                    const caddyPort = getCaddyPort();
                    const portDisplay = caddyPort === 80 ? '' : `:${caddyPort}`;
                    console.log(`✅ Caddy started on port ${caddyPort}`);
                    console.log(`   Dashboard: http://aigon.localhost${portDisplay}`);
                } catch (e) {
                    console.error(`❌ Caddy failed to start: ${e.message}`);
                }

            } else if (subcommand === 'stop') {
                if (!isProxyAvailable()) {
                    console.log('ℹ️  Caddy is not running.');
                    return;
                }
                try {
                    execSync('caddy stop', { stdio: 'pipe', timeout: 5000 });
                    console.log('✅ Caddy stopped');
                } catch (e) {
                    console.error(`❌ Could not stop Caddy: ${e.message}`);
                }

            } else if (subcommand === 'install') {
                if (!isCaddyInstalled()) {
                    console.error('❌ Caddy is not installed.');
                    if (process.platform === 'darwin') {
                        console.error('   Install first: brew install caddy');
                    } else {
                        console.error('   Install first: https://caddyserver.com/docs/install');
                    }
                    return;
                }
                // Create system LaunchDaemon for auto-start on boot (port 80)
                const plistPath = '/Library/LaunchDaemons/com.aigon.caddy.plist';
                const logPath = path.join(os.homedir(), '.aigon', 'dev-proxy', 'caddy.log');
                // Ensure Caddyfile exists with port 80
                const routes = parseCaddyRoutes();
                const caddyfileContent = [
                    '{',
                    '    auto_https off',
                    '    http_port 80',
                    '}',
                    '',
                ];
                for (const route of routes) {
                    if (route.comment) caddyfileContent.push(`# ${route.comment}`);
                    caddyfileContent.push(`${route.hostname}:80 {`);
                    caddyfileContent.push(`    reverse_proxy localhost:${route.port}`);
                    caddyfileContent.push('}');
                    caddyfileContent.push('');
                }
                const proxyDir = path.join(os.homedir(), '.aigon', 'dev-proxy');
                if (!fs.existsSync(proxyDir)) fs.mkdirSync(proxyDir, { recursive: true });
                fs.writeFileSync(CADDYFILE_PATH, caddyfileContent.join('\n'));

                let caddyPath;
                try {
                    caddyPath = execSync('which caddy', { encoding: 'utf8', stdio: 'pipe' }).trim();
                } catch (_) {
                    console.error('❌ Could not find caddy binary');
                    return;
                }

                const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.aigon.caddy</string>
    <key>ProgramArguments</key>
    <array>
        <string>${caddyPath}</string>
        <string>run</string>
        <string>--config</string>
        <string>${CADDYFILE_PATH}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${os.homedir()}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>${logPath}</string>
</dict>
</plist>`;
                const tmpPlist = path.join(os.tmpdir(), 'com.aigon.caddy.plist');
                fs.writeFileSync(tmpPlist, plist);
                try {
                    try { execSync('sudo launchctl unload ' + plistPath + ' 2>/dev/null', { stdio: 'pipe' }); } catch (_) {}
                    execSync(`sudo cp ${tmpPlist} ${plistPath}`, { stdio: 'inherit' });
                    execSync(`sudo launchctl load ${plistPath}`, { stdio: 'inherit' });
                    console.log(`\n✅ Caddy installed as system daemon on port 80`);
                    console.log(`   http://aigon.localhost — your dashboard`);
                    console.log(`   Starts automatically on boot, restarts if it crashes.`);
                    console.log(`\n   Uninstall: aigon proxy uninstall`);
                } catch (e) {
                    console.error('❌ Failed to install. Run with sudo access available.');
                    console.error('   Manual install:');
                    console.error(`   sudo cp ${tmpPlist} ${plistPath}`);
                    console.error(`   sudo launchctl load ${plistPath}`);
                }
                try { fs.unlinkSync(tmpPlist); } catch (_) {}

            } else if (subcommand === 'uninstall') {
                const plistPath = '/Library/LaunchDaemons/com.aigon.caddy.plist';
                try {
                    execSync('sudo launchctl unload ' + plistPath, { stdio: 'inherit' });
                    execSync('sudo rm ' + plistPath, { stdio: 'inherit' });
                    console.log('✅ Caddy proxy uninstalled');
                } catch (e) {
                    console.error('❌ Failed to uninstall. Check if plist exists: ' + plistPath);
                }

            } else if (subcommand === 'status') {
                const installed = isCaddyInstalled();
                const running = isProxyAvailable();
                console.log(`Caddy: ${installed ? 'installed' : '❌ not installed'}`);
                console.log(`Status: ${running ? '✅ running' : '❌ not running'}`);
                if (running) {
                    const caddyPort = getCaddyPort();
                    console.log(`Port: ${caddyPort}`);
                    const routes = parseCaddyRoutes();
                    if (routes.length > 0) {
                        console.log(`Routes: ${routes.length}`);
                        for (const route of routes) {
                            const label = route.comment ? ` (${route.comment})` : '';
                            console.log(`  ${route.hostname} → localhost:${route.port}${label}`);
                        }
                    }
                }

            } else {
                console.log('Usage: aigon proxy <start|stop|install|uninstall|status>');
                console.log('  start      — start Caddy (port 4080)');
                console.log('  stop       — stop Caddy');
                console.log('  install    — install as system daemon on port 80 (one-time, needs sudo)');
                console.log('  uninstall  — remove system daemon');
                console.log('  status     — show Caddy status and routes');
                console.log('');
                console.log('After install, http://aigon.localhost just works — forever.');
            }
        },

        'dev-server': async (args) => {
            const {
                detectDevServerContext,
                isProxyAvailable: isProxyAvailableFn,
                loadProjectConfig: loadProjectConfigFn,
                getActiveProfile: getActiveProfileFn,
                allocatePort: allocatePortFn,
                addCaddyRoute: addCaddyRouteFn,
                removeCaddyRoute: removeCaddyRouteFn,
                buildCaddyHostname: buildCaddyHostnameFn,
                parseCaddyRoutes: parseCaddyRoutesFn,
                getDevProxyUrl: getDevProxyUrlFn,
                getDevServerLogPath,
                spawnDevServer,
                waitForHealthy,
                openInBrowser: openInBrowserFn,
                isProcessAlive: isProcessAliveFn,
                isPortInUseSync: isPortInUseSyncFn,
                resolveDevServerUrl,
                proxyDiagnostics: proxyDiagnosticsFn,
            } = u;

            const subcommand = args[0];

            if (subcommand === 'start') {
                const registerOnly = args.includes('--register-only');
                const autoOpen = args.includes('--open');
                const context = detectDevServerContext();
                const proxyAvailable = isProxyAvailableFn();
                const projectConfig = loadProjectConfigFn();
                const profile = getActiveProfileFn();

                // Determine preferred port — explicit config > registry > error
                const devProxy = projectConfig.devProxy || {};
                let basePort = devProxy.basePort;
                if (!basePort) {
                    // Fall back to global port registry
                    const { loadPortRegistry: loadPortRegistryFn } = u;
                    const portRegistry = loadPortRegistryFn();
                    const projectName = path.basename(process.cwd());
                    const registryEntry = portRegistry[projectName] || Object.values(portRegistry).find(e => e.path === process.cwd());
                    if (registryEntry) {
                        basePort = registryEntry.basePort;
                    } else {
                        console.error('❌ No basePort configured. Run `aigon init` or set PORT in .env or devProxy.basePort in .aigon/config.json');
                        return;
                    }
                }
                const agentOffsets = require('../agent-registry').getPortOffsets();
                const offset = context.agentId ? (agentOffsets[context.agentId] || 0) : 0;

                // Check for explicit --port flag
                const portFlagIdx = args.indexOf('--port');
                let preferredPort;
                if (portFlagIdx !== -1 && args[portFlagIdx + 1]) {
                    preferredPort = parseInt(args[portFlagIdx + 1], 10);
                } else {
                    preferredPort = basePort + offset;
                }

                // Kill any existing server on the preferred port (kill-and-replace)
                const existingPid = (() => { try { return require('child_process').execSync(`lsof -ti :${preferredPort}`, { encoding: 'utf8' }).trim(); } catch (_) { return ''; } })();
                if (existingPid) {
                    existingPid.split('\n').filter(Boolean).forEach(pid => {
                        try { process.kill(parseInt(pid, 10), 'SIGTERM'); } catch (_) { /* ignore */ }
                    });
                    // Brief wait for port release
                    await new Promise(r => setTimeout(r, 500));
                    console.log(`⚠️  Killed existing process on port ${preferredPort} (PID ${existingPid.split('\n')[0]})`);
                }

                // Allocate port
                let port;
                try {
                    port = await allocatePortFn(preferredPort);
                } catch (e) {
                    console.error(`❌ ${e.message}`);
                    return;
                }

                // Write PORT to .env.local
                const envLocalPath = path.join(process.cwd(), '.env.local');
                let envContent = '';
                if (fs.existsSync(envLocalPath)) {
                    envContent = fs.readFileSync(envLocalPath, 'utf8');
                    // Replace existing PORT line
                    if (envContent.match(/^PORT=\d+/m)) {
                        envContent = envContent.replace(/^PORT=\d+/m, `PORT=${port}`);
                    } else {
                        envContent = envContent.trimEnd() + `\nPORT=${port}\n`;
                    }
                } else {
                    envContent = `PORT=${port}\n`;
                }
                fs.writeFileSync(envLocalPath, envContent);

                const startCmd = devProxy.command || 'npm run dev';
                // Use proxy if Caddy is available AND either: profile enables devServer, OR
                // an explicit devProxy command is configured in .aigon/config.json
                const useProxy = proxyAvailable && (
                    (profile.devServer && profile.devServer.enabled) ||
                    !!devProxy.command
                );
                const url = useProxy ? getDevProxyUrlFn(context.appId, context.serverId) : `http://localhost:${port}`;
                const logPath = getDevServerLogPath(context.appId, context.serverId);
                const healthCheckPath = devProxy.healthCheck || '/';
                const healthUrl = `http://localhost:${port}${healthCheckPath}`;

                if (useProxy) {
                    // Add Caddy route for this dev server
                    const hostname = buildCaddyHostnameFn(context.appId, context.serverId || null);
                    const comment = context.serverId ? `Dev server: ${context.serverId}.${context.appId}` : `Dev server: ${context.appId}`;
                    addCaddyRouteFn(hostname, port, comment);
                }

                if (!registerOnly) {
                    // Spawn the dev server process
                    console.log(`\n⏳ Starting dev server: ${startCmd}`);
                    const pid = spawnDevServer(startCmd, port, logPath, process.cwd());

                    // Wait for health check
                    process.stdout.write(`   Waiting for server on port ${port}...`);
                    let healthy = await waitForHealthy(healthUrl);

                    // Auto-install deps if server died due to missing modules
                    if (!healthy && !isProcessAliveFn(pid)) {
                        let logContent = '';
                        try { logContent = fs.readFileSync(logPath, 'utf8'); } catch (_) {}
                        const needsDeps = /command not found|MODULE_NOT_FOUND|Cannot find module/.test(logContent);
                        if (needsDeps) {
                            console.log(' deps missing — installing...');
                            try {
                                const { execSync } = require('child_process');
                                execSync('npm install', { cwd: process.cwd(), stdio: 'pipe', timeout: 120000 });
                                console.log(`   ✓ npm install complete`);
                                // Retry: spawn again and wait
                                spawnDevServer(startCmd, port, logPath, process.cwd());
                                process.stdout.write(`   Retrying on port ${port}...`);
                                healthy = await waitForHealthy(healthUrl);
                            } catch (e) {
                                console.log(`   ⚠️  npm install failed: ${e.message}`);
                            }
                        }
                    }

                    if (healthy) {
                        console.log(' ready!');
                        if (autoOpen) {
                            openInBrowserFn(url);
                        }
                    } else {
                        console.log(' (timeout — server may still be starting)');
                        console.log(`   Check logs: aigon dev-server logs`);
                    }

                    if (useProxy) {
                        console.log(`\n🌐 Dev server running`);
                        console.log(`   URL:  ${url}`);
                        console.log(`   Port: ${port}  PID: ${pid}`);
                        if (context.serverId) {
                            console.log(`   ID:   ${context.serverId} (${context.appId})`);
                        }
                        console.log(`   Logs: aigon dev-server logs`);
                        console.log(`\n   Open: ${url}\n`);
                    } else {
                        console.log(`\n📡 Dev server running (localhost — proxy unavailable)`);
                        console.log(`   URL:  ${url}`);
                        console.log(`   Port: ${port}  PID: ${pid}`);
                        const diag = proxyDiagnosticsFn();
                        if (diag.fix) {
                            console.log(`\n   ⚠️  Proxy: ${diag.fix}`);
                            console.log(`   Expected URL: ${getDevProxyUrlFn(context.appId, context.serverId)}`);
                        }
                        console.log(`   Logs: aigon dev-server logs`);
                        console.log(`\n   Open: ${url}\n`);
                    }
                } else {
                    // Register-only mode (manual process management)
                    if (useProxy) {
                        console.log(`\n🌐 Dev server registered with proxy`);
                        console.log(`   URL:  ${url}`);
                        console.log(`   Port: ${port}`);
                        if (context.serverId) {
                            console.log(`   ID:   ${context.serverId} (${context.appId})`);
                        }
                        console.log(`\n   Start your dev server: PORT=${port} ${startCmd}`);
                        console.log(`   Then open: ${url}\n`);
                    } else {
                        console.log(`\n📡 Dev server configured`);
                        console.log(`   Port: ${port}`);
                        console.log(`   URL:  ${url}`);
                        if (!proxyAvailable) {
                            console.log(`\n   💡 Run \`aigon proxy-setup\` for subdomain routing (e.g., ${getDevProxyUrlFn(context.appId, context.serverId)})`);
                        }
                        console.log(`\n   Start your dev server: PORT=${port} ${startCmd}\n`);
                    }
                }

            } else if (subcommand === 'stop') {
                const serverId = args[1];
                const context = detectDevServerContext();
                const targetServerId = serverId || context.serverId;
                const appId = context.appId;

                if (!targetServerId && targetServerId !== '') {
                    console.error('❌ Could not detect server ID. Specify it: aigon dev-server stop <serverId>');
                    console.error('   Run `aigon dev-server list` to see active servers.');
                    return;
                }

                // Kill any process on the port for this route
                const hostname = buildCaddyHostnameFn(appId, targetServerId || null);
                const route = parseCaddyRoutesFn().find(r => r.hostname === hostname);
                let stopPort = route && route.port ? route.port : null;
                if (!stopPort) {
                    const envLocalPath = path.join(process.cwd(), '.env.local');
                    if (fs.existsSync(envLocalPath)) {
                        const envMatch = fs.readFileSync(envLocalPath, 'utf8').match(/^PORT=(\d+)/m);
                        if (envMatch) stopPort = parseInt(envMatch[1], 10);
                    }
                }
                if (!stopPort && targetServerId) {
                    const agentMatch = String(targetServerId).match(/^([a-z]{2,4})-\d+$/);
                    if (agentMatch) {
                        const projectConfig = loadProjectConfigFn();
                        let basePort = projectConfig.devProxy && projectConfig.devProxy.basePort;
                        if (!basePort) {
                            const { loadPortRegistry: loadPortRegistryFn } = u;
                            const portRegistry = loadPortRegistryFn();
                            const projectName = path.basename(process.cwd());
                            const registryEntry = portRegistry[projectName] || Object.values(portRegistry).find(e => e.path === process.cwd());
                            if (registryEntry) basePort = registryEntry.basePort;
                        }
                        if (basePort) {
                            const agentOffsets = require('../agent-registry').getPortOffsets();
                            stopPort = basePort + (agentOffsets[agentMatch[1]] || 0);
                        }
                    }
                }

                let stoppedProcess = false;
                if (stopPort) {
                    try {
                        const pids = require('child_process').execSync(`lsof -ti tcp:${stopPort}`, { encoding: 'utf8', stdio: 'pipe' }).trim();
                        if (pids) {
                            pids.split('\n').filter(Boolean).forEach(p => {
                                try { process.kill(parseInt(p, 10), 'SIGTERM'); } catch (_) {}
                            });
                            stoppedProcess = true;
                            console.log(`   Stopped process on port ${stopPort}`);
                        }
                    } catch (_) { /* port not in use */ }
                }

                if (route) {
                    removeCaddyRouteFn(hostname);
                }
                if (stoppedProcess || route) {
                    console.log(`✅ Stopped and removed route for ${hostname}`);
                } else {
                    console.log(`ℹ️  No running dev server found for ${hostname}`);
                }

            } else if (subcommand === 'list') {
                const routes = parseCaddyRoutesFn();

                if (routes.length === 0) {
                    console.log('\nNo Caddy routes configured.\n');
                    console.log('   Start a dev server: aigon dev-server start');
                    return;
                }

                const caddyPort = getCaddyPort();
                console.log(`\n   HOSTNAME                            PORT   BACKEND   STATUS`);
                console.log('   ' + '─'.repeat(65));
                for (const route of routes) {
                    const portDisplay = caddyPort === 80 ? '' : `:${caddyPort}`;
                    const url = `http://${route.hostname}${portDisplay}`;
                    const alive = isPortInUseSyncFn(route.port);
                    const status = alive ? '✅ up' : '⚠️  502';
                    const label = route.comment ? ` (${route.comment})` : '';
                    console.log(`   ${route.hostname.padEnd(38)} ${String(route.port).padEnd(6)} ${(`localhost:${route.port}`).padEnd(9)} ${status}${label}`);
                }
                console.log('');

            } else if (subcommand === 'gc') {
                // With Caddy, routes are persistent and don't need GC.
                // Remove routes whose backends are down if the user wants cleanup.
                const routes = parseCaddyRoutesFn();
                let removed = 0;
                for (const route of routes) {
                    if (route.comment && /^Dashboard(?:[: ]|$)/.test(route.comment)) {
                        continue;
                    }
                    if (!isPortInUseSyncFn(route.port)) {
                        removeCaddyRouteFn(route.hostname);
                        removed++;
                    }
                }
                if (removed > 0) {
                    console.log(`✅ Removed ${removed} route${removed === 1 ? '' : 's'} with no running backend`);
                } else {
                    console.log('All routes have active backends.');
                }

            } else if (subcommand === 'logs') {
                const serverId = args[1];
                const context = detectDevServerContext();
                const targetServerId = serverId || context.serverId;
                const appId = context.appId;
                const logPath = u.getDevServerLogPath(appId, targetServerId);

                if (!fs.existsSync(logPath)) {
                    console.error(`No log file found at ${logPath}`);
                    console.error('   The dev server may not have been started with `aigon dev-server start`.');
                    return;
                }

                // Check for --follow / -f flag
                const follow = args.includes('--follow') || args.includes('-f');
                // Check for --tail / -n flag
                const tailIdx = args.indexOf('--tail');
                const nIdx = args.indexOf('-n');
                const tailLines = tailIdx !== -1 ? parseInt(args[tailIdx + 1], 10) : (nIdx !== -1 ? parseInt(args[nIdx + 1], 10) : 50);

                if (follow) {
                    // Use tail -f to follow logs (blocks until Ctrl+C)
                    const { spawn: spawnFollow } = require('child_process');
                    const tail = spawnFollow('tail', ['-f', '-n', String(tailLines), logPath], {
                        stdio: 'inherit'
                    });
                    tail.on('exit', () => process.exit(0));
                    // Handle Ctrl+C gracefully
                    process.on('SIGINT', () => { tail.kill(); process.exit(0); });
                } else {
                    // Print last N lines
                    const content = fs.readFileSync(logPath, 'utf8');
                    const lines = content.split('\n');
                    const start = Math.max(0, lines.length - tailLines);
                    console.log(lines.slice(start).join('\n'));
                }

            } else if (subcommand === 'url') {
                const context = detectDevServerContext();
                const proxyAvailable = isProxyAvailable();
                console.log(u.resolveDevServerUrl(context, proxyAvailable));

            } else if (subcommand === 'open') {
                const context = detectDevServerContext();
                const proxyAvailable = isProxyAvailable();
                const url = u.resolveDevServerUrl(context, proxyAvailable);

                console.log(`🌐 Opening ${url}`);
                openInBrowser(url);

            } else {
                console.error(`Usage: aigon dev-server <start|stop|list|logs|gc|url|open>`);
                console.error(`\n  start [--port N] [--open]  - Start dev server, register with proxy`);
                console.error(`  start --register-only      - Register port mapping only (don't start process)`);
                console.error(`  stop [serverId]            - Stop process and deregister from proxy`);
                console.error(`  open                       - Open dev server URL in default browser`);
                console.error(`  list                       - Show all active dev servers`);
                console.error(`  logs [-f] [-n N]           - Show dev server output (default: last 50 lines)`);
                console.error(`  gc                         - Remove entries for dead processes`);
                console.error(`  url                        - Print URL for current context (for scripting)`);
            }
        },

        'config': (args) => {
            const {
                parseConfigScope,
                loadGlobalConfig,
                saveGlobalConfig,
                loadProjectConfig: loadProjectConfigFn,
                saveProjectConfig: saveProjectConfigFn,
                setNestedValue,
                getConfigValueWithProvenance,
                getEffectiveConfig: getEffectiveConfigFn,
                getAvailableAgents,
                loadAgentConfig,
                getModelProvenance,
                getAgentCliConfig,
                GLOBAL_CONFIG_PATH: GCPATH,
                PROJECT_CONFIG_PATH: PCPATH,
                DEFAULT_SECURITY_CONFIG,
                DEFAULT_GLOBAL_CONFIG,
                PROFILE_PRESETS: PP,
                detectProjectProfile: detectProjectProfileFn,
            } = u;

            const subcommand = args[0];

            if (subcommand === 'init') {
                const { scope } = parseConfigScope(args.slice(1));

                if (scope === 'global') {
                    // Create global config file
                    if (!fs.existsSync(GLOBAL_CONFIG_DIR)) {
                        fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
                    }

                    if (fs.existsSync(GCPATH)) {
                        console.log(`ℹ️  Config already exists: ${GCPATH}`);
                        console.log(`   Edit it to customize agent CLI commands.`);
                        return;
                    }

                    fs.writeFileSync(GCPATH, JSON.stringify(DEFAULT_GLOBAL_CONFIG, null, 2));
                    console.log(`✅ Created: ${GCPATH}`);
                    console.log(`\n   The config includes default "yolo mode" flags that auto-approve commands.`);
                    console.log(`   To use stricter permissions, set implementFlag to "" (empty string) for any agent.`);
                    console.log(`\n   You can customize:`);
                    const _terminalIds = getTerminalConfigHelpIds().join(', ');
                    console.log(`   - terminalApp: Terminal app for tmux sessions (${_terminalIds})`);
                    console.log(`   - agents.{id}.cli: Override CLI command for each agent`);
                    console.log(`   - agents.{id}.implementFlag: Override CLI flags (set to "" to require manual approval)`);
                    console.log(`\n   Example (corporate/safer defaults - removes auto-approval flags):`);
                    console.log(`   {`);
                    console.log(`     "terminalApp": "warp",          // ${_terminalIds}`);
                    console.log(`     "agents": {`);
                    console.log(`       "cc": { "cli": "claude", "implementFlag": "" },`);
                    console.log(`       "cu": { "cli": "agent", "implementFlag": "" },`);
                    console.log(`       "gg": { "cli": "gemini", "implementFlag": "" },`);
                    console.log(`       "cx": { "cli": "codex", "implementFlag": "" }`);
                    console.log(`     }`);
                    console.log(`   }`);
                    console.log(`\n   Default flags (can be overridden):`);
                    console.log(`   - cc: --permission-mode acceptEdits`);
                    console.log(`   - cu: --force`);
                    console.log(`   - gg: --yolo`);
                    console.log(`   - cx: (none; interactive by default, --full-auto is applied only in --iterate mode)`);
                } else {
                    // Create project config file with detected profile
                    const detectedProfile = detectProjectProfileFn();
                    const projectConfig = {
                        profile: detectedProfile,
                        security: { ...DEFAULT_SECURITY_CONFIG },
                    };

                    if (fs.existsSync(PCPATH)) {
                        console.log(`ℹ️  Config already exists: ${PCPATH}`);
                        console.log(`   Edit it to customize project settings.`);
                        return;
                    }

                    saveProjectConfigFn(projectConfig);
                    console.log(`✅ Created: ${PCPATH}`);
                    console.log(`\n   Profile: ${detectedProfile} (auto-detected)`);
                    console.log(`\n   You can customize:`);
                    console.log(`   - profile: Project profile (web, api, ios, android, library, generic)`);
                    console.log(`   - security.enabled: Toggle local security checks`);
                    console.log(`   - security.mode: enforce | warn | off`);
                    console.log(`   - security.stages: Hook stages to run scanners (e.g. pre-commit)`);
                    console.log(`   - security.scanners: Enabled scanner IDs`);
                    console.log(`   - fleet.testInstructions: Custom test instructions`);
                    console.log(`   - agents.{id}.cli: Override CLI command for each agent`);
                    console.log(`   - agents.{id}.implementFlag: Override CLI flags`);
                    console.log(`\n💡 Run 'aigon update' to regenerate templates with the new profile.`);
                }
            } else if (subcommand === 'set') {
                const { scope, remainingArgs } = parseConfigScope(args.slice(1));

                if (remainingArgs.length < 2) {
                    console.error(`Usage: aigon config set [--global|--project] <key> <value>`);
                    console.error(`\n  --global   - Set in global config (~/.aigon/config.json)`);
                    console.error(`  --project   - Set in project config (.aigon/config.json) [default]`);
                    console.error(`\n  Examples:`);
                    console.error(`    aigon config set profile web`);
                    console.error(`    aigon config set --global terminalApp warp`);
                    console.error(`    aigon config set fleet.testInstructions "run npm test"`);
                    return;
                }

                const key = remainingArgs[0];
                const value = remainingArgs.slice(1).join(' '); // Join remaining args in case value has spaces

                // Try to parse as JSON if it looks like JSON, otherwise treat as string
                let parsedValue = value;
                if ((value.startsWith('{') && value.endsWith('}')) ||
                    (value.startsWith('[') && value.endsWith(']'))) {
                    try {
                        parsedValue = JSON.parse(value);
                    } catch (e) {
                        // Not valid JSON, use as string
                    }
                } else if (value === 'true') {
                    parsedValue = true;
                } else if (value === 'false') {
                    parsedValue = false;
                } else if (value === 'null') {
                    parsedValue = null;
                } else if (/^-?\d+$/.test(value)) {
                    parsedValue = parseInt(value, 10);
                } else if (/^-?\d+\.\d+$/.test(value)) {
                    parsedValue = parseFloat(value);
                }

                if (scope === 'global') {
                    const config = loadGlobalConfig();
                    setNestedValue(config, key, parsedValue);
                    saveGlobalConfig(config);
                    console.log(`✅ Set ${key} = ${JSON.stringify(parsedValue)}`);
                    console.log(`   Saved to: ${GCPATH}`);
                } else {
                    const config = loadProjectConfigFn();
                    setNestedValue(config, key, parsedValue);
                    saveProjectConfigFn(config);
                    console.log(`✅ Set ${key} = ${JSON.stringify(parsedValue)}`);
                    console.log(`   Saved to: ${PCPATH}`);
                }
            } else if (subcommand === 'get') {
                if (args.length < 2) {
                    console.error(`Usage: aigon config get <key>`);
                    console.error(`\n  Examples:`);
                    console.error(`    aigon config get profile`);
                    console.error(`    aigon config get terminalApp`);
                    console.error(`    aigon config get fleet.testInstructions`);
                    return;
                }

                const key = args[1];
                const result = getConfigValueWithProvenance(key);

                if (result.value === undefined) {
                    console.log(`❌ Config key "${key}" not found`);
                    return;
                }

                const valueStr = typeof result.value === 'string' ? result.value : JSON.stringify(result.value);
                let sourceStr;
                if (result.source === 'project') {
                    sourceStr = `.aigon/config.json`;
                } else if (result.source === 'global') {
                    sourceStr = `~/.aigon/config.json`;
                } else {
                    sourceStr = `default`;
                }

                console.log(`${valueStr} (from ${sourceStr})`);
            } else if (subcommand === 'show') {
                // For 'show', check flags directly (don't default to project - default to merged)
                const hasGlobal = args.slice(1).includes('--global');
                const hasProject = args.slice(1).includes('--project');

                if (hasGlobal) {
                    const config = loadGlobalConfig();
                    console.log(`\n📋 Global Configuration (~/.aigon/config.json):\n`);
                    console.log(JSON.stringify(config, null, 2));
                    console.log(`\n   Config file: ${GCPATH}`);
                    console.log(`   Exists: ${fs.existsSync(GCPATH) ? 'yes' : 'no (using defaults)'}`);
                } else if (hasProject) {
                    const config = loadProjectConfigFn();
                    console.log(`\n📋 Project Configuration (.aigon/config.json):\n`);
                    if (Object.keys(config).length === 0) {
                        console.log(`   (empty - using auto-detection)`);
                    } else {
                        console.log(JSON.stringify(config, null, 2));
                    }
                    console.log(`\n   Config file: ${PCPATH}`);
                    console.log(`   Exists: ${fs.existsSync(PCPATH) ? 'yes' : 'no (using auto-detection)'}`);
                } else {
                    // Show merged effective config (default for 'show')
                    const effectiveConfig = getEffectiveConfigFn();

                    console.log(`\n📋 Effective Configuration (merged from all levels):\n`);
                    console.log(JSON.stringify(effectiveConfig, null, 2));
                    console.log(`\n   Precedence: project > global > defaults`);
                    console.log(`\n   Project config: ${PCPATH}`);
                    console.log(`   ${fs.existsSync(PCPATH) ? '✅ exists' : '❌ not found (using auto-detection)'}`);
                    console.log(`\n   Global config: ${GCPATH}`);
                    console.log(`   ${fs.existsSync(GCPATH) ? '✅ exists' : '❌ not found (using defaults)'}`);
                }
            } else if (subcommand === 'models') {
                const agents = getAvailableAgents();
                const taskTypes = ['research', 'implement', 'evaluate'];
                // Agents without --model CLI flag support
                const noModelFlag = new Set(['cu']);

                const rows = [];
                for (const agentId of agents) {
                    const agentConfig = loadAgentConfig(agentId);
                    if (!agentConfig) continue;

                    for (const taskType of taskTypes) {
                        const provenance = getModelProvenance(agentId, taskType);
                        let model, source;
                        if (noModelFlag.has(agentId)) {
                            model = '(n/a — no CLI flag)';
                            source = '-';
                        } else if (provenance.source === 'none') {
                            model = '(not set)';
                            source = '-';
                        } else {
                            model = provenance.value;
                            source = provenance.source;
                        }
                        rows.push({ agent: agentId, task: taskType, model, source });
                    }
                }

                // Calculate column widths
                const colAgent = Math.max(5, ...rows.map(r => r.agent.length));
                const colTask = Math.max(10, ...rows.map(r => r.task.length));
                const colModel = Math.max(5, ...rows.map(r => r.model.length));
                const colSource = Math.max(6, ...rows.map(r => r.source.length));

                console.log(`\nModel Configuration (resolved):\n`);
                console.log(`  ${'AGENT'.padEnd(colAgent + 2)}${'TASK'.padEnd(colTask + 2)}${'MODEL'.padEnd(colModel + 2)}SOURCE`);
                console.log(`  ${'─'.repeat(colAgent)}  ${'─'.repeat(colTask)}  ${'─'.repeat(colModel)}  ${'─'.repeat(colSource)}`);

                for (const row of rows) {
                    console.log(`  ${row.agent.padEnd(colAgent + 2)}${row.task.padEnd(colTask + 2)}${row.model.padEnd(colModel + 2)}${row.source}`);
                }

                console.log(`\n  Precedence: env var > project config > global config > built-in default`);
                console.log(`  Env var pattern: AIGON_{AGENT}_{TASK}_MODEL (e.g. AIGON_CC_RESEARCH_MODEL=haiku)`);
            } else if (subcommand === 'restore') {
                const {
                    GLOBAL_CONFIG_BACKUP_DIR: backupDir,
                    GLOBAL_CONFIG_BACKUP_LATEST_PATH: latestBackup,
                } = u;

                if (!fs.existsSync(backupDir)) {
                    console.log('No backups found.');
                    return;
                }

                const backups = fs.readdirSync(backupDir)
                    .filter(f => f.startsWith('config.') && f.endsWith('.json'))
                    .sort()
                    .reverse();

                if (backups.length === 0) {
                    console.log('No backups found.');
                    return;
                }

                console.log('Available backups:');
                backups.forEach((f, i) => {
                    const label = f === 'config.latest.json' ? ' (latest)' : '';
                    console.log(`  ${i + 1}. ${f}${label}`);
                });

                const restoreFrom = args[1]
                    ? path.join(backupDir, args[1])
                    : latestBackup;

                if (!fs.existsSync(restoreFrom)) {
                    console.error(`❌ Backup not found: ${restoreFrom}`);
                    return;
                }

                try {
                    const content = fs.readFileSync(restoreFrom, 'utf8');
                    JSON.parse(content); // validate
                    fs.writeFileSync(GCPATH, content);
                    console.log(`✅ Restored from: ${path.basename(restoreFrom)}`);
                } catch (e) {
                    console.error(`❌ Failed to restore: ${e.message}`);
                }
            } else {
                console.error(`Usage: aigon config <init|set|get|show|models|restore>`);
                console.error(`\n  init [--global]     - Initialize config (project by default, --global for user-wide)`);
                console.error(`  set [--global] <key> <value>`);
                console.error(`                       - Set config value (project by default)`);
                console.error(`  get <key>           - Get config value with provenance`);
                console.error(`  show [--global|--project]`);
                console.error(`                       - Show config (merged by default, --global or --project for specific level)`);
                console.error(`  models              - Show resolved model configuration for all agents`);
                console.error(`  restore [file]      - Restore global config from backup`);
                console.error(`\n  Examples:`);
                console.error(`    aigon config init                    # Create project config`);
                console.error(`    aigon config init --global           # Create global config`);
                console.error(`    aigon config set profile web        # Set project profile`);
                console.error(`    aigon config set --global terminalApp warp`);
                console.error(`    aigon config get profile             # Show value + source`);
                console.error(`    aigon config show                   # Show merged config`);
                console.error(`    aigon config show --project         # Show project config only`);
                console.error(`    aigon config models                 # Show model config for all agents`);
                console.error(`    aigon config restore                # Restore from latest backup`);
            }
        },

        'hooks': (args) => {
            const { getDefinedHooks } = ctx.hooks;
            const subcommand = args[0] || 'list';

            if (subcommand === 'list') {
                const hooks = getDefinedHooks();

                if (hooks.length === 0) {
                    console.log(`\n🪝 No hooks defined.`);
                    console.log(`\n   Create hooks in: docs/aigon-hooks.md`);
                    console.log(`\n   Example format:`);
                    console.log(`   ## pre-feature-start`);
                    console.log(`   \`\`\`bash`);
                    console.log(`   echo "Setting up feature $AIGON_FEATURE_ID in $AIGON_MODE mode"`);
                    console.log(`   \`\`\``);
                    return;
                }

                console.log(`\n🪝 Defined Hooks (${hooks.length}):\n`);

                // Group by command
                const byCommand = {};
                hooks.forEach(hook => {
                    if (!byCommand[hook.command]) {
                        byCommand[hook.command] = [];
                    }
                    byCommand[hook.command].push(hook);
                });

                Object.entries(byCommand).forEach(([command, cmdHooks]) => {
                    console.log(`   ${command}:`);
                    cmdHooks.forEach(hook => {
                        const preview = hook.script.split('\n')[0].substring(0, 50);
                        console.log(`      ${hook.type}: ${preview}${hook.script.length > 50 ? '...' : ''}`);
                    });
                });

                console.log(`\n   Hooks file: docs/aigon-hooks.md`);
            } else {
                console.error(`Unknown hooks subcommand: ${subcommand}`);
                console.error(`Usage: aigon hooks [list]`);
            }
        },

        'profile': async (args) => {
            const {
                getActiveProfile: getActiveProfileFn,
                loadProjectConfig: loadProjectConfigFn,
                saveProjectConfig: saveProjectConfigFn,
                detectProjectProfile: detectProjectProfileFn,
                showPortSummary,
                PROFILE_PRESETS: PP,
                PROJECT_CONFIG_PATH: PCPATH,
            } = u;

            const subcommand = args[0] || 'show';

            // F380: profile sync subcommands (configure/push/pull/status) live
            // alongside the project-profile (show/set/detect) ones.
            if (subcommand === 'configure' || subcommand === 'push' || subcommand === 'pull' || subcommand === 'status') {
                const profileState = require('../profile-state');
                try {
                    return await profileState.handleProfileSyncCommand(args);
                } catch (error) {
                    console.error(`❌ ${error.message}`);
                    process.exitCode = 1;
                    return;
                }
            }
            if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
                const profileState = require('../profile-state');
                profileState.printUsage();
                return;
            }

            if (subcommand === 'show') {
                const profile = getActiveProfileFn();
                const projectConfig = loadProjectConfigFn();
                console.log(`\n📋 Project Profile: ${profile.name}${profile.detected ? ' (auto-detected)' : ' (set in .aigon/config.json)'}`);
                console.log(`\n   Dev server: ${profile.devServer.enabled ? 'enabled' : 'disabled'}`);
                if (profile.devServer.enabled) {
                    showPortSummary();
                }
                console.log(`\n   Test instructions:`);
                profile.testInstructions.split('\n').forEach(line => console.log(`     ${line}`));
                if (profile.depCheck) {
                    console.log(`\n   Dependency check: yes`);
                }
                if (profile.setupEnvLine) {
                    console.log(`   .env.local setup: yes`);
                }
                console.log(`\n   Config file: ${PCPATH}`);
                console.log(`   Exists: ${fs.existsSync(PCPATH) ? 'yes' : 'no (using auto-detection)'}`);
                if (Object.keys(projectConfig).length > 0) {
                    console.log(`\n   Raw config:`);
                    console.log(`   ${JSON.stringify(projectConfig, null, 2).split('\n').join('\n   ')}`);
                }
            } else if (subcommand === 'set') {
                const profileName = args[1];
                if (!profileName) {
                    console.error(`Usage: aigon profile set <type>`);
                    console.error(`\nAvailable profiles: ${Object.keys(PP).join(', ')}`);
                    return;
                }
                if (!PP[profileName]) {
                    console.error(`❌ Unknown profile: ${profileName}`);
                    console.error(`Available profiles: ${Object.keys(PP).join(', ')}`);
                    return;
                }
                const projectConfig = loadProjectConfigFn();
                projectConfig.profile = profileName;
                saveProjectConfigFn(projectConfig);
                console.log(`✅ Profile set to: ${profileName}`);
                console.log(`   Saved to: ${PCPATH}`);
                console.log(`\n💡 Run 'aigon update' to regenerate templates with the new profile.`);
            } else if (subcommand === 'detect') {
                const detected = detectProjectProfileFn();
                console.log(`\n🔍 Auto-detected profile: ${detected}`);
                const preset = PP[detected];
                console.log(`   Dev server: ${preset.devServer.enabled ? 'enabled' : 'disabled'}`);
                if (preset.devServer.enabled && Object.keys(preset.devServer.ports).length > 0) {
                    console.log(`   Ports: ${Object.entries(preset.devServer.ports).map(([k, v]) => `${k}=${v}`).join(', ')}`);
                }
                const projectConfig = loadProjectConfigFn();
                if (projectConfig.profile) {
                    console.log(`\n   ⚠️  Note: .aigon/config.json overrides detection with profile "${projectConfig.profile}"`);
                }
            } else {
                const profileState = require('../profile-state');
                profileState.printUsage();
            }
        },

        'sync': async (args) => {
            // F359: spec-aligned `sync` (configure/push/pull/status) lives in
            // ../sync-state. The legacy multi-repo bundle flow in ../sync
            // (init/register/export/bootstrap-merge) is reachable via
            // `aigon sync legacy <subcmd>` for callers that still depend on it.
            const sub = args[0];
            try {
                if (sub === 'legacy') {
                    const legacy = require('../sync');
                    await legacy.handleSyncCommand(args.slice(1));
                    return;
                }
                const sync = require('../sync-state');
                await sync.handleSyncCommand(args);
            } catch (error) {
                console.error(`❌ ${error.message}`);
                process.exitCode = 1;
            }
        },
        // ── Server command ──────────────────────────────────────────────────
        // Unified process: HTTP dashboard + supervisor module.
        // `aigon server start` launches the combined process.
        // `aigon server stop` stops it cleanly.
        // `aigon server status` reports health.
        'server': async (args) => {
            const options = parseCliOptions(args);
            const sub = options._[0];

            if (!sub || sub === 'start') {
                const persistent = options.persistent === true;

                if (persistent) {
                    // Install auto-restart service (launchd on macOS, systemd on Linux)
                    const { installService } = require('../supervisor-service');
                    installService();
                    return;
                }

                autoRegisterRepoIfNeeded(resolveCurrentRepoRoot());

                const existing = getServerRegistryEntry();
                if (existing && existing.pid && existing.pid !== process.pid && isProcessAlive(existing.pid)) {
                    if (!process.stdout.isTTY) {
                        console.log(`ℹ️  Taking over from existing server (PID ${existing.pid})`);
                        await stopDashboardProcess(existing, 'server', { isProcessAlive });
                    } else {
                        console.log(`⚠️  Server already running (PID ${existing.pid})`);
                        console.log(`   ${getServerUrl(existing)}`);
                        return;
                    }
                }

                await launchDashboardServer({
                    dashCtx: { isWorktree: false, instanceName: 'main', worktreePath: null, serverId: null },
                    instanceName: 'main',
                    serverId: null,
                    isPreview: false,
                    repoRoot: resolveCurrentRepoRoot(),
                    appId: SERVER_APP_ID,
                    proxyAvailable: isProxyAvailable(),
                }, {
                    DASHBOARD_DYNAMIC_PORT_START,
                    hashBranchToPort,
                    isPortAvailable,
                    allocatePort,
                    addCaddyRoute,
                    getAigonServerAppId,
                    buildCaddyHostname,
                    runDashboardServer,
                    isProcessAlive,
                });
                return;
            }

            if (sub === 'stop') {
                const { isServiceInstalled, stopService } = require('../supervisor-service');
                if (isServiceInstalled()) {
                    stopService();
                    console.log('✅ Server stopped (service unloaded).');
                    console.log('   To start again: aigon server start --persistent');
                } else {
                    const existing = getServerRegistryEntry();
                    const stopped = await stopDashboardProcess(existing, 'server', { isProcessAlive });
                    if (!stopped) {
                        console.log('ℹ️  Server is not running.');
                    } else {
                        console.log('✅ Server stopped.');
                    }
                }
                // Dashboard Caddy route is intentionally kept — returns 502 while down,
                // auto-recovers on next start.
                return;
            }

            if (sub === 'restart') {
                autoRegisterRepoIfNeeded(resolveCurrentRepoRoot());
                const { isServiceInstalled, restartService } = require('../supervisor-service');
                if (isServiceInstalled()) {
                    restartService();
                    console.log('✅ Server restarting via system service.');
                } else {
                    const existing = getServerRegistryEntry();
                    const stopped = await stopDashboardProcess(existing, 'server', { isProcessAlive });
                    if (!stopped) {
                        console.log('ℹ️  No running server found — starting fresh');
                    }
                    await launchDashboardServer({
                        dashCtx: { isWorktree: false, instanceName: 'main', worktreePath: null, serverId: null },
                        instanceName: 'main',
                        serverId: null,
                        isPreview: false,
                        repoRoot: resolveCurrentRepoRoot(),
                        appId: SERVER_APP_ID,
                        proxyAvailable: isProxyAvailable(),
                        _isRestart: true,
                    }, {
                        DASHBOARD_DYNAMIC_PORT_START,
                        hashBranchToPort,
                        isPortAvailable,
                        allocatePort,
                        addCaddyRoute,
                        getAigonServerAppId,
                        buildCaddyHostname,
                        runDashboardServer,
                        isProcessAlive,
                    });
                }
                return;
            }

            if (sub === 'status') {
                const entry = getServerRegistryEntry();
                const processRunning = entry && entry.pid > 0 && isProcessAlive(entry.pid);

                if (!processRunning) {
                    console.log('Server: stopped');
                    return;
                }

                const startedAt = entry.startedAt || entry.started;
                const uptime = startedAt
                    ? Math.round((Date.now() - new Date(startedAt).getTime()) / 1000)
                    : null;
                const uptimeStr = uptime !== null
                    ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`
                    : 'unknown';

                let healthResult = null;
                try {
                    healthResult = await fetchServerJson(entry.port, '/api/health');
                } catch (_) { /* leave unavailable */ }

                const healthOk = healthResult && healthResult.statusCode === 200;
                console.log(`Server: ${healthOk ? 'running' : 'unhealthy'} (PID ${entry.pid})`);
                console.log(`  URL: ${getServerUrl(entry)}`);
                console.log(`  Port: ${entry.port}`);
                console.log(`  Uptime: ${uptimeStr}`);
                if (healthResult && healthResult.body) {
                    if (healthOk) {
                        if (healthResult.body.warming) console.log(`  Health: warming (first poll pending)`);
                        else console.log(`  Health: ok (${healthResult.body.repoCount || 0} repos)`);
                    } else {
                        console.log(`  Health: failed${healthResult.body.error ? ` — ${healthResult.body.error}` : ''}`);
                    }
                } else {
                    console.log('  Health: unavailable');
                }

                // Try to fetch supervisor status from the running server
                try {
                    const statusData = (await fetchServerJson(entry.port, '/api/supervisor/status')).body;
                    // sweepHealth is optional — older servers won't return it.
                    // Fall back to plain "running/stopped" so mismatched versions stay readable.
                    let supervisorLine = `  Supervisor: ${statusData.running ? 'running' : 'stopped'}`;
                    if (statusData.sweepHealth) {
                        const icon = statusData.sweepHealth === 'healthy' ? '🟢'
                            : statusData.sweepHealth === 'stale' ? '🟡' : '🔴';
                        supervisorLine += ` ${icon} ${statusData.sweepHealth}`;
                    }
                    console.log(supervisorLine);
                    console.log(`  Last sweep: ${statusData.lastSweepAt || 'never'}`);
                    console.log(`  Sweep count: ${statusData.sweepCount}`);
                } catch (_) {
                    console.log('  Supervisor: status unavailable');
                }
                return;
            }

            if (sub === 'add') {
                const repoPath = path.resolve(options._[1] || process.cwd());
                const repos = readConductorReposFromGlobalConfig();
                if (repos.includes(repoPath)) { console.log(`⚠️  Already registered: ${repoPath}`); return; }
                repos.push(repoPath);
                writeRepoRegistry(repos);
                console.log(`✅ Registered: ${repoPath}`);
                return;
            }

            if (sub === 'remove') {
                const repoPath = path.resolve(options._[1] || process.cwd());
                const repos = readConductorReposFromGlobalConfig();
                const idx = repos.indexOf(repoPath);
                if (idx === -1) { console.log(`⚠️  Not registered: ${repoPath}`); return; }
                repos.splice(idx, 1);
                writeRepoRegistry(repos);
                console.log(`✅ Removed: ${repoPath}`);
                return;
            }

            if (sub === 'list') {
                const repos = readConductorReposFromGlobalConfig();
                if (repos.length === 0) { console.log('No repos registered.'); return; }
                console.log(`Registered repos (${repos.length}):`);
                repos.forEach(r => console.log(`  ${r}`));
                return;
            }

            if (sub === 'open') {
                const entry = getServerRegistryEntry();
                const processRunning = entry && entry.pid > 0 && isProcessAlive(entry.pid);
                if (!processRunning) {
                    console.error('❌ Server is not running. Start it with: aigon server start --persistent');
                    process.exitCode = 1;
                    return;
                }
                const url = getServerUrl(entry);
                try { openInBrowser(url); } catch (e) { /* ignore */ }
                console.log(`🌐 Dashboard: ${url}`);
                return;
            }

            if (sub === 'tile') {
                try {
                    tileITerm2Windows();
                } catch (e) {
                    console.error(`❌ ${e.message}`);
                    process.exitCode = 1;
                }
                return;
            }

            console.error('Usage: aigon server [start|stop|restart|status|add|remove|list|open|tile]');
            console.error('');
            console.error('  start              Start server (HTTP + supervisor) in foreground');
            console.error('  start --persistent Install as system service (auto-restart on crash)');
            console.error('  stop               Stop the server');
            console.error('  restart            Stop and restart the server');
            console.error('  status             Show server and supervisor health');
            console.error('  add [path]         Register a repo (default: current directory)');
            console.error('  remove [path]      Unregister a repo');
            console.error('  list               Show registered repos');
            console.error('  open               Open dashboard in browser');
            console.error('  tile               Tile iTerm2 agent windows');
            process.exitCode = 1;
        },
    };

    return commands;
};

// Backward-compat wrapper
function createInfraCommands(overrides = {}) {
    const utils = require('../utils');
    const git = require('../git');
    const board = require('../board');
    const feedbackLib = require('../feedback');
    const validation = require('../validation');
    const stateMachine = require('../state-queries');

    const ctx = {
        utils: { ...utils, ...overrides },
        git: { ...git, ...overrides },
        board: { ...board, ...overrides },
        feedback: { ...feedbackLib, ...overrides },
        validation: { ...validation, ...overrides },
        stateMachine,
    };
    const allCmds = module.exports(ctx);
    const names = ['dashboard', 'server', 'terminal-focus', 'board', 'proxy-setup', 'proxy', 'dev-server', 'config', 'hooks', 'profile', 'sync'];
    return Object.fromEntries(names.map(n => [n, allCmds[n]]).filter(([, h]) => typeof h === 'function'));
}

function getTerminalConfigHelpIds() {
    return require('../terminal-adapters').getDashboardOptions();
}

module.exports.createInfraCommands = createInfraCommands;
module.exports.getTerminalConfigHelpIds = getTerminalConfigHelpIds;
