'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');
const git = require('./git');
const stateMachine = require('./state-queries');
const { isProAvailable, getPro } = require('./pro');
const workflowReadModel = require('./workflow-read-model');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const featureDashboardModel = require('./feature-dashboard-model');
const featureReviewState = require('./feature-review-state');
const featureSpecResolver = require('./feature-spec-resolver');
const { collectDashboardStatusData } = require('./dashboard-status-collector');
const {
    normalizeDashboardStatus,
    parseFeatureSpecFileName,
    findTmuxSessionsByPrefix,
    findFirstTmuxSessionByPrefix,
    safeTmuxSessionExists,
    resolveFeatureWorktreePath,
    detectDefaultBranch,
    parseStatusFlags,
    maybeFlagEndedSession,
} = require('./dashboard-status-helpers');
// Supervisor integration: startSupervisorLoop and getSupervisorStatus are
// injected via serverOptions by the infra.js command handler, NOT imported
// directly — the HTTP module has zero imports of the supervisor module.

// Constants from config.js
const {
    GLOBAL_CONFIG_PATH, GLOBAL_CONFIG_DIR, DASHBOARD_LOG_FILE, ROOT_DIR, CLI_ENTRY_PATH,
    DASHBOARD_DYNAMIC_PORT_START, DASHBOARD_DYNAMIC_PORT_END,
    loadGlobalConfig, saveGlobalConfig, getAgentCliConfig,
    readConductorReposFromGlobalConfig, loadProjectConfig,
    getNestedValue, setNestedValue, DEFAULT_GLOBAL_CONFIG, getConfigModelValue,
} = require('./config');
// Proxy functions
const {
    getAppId, isProxyAvailable, getDevProxyUrl, openInBrowser,
    registerDevServer, deregisterDevServer,
    loadProxyRegistry, isProcessAlive,
} = require('./proxy');

// Agent status functions
const { writeAgentStatusAt } = require('./agent-status');

// Entity/dependency functions
const { buildFeatureIndex, buildDependencyGraph, buildFeatureDependencySvg } = require('./entity');

// Template functions
const { readTemplate } = require('./templates');

// Worktree/tmux functions
const {
    assertTmuxAvailable, buildTmuxSessionName, buildResearchTmuxSessionName,
    matchTmuxSessionByEntityId, tmuxSessionExists, createDetachedTmuxSession,
    getEnrichedSessions, runTmux, openTerminalAppWithCommand, shellQuote,
    buildAgentCommand, buildResearchAgentCommand, tileITerm2Windows, toUnpaddedId,
} = require('./worktree');

// Platform-aware file/URL opener (macOS: open, Linux: xdg-open)
function platformOpen(target) {
    const cmd = process.platform === 'linux' ? 'xdg-open' : 'open';
    execSync(`${cmd} ${JSON.stringify(target)}`);
}

// Lazy require to avoid circular dependency (utils.js requires this module)
function _collectAnalyticsData(globalConfig) {
    return require('./utils').collectAnalyticsData(globalConfig);
}

/**
 * On-demand dependency graph: if filePath is a feature spec with depends_on,
 * generate the SVG and append it to the content string (without writing to disk).
 */
function _appendDependencyGraph(filePath, content) {
    // Only for feature specs
    const featureMatch = filePath.match(/\/docs\/specs\/features\/[^/]+\/feature-(\d+)-/);
    if (!featureMatch) return content;
    const featureId = featureMatch[1];

    // Derive repo root and build paths object for this repo
    const repoRoot = filePath.replace(/\/docs\/specs\/features\/.*$/, '');
    const featurePaths = {
        root: path.join(repoRoot, 'docs', 'specs', 'features'),
        folders: ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'],
    };

    try {
        const { parseFrontMatter } = require('./utils');
        const featureIndex = buildFeatureIndex(featurePaths);
        const graph = buildDependencyGraph(featurePaths, { parseFrontMatter }, featureIndex);

        // Check if this feature is part of the graph at all (as dependent or dependency)
        const isInGraph = graph.has(featureId) ||
            [...graph.values()].some(deps => deps.includes(featureId));
        if (!isInGraph) return content;

        const svg = buildFeatureDependencySvg(featureId, featureIndex, graph);
        if (svg) {
            return content + '\n## Dependency Graph\n\n' + svg + '\n';
        }
    } catch (e) {
        // Non-fatal — just return content without graph
    }
    return content;
}

function stripAnsi(str) {
    return str
        .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')     // CSI sequences (including DEC private mode ?2026h etc)
        .replace(/\x1b\][^\x07]*\x07/g, '')           // OSC sequences
        .replace(/\x1b[()][A-Z0-9]/g, '')              // charset sequences
        .replace(/\x1b[\x20-\x2f]*[\x40-\x7e]/g, '')  // other escapes
        .replace(/[\x00-\x08\x0b\x0e-\x1f\x7f]/g, '') // control chars (keep \t \n \r)
        .replace(/\n{3,}/g, '\n\n');                    // collapse 3+ blank lines to 2
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

function extractMarkdownSection(content, heading) {
    if (!content || !heading) return '';
    const escaped = String(heading).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^##\\s+${escaped}\\s*\\r?\\n([\\s\\S]*?)(?=^##\\s+|$)`, 'im');
    const m = content.match(re);
    return m ? m[1].trim() : '';
}

function resolveDetailRepoPath(registeredRepos, options = {}) {
    const repos = Array.isArray(registeredRepos) ? registeredRepos.map(r => path.resolve(String(r))) : [];
    const explicit = String(options.repoPath || '').trim();
    const specPath = String(options.specPath || '').trim();
    const type = String(options.type || '').trim();
    const id = String(options.id || '').trim();

    if (explicit) {
        const abs = path.resolve(explicit);
        if (repos.length > 0 && !repos.includes(abs)) return null;
        return abs;
    }

    if (specPath) {
        const absSpec = path.resolve(specPath);
        const byPrefix = repos.find(repo => absSpec.startsWith(repo + path.sep));
        if (byPrefix) return byPrefix;
    }

    if (repos.length === 1) return repos[0];

    if (repos.length > 1 && id) {
        for (const repo of repos) {
            if (type === 'feature') {
                const snapshot = workflowSnapshotAdapter.readFeatureSnapshotSync(repo, id);
                const resolvedSpec = featureSpecResolver.resolveFeatureSpec(repo, id, { snapshot });
                if (snapshot || resolvedSpec.path) return repo;
                continue;
            }

            const inProgress = path.join(repo, 'docs', 'specs', type === 'research' ? 'research-topics' : 'features', '03-in-progress');
            const inEval = path.join(repo, 'docs', 'specs', type === 'research' ? 'research-topics' : 'features', '04-in-evaluation');
            const done = path.join(repo, 'docs', 'specs', type === 'research' ? 'research-topics' : 'features', '05-done');
            const prefix = type === 'research' ? `research-${id}-` : `feature-${id}-`;
            const hit = [inProgress, inEval, done].some(dir => {
                try {
                    return fs.existsSync(dir) && fs.readdirSync(dir).some(f => f.startsWith(prefix) && f.endsWith('.md'));
                } catch (_) {
                    return false;
                }
            });
            if (hit) return repo;
        }
    }

    return null;
}

