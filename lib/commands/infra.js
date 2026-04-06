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

module.exports = function infraCommands(ctx) {
    const u = ctx.utils;

    const {
        GLOBAL_CONFIG_DIR,
        GLOBAL_CONFIG_PATH,
        DASHBOARD_DEFAULT_PORT,
        DASHBOARD_DYNAMIC_PORT_START,
        PROFILE_PRESETS,
        PROJECT_CONFIG_PATH,
        parseCliOptions,
        getEffectiveConfig,
        isProxyAvailable,
        loadProxyRegistry,
        reconcileProxyRoutes,
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
        deregisterDevServer,
    } = u;

    const {
        displayBoardKanbanView,
        displayBoardListView,
    } = ctx.board;

    const SERVER_APP_ID = getAigonServerAppId();

    function getServerRegistryEntry() {
        const registry = loadProxyRegistry();
        const appServers = registry[SERVER_APP_ID] || {};
        return appServers[''] || null;
    }

    function getServerUrl(entry) {
        const proxyAvailable = isProxyAvailable();
        if (proxyAvailable) {
            return getDevProxyUrl(SERVER_APP_ID, null);
        }
        const port = entry && entry.port ? entry.port : DASHBOARD_DEFAULT_PORT;
        return `http://localhost:${port}`;
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

            // Resolve terminal preference: project config > global config > default
            const effectiveConfig = getEffectiveConfig();
            const terminal = effectiveConfig.terminal || 'warp';

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

                const focusCommand = terminal === 'tmux'
                    ? buildAgentCommand(target)
                    : 'echo "Ready — run your agent command here"';
                openSingleWorktree(target, focusCommand, terminal);
                return;
            }

            // No worktree — solo branch mode. Open terminal at repo root.
            const fakeWt = {
                path: repoPath,
                featureId: String(featureId).padStart(2, '0'),
                agent: requestedAgent || 'solo',
                desc: 'branch-mode'
            };
            const fallbackCommand = terminal === 'tmux' ? '' : 'echo "Ready — run your agent command here"';
            openSingleWorktree(fakeWt, fallbackCommand, terminal);
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
            // Simplified: just check port 80 availability (no Caddy/dnsmasq install needed)
            const { isPortAvailable: isPortAvailableFn, isProxyAvailable: isProxyAvailableFn } = u;
            const port80Available = await isPortAvailableFn(80);
            console.log('\nProxy Setup — .localhost domains (RFC 6761)');
            console.log('──────────────────────────────────────────');
            console.log(`  *.localhost resolves to 127.0.0.1 automatically — no DNS config needed.`);
            console.log(`  ${port80Available ? '✅' : '⚠️ '} Port 80: ${port80Available ? 'available' : 'in use (proxy will use fallback port)'}`);
            console.log(`  ${isProxyAvailableFn() ? '✅' : '❌'} aigon-proxy: ${isProxyAvailableFn() ? 'running' : 'not running'}`);
            if (!isProxyAvailableFn()) {
                console.log('\n  Run: aigon proxy start');
            }
        },

        'proxy': async (args) => {
            const subcommand = args[0];
            const { isPortAvailable: isPortAvailableFn, isProxyAvailable: isProxyAvailableFn, isProcessAlive: isProcessAliveFn } = u;
            const proxyScript = path.join(__dirname, '..', 'aigon-proxy.js');
            const DEV_PROXY_PID_FILE = path.join(os.homedir(), '.aigon', 'dev-proxy', 'proxy.pid');

            if (subcommand === 'start') {
                if (isProxyAvailableFn()) {
                    console.log('ℹ️  aigon-proxy is already running.');
                    return;
                }
                // Port 80 requires root on macOS/Linux — only use it if running as root
                const isRoot = process.getuid && process.getuid() === 0;
                const listenPort = (isRoot && await isPortAvailableFn(80)) ? 80 : 4080;
                const { spawn } = require('child_process');
                const child = spawn(process.execPath, [proxyScript], {
                    detached: true,
                    stdio: 'ignore',
                    env: { ...process.env, AIGON_PROXY_PORT: String(listenPort) }
                });
                child.unref();
                // Give proxy a moment to write PID file
                await new Promise(r => setTimeout(r, 300));
                if (isProxyAvailableFn()) {
                    const portDisplay = listenPort === 80 ? '' : `:${listenPort}`;
                    console.log(`✅ aigon-proxy started on port ${listenPort}`);
                    console.log(`   Dashboard: http://aigon.localhost${portDisplay}`);
                } else {
                    console.log('❌ aigon-proxy failed to start. Check that http-proxy is installed: npm install');
                }

            } else if (subcommand === 'stop') {
                if (!isProxyAvailableFn()) {
                    console.log('ℹ️  aigon-proxy is not running.');
                    return;
                }
                try {
                    const pid = parseInt(fs.readFileSync(DEV_PROXY_PID_FILE, 'utf8').trim(), 10);
                    process.kill(pid, 'SIGTERM');
                    console.log(`✅ aigon-proxy stopped (PID ${pid})`);
                } catch (e) {
                    console.error(`❌ Could not stop proxy: ${e.message}`);
                }

            } else if (subcommand === 'install') {
                // Create system LaunchDaemon for auto-start on boot (port 80, runs as root)
                const plistPath = '/Library/LaunchDaemons/com.aigon.proxy.plist';
                const logPath = path.join(os.homedir(), '.aigon', 'dev-proxy', 'proxy.log');
                const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.aigon.proxy</string>
    <key>ProgramArguments</key>
    <array>
        <string>${process.execPath}</string>
        <string>${proxyScript}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>AIGON_PROXY_PORT</key>
        <string>80</string>
        <key>HOME</key>
        <string>${os.homedir()}</string>
    </dict>
    <key>WorkingDirectory</key>
    <string>${path.dirname(proxyScript).replace(/\/lib$/, '')}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>${logPath}</string>
</dict>
</plist>`;
                // Write plist (needs sudo for /Library/LaunchDaemons)
                const tmpPlist = path.join(os.tmpdir(), 'com.aigon.proxy.plist');
                fs.writeFileSync(tmpPlist, plist);
                try {
                    // Stop existing if loaded
                    try { execSync('sudo launchctl unload ' + plistPath + ' 2>/dev/null', { stdio: 'pipe' }); } catch (e) {}
                    execSync(`sudo cp ${tmpPlist} ${plistPath}`, { stdio: 'inherit' });
                    execSync(`sudo launchctl load ${plistPath}`, { stdio: 'inherit' });
                    console.log(`\n✅ aigon-proxy installed as system daemon on port 80`);
                    console.log(`   http://aigon.localhost — your dashboard`);
                    console.log(`   Starts automatically on boot, restarts if it crashes.`);
                    console.log(`\n   Uninstall: aigon proxy uninstall`);
                } catch (e) {
                    console.error('❌ Failed to install. Run with sudo access available.');
                    console.error('   Manual install:');
                    console.error(`   sudo cp ${tmpPlist} ${plistPath}`);
                    console.error(`   sudo launchctl load ${plistPath}`);
                }
                fs.unlinkSync(tmpPlist);

            } else if (subcommand === 'uninstall') {
                const plistPath = '/Library/LaunchDaemons/com.aigon.proxy.plist';
                try {
                    execSync('sudo launchctl unload ' + plistPath, { stdio: 'inherit' });
                    execSync('sudo rm ' + plistPath, { stdio: 'inherit' });
                    console.log('✅ aigon-proxy uninstalled');
                } catch (e) {
                    console.error('❌ Failed to uninstall. Check if plist exists: ' + plistPath);
                }

            } else if (subcommand === 'status') {
                const running = isProxyAvailableFn();
                console.log(`aigon-proxy: ${running ? '✅ running' : '❌ not running'}`);
                if (running) {
                    try {
                        const pid = parseInt(fs.readFileSync(DEV_PROXY_PID_FILE, 'utf8').trim(), 10);
                        console.log(`PID: ${pid}`);
                    } catch (e) { /* ignore */ }
                }

            } else {
                console.log('Usage: aigon proxy <start|stop|install|uninstall|status>');
                console.log('  start      — start the proxy daemon (port 4080)');
                console.log('  stop       — stop the proxy daemon');
                console.log('  install    — install as system daemon on port 80 (one-time, needs sudo)');
                console.log('  uninstall  — remove system daemon');
                console.log('  status     — show proxy status');
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
                registerDevServer,
                deregisterDevServer,
                gcDevServers,
                getDevProxyUrl: getDevProxyUrlFn,
                getDevServerLogPath,
                spawnDevServer,
                waitForHealthy,
                openInBrowser: openInBrowserFn,
                loadProxyRegistry: loadProxyRegistryFn,
                isProcessAlive: isProcessAliveFn,
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
                // Use proxy if aigon-proxy is available AND either: profile enables devServer, OR
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
                    // Register with proxy (PID 0 for now, updated after spawn)
                    registerDevServer(context.appId, context.serverId, port, process.cwd(), 0);
                }

                if (!registerOnly) {
                    // Spawn the dev server process
                    console.log(`\n⏳ Starting dev server: ${startCmd}`);
                    const pid = spawnDevServer(startCmd, port, logPath, process.cwd());

                    // Update registry with real PID
                    if (useProxy) {
                        registerDevServer(context.appId, context.serverId, port, process.cwd(), pid);
                    }

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
                                const retryPid = spawnDevServer(startCmd, port, logPath, process.cwd());
                                if (useProxy) {
                                    registerDevServer(context.appId, context.serverId, port, process.cwd(), retryPid);
                                }
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

                // Kill the process if it's running
                const registry = loadProxyRegistry();
                const serverEntry = registry[appId] && registry[appId][targetServerId];
                if (serverEntry && serverEntry.pid > 0) {
                    try {
                        // Kill the process group (negative PID kills the group)
                        process.kill(-serverEntry.pid, 'SIGTERM');
                        console.log(`   Stopped process (PID ${serverEntry.pid})`);
                    } catch (e) {
                        if (e.code !== 'ESRCH') {
                            // ESRCH = process doesn't exist, which is fine
                            try { process.kill(serverEntry.pid, 'SIGTERM'); } catch (e2) { /* ignore */ } // optional
                        }
                    }
                }

                deregisterDevServer(appId, targetServerId);
                const hostname = targetServerId ? `${targetServerId}.${appId}.test` : `${appId}.test`;
                console.log(`✅ Stopped and deregistered ${hostname}`);

            } else if (subcommand === 'list') {
                const registry = loadProxyRegistry();
                const hasEntries = Object.keys(registry).length > 0 &&
                    Object.values(registry).some(servers => Object.keys(servers).length > 0);

                if (!hasEntries) {
                    console.log('\nNo active dev servers.\n');
                    console.log('   Start one: aigon dev-server start');
                    return;
                }

                console.log('\n   APP            SERVER      PORT   URL                              PID');
                console.log('   ' + '─'.repeat(75));
                for (const [appId, servers] of Object.entries(registry)) {
                    for (const [serverId, info] of Object.entries(servers)) {
                        const url = getDevProxyUrl(appId, serverId);
                        // Legacy entries have nested service/dashboard format
                        if (info.service && info.dashboard) {
                            const dashAlive = info.dashboard.pid > 0 && isProcessAlive(info.dashboard.pid);
                            const svcAlive = info.service.pid > 0 && isProcessAlive(info.service.pid);
                            const status = (dashAlive && svcAlive) ? '' : ' (dead)';
                            const portStr = `${info.service.port}/${info.dashboard.port}`;
                            const pidStr = `${info.service.pid}/${info.dashboard.pid}`;
                            console.log(`   ${appId.padEnd(15)} ${(serverId || '(main)').padEnd(11)} ${portStr.padEnd(6)} ${url.padEnd(36)} ${pidStr}${status}`);
                        } else {
                            const pidStr = info.pid ? String(info.pid) : '-';
                            let alive = false;
                            if (info.pid > 0) {
                                alive = isProcessAlive(info.pid);
                            }
                            const status = alive ? '' : ' (dead)';
                            console.log(`   ${appId.padEnd(15)} ${(serverId || '(main)').padEnd(11)} ${String(info.port).padEnd(6)} ${url.padEnd(36)} ${pidStr}${status}`);
                        }
                    }
                }
                console.log('');

            } else if (subcommand === 'gc') {
                const removed = gcDevServers();
                if (removed > 0) {
                    console.log(`✅ Removed ${removed} dead server${removed === 1 ? '' : 's'} from registry`);
                } else {
                    console.log('No dead servers found.');
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
                    console.log(`   - terminal: Terminal to use (warp, code, cursor, terminal, tmux)`);
                    console.log(`   - tmuxApp: Terminal app for tmux sessions (terminal, iterm2)`);
                    console.log(`   - agents.{id}.cli: Override CLI command for each agent`);
                    console.log(`   - agents.{id}.implementFlag: Override CLI flags (set to "" to require manual approval)`);
                    console.log(`\n   Example (corporate/safer defaults - removes auto-approval flags):`);
                    console.log(`   {`);
                    console.log(`     "terminal": "warp",             // warp, code, cursor, terminal, tmux`);
                    console.log(`     "tmuxApp": "iterm2",            // terminal (Terminal.app) or iterm2`);
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
                    console.log(`   - cx: (none; interactive by default, --full-auto is applied only in --autonomous mode)`);
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
                    console.error(`    aigon config set --global terminal warp`);
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
                    console.error(`    aigon config get terminal`);
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
                console.error(`    aigon config set --global terminal warp`);
                console.error(`    aigon config get profile             # Show value + source`);
                console.error(`    aigon config show                   # Show merged config`);
                console.error(`    aigon config show --project         # Show project config only`);
                console.error(`    aigon config models                 # Show model config for all agents`);
                console.error(`    aigon config restore                # Restore from latest backup`);
            }
        },

        'hooks': (args) => {
            const { getDefinedHooks } = u;
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

        'profile': (args) => {
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
                console.error(`Usage: aigon profile [show|set|detect]`);
                console.error(`\n  show    - Display current profile and settings`);
                console.error(`  set     - Set project profile (web, api, ios, android, library, generic)`);
                console.error(`  detect  - Show what auto-detection would choose`);
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

                const existing = getServerRegistryEntry();
                if (existing && existing.pid && existing.pid !== process.pid && isProcessAlive(existing.pid)) {
                    // Non-interactive (launchd, systemd, nohup): take over the existing
                    // instance. Bailing out with exit(0) causes a KeepAlive restart loop
                    // because launchd immediately relaunches the process.
                    // Interactive (user typed `aigon server start`): inform and bail.
                    if (!process.stdout.isTTY) {
                        console.log(`ℹ️  Taking over from existing server (PID ${existing.pid})`);
                        await stopDashboardProcess(existing, 'server', { isProcessAlive });
                        deregisterDevServer(SERVER_APP_ID, '');
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
                    shouldLogProxyReconcile: true,
                }, {
                    DASHBOARD_DEFAULT_PORT,
                    DASHBOARD_DYNAMIC_PORT_START,
                    hashBranchToPort,
                    isPortAvailable,
                    allocatePort,
                    reconcileProxyRoutes,
                    runDashboardServer,
                    isProcessAlive,
                });
                return;
            }

            if (sub === 'stop') {
                const { isServiceInstalled, stopService } = require('../supervisor-service');
                if (isServiceInstalled()) {
                    // Delegate to launchd/systemd — unloading the service stops the
                    // process AND prevents KeepAlive from relaunching it.
                    stopService();
                    deregisterDevServer(SERVER_APP_ID, '');
                    console.log('✅ Server stopped (service unloaded).');
                    console.log('   To start again: aigon server start --persistent');
                } else {
                    const existing = getServerRegistryEntry();
                    const stopped = await stopDashboardProcess(existing, 'server', { isProcessAlive });
                    deregisterDevServer(SERVER_APP_ID, '');
                    if (!stopped) {
                        console.log('ℹ️  Server is not running.');
                    } else {
                        console.log('✅ Server stopped.');
                    }
                }
                return;
            }

            if (sub === 'restart') {
                const { isServiceInstalled, restartService } = require('../supervisor-service');
                if (isServiceInstalled()) {
                    // Delegate to launchd/systemd — it kills the old process and
                    // starts a fresh one. Doing this ourselves would race with
                    // KeepAlive and spawn duplicate instances.
                    restartService();
                    console.log('✅ Server restarting via system service.');
                } else {
                    const existing = getServerRegistryEntry();
                    const stopped = await stopDashboardProcess(existing, 'server', { isProcessAlive });
                    deregisterDevServer(SERVER_APP_ID, '');
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
                        shouldLogProxyReconcile: false,
                        _isRestart: true,
                    }, {
                        DASHBOARD_DEFAULT_PORT,
                        DASHBOARD_DYNAMIC_PORT_START,
                        hashBranchToPort,
                        isPortAvailable,
                        allocatePort,
                        reconcileProxyRoutes,
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

                console.log(`Server: running (PID ${entry.pid})`);
                console.log(`  URL: ${getServerUrl(entry)}`);
                console.log(`  Port: ${entry.port}`);
                console.log(`  Uptime: ${uptimeStr}`);

                // Try to fetch supervisor status from the running server
                try {
                    const http = require('http');
                    const statusData = await new Promise((resolve, reject) => {
                        const req = http.get(`http://127.0.0.1:${entry.port}/api/supervisor/status`, (res) => {
                            let body = '';
                            res.on('data', chunk => { body += chunk; });
                            res.on('end', () => {
                                try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
                            });
                        });
                        req.on('error', reject);
                        req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
                    });
                    console.log(`  Supervisor: ${statusData.running ? 'running' : 'stopped'}`);
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
    const names = ['dashboard', 'server', 'terminal-focus', 'board', 'proxy-setup', 'proxy', 'dev-server', 'config', 'hooks', 'profile'];
    return Object.fromEntries(names.map(n => [n, allCmds[n]]).filter(([, h]) => typeof h === 'function'));
}

module.exports.createInfraCommands = createInfraCommands;
