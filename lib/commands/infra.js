'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { readAgentStatus } = require('../manifest');

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
        getAppId,
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
    } = u;

    const {
        displayBoardKanbanView,
        displayBoardListView,
    } = ctx.board;

    const commands = {
        'conductor': (args) => {
            const CONDUCTOR_PID_FILE = path.join(GLOBAL_CONFIG_DIR, 'conductor.pid');
            const CONDUCTOR_LOG_FILE = path.join(GLOBAL_CONFIG_DIR, 'conductor.log');

            // --- Helpers ---

            function readConductorRepos() {
                try {
                    if (!fs.existsSync(GLOBAL_CONFIG_PATH)) return [];
                    const cfg = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8'));
                    return Array.isArray(cfg.repos) ? cfg.repos : [];
                } catch (e) {
                    return [];
                }
            }

            function writeConductorRepos(repos) {
                let cfg = {};
                try {
                    if (fs.existsSync(GLOBAL_CONFIG_PATH)) {
                        cfg = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8'));
                    }
                } catch (e) { /* start fresh */ } // optional
                cfg.repos = repos;
                if (!fs.existsSync(GLOBAL_CONFIG_DIR)) fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
                fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
            }

            function isDaemonAlive() {
                if (!fs.existsSync(CONDUCTOR_PID_FILE)) return false;
                try {
                    const pid = parseInt(fs.readFileSync(CONDUCTOR_PID_FILE, 'utf8').trim(), 10);
                    process.kill(pid, 0);
                    return pid;
                } catch (e) {
                    return false;
                }
            }

            // --- Daemon implementation (runs as detached child) ---

            function runConductorDaemon() {
                const { execSync: exec } = require('child_process');

                function log(msg) {
                    try {
                        fs.appendFileSync(CONDUCTOR_LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
                    } catch (e) { /* ignore */ } // optional
                }

                // Write our own PID (complements what the parent wrote — same value)
                fs.writeFileSync(CONDUCTOR_PID_FILE, String(process.pid));
                log(`Conductor daemon started (PID ${process.pid})`);

                // In-memory state: log file key -> last status
                const lastStatus = {};

                function poll() {
                    let repos;
                    try {
                        repos = readConductorRepos();
                    } catch (e) {
                        log(`Error reading config: ${e.message}`);
                        return;
                    }

                    repos.forEach(repoPath => {
                        // Collect log files from main repo + worktrees
                        const mainLogsDir = path.join(repoPath, 'docs', 'specs', 'features', 'logs');
                        const allLogEntries = []; // { logFile, logPath }

                        // Main repo logs
                        if (fs.existsSync(mainLogsDir)) {
                            try {
                                fs.readdirSync(mainLogsDir)
                                    .filter(f => /^feature-\d+-.+-log\.md$/.test(f))
                                    .forEach(f => allLogEntries.push({ logFile: f, logPath: path.join(mainLogsDir, f) }));
                            } catch (e) {
                                log(`Error reading logs dir ${mainLogsDir}: ${e.message}`);
                            }
                        }

                        // Worktree logs
                        const worktreeBaseDir = repoPath + '-worktrees';
                        if (fs.existsSync(worktreeBaseDir)) {
                            try {
                                fs.readdirSync(worktreeBaseDir).forEach(dirName => {
                                    const wtLogsDir = path.join(worktreeBaseDir, dirName, 'docs', 'specs', 'features', 'logs');
                                    if (!fs.existsSync(wtLogsDir)) return;
                                    try {
                                        fs.readdirSync(wtLogsDir)
                                            .filter(f => /^feature-\d+-.+-log\.md$/.test(f))
                                            .forEach(f => allLogEntries.push({ logFile: f, logPath: path.join(wtLogsDir, f) }));
                                    } catch (e) { /* skip */ } // optional
                                });
                            } catch (e) { /* skip */ } // optional
                        }

                        if (allLogEntries.length === 0) return;

                        // Deduplicate: same logFile name may appear in main + worktree; prefer worktree (more up-to-date)
                        const byName = {};
                        allLogEntries.forEach(entry => {
                            byName[entry.logFile] = entry; // last wins = worktree overwrites main
                        });
                        const logEntries = Object.values(byName);

                        logEntries.forEach(({ logFile }) => {
                            // Parse feature ID and agent from log filename
                            const arenaM = logFile.match(/^feature-(\d+)-([a-z]{2})-(.+)-log\.md$/);
                            const soloM = logFile.match(/^feature-(\d+)-(.+)-log\.md$/);
                            const featureId = arenaM ? arenaM[1] : (soloM ? soloM[1] : null);
                            const agent = arenaM ? arenaM[2] : 'solo';

                            if (!featureId) return;

                            // Read status from manifest state dir
                            let status = 'unknown';
                            try {
                                const stateFile = path.join(repoPath, '.aigon', 'state', `feature-${featureId}-${agent}.json`);
                                if (fs.existsSync(stateFile)) {
                                    const agentState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
                                    status = agentState.status || 'unknown';
                                }
                            } catch (e) { /* skip */ }

                            const key = `${repoPath}:${logFile}`;
                            const prev = lastStatus[key];
                            lastStatus[key] = status;

                            // Notify on transition to waiting — dashboard poll loop handles notifications
                            if (prev !== undefined && prev !== 'waiting' && status === 'waiting') {
                                const repoName = path.basename(repoPath);
                                log(`Agent waiting: ${agent} on #${featureId} in ${repoName}`);
                            }
                        });
                    });

                    log(`Poll complete (${repos.length} repo${repos.length !== 1 ? 's' : ''})`);
                }

                // Initial poll then every 30 seconds
                try { poll(); } catch (e) { log(`Poll error: ${e.message}`); }
                setInterval(() => {
                    try { poll(); } catch (e) { log(`Poll error: ${e.message}`); }
                }, 30000);

                // Keep process alive
                process.stdin.resume();
            }

            // --- Subcommand dispatch ---

            const sub = args[0];
            const deprecatedDashboardSubs = ['start', 'stop', 'status', 'add', 'remove', 'list'];
            if (deprecatedDashboardSubs.includes(sub)) {
                console.log(`⚠ 'aigon conductor ${sub}' is deprecated — use 'aigon dashboard ${sub}' instead.`);
                return commands['dashboard']([sub, ...args.slice(1)]);
            }

            // Internal: daemon mode (called as detached child)
            if (sub === '--daemon') {
                return runConductorDaemon();
            }

            if (sub === 'start') {
                const pid = isDaemonAlive();
                if (pid) {
                    console.log(`⚠️  Conductor already running (PID ${pid})`);
                    console.log(`   Run: aigon conductor stop`);
                    return;
                }
                // Clear stale PID file
                if (fs.existsSync(CONDUCTOR_PID_FILE)) fs.unlinkSync(CONDUCTOR_PID_FILE);

                const { spawn } = require('child_process');
                const child = spawn(process.execPath, [__filename, 'conductor', '--daemon'], {
                    detached: true,
                    stdio: 'ignore',
                    env: process.env
                });
                child.unref();
                if (!fs.existsSync(GLOBAL_CONFIG_DIR)) fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
                fs.writeFileSync(CONDUCTOR_PID_FILE, String(child.pid));
                console.log(`✅ Conductor started (PID ${child.pid})`);
                console.log(`   Polling every 30s across ${readConductorRepos().length} repo(s)`);
                console.log(`📋 Logs: ${CONDUCTOR_LOG_FILE}`);
                return;
            }

            if (sub === 'stop') {
                const pid = isDaemonAlive();
                if (!pid) {
                    console.log('⛔ Conductor is not running.');
                    if (fs.existsSync(CONDUCTOR_PID_FILE)) fs.unlinkSync(CONDUCTOR_PID_FILE);
                    return;
                }
                try {
                    process.kill(pid, 'SIGTERM');
                    fs.unlinkSync(CONDUCTOR_PID_FILE);
                    console.log(`✅ Conductor stopped (PID ${pid})`);
                } catch (e) {
                    console.error(`❌ Failed to stop conductor: ${e.message}`);
                }
                return;
            }

            if (sub === 'status') {
                const pid = isDaemonAlive();
                console.log(`Conductor: ${pid ? `✅ running (PID ${pid})` : '⛔ stopped'}`);

                const repos = readConductorRepos();
                if (repos.length === 0) {
                    console.log('Repos:     (none — run: aigon conductor add)');
                } else {
                    console.log(`Repos (${repos.length}):`);
                    repos.forEach(r => console.log(`  ${r}`));
                }

                // Last log line
                if (fs.existsSync(CONDUCTOR_LOG_FILE)) {
                    const lines = fs.readFileSync(CONDUCTOR_LOG_FILE, 'utf8').trim().split('\n');
                    const last = lines[lines.length - 1];
                    if (last) console.log(`Last poll: ${last}`);
                }

                // Show currently waiting agents
                const waiting = [];
                repos.forEach(repoPath => {
                    const stateDir = path.join(repoPath, '.aigon', 'state');
                    if (!fs.existsSync(stateDir)) return;
                    try {
                        fs.readdirSync(stateDir)
                            .filter(f => /^feature-\d+-\w+\.json$/.test(f))
                            .forEach(stateFile => {
                                try {
                                    const agentState = JSON.parse(fs.readFileSync(path.join(stateDir, stateFile), 'utf8'));
                                    if (agentState.status === 'waiting') {
                                        const m = stateFile.match(/^feature-(\d+)-(\w+)\.json$/);
                                        if (m) {
                                            const featureId = m[1];
                                            const agent = m[2];
                                            waiting.push(`  ${path.basename(repoPath)}: #${featureId} (${agent})`);
                                        }
                                    }
                                } catch (e) { /* skip */ }
                            });
                    } catch (e) { /* skip */ }
                });
                if (waiting.length > 0) {
                    console.log(`Waiting agents (${waiting.length}):`);
                    waiting.forEach(w => console.log(w));
                } else if (repos.length > 0) {
                    console.log('Waiting:   none');
                }
                return;
            }

            if (sub === 'add') {
                const repoPath = path.resolve(args[1] || process.cwd());
                const repos = readConductorRepos();
                if (repos.includes(repoPath)) {
                    console.log(`⚠️  Already registered: ${repoPath}`);
                    return;
                }
                repos.push(repoPath);
                writeConductorRepos(repos);
                console.log(`✅ Registered: ${repoPath}`);
                console.log(`   Total repos: ${repos.length}`);
                return;
            }

            if (sub === 'remove') {
                const repoPath = path.resolve(args[1] || process.cwd());
                const repos = readConductorRepos();
                const idx = repos.indexOf(repoPath);
                if (idx === -1) {
                    console.log(`⚠️  Not registered: ${repoPath}`);
                    return;
                }
                repos.splice(idx, 1);
                writeConductorRepos(repos);
                console.log(`✅ Removed: ${repoPath}`);
                return;
            }

            if (sub === 'list') {
                const repos = readConductorRepos();
                if (repos.length === 0) {
                    console.log('No repos registered. Run: aigon conductor add');
                    return;
                }
                console.log(`Watched repos (${repos.length}):`);
                repos.forEach(r => console.log(`  ${r}`));
                return;
            }

            if (sub === 'menubar-render') {
                const repos = readConductorRepos();
                if (repos.length === 0) {
                    console.log('⚙ –');
                    console.log('---');
                    console.log('No repos registered');
                    console.log('Run: aigon conductor add | href=https://github.com/jviner/aigon');
                    return;
                }

                const nodeExec = process.execPath;
                const aigonScript = __filename;
                let waitingCount = 0;
                let implementingCount = 0;
                const sections = [];
                const attentionItems = []; // { repoShort, fid, name, reason, action }

                repos.forEach(repoPath => {
                    const inProgressDir = path.join(repoPath, 'docs', 'specs', 'features', '03-in-progress');
                    const inEvalDir = path.join(repoPath, 'docs', 'specs', 'features', '04-in-evaluation');
                    const logsDir = path.join(repoPath, 'docs', 'specs', 'features', 'logs');

                    // Source of truth: specs in 03-in-progress/ and 04-in-evaluation/
                    let specFiles = []; // { file, stage: 'in-progress' | 'in-evaluation' }
                    const stageDirs = [
                        { dir: inProgressDir, stage: 'in-progress' },
                        { dir: inEvalDir, stage: 'in-evaluation' }
                    ];
                    stageDirs.forEach(({ dir, stage }) => {
                        if (fs.existsSync(dir)) {
                            try {
                                fs.readdirSync(dir)
                                    .filter(f => /^feature-\d+-.+\.md$/.test(f))
                                    .forEach(f => specFiles.push({ file: f, stage }));
                            } catch (e) { /* skip */ } // optional
                        }
                    });

                    const repoShort = repoPath.replace(os.homedir(), '~');
                    const lines = [];

                    // Build a map of log statuses for enrichment
                    const logStatuses = {}; // key: "featureId" or "featureId-agent" -> status

                    // Collect all log directories: main repo + worktrees
                    const allLogDirs = [];
                    if (fs.existsSync(logsDir)) allLogDirs.push(logsDir);
                    const worktreeBaseDir = repoPath + '-worktrees';
                    if (fs.existsSync(worktreeBaseDir)) {
                        try {
                            fs.readdirSync(worktreeBaseDir).forEach(dirName => {
                                const wtLogsDir = path.join(worktreeBaseDir, dirName, 'docs', 'specs', 'features', 'logs');
                                if (fs.existsSync(wtLogsDir)) allLogDirs.push(wtLogsDir);
                            });
                        } catch (e) { /* skip */ } // optional
                    }

                    // Read agent statuses from manifest state dir
                    const stateDir = path.join(repoPath, '.aigon', 'state');
                    if (fs.existsSync(stateDir)) {
                        try {
                            fs.readdirSync(stateDir)
                                .filter(f => /^feature-\d+-\w+\.json$/.test(f))
                                .forEach(stateFile => {
                                    try {
                                        const agentState = JSON.parse(fs.readFileSync(path.join(stateDir, stateFile), 'utf8'));
                                        const m = stateFile.match(/^feature-(\d+)-(\w+)\.json$/);
                                        if (!m) return;
                                        const featureId = m[1];
                                        const agent = m[2];
                                        const status = agentState.status || 'implementing';
                                        if (agent === 'solo') {
                                            logStatuses[featureId] = status;
                                        } else {
                                            logStatuses[`${featureId}-${agent}`] = status;
                                        }
                                    } catch (e) { /* skip */ }
                                });
                        } catch (e) { /* skip */ } // optional
                    }

                    // Discover worktrees for this repo to detect fleet agents
                    const worktreeAgents = {}; // featureId -> [agent, agent, ...]
                    if (fs.existsSync(worktreeBaseDir)) {
                        try {
                            fs.readdirSync(worktreeBaseDir).forEach(dirName => {
                                const wtM = dirName.match(/^feature-(\d+)-([a-z]{2})-.+$/);
                                if (wtM) {
                                    const fid = wtM[1];
                                    if (!worktreeAgents[fid]) worktreeAgents[fid] = [];
                                    worktreeAgents[fid].push(wtM[2]);
                                }
                            });
                        } catch (e) { /* skip */ } // optional
                    }

                    // Group by feature from specs, enrich with log status + worktree agents
                    const features = {};
                    specFiles.forEach(({ file: specFile, stage }) => {
                        const m = specFile.match(/^feature-(\d+)-(.+)\.md$/);
                        if (!m) return;
                        const featureId = m[1];
                        const featureName = m[2];

                        if (!features[featureId]) features[featureId] = { name: featureName, agents: [], stage };

                        // Collect known agents from both log files and worktrees
                        const agentSet = new Set();
                        Object.keys(logStatuses)
                            .filter(k => k.startsWith(`${featureId}-`) && k.includes('-'))
                            .forEach(k => agentSet.add(k.split('-').slice(1).join('-')));
                        if (worktreeAgents[featureId]) {
                            worktreeAgents[featureId].forEach(a => agentSet.add(a));
                        }

                        if (agentSet.size > 0) {
                            // Fleet mode: multiple agents (from logs and/or worktrees)
                            agentSet.forEach(agent => {
                                const status = logStatuses[`${featureId}-${agent}`] || 'implementing';
                                features[featureId].agents.push({ agent, status });
                                if (status === 'waiting') waitingCount++;
                                else if (status === 'implementing') implementingCount++;
                            });
                        } else if (logStatuses[featureId]) {
                            // Solo mode: only show if there's an actual log file
                            const status = logStatuses[featureId];
                            features[featureId].agents.push({ agent: 'solo', status });
                            if (status === 'waiting') waitingCount++;
                            else if (status === 'implementing') implementingCount++;
                        }
                        // else: spec exists but no agents working — skip from menubar
                    });

                    // Filter to only features with active agents
                    const activeFeatures = Object.entries(features).filter(([, data]) => data.agents.length > 0);

                    if (activeFeatures.length > 0) {
                    lines.push(repoShort + ' | size=14');

                    activeFeatures.sort((a, b) => a[0].localeCompare(b[0])).forEach(([fid, data]) => {
                        const paddedId = String(fid).padStart(2, '0');
                        const headerCmd = `/afd ${paddedId}`;
                        lines.push(`#${fid} ${data.name} | size=13 bash=/bin/bash param1=-c param2="echo '${headerCmd}' | pbcopy" terminal=false`);
                        data.agents.forEach(({ agent, status }) => {
                            const icon = status === 'waiting' ? '●' : status === 'submitted' ? '✓' : '○';
                            const focusParams = agent === 'solo'
                                ? `param1="${aigonScript}" param2=terminal-focus param3=${fid} param4=--repo param5="${repoPath}"`
                                : `param1="${aigonScript}" param2=terminal-focus param3=${fid} param4=${agent} param5=--repo param6="${repoPath}"`;
                            const paddedId2 = String(fid).padStart(2, '0');
                            const slashCmd = `/afd ${paddedId2}`;

                            lines.push(`-- ${icon} ${agent}: ${status} | bash="${nodeExec}" ${focusParams} terminal=false`);
                            lines.push(`-- ${icon} ${agent}: ${status} — copy cmd | alternate=true bash=/bin/bash param1=-c param2="echo '${slashCmd}' | pbcopy" terminal=false`);
                        });

                        // Detect attention-worthy states
                        const hasWaiting = data.agents.some(a => a.status === 'waiting');
                        const allSubmitted = data.agents.length > 0 && data.agents.every(a => a.status === 'submitted');
                        const paddedFid = String(fid).padStart(2, '0');

                        if (data.stage === 'in-evaluation') {
                            const evalsDir = path.join(repoPath, 'docs', 'specs', 'features', 'evaluations');
                            const rawStatus = u.parseEvalFileStatus(evalsDir, fid);
                            const evalReason = rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1);
                            attentionItems.push({ repoShort, repoPath, fid, name: data.name, reason: evalReason, action: `/afe ${paddedFid}`, actionLabel: 'Continue eval' });
                        } else if (allSubmitted) {
                            const isSolo = data.agents.length === 1 && data.agents[0].agent === 'solo';
                            if (isSolo) {
                                attentionItems.push({ repoShort, repoPath, fid, name: data.name, reason: 'Ready to close', action: `/aigon:feature-close ${paddedFid}`, actionLabel: 'Close feature' });
                            } else {
                                attentionItems.push({ repoShort, repoPath, fid, name: data.name, reason: 'All agents submitted', action: `/afe ${paddedFid}`, actionLabel: 'Run eval' });
                            }
                        } else if (hasWaiting) {
                            const waitingAgents = data.agents.filter(a => a.status === 'waiting').map(a => a.agent).join(', ');
                            attentionItems.push({ repoShort, repoPath, fid, name: data.name, reason: `${waitingAgents} waiting`, action: null, actionLabel: 'Focus agent' });
                        }
                    });
                    } // end features block

                    // --- Research sessions ---
                    const researchInProgressDir = path.join(repoPath, 'docs', 'specs', 'research-topics', '03-in-progress');
                    const researchLogsDir = path.join(repoPath, 'docs', 'specs', 'research-topics', 'logs');

                    const researchItems = {}; // id -> { name, agents: [{ agent, status }] }

                    // Discover research specs in progress
                    if (fs.existsSync(researchInProgressDir)) {
                        try {
                            fs.readdirSync(researchInProgressDir)
                                .filter(f => /^research-(\d+)-.+\.md$/.test(f))
                                .forEach(f => {
                                    const rm = f.match(/^research-(\d+)-(.+)\.md$/);
                                    if (rm) {
                                        researchItems[rm[1]] = { name: rm[2], agents: [] };
                                    }
                                });
                        } catch (e) { /* skip */ } // optional
                    }

                    // Discover agents from findings files in logs dir
                    if (fs.existsSync(researchLogsDir) && Object.keys(researchItems).length > 0) {
                        try {
                            fs.readdirSync(researchLogsDir)
                                .filter(f => /^research-(\d+)-([a-z]{2})-findings\.md$/.test(f))
                                .forEach(f => {
                                    const rm = f.match(/^research-(\d+)-([a-z]{2})-findings\.md$/);
                                    if (!rm) return;
                                    const rid = rm[1];
                                    const agent = rm[2];
                                    if (!researchItems[rid]) return;

                                    let status = 'implementing';
                                    try {
                                        const stateFile = path.join(repoPath, '.aigon', 'state', `feature-${rid}-${agent}.json`);
                                        if (fs.existsSync(stateFile)) {
                                            const agentState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
                                            status = agentState.status || 'implementing';
                                        }
                                    } catch (e) { /* skip */ } // optional

                                    researchItems[rid].agents.push({ agent, status });
                                    if (status === 'implementing') implementingCount++;
                                });
                        } catch (e) { /* skip */ } // optional
                    }

                    // Render research items
                    if (Object.keys(researchItems).length > 0) {
                        Object.entries(researchItems).sort((a, b) => a[0].localeCompare(b[0])).forEach(([rid, data]) => {
                            if (data.agents.length === 0) return;
                            // Add repo header if not already present (no features)
                            if (lines.length === 0) lines.push(repoShort + ' | size=14');
                            lines.push(`R#${rid} ${data.name} | size=13`);
                            data.agents.forEach(({ agent, status }) => {
                                const icon = status === 'submitted' ? '✓' : '○';
                                const focusParams = `param1="${aigonScript}" param2=terminal-focus param3=${rid} param4=${agent} param5=--research param6=--repo param7="${repoPath}"`;
                                const paddedId = String(rid).padStart(2, '0');
                                const slashCmd = `/ard ${paddedId}`;

                                lines.push(`-- ${icon} ${agent}: ${status} | bash="${nodeExec}" ${focusParams} terminal=false`);
                                lines.push(`-- ${icon} ${agent}: ${status} — copy cmd | alternate=true bash=/bin/bash param1=-c param2="echo '${slashCmd}' | pbcopy" terminal=false`);
                            });

                            // Attention: all agents submitted → synthesize
                            const allSubmitted = data.agents.length > 0 && data.agents.every(a => a.status === 'submitted');
                            if (allSubmitted) {
                                const paddedRid = String(rid).padStart(2, '0');
                                attentionItems.push({ repoShort, repoPath, fid: rid, name: data.name, reason: 'All agents submitted', action: `/ars ${paddedRid}`, actionLabel: 'Synthesize' });
                            }
                        });
                    }

                    if (lines.length > 0) sections.push(lines);
                });

                // Menubar title
                if (attentionItems.length > 0) {
                    console.log(`⚙ ${attentionItems.length} need${attentionItems.length === 1 ? 's' : ''} attention`);
                } else if (waitingCount > 0) {
                    console.log(`⚙ ${waitingCount} waiting`);
                } else if (implementingCount > 0) {
                    console.log(`⚙ ${implementingCount} running`);
                } else {
                    console.log('⚙ –');
                }
                console.log('---');

                // Needs Attention section (pinned to top)
                if (attentionItems.length > 0) {
                    console.log('⚠ Needs Attention | size=14');
                    attentionItems.forEach(item => {
                        const repoName = path.basename(item.repoPath);
                        const paddedId = String(item.fid).padStart(2, '0');
                        const label = `#${item.fid} ${item.name}: ${item.reason}`;
                        if (item.action) {
                            // Clicking copies the action command
                            console.log(`-- ${label} | bash=/bin/bash param1=-c param2="echo '${item.action}' | pbcopy" terminal=false`);
                            console.log(`-- ${label} — copy: ${item.action} | alternate=true bash=/bin/bash param1=-c param2="echo '${item.action}' | pbcopy" terminal=false`);
                        } else {
                            // Focus the waiting agent
                            console.log(`-- ${label} | bash="${nodeExec}" param1="${aigonScript}" param2=terminal-focus param3=${item.fid} param4=--repo param5="${item.repoPath}" terminal=false`);
                        }
                    });
                    console.log('---');
                }

                if (sections.length === 0) {
                    console.log('No active features');
                } else {
                    sections.forEach((lines, i) => {
                        if (i > 0) console.log('---');
                        lines.forEach(l => console.log(l));
                    });
                }

                console.log('---');
                const nodeExecPath = process.execPath;
                const aigonScriptPath = require.resolve('../aigon-cli');
                console.log(`Tile Windows | bash="${nodeExecPath}" param1="${aigonScriptPath}" param2=dashboard param3=tile terminal=false`);
                console.log('Refresh | refresh=true');
                return;
            }

            // Default: show usage
            console.log('Usage: aigon conductor <subcommand> (deprecated — use aigon dashboard)\n');
            console.log('Subcommands:');
            console.log('  start              Start the background daemon');
            console.log('  stop               Stop the daemon');
            console.log('  status             Show daemon state, watched repos, waiting agents');
            console.log('  add [path]         Register a repo (default: cwd)');
            console.log('  remove [path]      Unregister a repo (default: cwd)');
            console.log('  list               List registered repos');
        },

        'dashboard': async (args) => {
            const options = parseCliOptions(args);
            const sub = options._[0];
            const dashCtx = detectDashboardContext();
            const instanceName = dashCtx.instanceName;
            const serverId = dashCtx.serverId;
            const registryServerId = serverId || '';
            const appId = getAppId();
            const proxyAvailable = isProxyAvailable();

            // Guard: warn if running from a worktree — likely user/agent meant dev-server
            const worktreeMarker = path.join(process.cwd(), '.aigon', 'worktree.json');
            if (fs.existsSync(worktreeMarker) && (!sub || sub === 'start')) {
                console.error('⚠️  You are in a worktree. `aigon dashboard` is the centralised Aigon management UI — it does NOT start this project\'s dev server.');
                console.error('');
                console.error('   To start the project dev server, run:  aigon dev-server start');
                console.error('');
                return;
            }

            // No subcommand or 'start': start foreground server + open browser
            if (!sub || sub === 'start') {
                let port;
                if (process.env.PORT) {
                    port = parseInt(process.env.PORT, 10);
                } else if (!dashCtx.isWorktree) {
                    port = DASHBOARD_DEFAULT_PORT;
                } else {
                    const preferred = hashBranchToPort(instanceName);
                    port = (await isPortAvailable(preferred)) ? preferred : await allocatePort(DASHBOARD_DYNAMIC_PORT_START);
                }
                // Check if already running via proxy registry
                // Skip if the registered PID is our own (spawned by dev-server start which pre-registers)
                const registry = loadProxyRegistry();
                const appServers = registry[appId] || {};
                const existing = appServers[registryServerId];
                if (existing && existing.pid && existing.pid !== process.pid && isProcessAlive(existing.pid)) {
                    const existingUrl = proxyAvailable ? getDevProxyUrl(appId, serverId || null) : `http://localhost:${existing.port}`;
                    console.log(`⚠️  Dashboard already running (PID ${existing.pid})`);
                    console.log(`   ${existingUrl}`);
                    return;
                }
                // Reconcile proxy routes before starting (re-adds routes lost after crash/reboot)
                if (proxyAvailable) {
                    try {
                        const r = reconcileProxyRoutes();
                        const parts = [];
                        if (r.added > 0) parts.push(`${r.added} route${r.added === 1 ? '' : 's'} added`);
                        if (r.removed > 0) parts.push(`${r.removed} orphan${r.removed === 1 ? '' : 's'} removed`);
                        if (r.cleaned > 0) parts.push(`${r.cleaned} dead entr${r.cleaned === 1 ? 'y' : 'ies'} cleaned`);
                        if (parts.length > 0) {
                            console.log(`🔄 Proxy reconciled: ${parts.join(', ')}, ${r.unchanged} unchanged`);
                        }
                    } catch (e) { /* non-fatal */ } // optional
                }
                runDashboardServer(port, instanceName, serverId);
                return;
            }

            if (sub === 'restart') {
                const registry = loadProxyRegistry();
                const appServers = registry[appId] || {};
                const existing = appServers[registryServerId];
                if (existing && existing.pid && isProcessAlive(existing.pid)) {
                    try {
                        process.kill(existing.pid, 'SIGTERM');
                        for (let i = 0; i < 30; i++) {
                            if (!isProcessAlive(existing.pid)) break;
                            await new Promise(r => setTimeout(r, 100));
                        }
                        console.log(`🔄 Stopped dashboard (PID ${existing.pid})`);
                    } catch (e) {
                        console.error(`⚠️  Could not stop PID ${existing.pid}: ${e.message}`);
                    }
                } else {
                    console.log('ℹ️  No running dashboard found — starting fresh');
                }
                let port;
                if (process.env.PORT) {
                    port = parseInt(process.env.PORT, 10);
                } else if (!dashCtx.isWorktree) {
                    port = DASHBOARD_DEFAULT_PORT;
                } else {
                    const preferred = hashBranchToPort(instanceName);
                    port = (await isPortAvailable(preferred)) ? preferred : await allocatePort(DASHBOARD_DYNAMIC_PORT_START);
                }
                if (proxyAvailable) {
                    try { reconcileProxyRoutes(); } catch (e) { /* non-fatal */ }
                }
                runDashboardServer(port, instanceName, serverId);
                return;
            }

            if (sub === 'list') {
                const registry = loadProxyRegistry();
                const appServers = registry[appId] || {};
                const entries = Object.entries(appServers);
                if (entries.length === 0) { console.log('No dashboard instances running.'); return; }
                console.log(`Running instances (${entries.length}):`);
                entries.forEach(([sid, info]) => {
                    const alive = info.pid && isProcessAlive(info.pid);
                    const label = sid || 'main';
                    const url = proxyAvailable ? getDevProxyUrl(appId, sid || null) : `http://localhost:${info.port}`;
                    console.log(`  ${label.padEnd(40)} ${url}  PID ${info.pid || '?'} ${alive ? '✅' : '⛔ dead'}`);
                });
                return;
            }

            if (sub === 'open') {
                const name = options._[1] || registryServerId;
                const registry = loadProxyRegistry();
                const appServers = registry[appId] || {};
                // Try exact match, then empty string (main), then first entry
                const info = appServers[name] || appServers[''] || appServers[Object.keys(appServers)[0]];
                if (!info) { console.error(`❌ No instance found: ${name}`); process.exitCode = 1; return; }
                const resolvedSid = Object.entries(appServers).find(([, v]) => v === info)?.[0] ?? '';
                const url = proxyAvailable ? getDevProxyUrl(appId, resolvedSid || null) : `http://localhost:${info.port}`;
                try { openInBrowser(url); } catch (e) { /* ignore */ } // optional
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

            if (sub === 'status') {
                const registry = loadProxyRegistry();
                const appServers = registry[appId] || {};
                const entries = Object.entries(appServers);
                const repos = readConductorReposFromGlobalConfig();
                entries.forEach(([sid, info]) => {
                    const alive = info.pid && isProcessAlive(info.pid);
                    const label = sid || 'main';
                    const url = proxyAvailable ? getDevProxyUrl(appId, sid || null) : `http://localhost:${info.port}`;

                    console.log(`Dashboard (${label}): ${alive ? `✅ running (PID ${info.pid})` : '⛔ stopped'}`);
                    if (alive) console.log(`   ${url}`);
                });
                if (entries.length === 0) console.log('Dashboard: ⛔ not running');
                if (repos.length === 0) {
                    console.log('Repos:     (none — run: aigon dashboard add)');
                } else {
                    console.log(`Repos (${repos.length}):`);
                    repos.forEach(r => console.log(`  ${r}`));
                }
                return;
            }

            if (sub === 'autostart') {
                const shellProfile = getShellProfile();
                const marker = '# aigon-dashboard-autostart';
                const aigonBin = process.argv[1]; // path to aigon-cli.js
                const snippet = [
                    marker,
                    `if command -v tmux &>/dev/null && ! tmux has-session -t aigon-dashboard 2>/dev/null; then`,
                    `  tmux new-session -d -s aigon-dashboard "node ${JSON.stringify(aigonBin)} dashboard start"`,
                    `fi`,
                    `${marker}-end`
                ].join('\n');

                if (!shellProfile) {
                    console.log('⚠️  Could not detect shell profile (~/.zshrc or ~/.bashrc).');
                    console.log('   Add this to your shell profile manually:\n');
                    console.log(snippet);
                    return;
                }

                const profileContent = fs.existsSync(shellProfile) ? fs.readFileSync(shellProfile, 'utf8') : '';

                if (args.includes('--remove')) {
                    if (!profileContent.includes(marker)) {
                        console.log('ℹ️  Dashboard autostart is not configured.');
                        return;
                    }
                    const re = new RegExp(`\\n?${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${(marker + '-end').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`);
                    fs.writeFileSync(shellProfile, profileContent.replace(re, '\n'));
                    console.log(`✅ Removed dashboard autostart from ${shellProfile}`);
                    return;
                }

                if (profileContent.includes(marker)) {
                    console.log(`ℹ️  Dashboard autostart is already configured in ${shellProfile}`);
                    console.log('   To remove: aigon dashboard autostart --remove');
                    return;
                }

                fs.appendFileSync(shellProfile, '\n' + snippet + '\n');
                console.log(`✅ Added dashboard autostart to ${shellProfile}`);
                console.log('   The dashboard will start in a tmux session on login.');
                console.log('   Attach:  tmux attach -t aigon-dashboard');
                console.log('   Remove:  aigon dashboard autostart --remove');

                // Also start it now if not running
                try {
                    execSync('tmux has-session -t aigon-dashboard 2>/dev/null', { stdio: 'pipe' });
                    console.log('\n📊 Dashboard is already running (tmux session: aigon-dashboard)');
                } catch (e) {
                    try {
                        execSync(`tmux new-session -d -s aigon-dashboard "node ${JSON.stringify(aigonBin)} dashboard start"`, { stdio: 'pipe' });
                        console.log('\n🚀 Dashboard started (tmux session: aigon-dashboard)');
                    } catch (e2) {
                        console.log('\n⚠️  Could not start dashboard now. It will start on next login.');
                    }
                }
                return;
            }

            console.log('Usage: aigon dashboard [subcommand]\n');
            console.log('  start              Start dashboard server (foreground)');
            console.log('  restart            Stop running dashboard and start fresh');
            console.log('  list               List running dashboard instances');
            console.log('  open [name]        Open instance in browser');
            console.log('  add [path]         Register a repo (default: cwd)');
            console.log('  remove [path]      Unregister a repo (default: cwd)');
            console.log('  status             Show dashboard state and repos');
            console.log('  autostart          Auto-start dashboard on login (via tmux)');
            console.log('  autostart --remove Remove auto-start from shell profile');
        },

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
            const worktreeBaseDir = repoPath + '-worktrees';
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
                const agentOffsets = { cc: 1, gg: 2, cx: 3, cu: 4 };
                const offset = context.agentId ? (agentOffsets[context.agentId] || 0) : 0;

                // Check for explicit --port flag
                const portFlagIdx = args.indexOf('--port');
                let preferredPort;
                if (portFlagIdx !== -1 && args[portFlagIdx + 1]) {
                    preferredPort = parseInt(args[portFlagIdx + 1], 10);
                } else {
                    preferredPort = basePort + offset;
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
            } else {
                console.error(`Usage: aigon config <init|set|get|show|models>`);
                console.error(`\n  init [--global]     - Initialize config (project by default, --global for user-wide)`);
                console.error(`  set [--global] <key> <value>`);
                console.error(`                       - Set config value (project by default)`);
                console.error(`  get <key>           - Get config value with provenance`);
                console.error(`  show [--global|--project]`);
                console.error(`                       - Show config (merged by default, --global or --project for specific level)`);
                console.error(`  models              - Show resolved model configuration for all agents`);
                console.error(`\n  Examples:`);
                console.error(`    aigon config init                    # Create project config`);
                console.error(`    aigon config init --global           # Create global config`);
                console.error(`    aigon config set profile web        # Set project profile`);
                console.error(`    aigon config set --global terminal warp`);
                console.error(`    aigon config get profile             # Show value + source`);
                console.error(`    aigon config show                   # Show merged config`);
                console.error(`    aigon config show --project         # Show project config only`);
                console.error(`    aigon config models                 # Show model config for all agents`);
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
    const stateMachine = require('../state-machine');

    const ctx = {
        utils: { ...utils, ...overrides },
        git: { ...git, ...overrides },
        board: { ...board, ...overrides },
        feedback: { ...feedbackLib, ...overrides },
        validation: { ...validation, ...overrides },
        stateMachine,
    };
    const allCmds = module.exports(ctx);
    const names = ['conductor', 'dashboard', 'terminal-focus', 'board', 'proxy-setup', 'proxy', 'dev-server', 'config', 'hooks', 'profile'];
    return Object.fromEntries(names.map(n => [n, allCmds[n]]).filter(([, h]) => typeof h === 'function'));
}

module.exports.createInfraCommands = createInfraCommands;