function buildDetailPayload(repoPath, type, id, specPathHint) {
    const absRepo = path.resolve(repoPath);
    const stateDir = path.join(absRepo, '.aigon', 'state');

    // Read engine snapshot for agent list (features)
    const snapshot = type === 'feature'
        ? workflowSnapshotAdapter.readFeatureSnapshotSync(absRepo, id)
        : null;
    const manifest = snapshot ? {
        agents: Object.keys(snapshot.agents || {}),
        createdAt: snapshot.createdAt || null,
        updatedAt: snapshot.updatedAt || null,
        winnerAgentId: snapshot.winnerAgentId || null,
        lifecycle: snapshot.lifecycle || null,
    } : {};

    const discoveredAgents = new Set();
    if (snapshot && snapshot.agents) {
        Object.keys(snapshot.agents).forEach(a => discoveredAgents.add(a));
    }
    // Also discover agents from agent status files on disk
    if (fs.existsSync(stateDir)) {
        try {
            fs.readdirSync(stateDir)
                .filter(f => new RegExp(`^(feature|research)-${id}-([a-z0-9]+)\\.json$`).test(f))
                .forEach(f => {
                    const m = f.match(/^(feature|research)-\d+-([a-z0-9]+)\.json$/);
                    if (m) discoveredAgents.add(m[2]);
                });
        } catch (_) { /* ignore */ }
    }

    const agentFiles = {};
    const rawAgentFiles = {};
    const logExcerpts = {};
    Array.from(discoveredAgents).sort().forEach(agentId => {
        const candidates = [
            path.join(stateDir, `${type}-${id}-${agentId}.json`),
            path.join(stateDir, `feature-${id}-${agentId}.json`),
            path.join(stateDir, `research-${id}-${agentId}.json`)
        ];
        let parsed = {};
        let raw = '';
        for (const p of candidates) {
            if (!fs.existsSync(p)) continue;
            try {
                raw = fs.readFileSync(p, 'utf8');
                parsed = JSON.parse(raw);
                break;
            } catch (_) { /* keep searching */ }
        }
        agentFiles[agentId] = parsed;
        rawAgentFiles[agentId] = raw || JSON.stringify(parsed || {}, null, 2);

        if (type === 'research') {
            const findingsPath = path.join(absRepo, 'docs', 'specs', 'research-topics', 'logs', `research-${id}-${agentId}-findings.md`);
            if (fs.existsSync(findingsPath)) {
                try {
                    const content = fs.readFileSync(findingsPath, 'utf8');
                    logExcerpts[agentId] = {
                        findings: extractMarkdownSection(content, 'Findings'),
                        progress: extractMarkdownSection(content, 'Progress'),
                        summary: extractMarkdownSection(content, 'Summary')
                    };
                } catch (_) {
                    logExcerpts[agentId] = {};
                }
            } else {
                logExcerpts[agentId] = {};
            }
            return;
        }

        const featureLogCandidates = [];
        const repoLogDir = path.join(absRepo, 'docs', 'specs', 'features', 'logs');
        if (fs.existsSync(repoLogDir)) {
            try {
                fs.readdirSync(repoLogDir)
                    .filter(f => new RegExp(`^feature-${id}-${agentId}-.+-log\\.md$`).test(f))
                    .forEach(f => featureLogCandidates.push(path.join(repoLogDir, f)));
            } catch (_) { /* ignore */ }
        }
        if (parsed.worktreePath && fs.existsSync(parsed.worktreePath)) {
            const wtLogDir = path.join(parsed.worktreePath, 'docs', 'specs', 'features', 'logs');
            if (fs.existsSync(wtLogDir)) {
                try {
                    fs.readdirSync(wtLogDir)
                        .filter(f => new RegExp(`^feature-${id}-${agentId}-.+-log\\.md$`).test(f))
                        .forEach(f => featureLogCandidates.push(path.join(wtLogDir, f)));
                } catch (_) { /* ignore */ }
            }
        }
        featureLogCandidates.sort((a, b) => {
            const ma = (() => { try { return fs.statSync(a).mtimeMs; } catch (_) { return 0; } })();
            const mb = (() => { try { return fs.statSync(b).mtimeMs; } catch (_) { return 0; } })();
            return mb - ma;
        });
        const logPath = featureLogCandidates[0];
        if (!logPath) {
            logExcerpts[agentId] = {};
            return;
        }
        try {
            const content = fs.readFileSync(logPath, 'utf8');
            logExcerpts[agentId] = {
                plan: extractMarkdownSection(content, 'Plan'),
                progress: extractMarkdownSection(content, 'Progress'),
                summary: extractMarkdownSection(content, 'Summary')
            };
        } catch (_) {
            logExcerpts[agentId] = {};
        }
    });

    const resolvedFeatureSpec = type === 'feature'
        ? featureSpecResolver.resolveFeatureSpec(absRepo, id, { snapshot })
        : null;
    let resolvedSpecPath = String(specPathHint || '').trim();
    if (!resolvedSpecPath && resolvedFeatureSpec && resolvedFeatureSpec.path) {
        resolvedSpecPath = resolvedFeatureSpec.path;
    }
    if (!resolvedSpecPath) {
        const root = path.join(absRepo, 'docs', 'specs', type === 'research' ? 'research-topics' : 'features');
        const dirs = ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'];
        const prefix = type === 'research' ? `research-${id}-` : `feature-${id}-`;
        for (const sub of dirs) {
            const dir = path.join(root, sub);
            if (!fs.existsSync(dir)) continue;
            try {
                const hit = fs.readdirSync(dir).find(f => f.startsWith(prefix) && f.endsWith('.md'));
                if (hit) {
                    resolvedSpecPath = path.join(dir, hit);
                    break;
                }
            } catch (_) { /* ignore */ }
        }
    }

    const evalPath = type === 'feature'
        ? path.join(absRepo, 'docs', 'specs', 'features', 'evaluations', `feature-${id}-eval.md`)
        : null;
    const workflowEvents = type === 'feature'
        ? workflowSnapshotAdapter.filterAgentSignalEvents(
            workflowSnapshotAdapter.readFeatureEventsSync(absRepo, id)
        )
        : [];
    let detailEvents = workflowEvents;

    if (type === 'feature') {
        const stage = snapshot
            ? (workflowSnapshotAdapter.snapshotToStage(snapshot) || (resolvedFeatureSpec && resolvedFeatureSpec.stage) || 'inbox')
            : ((resolvedFeatureSpec && resolvedFeatureSpec.stage)
                || (resolvedSpecPath.includes('/04-in-evaluation/') ? 'in-evaluation'
                    : resolvedSpecPath.includes('/03-in-progress/') ? 'in-progress'
                    : resolvedSpecPath.includes('/02-backlog/') ? 'backlog'
                    : resolvedSpecPath.includes('/06-paused/') ? 'paused'
                    : resolvedSpecPath.includes('/05-done/') ? 'done'
                    : 'inbox'));
        const featureAgents = Object.entries(agentFiles).map(([agentId, file]) => {
            const tmuxInfo = safeTmuxSessionExists(id, agentId) || { sessionName: null, running: false };
            return {
                id: agentId,
                status: normalizeDashboardStatus(file.status),
                updatedAt: file.updatedAt || null,
                tmuxSession: tmuxInfo.sessionName,
                tmuxRunning: tmuxInfo.running,
            };
        });
        const featureState = featureDashboardModel.getFeatureDashboardModel(absRepo, id, stage, featureAgents);
        const runtimeEvents = [];
        if (featureState.reviewState) {
            manifest.review = featureState.reviewState;
        }

        const currentReview = featureState.reviewState && featureState.reviewState.current;
        if (currentReview) {
            runtimeEvents.push({
                type: 'review.running',
                agentId: currentReview.agent,
                at: currentReview.startedAt || new Date().toISOString(),
            });
        }
        (featureState.reviewState && featureState.reviewState.history || []).forEach(entry => {
            runtimeEvents.push({
                type: 'review.completed',
                agentId: entry.agent,
                at: entry.completedAt || entry.startedAt || new Date().toISOString(),
            });
        });

        if (featureState.evalSession) {
            runtimeEvents.push({
                type: featureState.evalSession.running ? 'eval.running' : 'eval.completed',
                agentId: featureState.evalSession.agent || 'system',
                at: new Date().toISOString(),
            });
        }

        if (featureState.winnerAgent) {
            runtimeEvents.push({
                type: 'winner.selected',
                agentId: featureState.winnerAgent,
                at: (() => {
                    try {
                        return featureState.evalPath ? fs.statSync(featureState.evalPath).mtime.toISOString() : new Date().toISOString();
                    } catch (_) {
                        return new Date().toISOString();
                    }
                })(),
            });
        }

        detailEvents = [...workflowEvents, ...runtimeEvents]
            .sort((left, right) => String(left.at || '').localeCompare(String(right.at || '')));
    }

    return {
        manifest,
        rawManifest: snapshot ? JSON.stringify(snapshot, null, 2) : JSON.stringify({}, null, 2),
        events: detailEvents,
        workflowEvents,
        agentFiles,
        rawAgentFiles,
        logExcerpts,
        evalPath: evalPath && fs.existsSync(evalPath) ? evalPath : null,
        specPath: resolvedSpecPath || null
    };
}

