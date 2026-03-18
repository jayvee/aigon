'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');
const stateMachine = require('./state-machine');

// Constants from config.js
const {
    GLOBAL_CONFIG_PATH, GLOBAL_CONFIG_DIR, DASHBOARD_LOG_FILE, ROOT_DIR, CLI_ENTRY_PATH,
    DASHBOARD_DYNAMIC_PORT_START, DASHBOARD_DYNAMIC_PORT_END,
    loadGlobalConfig, saveGlobalConfig, getAgentCliConfig,
} = require('./config');

// Proxy functions
const {
    getAppId, isProxyAvailable, getDevProxyUrl, openInBrowser,
    registerDevServer, deregisterDevServer,
} = require('./proxy');

// Template functions
const { readTemplate } = require('./templates');

// Worktree/tmux functions
const {
    assertTmuxAvailable, buildTmuxSessionName, buildResearchTmuxSessionName,
    matchTmuxSessionByEntityId, tmuxSessionExists, createDetachedTmuxSession,
    getEnrichedSessions, runTmux, openTerminalAppWithCommand, shellQuote,
    buildAgentCommand, buildResearchAgentCommand,
} = require('./worktree');

// Lazy require to avoid circular dependency (utils.js requires this module)
function _collectAnalyticsData(globalConfig) {
    return require('./utils').collectAnalyticsData(globalConfig);
}

function readConductorReposFromGlobalConfig() {
    try {
        if (!fs.existsSync(GLOBAL_CONFIG_PATH)) return [];
        const cfg = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8'));
        return Array.isArray(cfg.repos) ? cfg.repos : [];
    } catch (e) {
        return [];
    }
}

function parseSimpleFrontMatter(content) {
    const m = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (!m) return {};
    const result = {};
    m[1].split('\n').forEach(line => {
        const idx = line.indexOf(':');
        if (idx === -1) return;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        result[key] = value;
    });
    return result;
}

function normalizeDashboardStatus(raw) {
    const status = String(raw || '').trim().toLowerCase();
    if (status === 'implementing' || status === 'waiting' || status === 'submitted' || status === 'error') {
        return status;
    }
    return 'implementing';
}

function parseFeatureSpecFileName(file) {
    const m = file.match(/^feature-(\d+)-(.+)\.md$/);
    if (m) return { id: m[1], name: m[2] };
    // Inbox files may have no ID: feature-name.md
    const m2 = file.match(/^feature-(.+)\.md$/);
    if (m2) return { id: null, name: m2[1] };
    return null;
}

function inferDashboardNextCommand(featureId, agents, stage) {
    // Derives the single most-recommended next action from inferDashboardNextActions.
    const actions = inferDashboardNextActions(featureId, agents, stage);
    if (!actions || actions.length === 0) return null;
    const first = actions[0];
    return { command: first.command, reason: first.reason };
}

function inferDashboardNextActions(featureId, agents, stage) {
    const id = String(featureId).padStart(2, '0');
    if (!agents || agents.length === 0) return [];

    // Build StateContext for the state machine
    const realAgents = agents.filter(a => a.id !== 'solo');
    const smAgents = realAgents.length > 0 ? realAgents : agents;
    const smContext = {
        mode: realAgents.length > 1 ? 'fleet' : 'solo',
        agents: smAgents.map(a => a.id),
        agentStatuses: Object.fromEntries(smAgents.map(a => [a.id, a.status || 'implementing'])),
        tmuxSessionStates: Object.fromEntries(smAgents.map(a => [
            a.id,
            a.tmuxRunning ? 'running' : (a.tmuxSession ? 'exited' : 'none')
        ])),
        currentStage: stage,
        entityType: 'feature'
    };

    // Get recommended actions from state machine, convert to dashboard format
    const recommended = stateMachine.getRecommendedActions('feature', stage, smContext);
    const actions = [];

    const ACTION_REASONS = {
        'feature-open': 'Launch agent on this feature',
        'feature-attach': 'Open terminal to view progress',
        'feature-focus': 'Agent is waiting for input',
        'feature-stop': 'Kill the agent session',
        'feature-eval': stage === 'in-evaluation' ? 'Evaluation in progress' : 'All agents submitted; compare implementations',
        'feature-review': 'Get a code review before closing',
        'feature-close': stage === 'in-evaluation' ? 'Close without further evaluation' : 'Close and merge implementation',
        'feature-setup': 'Set up workspace and begin',
        'feature-autopilot': 'Run parallel agents in autopilot mode'
    };

    recommended.forEach(a => {
        const agentSuffix = a.agentId ? ` ${a.agentId}` : '';
        let command;
        switch (a.action) {
            case 'feature-open':   command = `aigon feature-open ${id}${agentSuffix}`; break;
            case 'feature-attach': command = `aigon terminal-attach ${id}${agentSuffix}`; break;
            case 'feature-focus':  command = `aigon terminal-focus ${id}${agentSuffix}`; break;
            case 'feature-stop':   command = `aigon feature-stop ${id}${agentSuffix}`; break;
            case 'feature-eval':   command = `/afe ${id}`; break;
            case 'feature-review': command = `aigon feature-review ${id}`; break;
            case 'feature-close':  command = `aigon feature-close ${id}${agentSuffix}`; break;
            case 'feature-setup':  command = `aigon feature-setup ${id}`; break;
            case 'feature-autopilot': command = `aigon feature-autopilot ${id}`; break;
            default:               command = `aigon ${a.action} ${id}${agentSuffix}`;
        }
        actions.push({
            command,
            label: a.label,
            reason: ACTION_REASONS[a.action] || '',
            mode: a.mode,
            action: a.action,
            agentId: a.agentId || null
        });
    });

    return actions;
}

function safeTmuxSessionExists(featureId, agentId) {
    if (!agentId || agentId === 'solo') return null;
    try {
        assertTmuxAvailable();
        const defaultSessionName = buildTmuxSessionName(featureId, agentId);

        const listResult = runTmux(['list-sessions', '-F', '#S'], { encoding: 'utf8', stdio: 'pipe' });
        if (!listResult.error && listResult.status === 0) {
            const candidates = listResult.stdout
                .split('\n')
                .map(s => s.trim())
                .filter(Boolean)
                .filter(s => matchTmuxSessionByEntityId(s, featureId)?.agent === agentId);

            if (candidates.length > 0) {
                const clientsResult = runTmux(['list-clients', '-F', '#{session_name}'], { encoding: 'utf8', stdio: 'pipe' });
                const attachedSet = (!clientsResult.error && clientsResult.status === 0)
                    ? new Set(clientsResult.stdout.split('\n').map(s => s.trim()).filter(Boolean))
                    : new Set();

                const attachedCandidates = candidates.filter(name => attachedSet.has(name));
                const pool = attachedCandidates.length > 0 ? attachedCandidates : candidates;
                pool.sort((a, b) => b.length - a.length || a.localeCompare(b));
                return { sessionName: pool[0], running: true };
            }
        }

        return { sessionName: defaultSessionName, running: false };
    } catch (e) {
        return { sessionName: buildTmuxSessionName(featureId, agentId), running: false };
    }
}