function inferDashboardNextCommand(featureId, agents, stage) {
    return workflowReadModel.getDashboardNextCommand('feature', featureId, stage, agents);
}

function inferDashboardNextActions(featureId, agents, stage) {
    return workflowReadModel.getDashboardNextActions('feature', featureId, stage, agents);
}

// --- feature-open launch handlers ---
// Each receives ctx: { absRepo, worktreePath, featureId, agentId, desc, isResearch, worktreePrefix, repoName }

function ensureTmuxSession(sessionName, cwd, buildCmd) {
    if (!tmuxSessionExists(sessionName)) {
        createDetachedTmuxSession(sessionName, cwd, buildCmd());
    }
    openTerminalAppWithCommand(cwd, `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
}

function handleLaunchReview(ctx) {
    const { worktreePath, absRepo, featureId, agentId, desc, repoName } = ctx;
    const taskCwd = (worktreePath !== absRepo && fs.existsSync(worktreePath)) ? worktreePath : absRepo;
    const sessionName = buildTmuxSessionName(toUnpaddedId(featureId), `review-${agentId}`, { repo: repoName, desc, entityType: 'f' });
    ensureTmuxSession(sessionName, taskCwd, () => buildAgentCommand({ agent: agentId, featureId, path: taskCwd, desc }, 'review'));
    featureReviewState.startReview(absRepo, String(featureId).padStart(2, '0'), agentId, new Date().toISOString(), 'dashboard/review-launch')
        .catch(() => {});
    return { ok: true, message: `Opened review for F${featureId}`, sessionName };
}

function handleLaunchEval(ctx) {
    const { worktreePath, absRepo, featureId, agentId, desc, isResearch, repoName } = ctx;
    const label = isResearch ? 'R' : 'F';
    const sessionSuffix = isResearch ? `eval-${agentId}` : 'eval';
    const taskCwd = (worktreePath !== absRepo && fs.existsSync(worktreePath)) ? worktreePath : absRepo;
    const sessionName = buildTmuxSessionName(toUnpaddedId(featureId), sessionSuffix, { repo: repoName, desc, entityType: label.toLowerCase() });
    ensureTmuxSession(sessionName, taskCwd, () =>
        isResearch ? buildResearchAgentCommand(agentId, featureId, 'eval')
                   : buildAgentCommand({ agent: agentId, featureId, path: taskCwd, desc }, 'evaluate'));
    return { ok: true, message: `Opened eval for ${label}${featureId}`, sessionName };
}

function handleLaunchImplementation(ctx) {
    const { worktreePath, featureId, agentId, desc, isResearch, repoName } = ctx;
    const sessionName = isResearch
        ? buildResearchTmuxSessionName(featureId, agentId, { repo: repoName })
        : buildTmuxSessionName(featureId, agentId, { repo: repoName, desc });
    const tmuxInfo = safeTmuxSessionExists(featureId, agentId, { isResearch });
    const tmuxSessionState = tmuxInfo && tmuxInfo.running ? 'running' : 'none';

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

    const { action: sessionAction } = stateMachine.getSessionAction(agentId, {
        tmuxSessionStates: { [agentId]: tmuxSessionState },
        agentStatuses: { [agentId]: cachedAgentStatus }
    });
    const agentCmd = isResearch
        ? buildResearchAgentCommand(agentId, featureId)
        : buildAgentCommand({ agent: agentId, featureId, path: worktreePath, desc });

    if (sessionAction === 'attach') {
        const s = tmuxInfo.sessionName;
        openTerminalAppWithCommand(worktreePath, `tmux attach -t ${shellQuote(s)}`, s);
        return { ok: true, message: `Attached to ${s}`, sessionName: s };
    }
    if (sessionAction === 'send-keys') {
        const s = tmuxInfo.sessionName;
        runTmux(['send-keys', '-t', s, agentCmd, 'Enter'], { stdio: 'ignore' });
        openTerminalAppWithCommand(worktreePath, `tmux attach -t ${shellQuote(s)}`, s);
        return { ok: true, message: `Restarted agent in ${s}`, sessionName: s };
    }
    createDetachedTmuxSession(sessionName, worktreePath, agentCmd);
    openTerminalAppWithCommand(worktreePath, `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
    const label = isResearch ? `R${featureId}` : `F${featureId}`;
    return { ok: true, message: `Opened worktree for ${label} ${agentId}`, sessionName };
}

const DASHBOARD_SETTINGS_SCHEMA = [
    {
        key: 'backgroundAgents',
        label: 'Background agents',
        type: 'boolean',
        description: 'Starts agents without opening a terminal window by default. You can still override this per command with CLI flags.'
    },
    {
        key: 'terminal',
        label: 'Terminal',
        type: 'enum',
        options: ['warp', 'tmux', 'code', 'cursor', 'terminal', 'iterm2'],
        description: 'Chooses which terminal app Aigon opens when a command needs an interactive session.'
    },
    {
        key: 'profile',
        label: 'Profile',
        type: 'enum',
        options: ['web', 'api', 'ios', 'android', 'library', 'generic'],
        description: 'Defines the project type used for defaults like test instructions and dev-server behavior. This is usually a project override, not a global setting.'
    },
    {
        key: 'security.enabled',
        label: 'Security enabled',
        type: 'boolean',
        description: 'Master switch for local security scanning in Aigon workflows such as close and submit.'
    },
    {
        key: 'security.mode',
        label: 'Security mode',
        type: 'enum',
        options: ['enforce', 'warn', 'off'],
        description: 'enforce blocks on findings, warn reports findings but continues, off disables scanning.'
    },
    {
        key: 'devServer.enabled',
        label: 'Dev server enabled',
        type: 'boolean',
        description: 'Enables per-agent dev-server handling for repos that expose local web or API apps. Usually meaningful only for web or api profiles.'
    },
];

const AGENT_DISPLAY_NAMES = { cc: 'Claude Code', gg: 'Gemini', cx: 'Codex', cu: 'Cursor', mv: 'Mistral Vibe' };
['cc', 'gg', 'cx', 'cu', 'mv'].forEach(agentId => {
    ['research', 'implement', 'evaluate'].forEach(task => {
        DASHBOARD_SETTINGS_SCHEMA.push({
            key: `agents.${agentId}.${task}.model`,
            label: task.charAt(0).toUpperCase() + task.slice(1),
            group: `agent:${agentId}`,
            groupLabel: `${agentId.toUpperCase()} — ${AGENT_DISPLAY_NAMES[agentId] || agentId}`,
            type: 'string',
            description: `Model used by ${agentId.toUpperCase()} for ${task} tasks. Leave unset to use the built-in default.`
        });
    });
});

function readRawGlobalConfig() {
    try {
        if (!fs.existsSync(GLOBAL_CONFIG_PATH)) return {};
        const parsed = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
        return {};
    }
}

function coerceDashboardSettingValue(type, value) {
    if (type === 'boolean') {
        if (typeof value === 'boolean') return value;
        if (value === 'true') return true;
        if (value === 'false') return false;
        throw new Error('Expected boolean value');
    }
    if (type === 'enum') return String(value);
    if (type === 'string') return String(value || '').trim();
    return value;
}

function buildDashboardSettingsPayload(repoPath, options = {}) {
    const globalOnly = !!options.globalOnly;
    const cwd = repoPath ? path.resolve(repoPath) : process.cwd();
    const globalConfigRaw = readRawGlobalConfig();
    const projectConfigPath = globalOnly ? null : path.join(cwd, '.aigon', 'config.json');
    let projectConfig = {};
    try {
        if (projectConfigPath && fs.existsSync(projectConfigPath)) {
            projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
        }
    } catch (_) { /* ignore parse errors */ }
    const globalDisplayConfig = JSON.parse(JSON.stringify(DEFAULT_GLOBAL_CONFIG || {}));
    Object.keys(globalConfigRaw).forEach(key => {
        if (key === 'agents' && globalConfigRaw.agents) {
            globalDisplayConfig.agents = { ...(globalDisplayConfig.agents || {}) };
            Object.entries(globalConfigRaw.agents).forEach(([agent, agentCfg]) => {
                globalDisplayConfig.agents[agent] = { ...(globalDisplayConfig.agents[agent] || {}), ...(agentCfg || {}) };
                if (globalDisplayConfig.agents[agent]?.models && agentCfg?.models) {
                    globalDisplayConfig.agents[agent].models = {
                        ...(DEFAULT_GLOBAL_CONFIG.agents?.[agent]?.models || {}),
                        ...agentCfg.models
                    };
                }
            });
        } else if (key === 'security' && globalConfigRaw.security) {
            globalDisplayConfig.security = { ...(globalDisplayConfig.security || {}), ...globalConfigRaw.security };
        } else {
            globalDisplayConfig[key] = globalConfigRaw[key];
        }
    });
    const effectiveConfig = JSON.parse(JSON.stringify(globalDisplayConfig));
    if (!globalOnly) {
        Object.keys(projectConfig).forEach(key => {
            if (key === 'agents' && projectConfig.agents) {
                effectiveConfig.agents = { ...(effectiveConfig.agents || {}) };
                Object.entries(projectConfig.agents).forEach(([agent, agentCfg]) => {
                    effectiveConfig.agents[agent] = { ...(effectiveConfig.agents[agent] || {}), ...(agentCfg || {}) };
                    if (effectiveConfig.agents[agent]?.models && agentCfg?.models) {
                        effectiveConfig.agents[agent].models = {
                            ...(globalDisplayConfig.agents?.[agent]?.models || {}),
                            ...agentCfg.models
                        };
                    }
                });
            } else if (key === 'security' && projectConfig.security) {
                effectiveConfig.security = { ...(effectiveConfig.security || {}), ...projectConfig.security };
            } else {
                effectiveConfig[key] = projectConfig[key];
            }
        });
    }
    const settings = DASHBOARD_SETTINGS_SCHEMA.map(def => {
        const modelKeyMatch = def.key.match(/^agents\.(cc|gg|cx|cu|mv)\.(research|implement|evaluate)\.model$/);
        const builtInValue = modelKeyMatch
            ? (DEFAULT_GLOBAL_CONFIG.agents?.[modelKeyMatch[1]]?.models?.[modelKeyMatch[2]] ?? undefined)
            : getNestedValue(DEFAULT_GLOBAL_CONFIG, def.key);
        const globalValue = modelKeyMatch
            ? (getConfigModelValue(globalDisplayConfig, modelKeyMatch[1], modelKeyMatch[2]) ?? undefined)
            : getNestedValue(globalDisplayConfig, def.key);
        const globalOverrideValue = modelKeyMatch
            ? (getConfigModelValue(globalConfigRaw, modelKeyMatch[1], modelKeyMatch[2]) ?? undefined)
            : getNestedValue(globalConfigRaw, def.key);
        const projectValue = globalOnly
            ? undefined
            : (modelKeyMatch
                ? (getConfigModelValue(projectConfig, modelKeyMatch[1], modelKeyMatch[2]) ?? undefined)
                : getNestedValue(projectConfig, def.key));
        const effectiveValue = modelKeyMatch
            ? (projectValue ?? globalValue ?? builtInValue)
            : getNestedValue(effectiveConfig, def.key);
        const source = projectValue !== undefined
            ? 'project'
            : (globalOverrideValue !== undefined ? 'global' : (builtInValue !== undefined ? 'default' : 'default'));
        return {
            ...def,
            builtInValue: builtInValue === undefined ? null : builtInValue,
            globalValue: globalValue === undefined ? null : globalValue,
            globalOverrideValue: globalOverrideValue === undefined ? null : globalOverrideValue,
            projectValue: projectValue === undefined ? null : projectValue,
            effectiveValue: effectiveValue === undefined ? null : effectiveValue,
            source
        };
    });
    return {
        repoPath: cwd,
        projectName: globalOnly ? null : path.basename(cwd),
        globalConfigPath: GLOBAL_CONFIG_PATH,
        projectConfigPath,
        globalOnly,
        global: globalConfigRaw,
        project: projectConfig,
        effective: effectiveConfig,
        settings
    };
}

function escapeForHtmlScript(jsonValue) {
    return JSON.stringify(jsonValue)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function buildDashboardHtml(initialData, instanceName, templateRootOverride) {
    const serializedData = escapeForHtmlScript(initialData);
    const serializedName = escapeForHtmlScript(instanceName || 'main');
    let htmlTemplate;
    if (templateRootOverride) {
        const overridePath = path.join(templateRootOverride, 'templates', 'dashboard', 'index.html');
        if (fs.existsSync(overridePath)) {
            htmlTemplate = fs.readFileSync(overridePath, 'utf8');
        } else {
            htmlTemplate = readTemplate('dashboard/index.html');
        }
    } else {
        htmlTemplate = readTemplate('dashboard/index.html');
    }
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
    'feature-start',
    'feature-do',
    'feature-open',
    'feature-submit',
    'feature-review',
    'feature-eval',
    'feature-close',
    'dev-server',
    'research-prioritise',
    'research-start',
    'research-eval',
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

function verifyFeatureStartRegistration(repoPath, featureId, expectedAgents) {
    const snapshot = workflowSnapshotAdapter.readFeatureSnapshotSync(repoPath, featureId);
    if (snapshot && snapshot.agents) {
        const registeredAgents = Object.keys(snapshot.agents);
        const missing = expectedAgents.filter(agent => !registeredAgents.includes(agent));
        if (missing.length > 0) {
            return { ok: false, error: `Agents not registered in workflow snapshot: ${missing.join(', ')}` };
        }
        return { ok: true };
    }

    const manifestPath = path.join(repoPath, '.aigon', 'state', `feature-${featureId}.json`);
    if (!fs.existsSync(manifestPath)) {
        return { ok: false, error: `feature-start completed without creating workflow snapshot or manifest for feature ${featureId}` };
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const registeredAgents = Array.isArray(manifest.agents) ? manifest.agents : [];
    const missing = expectedAgents.filter(agent => !registeredAgents.includes(agent));
    if (missing.length > 0) {
        return { ok: false, error: `Agents not registered in manifest: ${missing.join(', ')}` };
    }
    return { ok: true };
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
        // Extract the meaningful error from stderr (look for ❌ lines first, then fall back)
        const stderrText = (result.stderr || '').trim();
        const errorLine = stderrText.split('\n').find(l => l.includes('❌'));
        const errorMsg = errorLine
            ? errorLine.replace(/^.*❌\s*/, '').trim()
            : (stderrText.split('\n')[0] || `Action failed with exit code ${exitCode}`);
        return {
            ...payload,
            ok: false,
            status: 422,
            error: `Action failed: ${errorMsg}`,
        };
    }

    // Post-dispatch verification for feature-start: confirm the manifest exists
    // and all requested agents were actually recorded.
    if (parsed.action === 'feature-start' && parsed.args.length >= 2) {
        const featureId = parsed.args[0];
        const expectedAgents = parsed.args.slice(1);
        try {
            const verification = verifyFeatureStartRegistration(parsed.repoPath, featureId, expectedAgents);
            if (!verification.ok) {
                payload.ok = false;
                payload.status = 422;
                payload.error = verification.error;
            }
        } catch (e) {
            // Verification is best-effort — don't fail the action for read errors
        }
    }

    return payload;
}

function runDashboardServer(port, instanceName, serverId, options) {
    const http = require('http');
    const host = '0.0.0.0';
    instanceName = instanceName || 'main';
    options = options || {};
    const templateRoot = options.templateRoot || ROOT_DIR;
    const isPreview = !!options.templateRoot;
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

    const LOG_MAX_BYTES = 1 * 1024 * 1024; // 1 MB
    let _logRotating = false;

    function _rotateLogIfNeeded() {
        if (_logRotating) return;
        try {
            const stat = fs.statSync(DASHBOARD_LOG_FILE);
            if (stat.size > LOG_MAX_BYTES) {
                _logRotating = true;
                const backup = DASHBOARD_LOG_FILE + '.1';
                try { fs.unlinkSync(backup); } catch (_) { /* no previous backup */ }
                fs.renameSync(DASHBOARD_LOG_FILE, backup);
                _logRotating = false;
            }
        } catch (_) { _logRotating = false; /* file doesn't exist yet */ }
    }

    function log(msg) {
        try {
            _rotateLogIfNeeded();
            fs.appendFileSync(DASHBOARD_LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
        } catch (e) { /* ignore */ }
    }
    log.error = (msg) => log(`ERROR ${msg}`);
    log.warn = (msg) => log(`WARN  ${msg}`);

    // ── Startup diagnostics ───────────────────────────────────────────────────
    {
        const ver = (() => { try { return require('../package.json').version; } catch (_) { return '?'; } })();
        log(`──── Dashboard starting ────`);
        log(`  aigon     : v${ver}`);
        log(`  node      : ${process.version}`);
        log(`  platform  : ${process.platform} ${process.arch}`);
        log(`  pid       : ${process.pid}`);
        log(`  port      : ${port}`);
        log(`  instance  : ${instanceName}`);
        log(`  log file  : ${DASHBOARD_LOG_FILE}`);
    }

    // ── Idle timer removed: dashboard stays alive until Ctrl+C or dev-server stop ──
    function resetIdleTimer() { /* no-op — kept for call-site compatibility */ }

    function resolveRepoFromPathParam(repoParam) {
        let decodedRepo = '';
        try {
            decodedRepo = decodeURIComponent(String(repoParam || ''));
        } catch (_) {
            return { ok: false, status: 400, error: 'Invalid repo path parameter' };
        }
        return resolveDashboardActionRepoPath(
            decodedRepo,
            readConductorReposFromGlobalConfig(),
            process.cwd()
        );
    }

    function findFeatureAgentInStatus(repoPath, featureId, agentId) {
        const absRepoPath = path.resolve(String(repoPath || ''));
        const targetFeatureId = String(featureId || '');
        const targetAgentId = String(agentId || '');
        const repo = (latestStatus.repos || []).find(r => path.resolve(String(r.path || '')) === absRepoPath);
        if (!repo) return null;
        const feature = (repo.features || []).find(f => String(f.id) === targetFeatureId);
        if (!feature) return null;
        const agent = (feature.agents || []).find(a => String(a.id) === targetAgentId);
        if (!agent) return null;
        return { repo, feature, agent };
    }

    function pollStatus() {
        let pollStart;
        try {
            pollStart = Date.now();
            latestStatus = collectDashboardStatusData();
        } catch (e) {
            log.error(`Poll failed: ${e.message}`);
            log.error(`  stack: ${e.stack}`);
            return; // Don't crash — skip this poll cycle
        }
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
        // Heartbeat sweep, session liveness, and recovery are handled by the
        // supervisor module (lib/supervisor.js) — not in the HTTP polling loop.

        const elapsed = pollStart ? Date.now() - pollStart : 0;
        const repoCount = (latestStatus.repos || []).length;
        const featureCount = (latestStatus.repos || []).reduce((n, r) => n + (r.features || []).length, 0);
        const researchCount = (latestStatus.repos || []).reduce((n, r) => n + (r.research || []).length, 0);
        log(`Poll complete (${repoCount} repos, ${featureCount}F/${researchCount}R, ${elapsed}ms)`);
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

    function parsePeriodDays(periodRaw) {
        const m = String(periodRaw || '').trim().match(/^(\d+)([dwm])$/i);
        if (!m) return null;
        const n = parseInt(m[1], 10);
        const unit = m[2].toLowerCase();
        if (!Number.isFinite(n) || n <= 0) return null;
        if (unit === 'd') return n;
        if (unit === 'w') return n * 7;
        if (unit === 'm') return n * 30;
        return null;
    }

    const server = http.createServer((req, res) => {
        const reqPath = (req.url || '/').split('?')[0];
        const reqStart = Date.now();
        resetIdleTimer();

        // Log completed response (skip noisy polling/status/assets)
        res.on('finish', () => {
            const isQuiet = reqPath === '/api/status' || reqPath === '/api/sessions' ||
                reqPath === '/favicon.ico' || reqPath.startsWith('/assets/') ||
                reqPath.startsWith('/js/') || reqPath === '/styles.css';
            if (!isQuiet || res.statusCode >= 400) {
                const ms = Date.now() - reqStart;
                const entry = `${req.method} ${reqPath} ${res.statusCode} ${ms}ms`;
                if (res.statusCode >= 500) log.error(entry);
                else if (res.statusCode >= 400) log.warn(entry);
                else log(entry);
            }
        });

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
                const mode = String(payload.mode || 'implement').trim();
                const isResearch = pipelineType === 'research';
                const worktreePrefix = isResearch ? 'research' : 'feature';
                if (!featureId || !agentId || agentId === 'solo') {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'featureId and non-solo agentId are required' }));
                    return;
                }

                try {
                    // --- Resolve all shared context once ---
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
                    const wtDirName = path.basename(worktreePath);
                    const wtDescMatch = wtDirName.match(new RegExp(`^${worktreePrefix}-\\d+-[a-z]{2}-(.+)$`));
                    const desc = wtDescMatch ? wtDescMatch[1] : undefined;
                    const repoName = path.basename(absRepo);
                    const ctx = { absRepo, worktreePath, featureId, agentId, desc, isResearch, worktreePrefix, repoName };

                    const handler = mode === 'review' ? handleLaunchReview
                        : mode === 'eval' ? handleLaunchEval : handleLaunchImplementation;
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify(handler(ctx)));
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: `Failed to open worktree: ${e.message}` }));
                }
            });
            return;
        }

        const repoMainDevServerStartMatch = reqPath.match(/^\/api\/repos\/(.+)\/dev-server\/start$/);
        if (repoMainDevServerStartMatch && req.method === 'POST') {
            const repoResolution = resolveRepoFromPathParam(repoMainDevServerStartMatch[1]);
            if (!repoResolution.ok) {
                res.writeHead(repoResolution.status || 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: repoResolution.error || 'Invalid repo path' }));
                return;
            }

            const repoPath = repoResolution.repoPath;
            const profile = getActiveProfile(repoPath);
            if (!profile.devServer.enabled) {
                res.writeHead(409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: 'Dev server is disabled for this repo profile' }));
                return;
            }

            try {
                const appId = getAppId(repoPath);
                const registryBefore = loadProxyRegistry();
                const existingMain = ((registryBefore[appId] || {})['']) || null;
                const alreadyRunning = Boolean(existingMain && existingMain.pid > 0 && isProcessAlive(existingMain.pid));
                if (alreadyRunning) {
                    const url = getDevProxyUrl(appId, '');
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true, started: false, url, message: `Main dev server already running at ${url}` }));
                    return;
                }

                const actionResult = runDashboardInteractiveAction({
                    action: 'dev-server',
                    args: ['start'],
                    repoPath,
                    registeredRepos: readConductorReposFromGlobalConfig(),
                    defaultRepoPath: process.cwd()
                });
                if (!actionResult.ok) {
                    res.writeHead(actionResult.status || 422, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({
                        error: actionResult.error || 'Failed to start dev server',
                        stdout: actionResult.stdout || '',
                        stderr: actionResult.stderr || '',
                        exitCode: actionResult.exitCode
                    }));
                    return;
                }

                const registryAfter = loadProxyRegistry();
                const startedMain = ((registryAfter[appId] || {})['']) || null;
                const runningNow = Boolean(startedMain && startedMain.pid > 0 && isProcessAlive(startedMain.pid));
                const url = runningNow ? getDevProxyUrl(appId, '') : null;
                latestStatus = collectDashboardStatusData();

                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({
                    ok: true,
                    started: true,
                    url,
                    command: actionResult.command,
                    stdout: actionResult.stdout || '',
                    stderr: actionResult.stderr || '',
                    message: url ? `Started main dev server at ${url}` : 'Started main dev server'
                }));
            } catch (e) {
                res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: `Failed to start main dev server: ${e.message}` }));
            }
            return;
        }

        const repoAgentDevServerPokeMatch = reqPath.match(/^\/api\/repos\/(.+)\/features\/([^/]+)\/agents\/([^/]+)\/dev-server\/poke$/);
        if (repoAgentDevServerPokeMatch && req.method === 'POST') {
            const repoResolution = resolveRepoFromPathParam(repoAgentDevServerPokeMatch[1]);
            if (!repoResolution.ok) {
                res.writeHead(repoResolution.status || 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: repoResolution.error || 'Invalid repo path' }));
                return;
            }

            const repoPath = repoResolution.repoPath;
            let featureId;
            let agentId;
            try {
                featureId = decodeURIComponent(repoAgentDevServerPokeMatch[2] || '');
                agentId = decodeURIComponent(repoAgentDevServerPokeMatch[3] || '');
            } catch (_) {
                res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: 'Invalid feature/agent path parameter' }));
                return;
            }

            if (!featureId || !agentId || agentId === 'solo') {
                res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: 'featureId and non-solo agentId are required' }));
                return;
            }

            try {
                latestStatus = collectDashboardStatusData();
                const located = findFeatureAgentInStatus(repoPath, featureId, agentId);
                if (!located) {
                    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: `Agent ${agentId} for feature ${featureId} not found in in-progress view` }));
                    return;
                }

                const { feature, agent } = located;
                const sessionEnded = Boolean(agent.flags && agent.flags.sessionEnded);
                const busyImplementing = agent.status === 'implementing' && agent.tmuxRunning && !sessionEnded;
                if (busyImplementing) {
                    res.writeHead(409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: `Cannot poke while ${agentId} is actively implementing` }));
                    return;
                }
                if (agent.devServerUrl) {
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true, started: false, url: agent.devServerUrl, message: 'Dev server already running' }));
                    return;
                }
                if (!agent.devServerEligible || !agent.worktreePath) {
                    res.writeHead(409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'Dev server is not eligible for this agent/worktree' }));
                    return;
                }

                const worktreePath = agent.worktreePath || resolveFeatureWorktreePath(repoPath + '-worktrees', featureId, agentId) || repoPath;

                // Run dev-server start as a direct child process in the worktree dir
                // (not send-keys into the agent session — doesn't work for cx/gg)
                // Bypass runDashboardInteractiveAction because worktree paths aren't registered repos
                const cliArgs = buildDashboardActionCommandArgs('dev-server', ['start']);
                const spawnResult = spawnSync(process.execPath, cliArgs, {
                    cwd: worktreePath,
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'pipe']
                });
                if (spawnResult.error || (typeof spawnResult.status === 'number' && spawnResult.status !== 0)) {
                    const errMsg = spawnResult.error ? spawnResult.error.message : (spawnResult.stderr || '').slice(0, 200);
                    res.writeHead(422, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({
                        error: errMsg || 'Failed to start dev server',
                        stdout: spawnResult.stdout || '',
                        stderr: spawnResult.stderr || '',
                        exitCode: spawnResult.status
                    }));
                    return;
                }

                latestStatus = collectDashboardStatusData();
                const appId = getAppId(repoPath);
                const agentSlot = agentId || '';
                const registryAfter = loadProxyRegistry();
                const entry = ((registryAfter[appId] || {})[agentSlot]) || ((registryAfter[appId] || {})['']) || null;
                const runningNow = Boolean(entry && entry.pid > 0 && isProcessAlive(entry.pid));
                const url = runningNow ? getDevProxyUrl(appId, agentSlot) : null;

                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({
                    ok: true,
                    started: true,
                    url,
                    message: url ? `Dev server started at ${url}` : 'Dev server started for ' + agentId
                }));
            } catch (e) {
                res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: `Failed to poke dev server: ${e.message}` }));
            }
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
                const prompt = String(payload.prompt || payload.message || '').trim();
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
                        if (prompt) {
                            runTmux(['send-keys', '-t', sessionName, '-l', prompt], { stdio: 'ignore' });
                            runTmux(['send-keys', '-t', sessionName, 'Enter'], { stdio: 'ignore' });
                        }
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

        if (reqPath === '/api/tile-windows' && req.method === 'POST') {
            try {
                tileITerm2Windows();
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ ok: true }));
            } catch (e) {
                res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: e.message }));
            }
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
                        exitCode: result.exitCode,
                        stdout: result.stdout || '',
                        stderr: result.stderr || '',
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

        if (reqPath === '/api/commits' && req.method === 'GET') {
            try {
                const reqUrl = new URL(req.url || '/api/commits', 'http://localhost');
                const forceRefresh = reqUrl.searchParams.get('force') === '1';
                const repoFilter = reqUrl.searchParams.get('repo');
                const from = reqUrl.searchParams.get('from');
                const to = reqUrl.searchParams.get('to');
                const feature = reqUrl.searchParams.get('feature');
                const agent = reqUrl.searchParams.get('agent');
                const periodDays = parsePeriodDays(reqUrl.searchParams.get('period') || '');
                const limitRaw = parseInt(reqUrl.searchParams.get('limit') || '2000', 10);
                const limit = limitRaw === 0 ? Infinity : (Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50000) : 2000);

                const repos = readConductorReposFromGlobalConfig();
                const targetRepos = repoFilter
                    ? repos.filter(r => path.resolve(r) === path.resolve(repoFilter))
                    : repos;
                const effectiveRepos = targetRepos.length > 0 ? targetRepos : [process.cwd()];

                const allCommits = [];
                effectiveRepos.forEach(repoPath => {
                    const payload = git.getCommitAnalytics({ cwd: repoPath, forceRefresh });
                    (payload.commits || []).forEach(commit => {
                        allCommits.push({
                            ...commit,
                            repoPath: path.resolve(repoPath)
                        });
                    });
                });

                let filtered = git.filterCommitAnalytics(allCommits, {
                    from: from || null,
                    to: to || null,
                    feature: feature || null,
                    agent: agent || null,
                    periodDays
                });
                filtered = filtered
                    .slice()
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                // Summary and series use ALL filtered commits (not truncated by limit)
                const summary = git.buildCommitAnalyticsSummary(filtered);
                const series = git.buildCommitSeries(filtered);

                // Only truncate the raw commit list for the details table
                const commits = filtered.slice(0, limit);

                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ commits, summary, series }));
                return;
            } catch (error) {
                res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: error.message }));
                return;
            }
        }

        if (reqPath === '/api/insights' && req.method === 'GET') {
            if (!isProAvailable()) {
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ proRequired: true, error: 'AADE Insights requires @aigon/pro' }));
                return;
            }
            const insights = getPro().insights;
            const cached = insights.readInsightsCache(process.cwd());
            if (cached) {
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify(cached));
                return;
            }

            insights.generateAndCacheInsights({ repoPath: process.cwd(), includeCoaching: false, loadProjectConfig })
                .then(payload => {
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify(payload));
                })
                .catch(error => {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: error.message }));
                });
            return;
        }

        if (reqPath === '/api/insights/refresh' && req.method === 'POST') {
            if (!isProAvailable()) {
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ proRequired: true, error: 'AADE Insights requires @aigon/pro' }));
                return;
            }
            const insights = getPro().insights;
            insights.generateAndCacheInsights({ repoPath: process.cwd(), includeCoaching: false, loadProjectConfig })
                .then(payload => {
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify(payload));
                })
                .catch(error => {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: error.message }));
                });
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

        if (reqPath.startsWith('/api/detail/') && req.method === 'GET') {
            const m = reqPath.match(/^\/api\/detail\/(feature|research)\/(\d+)$/);
            if (!m) {
                res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: 'Invalid detail route' }));
                return;
            }
            const type = m[1];
            const id = m[2];
            const url = new URL(req.url, `http://${req.headers.host}`);
            const repoPathHint = String(url.searchParams.get('repoPath') || '').trim();
            const specPathHint = String(url.searchParams.get('specPath') || '').trim();
            const registered = readConductorReposFromGlobalConfig();
            const resolvedRepo = resolveDetailRepoPath(registered, {
                repoPath: repoPathHint,
                specPath: specPathHint,
                type,
                id
            });
            if (!resolvedRepo) {
                res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: 'Could not resolve repository for detail request' }));
                return;
            }
            try {
                const payload = buildDetailPayload(resolvedRepo, type, id, specPathHint);
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify(payload));
            } catch (e) {
                res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: e.message }));
            }
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
                let content = fs.readFileSync(filePath, 'utf8');
                // On-demand dependency graph: if this is a feature spec, generate SVG
                content = _appendDependencyGraph(filePath, content);
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
                    platformOpen(filePath);
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
                    platformOpen(folderPath);
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

        // ── Supervisor status endpoint ─────────────────────────────────────────

        if (reqPath === '/api/supervisor/status' && req.method === 'GET') {
            const supervisorStatus = typeof options.getSupervisorStatus === 'function'
                ? options.getSupervisorStatus()
                : { running: false, lastSweepAt: null, sweepCount: 0 };
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify(supervisorStatus));
            return;
        }

        // ── Session endpoints ──────────────────────────────────────────────────

        if (reqPath === '/api/sessions' && req.method === 'GET') {
            try {
                const enriched = getEnrichedSessions();
                const repos = readConductorReposFromGlobalConfig().map(r => path.resolve(r));
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ ...enriched, repos }));
            } catch (e) {
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ sessions: [], orphanCount: 0, error: e.message }));
            }
            return;
        }

        // /api/sessions/cleanup removed — supervisor observes and emits signals,
        // never kills sessions. Users manage sessions via CLI.

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

            // Use capture-pane to get the visible screen content (clean, no raw escape stream)
            try {
                const snap = runTmux(['capture-pane', '-t', sessionName, '-p', '-S', '-200'], { encoding: 'utf8', stdio: 'pipe' });
                const rawOutput = (!snap.error && snap.status === 0) ? (snap.stdout || '') : '';
                // Strip trailing blank lines, collapse excessive whitespace
                const output = rawOutput.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '\n');
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ output, offset: output.length, alive: true }));
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
                    runTmux(['send-keys', '-t', sessionName, '-l', sanitized], { stdio: 'ignore' });
                    // Small delay to let the TUI process the text before sending Enter
                    const { execFileSync } = require('child_process');
                    execFileSync('sleep', ['0.1']);
                    runTmux(['send-keys', '-t', sessionName, 'Enter'], { stdio: 'ignore' });
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

        if (reqPath === '/api/settings' && req.method === 'GET') {
            const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
            const repoPath = String(parsedUrl.searchParams.get('repoPath') || '').trim();
            const globalOnly = parsedUrl.searchParams.get('globalOnly') === '1';
            if (globalOnly) {
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify(buildDashboardSettingsPayload(process.cwd(), { globalOnly: true })));
                return;
            }
            const repoResolution = resolveDashboardActionRepoPath(
                repoPath,
                readConductorReposFromGlobalConfig(),
                process.cwd()
            );
            if (!repoResolution.ok) {
                res.writeHead(repoResolution.status || 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: repoResolution.error || 'Invalid repoPath' }));
                return;
            }
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify(buildDashboardSettingsPayload(repoResolution.repoPath)));
            return;
        }

        if (reqPath === '/api/settings' && req.method === 'PUT') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                let payload = {};
                try { payload = JSON.parse(body || '{}'); } catch (e) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                    return;
                }

                const scope = String(payload.scope || '').trim();
                const key = String(payload.key || '').trim();
                const repoPathRaw = String(payload.repoPath || '').trim();
                if (scope !== 'global' && scope !== 'project') {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'scope must be "global" or "project"' }));
                    return;
                }
                const settingDef = DASHBOARD_SETTINGS_SCHEMA.find(s => s.key === key);
                if (!settingDef) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: `Unsupported setting key: ${key}` }));
                    return;
                }

                const repoResolution = resolveDashboardActionRepoPath(
                    repoPathRaw,
                    readConductorReposFromGlobalConfig(),
                    process.cwd()
                );
                if (!repoResolution.ok) {
                    res.writeHead(repoResolution.status || 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: repoResolution.error || 'Invalid repoPath' }));
                    return;
                }
                const repoPath = repoResolution.repoPath;

                let coercedValue;
                try {
                    coercedValue = coerceDashboardSettingValue(settingDef.type, payload.value);
                    if (settingDef.type === 'enum' && !settingDef.options.includes(coercedValue)) {
                        throw new Error(`Expected one of: ${settingDef.options.join(', ')}`);
                    }
                } catch (e) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: e.message }));
                    return;
                }

                try {
                    if (scope === 'global') {
                        const next = readRawGlobalConfig();
                        setNestedValue(next, key, coercedValue);
                        saveGlobalConfig(next);
                        globalConfig = loadGlobalConfig();
                    } else {
                        const projectConfigPath = path.join(repoPath, '.aigon', 'config.json');
                        let next = {};
                        try {
                            if (fs.existsSync(projectConfigPath)) {
                                next = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
                            }
                        } catch (_) { /* use empty config */ }
                        setNestedValue(next, key, coercedValue);
                        fs.mkdirSync(path.dirname(projectConfigPath), { recursive: true });
                        fs.writeFileSync(projectConfigPath, JSON.stringify(next, null, 2) + '\n');
                    }
                    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ ok: true, ...buildDashboardSettingsPayload(repoPath) }));
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        if (reqPath === '/api/agent-flag-action' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString('utf8'); });
            req.on('end', () => {
                let payload = {};
                try { payload = JSON.parse(body || '{}'); } catch (e) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                    return;
                }

                const action = String(payload.action || '').trim();
                const entityType = String(payload.entityType || 'feature').trim();
                const id = String(payload.id || '').trim();
                const agent = String(payload.agentId || '').trim();
                const repoResolution = resolveDashboardActionRepoPath(
                    payload.repoPath,
                    readConductorReposFromGlobalConfig(),
                    process.cwd()
                );
                if (!repoResolution.ok) {
                    res.writeHead(repoResolution.status || 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: repoResolution.error || 'Invalid repoPath' }));
                    return;
                }
                if (!id || !agent) {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: 'id and agentId are required' }));
                    return;
                }
                const repoPath = repoResolution.repoPath;
                const worktreeBase = repoPath + '-worktrees';
                const worktreePath = entityType === 'feature'
                    ? resolveFeatureWorktreePath(worktreeBase, id, agent)
                    : repoPath;

                try {
                    if (action === 'mark-submitted') {
                        writeAgentStatusAt(repoPath, id, agent, {
                            status: 'submitted',
                            flags: {},
                            entityType,
                            ...(worktreePath ? { worktreePath } : {})
                        });
                        latestStatus = collectDashboardStatusData();
                        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ ok: true, message: `Marked ${agent} as submitted` }));
                        return;
                    }

                    if (action === 'reopen-agent') {
                        const sessionName = entityType === 'research'
                            ? buildResearchTmuxSessionName(id, agent, { repo: path.basename(repoPath) })
                            : buildTmuxSessionName(id, agent, { repo: path.basename(repoPath) });
                        const desc = worktreePath ? (() => {
                            const m = path.basename(worktreePath).match(/^feature-\d+-[a-z]{2}-(.+)$/);
                            return m ? m[1] : undefined;
                        })() : undefined;
                        const command = entityType === 'research'
                            ? buildResearchAgentCommand(agent, id)
                            : buildAgentCommand({ agent, featureId: id, path: worktreePath || repoPath, desc });

                        try { runTmux(['kill-session', '-t', sessionName], { stdio: 'ignore' }); } catch (_) { /* ignore */ }
                        createDetachedTmuxSession(sessionName, worktreePath || repoPath, command);
                        writeAgentStatusAt(repoPath, id, agent, {
                            status: 'implementing',
                            flags: {},
                            entityType,
                            ...(worktreePath ? { worktreePath } : {})
                        });
                        latestStatus = collectDashboardStatusData();
                        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ ok: true, message: `Re-opened agent ${agent}` }));
                        return;
                    }

                    if (action === 'view-work') {
                        const terminalCwd = worktreePath || repoPath;
                        const diffCmd = entityType === 'research'
                            ? 'git --no-pager status; echo; git --no-pager log --oneline -n 20'
                            : `git --no-pager status; echo; git --no-pager log --oneline -n 20; echo; git --no-pager diff --stat ${detectDefaultBranch(terminalCwd)}...HEAD`;
                        openTerminalAppWithCommand(terminalCwd, diffCmd, `view-work-${entityType}-${id}-${agent}`);
                        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(JSON.stringify({ ok: true, message: 'Opened worktree diff in terminal' }));
                        return;
                    }

                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: `Unsupported action: ${action}` }));
                } catch (e) {
                    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
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
            // Pro dashboard components: serve from @aigon/pro if available
            if (reqPath === '/js/pro-reports.js') {
                if (isProAvailable()) {
                    const proFile = path.join(getPro().dashboardDir, 'pro-reports.js');
                    if (fs.existsSync(proFile)) {
                        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(fs.readFileSync(proFile, 'utf8'));
                        return;
                    }
                }
                // Pro not available — serve empty stub (placeholders are handled in logs.js)
                res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' });
                res.end('/* pro-reports: Pro not available */');
                return;
            }
            if (reqPath === '/js/amplification.js') {
                if (isProAvailable()) {
                    const proFile = path.join(getPro().dashboardDir, 'amplification.js');
                    if (fs.existsSync(proFile)) {
                        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' });
                        res.end(fs.readFileSync(proFile, 'utf8'));
                        return;
                    }
                }
                // Pro not available — serve stub that shows upgrade message
                res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' });
                res.end(`function renderAmplification() {
  var c = document.getElementById('amplification-view');
  if (c) c.innerHTML = '<div class="stats-empty-msg" style="text-align:center;padding:40px 20px">' +
    '<div style="font-size:18px;font-weight:600;margin-bottom:8px">Amplification (Pro)</div>' +
    '<div style="color:var(--text-secondary);margin-bottom:16px">Workflow insights, cost trends, autonomy metrics, and AI coaching.</div>' +
    '<a href="https://aigon.build/pro" target="_blank" style="display:inline-block;margin-top:12px;padding:8px 16px;background:var(--accent,#3b82f6);color:#fff;border-radius:6px;text-decoration:none;font-size:13px;font-weight:500">Upgrade to Pro</a>' +
    '<div style="color:var(--text-tertiary);font-size:12px;margin-top:12px">Or install <code>@aigon/pro</code> to unlock this view.</div>' +
    '</div>';
}`);
                return;
            }
            const dashFile = path.join(templateRoot, 'templates', 'dashboard', reqPath);
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

        const html = buildDashboardHtml(latestStatus, instanceName, isPreview ? templateRoot : null);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(html);
    });

    server.on('error', (err) => {
        log.error(`Server error: ${err.stack || err.message || err}`);
    });

    const registryServerId = serverId || '';

    const shutdown = () => {
        log(`Dashboard shutting down (PID ${process.pid})`);
        deregisterDevServer(appId, registryServerId);
        server.close(() => process.exit(0));
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // Crash logging — catch unhandled errors so they're written to the log file
    // instead of silently hanging or dying without a trace
    // Crash resilience — log errors but do NOT exit the process.
    // A proper daemon survives transient failures (missing dirs, bad polls, etc.)
    let uncaughtCount = 0;
    process.on('uncaughtException', (err) => {
        // EPIPE = client disconnected mid-response — harmless, don't count it
        if (err && err.code === 'EPIPE') {
            log(`EPIPE (client disconnected) — suppressed`);
            return;
        }
        uncaughtCount++;
        log.error(`uncaughtException #${uncaughtCount}: ${err.stack || err.message || err}`);
        // Don't use console.error here — if stderr is broken (EPIPE), it triggers
        // another uncaughtException, cascading to rapid shutdown.
        // Only exit if we're getting hammered (5+ crashes in rapid succession = something systemic)
        if (uncaughtCount >= 5) {
            log.error(`Too many uncaught exceptions (${uncaughtCount}), shutting down`);
            process.exit(1);
        }
    });
    process.on('unhandledRejection', (reason) => {
        const msg = reason instanceof Error ? reason.stack || reason.message : String(reason);
        log.error(`unhandledRejection: ${msg}`);
    });
    process.on('SIGINT', () => { log('Shutdown: SIGINT'); process.exit(0); });
    process.on('SIGTERM', () => { log('Shutdown: SIGTERM'); process.exit(0); });

    server.listen(port, host, () => {
        registerDevServer(appId, registryServerId, port, process.cwd(), process.pid);
        log(`Dashboard started (PID ${process.pid}, port ${port}${isPreview ? ', preview mode' : ''})`);
        const modeLabel = isPreview ? '🔀 Preview' : '🚀 Dashboard';
        if (proxyUrl) {
            console.log(`${modeLabel}: ${proxyUrl}  (also: ${localUrl})`);
        } else {
            console.log(`${modeLabel}: ${localUrl}`);
        }
        if (isPreview) {
            console.log(`   Templates: ${templateRoot}/templates/dashboard/`);
        }
        console.log('   Press Ctrl+C to stop');
        console.log(`   Log: ${DASHBOARD_LOG_FILE}`);
        pollStatus();
        setInterval(pollStatus, 10000);
        // Start supervisor loop if injected via serverOptions (zero-import contract)
        if (typeof options.startSupervisorLoop === 'function') {
            options.startSupervisorLoop();
        }
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
    buildDetailPayload,
    escapeAppleScriptString,
    captureDashboardScreenshot,
    writeRepoRegistry,
    sendMacNotification,
    DASHBOARD_INTERACTIVE_ACTIONS,
    resolveDashboardActionRepoPath,
    parseDashboardActionRequest,
    buildDashboardActionCommandArgs,
    verifyFeatureStartRegistration,
    runDashboardInteractiveAction,
    runDashboardServer,
};