function collectDashboardStatusData() {
    const repos = readConductorReposFromGlobalConfig();
    const response = {
        generatedAt: new Date().toISOString(),
        repos: [],
        summary: { implementing: 0, waiting: 0, submitted: 0, error: 0, total: 0 }
    };

    repos.forEach(repoPath => {
        const absRepoPath = path.resolve(repoPath);
        const inProgressDir = path.join(absRepoPath, 'docs', 'specs', 'features', '03-in-progress');
        const inEvalDir = path.join(absRepoPath, 'docs', 'specs', 'features', '04-in-evaluation');
        const evalsDir = path.join(absRepoPath, 'docs', 'specs', 'features', 'evaluations');
        const mainLogsDir = path.join(absRepoPath, 'docs', 'specs', 'features', 'logs');
        const worktreeBaseDir = absRepoPath + '-worktrees';

        const inboxDir = path.join(absRepoPath, 'docs', 'specs', 'features', '01-inbox');
        const backlogDir = path.join(absRepoPath, 'docs', 'specs', 'features', '02-backlog');
        const doneDir = path.join(absRepoPath, 'docs', 'specs', 'features', '05-done');

        const specFiles = []; // { file, stage, dir }
        const stageDirs = [
            { dir: inboxDir, stage: 'inbox' },
            { dir: backlogDir, stage: 'backlog' },
            { dir: inProgressDir, stage: 'in-progress' },
            { dir: inEvalDir, stage: 'in-evaluation' }
        ];
        stageDirs.forEach(({ dir, stage }) => {
            if (fs.existsSync(dir)) {
                try {
                    // Inbox allows files without an ID (feature-name.md); other stages require one
                    const pattern = stage === 'inbox' ? /^feature-.+\.md$/ : /^feature-\d+-.+\.md$/;
                    fs.readdirSync(dir)
                        .filter(f => pattern.test(f))
                        .sort((a, b) => {
                            const mtimeA = (() => { try { return fs.statSync(path.join(dir, a)).mtimeMs; } catch (e) { return 0; } })();
                            const mtimeB = (() => { try { return fs.statSync(path.join(dir, b)).mtimeMs; } catch (e) { return 0; } })();
                            return mtimeB - mtimeA;
                        })
                        .forEach(f => specFiles.push({ file: f, stage, dir }));
                } catch (e) { /* ignore */ }
            }
        });

        // Done: include only the 10 most recent specs by mtime
        let doneTotal = 0;
        let allDoneSpecFiles = []; // full uncapped list for Logs view
        if (fs.existsSync(doneDir)) {
            try {
                const allDone = fs.readdirSync(doneDir)
                    .filter(f => /^feature-\d+-.+\.md$/.test(f));
                doneTotal = allDone.length;
                const doneWithStats = allDone
                    .map(f => {
                        let mtime = 0, birthtime = null;
                        try { const st = fs.statSync(path.join(doneDir, f)); mtime = st.mtime.getTime(); birthtime = st.birthtime.toISOString(); } catch (e) {}
                        return { f, mtime, birthtime };
                    })
                    .sort((a, b) => b.mtime - a.mtime);
                allDoneSpecFiles = doneWithStats;
                doneWithStats.slice(0, 10)
                    .forEach(({ f }) => specFiles.push({ file: f, stage: 'done', dir: doneDir }));
            } catch (e) { /* ignore */ }
        }

        const allLogDirs = [];
        if (fs.existsSync(mainLogsDir)) allLogDirs.push(mainLogsDir);
        if (fs.existsSync(worktreeBaseDir)) {
            try {
                fs.readdirSync(worktreeBaseDir).forEach(dirName => {
                    // Only scan directories matching worktree naming convention
                    if (!/^feature-\d+-[a-z]{2}-.+$/.test(dirName)) return;
                    const wtLogsDir = path.join(worktreeBaseDir, dirName, 'docs', 'specs', 'features', 'logs');
                    if (fs.existsSync(wtLogsDir)) allLogDirs.push(wtLogsDir);
                });
            } catch (e) { /* ignore */ }
        }

        const logsByFeatureAgent = {}; // key: "id:agent" => { status, updatedAt }
        const logsByFeatureSolo = {}; // key: "id" => { status, updatedAt }
        const knownAgentsByFeature = {}; // id => Set(agent)

        // Legacy: scan log dirs for agent discovery and frontmatter status fallback
        allLogDirs.forEach(logDir => {
            try {
                fs.readdirSync(logDir)
                    .filter(f => /^feature-\d+-.+-log\.md$/.test(f))
                    .forEach(logFile => {
                        const logPath = path.join(logDir, logFile);
                        let content = '';
                        try { content = fs.readFileSync(logPath, 'utf8'); } catch (e) { return; }
                        const fm = parseSimpleFrontMatter(content);
                        const status = normalizeDashboardStatus(fm.status);
                        const updatedAt = fm.updated || new Date(fs.statSync(logPath).mtime).toISOString();

                        const arena = logFile.match(/^feature-(\d+)-([a-z]{2})-(.+)-log\.md$/);
                        const solo = !arena && logFile.match(/^feature-(\d+)-(.+)-log\.md$/);
                        if (arena) {
                            const featureId = arena[1];
                            const agent = arena[2];
                            logsByFeatureAgent[`${featureId}:${agent}`] = { status, updatedAt };
                            if (!knownAgentsByFeature[featureId]) knownAgentsByFeature[featureId] = new Set();
                            knownAgentsByFeature[featureId].add(agent);
                        } else if (solo) {
                            logsByFeatureSolo[solo[1]] = { status, updatedAt };
                        }
                    });
            } catch (e) { /* ignore */ }
        });

        // Read coordinator manifests from .aigon/state/ — authoritative source for agent lists
        const stateDir = path.join(absRepoPath, '.aigon', 'state');
        const manifestsByFeatureId = {};
        if (fs.existsSync(stateDir)) {
            try {
                fs.readdirSync(stateDir)
                    .filter(f => /^feature-\d+\.json$/.test(f))
                    .forEach(f => {
                        const m = f.match(/^feature-(\d+)\.json$/);
                        if (!m) return;
                        const featureId = m[1];
                        try {
                            manifestsByFeatureId[featureId] = JSON.parse(fs.readFileSync(path.join(stateDir, f), 'utf8'));
                        } catch (e) { /* corrupted — skip */ }
                    });
            } catch (e) { /* ignore */ }
        }

        // Primary: read manifest state files — these override log frontmatter
        // stateDir already declared above for coordinator manifests
        if (fs.existsSync(stateDir)) {
            try {
                fs.readdirSync(stateDir)
                    .filter(f => /^feature-\d+-[a-z]{2}\.json$/.test(f))
                    .forEach(f => {
                        try {
                            const data = JSON.parse(fs.readFileSync(path.join(stateDir, f), 'utf8'));
                            const m = f.match(/^feature-(\d+)-([a-z]{2})\.json$/);
                            if (!m) return;
                            const featureId = m[1];
                            const agent = m[2];
                            logsByFeatureAgent[`${featureId}:${agent}`] = {
                                status: normalizeDashboardStatus(data.status),
                                updatedAt: data.updatedAt || new Date().toISOString(),
                            };
                            if (!knownAgentsByFeature[featureId]) knownAgentsByFeature[featureId] = new Set();
                            knownAgentsByFeature[featureId].add(agent);
                        } catch (e) { /* ignore */ }
                    });
                // Solo state files: feature-{id}-solo.json
                fs.readdirSync(stateDir)
                    .filter(f => /^feature-\d+-solo\.json$/.test(f))
                    .forEach(f => {
                        try {
                            const data = JSON.parse(fs.readFileSync(path.join(stateDir, f), 'utf8'));
                            const m = f.match(/^feature-(\d+)-solo\.json$/);
                            if (!m) return;
                            logsByFeatureSolo[m[1]] = {
                                status: normalizeDashboardStatus(data.status),
                                updatedAt: data.updatedAt || new Date().toISOString(),
                            };
                        } catch (e) { /* ignore */ }
                    });
            } catch (e) { /* ignore */ }
        }

        const features = [];
        specFiles.forEach(({ file: specFile, stage, dir: specDir }) => {
            const parsed = parseFeatureSpecFileName(specFile);
            if (!parsed) return;

            const specPath = path.join(specDir, specFile);
            let fallbackUpdatedAt = new Date().toISOString();
            let createdAt = fallbackUpdatedAt;
            try {
                const st = fs.statSync(specPath);
                fallbackUpdatedAt = st.mtime.toISOString();
                createdAt = st.birthtime.toISOString();
            } catch (e) { /* ignore */ }

            const agents = [];
            const idPadded = String(parsed.id).padStart(2, '0');
            const featureManifest = parsed.id ? manifestsByFeatureId[parsed.id] : null;
            const featurePending = featureManifest ? (featureManifest.pending || []) : [];

            // Inbox, backlog, and done features have no active agent sessions
            const isActiveStage = stage === 'in-progress' || stage === 'in-evaluation';
            if (isActiveStage) {
                const manifestAgents = featureManifest && Array.isArray(featureManifest.agents) && featureManifest.agents.length > 0
                    ? featureManifest.agents
                    : null;

                if (manifestAgents) {
                    // Manifest-based agent discovery — authoritative, eliminates phantom agents
                    manifestAgents.slice().sort((a, b) => a.localeCompare(b)).forEach(agent => {
                        let agentStatus = 'implementing';
                        let agentUpdatedAt = fallbackUpdatedAt;
                        try {
                            const statusData = JSON.parse(fs.readFileSync(path.join(stateDir, `feature-${parsed.id}-${agent}.json`), 'utf8'));
                            agentStatus = normalizeDashboardStatus(statusData.status);
                            agentUpdatedAt = statusData.updatedAt || agentUpdatedAt;
                        } catch (e) { /* no status file — default to implementing */ }
                        const tmux = safeTmuxSessionExists(parsed.id, agent);
                        agents.push({
                            id: agent,
                            status: agentStatus,
                            updatedAt: agentUpdatedAt,
                            slashCommand: agentStatus === 'waiting' ? `aigon terminal-focus ${idPadded} ${agent}` : null,
                            tmuxSession: tmux ? tmux.sessionName : null,
                            tmuxRunning: tmux ? tmux.running : false,
                            attachCommand: tmux ? `tmux attach -t ${tmux.sessionName}` : null
                        });
                    });
                } else {
                    // Fallback: log-based agent discovery for features without a manifest
                    const agentSet = knownAgentsByFeature[parsed.id] || new Set();
                    const hasFleetAgents = agentSet.size > 0;

                    if (hasFleetAgents) {
                        [...agentSet].sort((a, b) => a.localeCompare(b)).forEach(agent => {
                            const row = logsByFeatureAgent[`${parsed.id}:${agent}`] || { status: 'implementing', updatedAt: fallbackUpdatedAt };
                            const tmux = safeTmuxSessionExists(parsed.id, agent);
                            agents.push({
                                id: agent,
                                status: normalizeDashboardStatus(row.status),
                                updatedAt: row.updatedAt,
                                slashCommand: row.status === 'waiting' ? `aigon terminal-focus ${idPadded} ${agent}` : null,
                                tmuxSession: tmux ? tmux.sessionName : null,
                                tmuxRunning: tmux ? tmux.running : false,
                                attachCommand: tmux ? `tmux attach -t ${tmux.sessionName}` : null
                            });
                        });
                    } else {
                        const row = logsByFeatureSolo[parsed.id] || { status: 'implementing', updatedAt: fallbackUpdatedAt };
                        const launchSessionName = buildTmuxSessionName(parsed.id, 'do', { repo: path.basename(absRepoPath), desc: 'launch' });
                        const soloTmuxRunning = tmuxSessionExists(launchSessionName);
                        agents.push({
                            id: 'solo',
                            status: normalizeDashboardStatus(row.status),
                            updatedAt: row.updatedAt,
                            slashCommand: row.status === 'waiting' ? `aigon terminal-focus ${idPadded}` : null,
                            tmuxSession: soloTmuxRunning ? launchSessionName : null,
                            tmuxRunning: soloTmuxRunning,
                            attachCommand: soloTmuxRunning ? `tmux attach -t ${launchSessionName}` : null
                        });
                    }
                }

                agents.forEach(agent => {
                    response.summary.total++;
                    response.summary[agent.status] = (response.summary[agent.status] || 0) + 1;
                });
            }

            const featureSmContext = {
                mode: agents.filter(a => a.id !== 'solo').length > 1 ? 'fleet' : 'solo',
                agents: agents.map(a => a.id),
                agentStatuses: Object.fromEntries(agents.map(a => [a.id, a.status])),
                tmuxSessionStates: Object.fromEntries(agents.map(a => [a.id, a.tmuxRunning ? 'running' : 'none'])),
                currentStage: stage,
                entityType: 'feature'
            };

            // Compute eval status — check via state machine whether feature-close transition is valid
            // (only true when stage is 'in-evaluation'), never hardcode the stage name
            let evalStatus = null;
            let winnerAgent = null;
            let evalPath = null;
            const isInEvaluation = stateMachine.getValidTransitions('feature', stage, featureSmContext)
                .some(t => t.action === 'feature-close');
            if (isInEvaluation) {
                evalStatus = 'evaluating';
                const evalFile = path.join(evalsDir, `feature-${parsed.id}-eval.md`);
                if (fs.existsSync(evalFile)) {
                    evalPath = evalFile;
                    try {
                        const content = fs.readFileSync(evalFile, 'utf8');
                        const winnerMatch = content.match(/\*\*Winner[:\s]*\*?\*?\s*(.+)/i);
                        if (winnerMatch) {
                            const val = winnerMatch[1].replace(/\*+/g, '').trim();
                            if (val && !val.includes('to be determined') && !val.includes('TBD') && val !== '()') {
                                evalStatus = 'pick winner';
                                // Extract agent ID: "cc (Claude)" → "cc"
                                winnerAgent = val.split(/[\s(]/)[0].toLowerCase() || null;
                            }
                        }
                    } catch (e) { /* skip */ }
                }
            }
            features.push({
                id: parsed.id,
                name: parsed.name,
                stage,
                specPath: path.join(specDir, specFile),
                updatedAt: fallbackUpdatedAt,
                createdAt,
                evalStatus,
                winnerAgent,
                evalPath,
                agents,
                pending: featurePending,
                nextAction: inferDashboardNextCommand(parsed.id, agents, stage),
                nextActions: inferDashboardNextActions(parsed.id, agents, stage),
                validActions: stateMachine.getAvailableActions('feature', stage, featureSmContext)
            });
        });

        // --- Research (all stages) ---
        const researchRoot = path.join(absRepoPath, 'docs', 'specs', 'research-topics');
        const researchLogsDir = path.join(researchRoot, 'logs');
        const research = [];
        let researchDoneTotal = 0;
        const researchStageDirs = [
            { dir: path.join(researchRoot, '01-inbox'), stage: 'inbox' },
            { dir: path.join(researchRoot, '02-backlog'), stage: 'backlog' },
            { dir: path.join(researchRoot, '03-in-progress'), stage: 'in-progress' },
            { dir: path.join(researchRoot, '05-paused'), stage: 'paused' }
        ];
        const researchSpecFiles = []; // { file, stage, dir }
        researchStageDirs.forEach(({ dir, stage }) => {
            if (!fs.existsSync(dir)) return;
            try {
                const pattern = stage === 'inbox' ? /^research-.+\.md$/ : /^research-\d+-.+\.md$/;
                fs.readdirSync(dir)
                    .filter(f => pattern.test(f))
                    .sort((a, b) => a.localeCompare(b))
                    .forEach(f => researchSpecFiles.push({ file: f, stage, dir }));
            } catch (e) { /* ignore */ }
        });
        const researchDoneDir = path.join(researchRoot, '04-done');
        if (fs.existsSync(researchDoneDir)) {
            try {
                const allDone = fs.readdirSync(researchDoneDir).filter(f => /^research-\d+-.+\.md$/.test(f));
                researchDoneTotal = allDone.length;
                allDone
                    .map(f => ({ f, mtime: (() => { try { return fs.statSync(path.join(researchDoneDir, f)).mtime.getTime(); } catch (e) { return 0; } })() }))
                    .sort((a, b) => b.mtime - a.mtime)
                    .slice(0, 10)
                    .forEach(({ f }) => researchSpecFiles.push({ file: f, stage: 'done', dir: researchDoneDir }));
            } catch (e) { /* ignore */ }
        }

        // Build research entries with agent info for in-progress items
        const researchLogsByAgent = {};
        if (fs.existsSync(researchLogsDir)) {
            try {
                fs.readdirSync(researchLogsDir)
                    .filter(f => /^research-(\d+)-([a-z]{2})-findings\.md$/.test(f))
                    .forEach(f => {
                        const rm = f.match(/^research-(\d+)-([a-z]{2})-findings\.md$/);
                        if (!rm) return;
                        let status = 'implementing', updatedAt = new Date().toISOString();
                        try {
                            const content = fs.readFileSync(path.join(researchLogsDir, f), 'utf8');
                            const fm = parseSimpleFrontMatter(content);
                            status = normalizeDashboardStatus(fm.status) || 'implementing';
                            updatedAt = fm.updated || updatedAt;
                        } catch (e) { /* ignore */ }
                        if (!researchLogsByAgent[rm[1]]) researchLogsByAgent[rm[1]] = [];
                        researchLogsByAgent[rm[1]].push({ agent: rm[2], status, updatedAt });
                    });
            } catch (e) { /* ignore */ }
        }

        researchSpecFiles.forEach(({ file, stage, dir: specDir }) => {
            const rm = file.match(/^research-(\d+)-(.+)\.md$/) || file.match(/^research-(.+)\.md$/);
            if (!rm) return;
            const hasId = /^\d+$/.test(rm[1]);
            const id = hasId ? rm[1] : null;
            const name = hasId ? rm[2] : rm[1];

            const agents = [];
            if (id && (stage === 'in-progress') && researchLogsByAgent[id]) {
                researchLogsByAgent[id].forEach(({ agent, status, updatedAt }) => {
                    const sessionName = buildResearchTmuxSessionName(id, agent, { repo: path.basename(absRepoPath) });
                    const tmuxRunning = tmuxSessionExists(sessionName);
                    const idPadded = String(id).padStart(2, '0');
                    agents.push({
                        id: agent, status, updatedAt,
                        slashCommand: status === 'waiting' ? `aigon terminal-focus ${idPadded} ${agent} --research` : null,
                        tmuxSession: tmuxRunning ? sessionName : null,
                        tmuxRunning,
                        attachCommand: tmuxRunning ? `tmux attach -t ${sessionName}` : null
                    });
                    response.summary.total++;
                    response.summary[status] = (response.summary[status] || 0) + 1;
                });
            }

            const researchSmContext = {
                mode: agents.filter(a => a.id !== 'solo').length > 1 ? 'fleet' : 'solo',
                agents: agents.map(a => a.id),
                agentStatuses: Object.fromEntries(agents.map(a => [a.id, a.status])),
                tmuxSessionStates: Object.fromEntries(agents.map(a => [a.id, a.tmuxRunning ? 'running' : 'none'])),
                currentStage: stage,
                entityType: 'research'
            };
            research.push({ id, name, stage, specPath: path.join(specDir, file), agents, validActions: stateMachine.getAvailableActions('research', stage, researchSmContext) });
        });

        // --- Feedback (all stages) ---
        const feedbackRoot = path.join(absRepoPath, 'docs', 'specs', 'feedback');
        const feedback = [];
        let feedbackDoneTotal = 0;
        const feedbackStageDirs = [
            { dir: path.join(feedbackRoot, '01-inbox'), stage: 'inbox' },
            { dir: path.join(feedbackRoot, '02-triaged'), stage: 'triaged' },
            { dir: path.join(feedbackRoot, '03-actionable'), stage: 'actionable' },
            { dir: path.join(feedbackRoot, '05-wont-fix'), stage: 'wont-fix' },
            { dir: path.join(feedbackRoot, '06-duplicate'), stage: 'duplicate' }
        ];
        const feedbackSpecFiles = [];
        feedbackStageDirs.forEach(({ dir, stage }) => {
            if (!fs.existsSync(dir)) return;
            try {
                fs.readdirSync(dir)
                    .filter(f => /^feedback-.+\.md$/.test(f))
                    .sort((a, b) => a.localeCompare(b))
                    .forEach(f => feedbackSpecFiles.push({ file: f, stage, dir }));
            } catch (e) { /* ignore */ }
        });
        const feedbackDoneDir = path.join(feedbackRoot, '04-done');
        if (fs.existsSync(feedbackDoneDir)) {
            try {
                const allDone = fs.readdirSync(feedbackDoneDir).filter(f => /^feedback-.+\.md$/.test(f));
                feedbackDoneTotal = allDone.length;
                allDone
                    .map(f => ({ f, mtime: (() => { try { return fs.statSync(path.join(feedbackDoneDir, f)).mtime.getTime(); } catch (e) { return 0; } })() }))
                    .sort((a, b) => b.mtime - a.mtime)
                    .slice(0, 10)
                    .forEach(({ f }) => feedbackSpecFiles.push({ file: f, stage: 'done', dir: feedbackDoneDir }));
            } catch (e) { /* ignore */ }
        }

        feedbackSpecFiles.forEach(({ file, stage, dir: specDir }) => {
            const fm = file.match(/^feedback-(\d+)-(.+)\.md$/) || file.match(/^feedback-(.+)\.md$/);
            if (!fm) return;
            const hasId = /^\d+$/.test(fm[1]);
            const feedbackSmContext = { mode: 'solo', agents: [], agentStatuses: {}, tmuxSessionStates: {}, currentStage: stage, entityType: 'feedback' };
            feedback.push({ id: hasId ? fm[1] : null, name: hasId ? fm[2] : fm[1], stage, specPath: path.join(specDir, file), agents: [], validActions: stateMachine.getAvailableActions('feedback', stage, feedbackSmContext) });
        });

        // allFeatures: full uncapped list for Logs view
        // Combines existing features array (which carries non-done + top-10 done)
        // with any remaining done features beyond the cap.
        const seenIds = new Set(features.map(f => f.id));
        const extraDone = allDoneSpecFiles
            .filter(({ f }) => {
                const parsed = parseFeatureSpecFileName(f);
                return parsed && !seenIds.has(parsed.id);
            })
            .map(({ f, mtime, birthtime }) => {
                const parsed = parseFeatureSpecFileName(f);
                return {
                    id: parsed.id,
                    name: parsed.name,
                    stage: 'done',
                    specPath: path.join(doneDir, f),
                    updatedAt: new Date(mtime).toISOString(),
                    createdAt: birthtime || new Date(mtime).toISOString()
                };
            });
        // Build map of feature ID → log file paths from flat logs/ directory
        const logPathsByFeatureId = {};
        try {
            if (fs.existsSync(mainLogsDir)) {
                fs.readdirSync(mainLogsDir)
                    .filter(f => /^feature-\d+-.+-log\.md$/.test(f) && !fs.lstatSync(path.join(mainLogsDir, f)).isDirectory())
                    .forEach(f => {
                        const m = f.match(/^feature-(\d+)-/);
                        if (!m) return;
                        const fid = m[1];
                        if (!logPathsByFeatureId[fid]) logPathsByFeatureId[fid] = [];
                        logPathsByFeatureId[fid].push(path.join(mainLogsDir, f));
                    });
            }
        } catch (_) { /* ignore */ }

        const allFeatures = [
            ...features.map(f => ({ id: f.id, name: f.name, stage: f.stage, specPath: f.specPath, updatedAt: f.updatedAt, createdAt: f.createdAt, logPaths: logPathsByFeatureId[f.id] || [] })),
            ...extraDone.map(f => ({ ...f, logPaths: logPathsByFeatureId[f.id] || [] }))
        ];

        response.repos.push({
            path: absRepoPath,
            displayPath: absRepoPath.replace(os.homedir(), '~'),
            name: path.basename(absRepoPath),
            features,
            allFeatures,
            research,
            feedback,
            doneTotal,
            researchDoneTotal,
            feedbackDoneTotal
        });
    });

    return response;
}

function escapeForHtmlScript(jsonValue) {
    return JSON.stringify(jsonValue)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function buildDashboardHtml(initialData, instanceName) {
    const serializedData = escapeForHtmlScript(initialData);
    const serializedName = escapeForHtmlScript(instanceName || 'main');
    const htmlTemplate = readTemplate('dashboard/index.html');
    return htmlTemplate
        .replace('${INITIAL_DATA}', () => serializedData)
        .replace('${INSTANCE_NAME}', () => serializedName);
}

function escapeAppleScriptString(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function captureDashboardScreenshot(url, outputPath, width, height) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    let puppeteer = null;
    try {
        puppeteer = require('puppeteer');
    } catch (e) {
        try { puppeteer = require('puppeteer-core'); } catch (_) { /* ignore */ }
    }

    if (puppeteer) {
        const browser = await puppeteer.launch({ headless: true });
        try {
            const page = await browser.newPage();
            await page.setViewport({ width, height });
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
            await page.screenshot({ path: outputPath, fullPage: true });
            return { method: 'puppeteer' };
        } finally {
            await browser.close();
        }
    }

    if (process.platform !== 'darwin') {
        throw new Error('Screenshot fallback requires macOS when Puppeteer is unavailable');
    }

    const escapedUrl = escapeAppleScriptString(url);
    const scriptLines = [
        'tell application "Safari" to activate',
        `tell application "Safari" to open location "${escapedUrl}"`,
        'delay 2.6',
        'tell application "System Events"',
        'tell process "Safari"',
        'set frontmost to true',
        'set position of front window to {0, 0}',
        `set size of front window to {${width}, ${height}}`,
        'end tell',
        'end tell',
        'delay 1.4'
    ];
    const args = [];
    scriptLines.forEach(line => args.push('-e', line));
    const scriptRun = spawnSync('osascript', args, { stdio: 'ignore' });
    if (scriptRun.status !== 0) {
        throw new Error('AppleScript fallback failed to control Safari window');
    }

    const shot = spawnSync('screencapture', ['-x', '-R', `0,0,${width},${height}`, outputPath], { stdio: 'ignore' });
    if (shot.status !== 0) {
        throw new Error('screencapture failed');
    }
    return { method: 'applescript' };
}

function writeRepoRegistry(repos) {
    let cfg = {};
    try {
        if (fs.existsSync(GLOBAL_CONFIG_PATH)) {
            cfg = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8'));
        }
    } catch (e) { /* start fresh */ }
    cfg.repos = repos;
    if (!fs.existsSync(GLOBAL_CONFIG_DIR)) fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

function sendMacNotification(message, title = 'Aigon Dashboard', { openUrl } = {}) {
    try {
        // Prefer terminal-notifier when available — supports click-to-open actions
        const tnPath = execSync('which terminal-notifier 2>/dev/null', { encoding: 'utf8' }).trim();
        if (tnPath) {
            const args = ['-title', title, '-message', message, '-group', 'aigon', '-sender', 'com.apple.Terminal'];
            if (openUrl) args.push('-open', openUrl);
            execSync(`${tnPath} ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`);
            return;
        }
    } catch (_) {
        // terminal-notifier not found — fall through to osascript
    }
    try {
        execSync(`osascript -e 'display notification "${message}" with title "${title}"'`);
    } catch (e) {
        // Notification failures are non-fatal.
    }
}

const DASHBOARD_INTERACTIVE_ACTIONS = new Set([
    'feature-create',
    'feature-prioritise',
    'feature-setup',
    'feature-do',
    'feature-open',
    'feature-submit',
    'feature-review',
    'feature-eval',
    'feature-close',
    'research-prioritise',
    'research-setup',
    'research-close',
    'feedback-triage',
    'feedback-promote'
]);

// Fire-and-forget and agent-mode state machine actions that can be invoked via /api/action.
// Terminal-mode actions (feature-open, feature-attach, feature-focus) are handled
// by /api/feature-open which creates sessions and opens terminals.
// This set supplements DASHBOARD_INTERACTIVE_ACTIONS to accept all state-machine-defined
// non-terminal actions without requiring a separate hardcoded allowlist.
const SM_INVOCABLE_ACTIONS = (() => {
    const s = new Set();
    Object.values(stateMachine.ENTITY_DEFINITIONS || {}).forEach(def => {
        (def.transitions || []).forEach(t => s.add(t.action));
        (def.actions || []).filter(a => a.mode !== 'terminal').forEach(a => s.add(a.action));
    });
    return s;
})();

function resolveDashboardActionRepoPath(requestedRepoPath, registeredRepos, defaultRepoPath = process.cwd()) {
    const repos = (Array.isArray(registeredRepos) ? registeredRepos : []).map(repo => path.resolve(String(repo)));
    const defaultRepo = defaultRepoPath ? path.resolve(String(defaultRepoPath)) : '';
    const requested = requestedRepoPath ? path.resolve(String(requestedRepoPath)) : '';

    if (requested) {
        if (repos.length > 0 && !repos.includes(requested)) {
            return { ok: false, status: 403, error: 'repoPath is not registered with dashboard' };
        }
        return { ok: true, repoPath: requested };
    }

    if (repos.length === 1) {
        return { ok: true, repoPath: repos[0] };
    }

    if (repos.length > 1) {
        if (defaultRepo && repos.includes(defaultRepo)) {
            return { ok: true, repoPath: defaultRepo };
        }
        return { ok: false, status: 400, error: 'repoPath is required when multiple repos are registered' };
    }

    return { ok: true, repoPath: defaultRepo || process.cwd() };
}

function parseDashboardActionRequest(payload, options = {}) {
    const data = payload && typeof payload === 'object' ? payload : {};
    const action = String(data.action || '').trim();
    if (!action) {
        return { ok: false, status: 400, error: 'action is required' };
    }
    if (!DASHBOARD_INTERACTIVE_ACTIONS.has(action) && !SM_INVOCABLE_ACTIONS.has(action)) {
        return { ok: false, status: 400, error: `Unsupported action: ${action}` };
    }

    const argsRaw = data.args === undefined ? [] : data.args;
    if (!Array.isArray(argsRaw)) {
        return { ok: false, status: 400, error: 'args must be an array of strings' };
    }

    const args = [];
    for (const value of argsRaw) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            args.push(String(value));
            continue;
        }
        return { ok: false, status: 400, error: 'args must contain only strings, numbers, or booleans' };
    }

    const repoResolution = resolveDashboardActionRepoPath(
        data.repoPath,
        options.registeredRepos || [],
        options.defaultRepoPath || process.cwd()
    );
    if (!repoResolution.ok) return repoResolution;

    return {
        ok: true,
        action,
        args,
        repoPath: repoResolution.repoPath
    };
}

function buildDashboardActionCommandArgs(action, args) {
    const actionName = String(action || '').trim();
    const actionArgs = Array.isArray(args) ? args.map(value => String(value)) : [];
    return [CLI_ENTRY_PATH, actionName, ...actionArgs];
}

function runDashboardInteractiveAction(request) {
    const parsed = parseDashboardActionRequest(request, {
        registeredRepos: request && request.registeredRepos,
        defaultRepoPath: request && request.defaultRepoPath
    });
    if (!parsed.ok) {
        return parsed;
    }

    const cliArgs = buildDashboardActionCommandArgs(parsed.action, parsed.args);
    const result = spawnSync(process.execPath, cliArgs, {
        cwd: parsed.repoPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });

    if (result.error) {
        return {
            ok: false,
            status: 500,
            error: `Failed to run action: ${result.error.message}`
        };
    }

    const exitCode = typeof result.status === 'number' ? result.status : 1;
    const payload = {
        ok: exitCode === 0,
        action: parsed.action,
        args: parsed.args,
        repoPath: parsed.repoPath,
        command: `aigon ${parsed.action}${parsed.args.length ? ` ${parsed.args.join(' ')}` : ''}`,
        exitCode,
        stdout: result.stdout || '',
        stderr: result.stderr || ''
    };

    if (exitCode !== 0) {
        return {
            ok: false,
            status: 422,
            error: `Action failed with exit code ${exitCode}`,
            details: payload
        };
    }

    return payload;
}

function runDashboardServer(port, instanceName, serverId) {
    const http = require('http');
    const host = '127.0.0.1';
    instanceName = instanceName || 'main';
    const appId = getAppId();
    const localUrl = `http://${host}:${port}`;
    const proxyAvailable = isProxyAvailable();
    const proxyUrl = proxyAvailable ? getDevProxyUrl(appId, serverId || null) : null;
    const dashboardUrl = proxyUrl || localUrl;
    let latestStatus = collectDashboardStatusData();
    const lastStatusByAgent = {};
    const allSubmittedNotified = new Set();
    let globalConfig = loadGlobalConfig();

    // ── Peek mode state — tracks which sessions have active pipe-pane streams ──
    const peekActiveSessions = new Set();

    // ── Console event buffer ───────────────────────────────────────────────────
    const CONSOLE_BUFFER_MAX = 200;
    const consoleBuffer = []; // { timestamp, type, action, args, repoPath, command, exitCode, ok, stdout, stderr, duration }

    function logToConsole(entry) {
        entry.timestamp = new Date().toISOString();
        consoleBuffer.push(entry);
        if (consoleBuffer.length > CONSOLE_BUFFER_MAX) consoleBuffer.shift();
        log(`${entry.type}: ${entry.command || entry.action} | ok=${entry.ok} exitCode=${entry.exitCode !== undefined ? entry.exitCode : 'n/a'}${entry.stderr ? ' stderr=' + String(entry.stderr).trim().slice(0, 120) : ''}`);
    }

    // ── Notification system ────────────────────────────────────────────────────
    const NOTIFICATION_BUFFER_MAX = 100;
    const notificationBuffer = []; // { id, type, message, meta, timestamp, read }
    let notificationUnreadCount = 0;
    let notificationIdSeq = 0;

    const NOTIFICATION_TYPES = ['agent-waiting', 'agent-submitted', 'all-submitted', 'all-research-submitted', 'error'];

    function getNotificationConfig() {
        const cfg = (globalConfig.notifications) || {};
        return {
            enabled: cfg.enabled !== false,
            types: NOTIFICATION_TYPES.reduce((acc, t) => {
                acc[t] = cfg.types ? cfg.types[t] !== false : true;
                return acc;
            }, {})
        };
    }

    function emitNotification(type, message, meta) {
        const notifCfg = getNotificationConfig();
        const event = {
            id: ++notificationIdSeq,
            type,
            message,
            meta: meta || {},
            timestamp: new Date().toISOString(),
            read: false
        };
        notificationBuffer.push(event);
        if (notificationBuffer.length > NOTIFICATION_BUFFER_MAX) notificationBuffer.shift();
        notificationUnreadCount++;
        log(`Notification [${type}] ${message}`);

        if (notifCfg.enabled && notifCfg.types[type] !== false) {
            const title = (meta && meta.title) || 'Aigon Dashboard';
            const openUrl = (meta && meta.openUrl) || undefined;
            sendMacNotification(message, title, { openUrl });
        }
    }

    function log(msg) {
        try {
            fs.appendFileSync(DASHBOARD_LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
        } catch (e) { /* ignore */ }
    }

    // ── Idle timer removed: dashboard stays alive until Ctrl+C or dev-server stop ──
    function resetIdleTimer() { /* no-op — kept for call-site compatibility */ }

    function pollStatus() {
        latestStatus = collectDashboardStatusData();
        (latestStatus.repos || []).forEach(repo => {
            const repoShort = repo.name || path.basename(repo.path);
            const notifTitle = `Aigon · ${repoShort}`;
            const notifMeta = (extra) => ({ title: notifTitle, openUrl: dashboardUrl, repoPath: repo.path, repoName: repoShort, ...extra });
            (repo.features || []).forEach(feature => {
                (feature.agents || []).forEach(agent => {
                    const key = `${repo.path}:${feature.id}:${agent.id}`;
                    const prev = lastStatusByAgent[key];
                    if (prev && prev !== 'waiting' && agent.status === 'waiting') {
                        emitNotification('agent-waiting', `${agent.id} waiting on #${feature.id} ${feature.name} · ${repoShort}`, notifMeta({ featureId: feature.id, agentId: agent.id }));
                    }
                    lastStatusByAgent[key] = agent.status;
                });

                const featureKey = `${repo.path}:${feature.id}`;
                const agents = Array.isArray(feature.agents) ? feature.agents : [];
                const featureSmCtx = {
                    agents: agents.map(a => a.id),
                    agentStatuses: Object.fromEntries(agents.map(a => [a.id, a.status])),
                    tmuxSessionStates: {}
                };
                if (stateMachine.shouldNotify('feature', feature.stage, featureSmCtx, 'all-submitted') && !allSubmittedNotified.has(featureKey)) {
                    allSubmittedNotified.add(featureKey);
                    emitNotification('all-submitted', `All submitted #${feature.id} ${feature.name} — ready for eval · ${repoShort}`, notifMeta({ featureId: feature.id }));
                }
            });

            // --- Research agent notifications ---
            (repo.research || []).forEach(item => {
                (item.agents || []).forEach(agent => {
                    const key = `${repo.path}:R${item.id}:${agent.id}`;
                    const prev = lastStatusByAgent[key];
                    if (prev && prev !== 'waiting' && agent.status === 'waiting') {
                        emitNotification('agent-waiting', `${agent.id} waiting on R#${item.id} ${item.name} · ${repoShort}`, notifMeta({ researchId: item.id, agentId: agent.id }));
                    }
                    lastStatusByAgent[key] = agent.status;
                });

                const researchKey = `${repo.path}:R${item.id}`;
                const researchSmCtx = {
                    agents: (item.agents || []).map(a => a.id),
                    agentStatuses: Object.fromEntries((item.agents || []).map(a => [a.id, a.status])),
                    tmuxSessionStates: {}
                };
                if (stateMachine.shouldNotify('research', item.stage, researchSmCtx, 'all-submitted') && !allSubmittedNotified.has(researchKey)) {
                    allSubmittedNotified.add(researchKey);
                    emitNotification('all-research-submitted', `All submitted R#${item.id} ${item.name} — ready for synthesis · ${repoShort}`, notifMeta({ researchId: item.id }));
                }
            });
        });
        log(`Poll complete (${(latestStatus.repos || []).length} repo${(latestStatus.repos || []).length === 1 ? '' : 's'})`);
    }

    // Analytics cache: recompute when pollStatus detects new completed features
    let analyticsCache = null;
    let analyticsLastDoneCount = -1;

    function getOrRecomputeAnalytics() {
        // Count done features across all repos to detect changes
        let doneCount = 0;
        const curRepos = readConductorReposFromGlobalConfig();
        curRepos.forEach(rp => {
            const doneDir = path.join(path.resolve(rp), 'docs', 'specs', 'features', '05-done');
            try {
                if (fs.existsSync(doneDir)) {
                    doneCount += fs.readdirSync(doneDir).filter(f => /^feature-\d+-.+\.md$/.test(f)).length;
                }
            } catch (e) { /* ignore */ }
        });
        if (!analyticsCache || doneCount !== analyticsLastDoneCount) {
            analyticsLastDoneCount = doneCount;
            try {
                analyticsCache = _collectAnalyticsData(globalConfig);
            } catch (e) {
                log(`Analytics compute error: ${e.message}`);
                analyticsCache = { generatedAt: new Date().toISOString(), error: e.message };
            }
        }
        return analyticsCache;
    }

    const server = http.createServer((req, res) => {
        const reqPath = (req.url || '/').split('?')[0];
        resetIdleTimer();

        if (reqPath === '/api/attach' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                let payload = {};
                try { payload = body ? JSON.parse(body) : {}; } catch (e) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                    return;
                }

                const featureId = String(payload.featureId || '').trim();
                const agentId = String(payload.agentId || '').trim();
                const repoPath = String(payload.repoPath || '').trim();
                const requestedSession = String(payload.tmuxSession || '').trim();
                if (!featureId || !agentId || agentId === 'solo') {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'featureId and non-solo agentId are required' }));
                    return;
                }

                let tmuxInfo = null;
                if (requestedSession) {
                    const match = matchTmuxSessionByEntityId(requestedSession, featureId);
                    if (!match || match.type !== 'f' || match.agent !== agentId) {
                        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'tmuxSession does not match featureId/agentId' }));
                        return;
                    }
                    tmuxInfo = {
                        sessionName: requestedSession,
                        running: tmuxSessionExists(requestedSession)
                    };
                } else {
                    tmuxInfo = safeTmuxSessionExists(featureId, agentId);
                }
                if (!tmuxInfo || !tmuxInfo.running) {
                    res.writeHead(409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: `tmux session not running for F${featureId} ${agentId}` }));
                    return;
                }
                const sessionName = tmuxInfo.sessionName;

                try {
                    openTerminalAppWithCommand(repoPath || process.cwd(), `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true, message: `Attached to ${sessionName}`, command: `tmux attach -t ${sessionName}` }));
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: `Failed to open terminal: ${e.message}` }));
                }
            });
            return;
        }

        if (reqPath === '/api/feature-open' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                let payload = {};
                try { payload = body ? JSON.parse(body) : {}; } catch (e) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                    return;
                }

                const featureId = String(payload.featureId || '').trim();
                const agentId = String(payload.agentId || '').trim();
                const repoPath = String(payload.repoPath || '').trim();
                const pipelineType = String(payload.pipelineType || 'features').trim();
                const isResearch = pipelineType === 'research';
                const worktreePrefix = isResearch ? 'research' : 'feature';
                if (!featureId || !agentId || agentId === 'solo') {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'featureId and non-solo agentId are required' }));
                    return;
                }

                try {
                    const absRepo = repoPath ? path.resolve(repoPath) : process.cwd();
                    const worktreeBase = absRepo + '-worktrees';
                    let worktreePath = absRepo;
                    if (fs.existsSync(worktreeBase)) {
                        const wtPattern = new RegExp(`^${worktreePrefix}-(\\d+)-([a-z]{2})-.+$`);
                        const entries = fs.readdirSync(worktreeBase).filter(d => {
                            const m = d.match(wtPattern);
                            return m && m[1] === featureId && m[2] === agentId;
                        });
                        if (entries.length > 0) {
                            worktreePath = path.join(worktreeBase, entries[0]);
                        }
                    }

                    // Extract desc from worktree directory name for consistent session naming
                    const wtDirName = path.basename(worktreePath);
                    const wtDescMatch = wtDirName.match(new RegExp(`^${worktreePrefix}-\\d+-[a-z]{2}-(.+)$`));
                    const desc = wtDescMatch ? wtDescMatch[1] : undefined;
                    const sessionName = buildTmuxSessionName(featureId, agentId, { repo: path.basename(absRepo), desc });
                    const tmuxInfo = safeTmuxSessionExists(featureId, agentId);
                    const tmuxSessionState = tmuxInfo && tmuxInfo.running ? 'running' : 'none';

                    // Look up cached agent status so getSessionAction can make the right decision
                    let cachedAgentStatus = 'idle';
                    if (latestStatus && latestStatus.repos) {
                        outer: for (const repo of latestStatus.repos) {
                            for (const entity of [...(repo.features || []), ...(repo.research || [])]) {
                                if (String(entity.id) === String(featureId)) {
                                    const a = (entity.agents || []).find(ag => ag.id === agentId);
                                    if (a) { cachedAgentStatus = a.status || 'idle'; break outer; }
                                }
                            }
                        }
                    }

                    const { action: sessionAction, needsAgentCommand } = stateMachine.getSessionAction(agentId, {
                        tmuxSessionStates: { [agentId]: tmuxSessionState },
                        agentStatuses: { [agentId]: cachedAgentStatus }
                    });

                    // Build the agent startup command (used for create-and-start and send-keys)
                    const agentCmd = isResearch
                        ? buildResearchAgentCommand(agentId, featureId)
                        : buildAgentCommand({ agent: agentId, featureId, path: worktreePath, desc });

                    if (sessionAction === 'attach') {
                        const activeSession = tmuxInfo.sessionName;
                        openTerminalAppWithCommand(worktreePath, `tmux attach -t ${shellQuote(activeSession)}`, activeSession);
                        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ ok: true, message: `Attached to ${activeSession}`, sessionName: activeSession }));
                    } else if (sessionAction === 'send-keys') {
                        // Session alive but agent done — resend the agent command in the existing session
                        const activeSession = tmuxInfo.sessionName;
                        runTmux(['send-keys', '-t', activeSession, agentCmd, 'Enter'], { stdio: 'ignore' });
                        openTerminalAppWithCommand(worktreePath, `tmux attach -t ${shellQuote(activeSession)}`, activeSession);
                        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ ok: true, message: `Restarted agent in ${activeSession}`, sessionName: activeSession }));
                    } else {
                        // create-and-start
                        createDetachedTmuxSession(sessionName, worktreePath, agentCmd);
                        openTerminalAppWithCommand(worktreePath, `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
                        const label = isResearch ? `R${featureId}` : `F${featureId}`;
                        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ ok: true, message: `Opened worktree for ${label} ${agentId}`, sessionName }));
                    }
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: `Failed to open worktree: ${e.message}` }));
                }
            });
            return;
        }

        if (reqPath === '/api/session/ask' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                let payload = {};
                try { payload = body ? JSON.parse(body) : {}; } catch (e) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'Invalid JSON body' })); return;
                }
                const repoPath = String(payload.repoPath || '').trim();
                const agentId = String(payload.agentId || 'cc').trim();
                const prompt = String(payload.prompt || '').trim();
                if (!repoPath) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'repoPath is required' })); return;
                }
                try {
                    const absRepo = path.resolve(repoPath);
                    const repoName = path.basename(absRepo);
                    const sessionName = `ask-${repoName}-${agentId}`;
                    const cliConfig = getAgentCliConfig(agentId);
                    const agentBin = cliConfig.command || agentId;
                    const flags = cliConfig.implementFlag || '';
                    const promptArg = prompt ? ' ' + shellQuote(prompt) : '';
                    const agentCmd = flags ? `${agentBin} ${flags}${promptArg}` : `${agentBin}${promptArg}`;
                    if (tmuxSessionExists(sessionName)) {
                        openTerminalAppWithCommand(absRepo, `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
                        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ ok: true, message: `Attached to existing session ${sessionName}`, sessionName }));
                    } else {
                        createDetachedTmuxSession(sessionName, absRepo, agentCmd);
                        openTerminalAppWithCommand(absRepo, `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
                        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ ok: true, message: `Started ask session for ${repoName} (${agentId})`, sessionName }));
                    }
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: `Failed to start ask session: ${e.message}` }));
                }
            });
            return;
        }

        if (reqPath === '/api/open-terminal' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                let payload = {};
                try { payload = body ? JSON.parse(body) : {}; } catch (e) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                    return;
                }
                const command = String(payload.command || '').trim();
                const cwd = String(payload.cwd || '').trim() || process.cwd();
                if (!command) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'command is required' }));
                    return;
                }
                try {
                    openTerminalAppWithCommand(cwd, command, command.split(' ').slice(0, 3).join(' '));
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true }));
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: `Failed to open terminal: ${e.message}` }));
                }
            });
            return;
        }

        if (reqPath === '/api/refresh' && req.method === 'POST') {
            pollStatus();
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify(latestStatus));
            return;
        }

        if (reqPath === '/api/action' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                let payload = {};
                try { payload = body ? JSON.parse(body) : {}; } catch (e) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                    return;
                }

                const actionStartTime = Date.now();
                const result = runDashboardInteractiveAction({
                    ...payload,
                    registeredRepos: readConductorReposFromGlobalConfig(),
                    defaultRepoPath: process.cwd()
                });
                const actionDuration = Date.now() - actionStartTime;

                logToConsole({
                    type: 'action',
                    action: payload.action,
                    args: payload.args || [],
                    repoPath: result.repoPath,
                    command: result.command,
                    exitCode: result.exitCode,
                    ok: result.ok,
                    stdout: result.stdout || '',
                    stderr: result.stderr || '',
                    duration: actionDuration
                });

                if (!result.ok) {
                    res.writeHead(result.status || 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({
                        error: result.error || 'Action failed',
                        details: result.details || null
                    }));
                    return;
                }

                // Treat stderr containing an error emoji as a failure even when exit code is 0
                if (result.stderr && /^❌/.test(String(result.stderr).trim())) {
                    const errMsg = String(result.stderr).trim().split('\n')[0].replace(/^❌\s*/, '');
                    log(`Action stderr error (exit 0): ${errMsg}`);
                    res.writeHead(422, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: errMsg, details: result }));
                    return;
                }

                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify(result));
            });
            return;
        }

        if (reqPath === '/api/status') {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify(latestStatus));
            return;
        }

        if (reqPath === '/api/repos') {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ repos: readConductorReposFromGlobalConfig() }));
            return;
        }

        if (reqPath === '/api/analytics') {
            const forceReload = (req.url || '').includes('force=1');
            if (forceReload) analyticsCache = null;
            const analytics = getOrRecomputeAnalytics();
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify(analytics));
            return;
        }

        // Create a new spec in the inbox
        if (reqPath === '/api/spec/create' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                try {
                    const payload = JSON.parse(body || '{}');
                    const repoPath = String(payload.repoPath || '').trim();
                    const type = String(payload.type || '').trim(); // features, research, feedback
                    const name = String(payload.name || '').trim();
                    if (!repoPath || !type || !name) {
                        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'Missing repoPath, type, or name' }));
                        return;
                    }
                    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                    if (!slug) {
                        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'Invalid name' }));
                        return;
                    }
                    let inboxDir, fileName, template;
                    const titleName = name;
                    if (type === 'features') {
                        inboxDir = path.join(repoPath, 'docs', 'specs', 'features', '01-inbox');
                        fileName = `feature-${slug}.md`;
                        template = `# Feature: ${titleName}\n\n## Summary\n\nDescribe the feature here.\n\n## User Stories\n\n- [ ] As a user, I can ...\n\n## Acceptance Criteria\n\n- [ ] ...\n\n## Technical Approach\n\n...\n\n## Validation\n\n...\n\n## Dependencies\n\n- None\n\n## Out of Scope\n\n- ...\n`;
                    } else if (type === 'research') {
                        inboxDir = path.join(repoPath, 'docs', 'specs', 'research-topics', '01-inbox');
                        fileName = `research-${slug}.md`;
                        template = `# Research: ${titleName}\n\n## Context\n\nDescribe the research question or problem here.\n\n## Questions to Answer\n\n1. ...\n\n## Approach\n\n...\n\n## Success Criteria\n\nWhat does a good answer look like?\n`;
                    } else if (type === 'feedback') {
                        inboxDir = path.join(repoPath, 'docs', 'specs', 'feedback', '01-inbox');
                        fileName = `feedback-${slug}.md`;
                        template = `---\ntitle: "${name}"\nstatus: "inbox"\ntype: "bug"\nreporter:\n  name: ""\n  identifier: ""\nsource:\n  channel: "dashboard"\n  reference: ""\n---\n\n## Summary\n\nDescribe the feedback here.\n\n## Steps to Reproduce\n\n1. ...\n\n## Expected Behaviour\n\n...\n\n## Actual Behaviour\n\n...\n`;
                    } else {
                        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'Invalid type: ' + type }));
                        return;
                    }
                    if (!fs.existsSync(inboxDir)) fs.mkdirSync(inboxDir, { recursive: true });
                    const filePath = path.join(inboxDir, fileName);
                    if (fs.existsSync(filePath)) {
                        res.writeHead(409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'File already exists: ' + fileName }));
                        return;
                    }
                    fs.writeFileSync(filePath, template, 'utf8');
                    log(`Created ${type} spec via dashboard: ${filePath}`);
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true, path: filePath, name: slug }));
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // Read a spec file
        if (reqPath.startsWith('/api/spec') && req.method === 'GET') {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const filePath = url.searchParams.get('path') || '';
            if (!filePath || !filePath.endsWith('.md') || !fs.existsSync(filePath)) {
                res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: 'File not found' }));
                return;
            }
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ content, path: filePath }));
            } catch (e) {
                res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: e.message }));
            }
            return;
        }

        // Write a spec file
        if (reqPath === '/api/spec' && req.method === 'PUT') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                try {
                    const payload = JSON.parse(body || '{}');
                    const filePath = String(payload.path || '').trim();
                    const content = payload.content;
                    if (!filePath || !filePath.endsWith('.md') || typeof content !== 'string') {
                        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'Invalid path or content' }));
                        return;
                    }
                    if (!fs.existsSync(filePath)) {
                        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'File does not exist' }));
                        return;
                    }
                    fs.writeFileSync(filePath, content, 'utf8');
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true }));
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // Open file in default editor
        if (reqPath === '/api/open-in-editor' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                try {
                    const payload = JSON.parse(body || '{}');
                    const filePath = String(payload.path || '').trim();
                    if (!filePath || !fs.existsSync(filePath)) {
                        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'File not found' }));
                        return;
                    }
                    execSync(`open ${JSON.stringify(filePath)}`);
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true }));
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        if (reqPath === '/api/open-folder' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                try {
                    const payload = JSON.parse(body || '{}');
                    const folderPath = String(payload.path || '').trim();
                    if (!folderPath || !fs.existsSync(folderPath)) {
                        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'Path does not exist' }));
                        return;
                    }
                    execSync(`open ${JSON.stringify(folderPath)}`);
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true }));
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        if (reqPath === '/api/repos/add' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                try {
                    const payload = JSON.parse(body || '{}');
                    const repoPath = String(payload.path || '').trim();
                    if (!repoPath) {
                        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'path is required' }));
                        return;
                    }
                    const expandedPath = repoPath.startsWith('~') ? repoPath.replace(/^~/, os.homedir()) : repoPath;
                    const absPath = path.resolve(expandedPath);
                    if (!fs.existsSync(absPath)) {
                        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'Path does not exist: ' + absPath }));
                        return;
                    }
                    const repos = readConductorReposFromGlobalConfig();
                    if (repos.includes(absPath)) {
                        res.writeHead(409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'Repo already registered' }));
                        return;
                    }
                    repos.push(absPath);
                    writeRepoRegistry(repos);
                    log(`Repo added via dashboard: ${absPath}`);
                    latestStatus = collectDashboardStatusData();
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true, repos }));
                } catch (e) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        if (reqPath === '/api/repos/remove' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                try {
                    const payload = JSON.parse(body || '{}');
                    const repoPath = String(payload.path || '').trim();
                    if (!repoPath) {
                        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'path is required' }));
                        return;
                    }
                    const repos = readConductorReposFromGlobalConfig();
                    const filtered = repos.filter(r => r !== repoPath);
                    if (filtered.length === repos.length) {
                        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: 'Repo not found in registry' }));
                        return;
                    }
                    writeRepoRegistry(filtered);
                    log(`Repo removed via dashboard: ${repoPath}`);
                    latestStatus = collectDashboardStatusData();
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true, repos: filtered }));
                } catch (e) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // ── Session endpoints ──────────────────────────────────────────────────

        if (reqPath === '/api/sessions' && req.method === 'GET') {
            try {
                const enriched = getEnrichedSessions();
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify(enriched));
            } catch (e) {
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ sessions: [], orphanCount: 0, error: e.message }));
            }
            return;
        }

        if (reqPath === '/api/sessions/cleanup' && req.method === 'POST') {
            try {
                const enriched = getEnrichedSessions();
                const orphans = enriched.sessions.filter(s => s.orphan);
                const killed = [];
                for (const s of orphans) {
                    try {
                        runTmux(['kill-session', '-t', s.name], { stdio: 'ignore' });
                        killed.push(s.name);
                        log(`Orphan killed: ${s.name} (reason: ${s.orphan.reason})`);
                    } catch (e) { /* ignore individual failures */ }
                }
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ ok: true, killed, count: killed.length }));
            } catch (e) {
                res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: e.message }));
            }
            return;
        }

        if (reqPath === '/api/session/run' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                let payload = {};
                try { payload = JSON.parse(body || '{}'); } catch (e) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'Invalid JSON body' })); return;
                }
                const command = String(payload.command || '').trim();
                const cwd = String(payload.cwd || '').trim() || process.cwd();
                if (!command) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'command is required' })); return;
                }
                try {
                    const effectiveCwd = fs.existsSync(cwd) ? cwd : process.cwd();
                    const sessionStartTime = Date.now();
                    const result = spawnSync('sh', ['-c', command], {
                        cwd: effectiveCwd,
                        encoding: 'utf8',
                        timeout: 120000,
                        maxBuffer: 1024 * 1024,
                        env: { ...process.env, AIGON_DASHBOARD: '1' }
                    });
                    const exitCode = result.status !== null ? result.status : 1;
                    logToConsole({
                        type: 'session',
                        action: 'session/run',
                        args: [],
                        repoPath: effectiveCwd,
                        command,
                        exitCode,
                        ok: exitCode === 0,
                        stdout: result.stdout || '',
                        stderr: result.stderr || '',
                        duration: Date.now() - sessionStartTime
                    });
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: exitCode === 0, stdout: result.stdout || '', stderr: result.stderr || '', exitCode }));
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        if (reqPath === '/api/session/stop' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                let payload = {};
                try { payload = JSON.parse(body || '{}'); } catch (e) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'Invalid JSON body' })); return;
                }
                const sessionName = String(payload.sessionName || '').trim();
                if (!sessionName) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'sessionName is required' })); return;
                }
                try {
                    // Clean up any active peek pipe before killing
                    if (peekActiveSessions.has(sessionName)) {
                        try { runTmux(['pipe-pane', '-t', sessionName], { stdio: 'ignore' }); } catch (_) {}
                        peekActiveSessions.delete(sessionName);
                        const peekFile = path.join(os.tmpdir(), `aigon-peek-${sessionName.replace(/[^a-zA-Z0-9_-]/g, '_')}.log`);
                        try { fs.unlinkSync(peekFile); } catch (_) {}
                    }
                    runTmux(['kill-session', '-t', sessionName], { stdio: 'ignore' });
                    log(`Session killed: ${sessionName}`);
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true }));
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        if (reqPath === '/api/session/status' && req.method === 'GET') {
            const sessionParam = (req.url || '').split('?')[1] || '';
            const session = (sessionParam.match(/(?:^|&)session=([^&]*)/) || [])[1] || '';
            if (!session) {
                res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: 'session query param is required' })); return;
            }
            const running = tmuxSessionExists(session);
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ running }));
            return;
        }

        // ── Session View — focus the iTerm2 window for a tmux session ────────
        if (reqPath === '/api/session/view' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                let payload = {};
                try { payload = JSON.parse(body || '{}'); } catch (e) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'Invalid JSON body' })); return;
                }
                const sessionName = String(payload.sessionName || '').trim();
                if (!sessionName) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'sessionName is required' })); return;
                }
                if (!tmuxSessionExists(sessionName)) {
                    res.writeHead(409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: `Session "${sessionName}" is not running` })); return;
                }
                try {
                    openTerminalAppWithCommand(process.cwd(), `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true, message: `Viewing ${sessionName}` }));
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: `Failed to open terminal: ${e.message}` }));
                }
            });
            return;
        }

        // ── Session Peek — stream incremental tmux output ────────────────────
        if (reqPath === '/api/session-peek' && req.method === 'GET') {
            const qs = (req.url || '').split('?')[1] || '';
            const nameMatch = qs.match(/(?:^|&)name=([^&]*)/);
            const sinceMatch = qs.match(/(?:^|&)since=([^&]*)/);
            const sessionName = decodeURIComponent(nameMatch ? nameMatch[1] : '').trim();
            const since = parseInt(sinceMatch ? sinceMatch[1] : '0', 10) || 0;

            if (!sessionName) {
                res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: 'name query param is required' })); return;
            }
            if (!tmuxSessionExists(sessionName)) {
                res.writeHead(409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: `Session "${sessionName}" is not running`, alive: false })); return;
            }

            const peekFile = path.join(os.tmpdir(), `aigon-peek-${sessionName.replace(/[^a-zA-Z0-9_-]/g, '_')}.log`);

            // Start pipe-pane if not already piping
            if (!peekActiveSessions.has(sessionName)) {
                try {
                    // Clear any stale log file
                    try { fs.writeFileSync(peekFile, ''); } catch (_) {}
                    runTmux(['pipe-pane', '-t', sessionName, '-o', `cat >> ${shellQuote(peekFile)}`], { stdio: 'ignore' });
                    peekActiveSessions.add(sessionName);
                    log(`Peek started for session: ${sessionName}`);
                } catch (e) {
                    // Fallback: capture-pane snapshot
                    try {
                        const snap = runTmux(['capture-pane', '-t', sessionName, '-p', '-S', '-50'], { encoding: 'utf8', stdio: 'pipe' });
                        const output = (!snap.error && snap.status === 0) ? snap.stdout : '';
                        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ output, offset: 0, alive: true, fallback: true })); return;
                    } catch (e2) {
                        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ error: `Failed to capture pane: ${e2.message}` })); return;
                    }
                }
            }

            // Read incremental output from peek file
            try {
                let output = '';
                let newOffset = since;
                if (fs.existsSync(peekFile)) {
                    const stat = fs.statSync(peekFile);
                    if (stat.size > since) {
                        const fd = fs.openSync(peekFile, 'r');
                        const buf = Buffer.alloc(Math.min(stat.size - since, 65536));
                        const bytesRead = fs.readSync(fd, buf, 0, buf.length, since);
                        fs.closeSync(fd);
                        output = buf.slice(0, bytesRead).toString('utf8');
                        newOffset = since + bytesRead;
                    } else {
                        newOffset = stat.size;
                    }
                }
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ output, offset: newOffset, alive: true }));
            } catch (e) {
                res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: e.message }));
            }
            return;
        }

        // ── Session Peek Stop — clean up pipe-pane ───────────────────────────
        if (reqPath === '/api/session-peek/stop' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                let payload = {};
                try { payload = JSON.parse(body || '{}'); } catch (_) {}
                const sessionName = String(payload.sessionName || '').trim();
                if (sessionName && peekActiveSessions.has(sessionName)) {
                    try { runTmux(['pipe-pane', '-t', sessionName], { stdio: 'ignore' }); } catch (_) {}
                    peekActiveSessions.delete(sessionName);
                    // Clean up temp file
                    const peekFile = path.join(os.tmpdir(), `aigon-peek-${sessionName.replace(/[^a-zA-Z0-9_-]/g, '_')}.log`);
                    try { fs.unlinkSync(peekFile); } catch (_) {}
                    log(`Peek stopped for session: ${sessionName}`);
                }
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ ok: true }));
            });
            return;
        }

        // ── Session Input — send keys to tmux session ────────────────────────
        if (reqPath === '/api/session-input' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                let payload = {};
                try { payload = JSON.parse(body || '{}'); } catch (e) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'Invalid JSON body' })); return;
                }
                const sessionName = String(payload.name || '').trim();
                const text = String(payload.text || '');
                if (!sessionName) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'name is required' })); return;
                }
                if (!tmuxSessionExists(sessionName)) {
                    res.writeHead(409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: `Session "${sessionName}" is not running` })); return;
                }
                // Sanitize: strip tmux escape sequences (prefix key default is Ctrl-B)
                const sanitized = text.replace(/[\x00-\x08\x0e-\x1f]/g, '');
                try {
                    runTmux(['send-keys', '-t', sessionName, sanitized, 'Enter'], { stdio: 'ignore' });
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true }));
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        // ── Notification API ───────────────────────────────────────────────────
        if (reqPath === '/api/console' && req.method === 'GET') {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ events: consoleBuffer.slice() }));
            return;
        }

        if (reqPath === '/api/notifications' && req.method === 'GET') {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ events: notificationBuffer.slice(), unreadCount: notificationUnreadCount }));
            return;
        }

        if (reqPath === '/api/notifications/read' && req.method === 'POST') {
            notificationBuffer.forEach(e => { e.read = true; });
            notificationUnreadCount = 0;
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        if (reqPath === '/api/settings/notifications' && req.method === 'GET') {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify(getNotificationConfig()));
            return;
        }

        if (reqPath === '/api/settings/notifications' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                try {
                    const updates = JSON.parse(body || '{}');
                    // Read raw config file to avoid persisting computed defaults
                    let rawConfig = {};
                    try { rawConfig = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8')); } catch (_) {}
                    const current = rawConfig.notifications || {};
                    const merged = { ...current };
                    if (typeof updates.enabled === 'boolean') merged.enabled = updates.enabled;
                    if (updates.types && typeof updates.types === 'object') {
                        merged.types = { ...(current.types || {}), ...updates.types };
                    }
                    rawConfig.notifications = merged;
                    saveGlobalConfig(rawConfig);
                    // Reload so in-memory state reflects new config
                    globalConfig = loadGlobalConfig();
                    log(`Notification settings updated: ${JSON.stringify(merged)}`);
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true, notifications: getNotificationConfig() }));
                } catch (e) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        if (reqPath.startsWith('/assets/')) {
            const assetFile = path.join(ROOT_DIR, reqPath);
            if (fs.existsSync(assetFile) && fs.statSync(assetFile).isFile()) {
                const ext = path.extname(assetFile).toLowerCase();
                const mime = { '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }[ext] || 'application/octet-stream';
                res.writeHead(200, { 'content-type': mime, 'cache-control': 'max-age=86400' });
                res.end(fs.readFileSync(assetFile));
            } else {
                res.writeHead(404);
                res.end();
            }
            return;
        }

        if (reqPath === '/favicon.ico') {
            const icoFile = path.join(ROOT_DIR, 'assets/icon/favicon.ico');
            if (fs.existsSync(icoFile)) {
                res.writeHead(200, { 'content-type': 'image/x-icon', 'cache-control': 'max-age=86400' });
                res.end(fs.readFileSync(icoFile));
            } else {
                res.writeHead(204);
                res.end();
            }
            return;
        }

        // Dashboard static JS and CSS modules
        if (reqPath.startsWith('/js/') || reqPath === '/styles.css') {
            const dashFile = path.join(ROOT_DIR, 'templates', 'dashboard', reqPath);
            if (fs.existsSync(dashFile) && fs.statSync(dashFile).isFile()) {
                const ext = path.extname(dashFile).toLowerCase();
                const mime = ext === '.css' ? 'text/css' : 'application/javascript';
                res.writeHead(200, { 'content-type': mime + '; charset=utf-8', 'cache-control': 'no-store' });
                res.end(fs.readFileSync(dashFile, 'utf8'));
            } else {
                res.writeHead(404);
                res.end();
            }
            return;
        }

        const html = buildDashboardHtml(latestStatus, instanceName);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(html);
    });

    const registryServerId = serverId || '';

    const shutdown = () => {
        log(`Dashboard shutting down (PID ${process.pid})`);
        deregisterDevServer(appId, registryServerId);
        server.close(() => process.exit(0));
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    server.listen(port, host, () => {
        registerDevServer(appId, registryServerId, port, process.cwd(), process.pid);
        log(`Dashboard started (PID ${process.pid}, port ${port})`);
        if (proxyUrl) {
            console.log(`🚀 Dashboard: ${proxyUrl}  (also: ${localUrl})`);
        } else {
            console.log(`🚀 Dashboard: ${localUrl}`);
        }
        console.log('   Press Ctrl+C to stop');
        pollStatus();
        setInterval(pollStatus, 10000);
        resetIdleTimer();
        try { openInBrowser(dashboardUrl); } catch (e) { /* non-fatal */ }
    });
}

module.exports = {
    readConductorReposFromGlobalConfig,
    parseSimpleFrontMatter,
    normalizeDashboardStatus,
    parseFeatureSpecFileName,
    inferDashboardNextCommand,
    inferDashboardNextActions,
    safeTmuxSessionExists,
    collectDashboardStatusData,
    escapeForHtmlScript,
    buildDashboardHtml,
    escapeAppleScriptString,
    captureDashboardScreenshot,
    writeRepoRegistry,
    sendMacNotification,
    DASHBOARD_INTERACTIVE_ACTIONS,
    resolveDashboardActionRepoPath,
    parseDashboardActionRequest,
    buildDashboardActionCommandArgs,
    runDashboardInteractiveAction,
    runDashboardServer,
};
