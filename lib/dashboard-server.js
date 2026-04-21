'use strict';

const fs = require('fs');
// Boundary: no direct fs reads of engine state or docs/specs here; use owner modules.
const path = require('path');
const os = require('os');
const { execSync, spawnSync, spawn } = require('child_process');
const git = require('./git');
const stateMachine = require('./state-queries');
const { isProAvailable, getPro } = require('./pro');
const proBridge = require('./pro-bridge');
const workflowReadModel = require('./workflow-read-model');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const workflowEngine = require('./workflow-core/engine');
const featureReviewState = require('./feature-review-state');
const researchReviewState = require('./research-review-state');
const featureSpecResolver = require('./feature-spec-resolver');
const { reconcileEntitySpec } = require('./spec-reconciliation');
const { queryGitHubPrStatus } = require('./remote-gate-github');
const { collectFeatureDeepStatus } = require('./feature-status');
const {
    collectDashboardStatusData,
    collectEntityAgentLogs,
    countDoneEntities,
    getAgentDetailRecords,
    readEntityLogExcerpts,
} = require('./dashboard-status-collector');
const { createDashboardRouteDispatcher } = require('./dashboard-routes');
const {
    normalizeDashboardStatus,
    parseFeatureSpecFileName,
    findTmuxSessionsByPrefix,
    findFirstTmuxSessionByPrefix,
    safeTmuxSessionExists,
    resolveFeatureWorktreePath,
    detectDefaultBranch,
    worktreeHasImplementationCommits,
    hasResearchFindingsProgress,
    parseStatusFlags,
    maybeFlagEndedSession,
} = require('./dashboard-status-helpers');
// Supervisor integration: startSupervisorLoop and getSupervisorStatus are
// injected via serverOptions by the infra.js command handler, NOT imported
// directly — the HTTP module has zero imports of the supervisor module.

// Constants from config.js
const {
    GLOBAL_CONFIG_PATH, GLOBAL_CONFIG_DIR, DASHBOARD_LOG_FILE, ACTION_LOG_FILE, ROOT_DIR, CLI_ENTRY_PATH,
    DASHBOARD_DYNAMIC_PORT_START, DASHBOARD_DYNAMIC_PORT_END,
    loadGlobalConfig, saveGlobalConfig, getAgentCliConfig,
    readConductorReposFromGlobalConfig, loadProjectConfig, getActiveProfile,
    getNestedValue, setNestedValue, DEFAULT_GLOBAL_CONFIG, getConfigModelValue,
} = require('./config');
// Proxy functions
const {
    getAppId, isProxyAvailable, getDevProxyUrl, openInBrowser,
    addCaddyRoute, removeCaddyRoute, buildCaddyHostname,
    parseCaddyRoutes, isProcessAlive, isPortInUseSync,
} = require('./proxy');

// Entity/dependency functions
const { buildFeatureIndex, buildDependencyGraph, buildFeatureDependencySvg } = require('./feature-dependencies');

// Template functions
const { readTemplate } = require('./templates');

// Worktree/tmux functions
const {
    assertTmuxAvailable, buildTmuxSessionName, buildResearchTmuxSessionName,
    matchTmuxSessionByEntityId, tmuxSessionExists, createDetachedTmuxSession,
    getEnrichedSessions, runTmux, openTerminalAppWithCommand, shellQuote,
    buildAgentCommand, buildRawAgentCommand, buildResearchAgentCommand, tileITerm2Windows, toUnpaddedId,
    addWorktreePermissions,
} = require('./worktree');
const agentRegistry = require('./agent-registry');

// Platform-aware file/URL opener (macOS: open, Linux: xdg-open, Windows: explorer.exe)
function platformOpen(target) {
    const value = String(target || '').trim();
    if (!value) {
        const err = new Error('Path is required');
        err.code = 'INVALID_PATH';
        throw err;
    }

    const cmd = process.platform === 'linux'
        ? 'xdg-open'
        : process.platform === 'win32'
            ? 'explorer.exe'
            : process.platform === 'darwin'
                ? 'open'
                : null;

    if (!cmd) {
        const err = new Error(`Opening folders is not supported on platform: ${process.platform}`);
        err.code = 'UNSUPPORTED_PLATFORM';
        throw err;
    }

    const openResult = spawnSync(cmd, [value], { stdio: 'ignore' });
    if (openResult.error) {
        const err = new Error(openResult.error.message || `Failed to run ${cmd}`);
        err.code = openResult.error.code || 'OPEN_COMMAND_FAILED';
        throw err;
    }
    if (openResult.status !== 0) {
        const err = new Error(`Failed to open path (exit ${openResult.status})`);
        err.code = 'OPEN_COMMAND_FAILED';
        throw err;
    }
}

function formatPeekUptime(totalSec) {
    const s = Math.max(0, Math.floor(Number(totalSec)));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60) % 60;
    const h = Math.floor(s / 3600) % 24;
    const d = Math.floor(s / 86400);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

/** Uptime since session create + last activity time from tmux (for peek headers). */
function getTmuxSessionPeekMeta(sessionName) {
    if (!sessionName) return { uptime: '', lastActivity: '' };
    const meta = runTmux(['display-message', '-t', sessionName, '-p', '#{session_created}\t#{session_activity}'], { encoding: 'utf8', stdio: 'pipe' });
    if (meta.error || meta.status !== 0) return { uptime: '', lastActivity: '' };
    const parts = (meta.stdout || '').trim().split('\t');
    const created = parseInt(parts[0], 10);
    const activity = parseInt(parts[1], 10);
    if (!Number.isFinite(created) || !Number.isFinite(activity)) return { uptime: '', lastActivity: '' };
    const now = Math.floor(Date.now() / 1000);
    const uptime = formatPeekUptime(Math.max(0, now - created));
    const lastActivity = new Date(activity * 1000).toLocaleString();
    return { uptime, lastActivity };
}

const { collectAnalyticsData } = require('./analytics');
function _collectAnalyticsData(globalConfig) {
    return collectAnalyticsData(globalConfig);
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

            const hit = featureSpecResolver.repoHasVisibleEntitySpec(repo, type, id);
            if (hit) return repo;
        }
    }

    return null;
}

function buildDetailPayload(repoPath, type, id, specPathHint) {
    const absRepo = path.resolve(repoPath);

    // Read engine snapshot for agent list.
    const snapshot = (type === 'feature' || type === 'research')
        ? workflowSnapshotAdapter.readWorkflowSnapshotSync(absRepo, type, id)
        : null;
    const manifest = snapshot ? {
        agents: Object.keys(snapshot.agents || {}),
        createdAt: snapshot.createdAt || null,
        updatedAt: snapshot.updatedAt || null,
        winnerAgentId: snapshot.winnerAgentId || null,
        lifecycle: snapshot.lifecycle || null,
    } : {};

    const { agentFiles, rawAgentFiles } = getAgentDetailRecords(
        absRepo,
        type,
        id,
        snapshot && snapshot.agents ? Object.keys(snapshot.agents) : []
    );
    const logExcerpts = {};
    Object.entries(agentFiles).forEach(([agentId, parsed]) => {
        logExcerpts[agentId] = readEntityLogExcerpts(absRepo, type, id, agentId, {
            worktreePath: parsed && parsed.worktreePath ? parsed.worktreePath : null,
        });
    });

    const resolvedSpec = type === 'research'
        ? featureSpecResolver.resolveResearchSpec(absRepo, id, { snapshot })
        : featureSpecResolver.resolveFeatureSpec(absRepo, id, { snapshot });
    let resolvedSpecPath = String(specPathHint || '').trim();
    if (!resolvedSpecPath && resolvedSpec && resolvedSpec.path) resolvedSpecPath = resolvedSpec.path;

    const evalPath = type === 'feature'
        ? path.join(absRepo, 'docs', 'specs', 'features', 'evaluations', `feature-${id}-eval.md`)
        : null;
    const workflowEvents = (type === 'feature' || type === 'research')
        ? workflowSnapshotAdapter.filterAgentSignalEvents(
            workflowSnapshotAdapter.readWorkflowEventsSync(absRepo, type, id)
        )
        : [];
    let detailEvents = workflowEvents;

    if (type === 'feature') {
        const stage = snapshot
            ? (workflowSnapshotAdapter.snapshotToStage(snapshot) || (resolvedSpec && resolvedSpec.stage) || 'inbox')
            : ((resolvedSpec && resolvedSpec.stage)
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
        const featureState = workflowReadModel.getFeatureDashboardState(absRepo, id, stage, featureAgents);
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

    // Collect full agent log markdown for the Agent Log drawer tab (feature only).
    let agentLogs = {};
    if (type === 'feature') {
        try {
            agentLogs = collectEntityAgentLogs(absRepo, id, agentFiles, resolvedSpecPath);
        } catch (_) {
            agentLogs = {};
        }
    }

    return {
        manifest,
        rawManifest: snapshot ? JSON.stringify(snapshot, null, 2) : JSON.stringify({}, null, 2),
        events: detailEvents,
        workflowEvents,
        agentFiles,
        rawAgentFiles,
        logExcerpts,
        agentLogs,
        evalPath: evalPath && fs.existsSync(evalPath) ? evalPath : null,
        specPath: resolvedSpecPath || null
    };
}

// inferDashboardNextCommand and inferDashboardNextActions removed —
// actions now come exclusively from workflow-core engine snapshots via
// workflowReadModel.getFeatureDashboardState().

// --- feature-open launch handlers ---
// Each receives ctx: { absRepo, worktreePath, featureId, agentId, desc, isResearch, worktreePrefix, repoName }

function ensureTmuxSession(sessionName, cwd, buildCmd) {
    if (!tmuxSessionExists(sessionName)) {
        createDetachedTmuxSession(sessionName, cwd, buildCmd());
    }
    openTerminalAppWithCommand(cwd, `tmux attach -t ${shellQuote(sessionName)}`, sessionName);
}

function handleLaunchReview(ctx) {
    const { worktreePath, absRepo, featureId, agentId, desc, isResearch, repoName, launcherModel, launcherEffort } = ctx;
    const taskCwd = (worktreePath !== absRepo && fs.existsSync(worktreePath)) ? worktreePath : absRepo;
    // Ensure reviewing agent has permissions for the worktree
    if (taskCwd !== absRepo) {
        addWorktreePermissions([taskCwd]);
        agentRegistry.ensureAgentTrust(agentId, [taskCwd]);
    }
    const entityType = isResearch ? 'r' : 'f';
    const label = isResearch ? 'R' : 'F';
    const sessionName = buildTmuxSessionName(toUnpaddedId(featureId), agentId, { repo: repoName, desc, entityType, role: 'review' });
    const commandType = isResearch ? 'research-review' : 'review';
    ensureTmuxSession(sessionName, taskCwd, () => buildAgentCommand({
        agent: agentId,
        featureId,
        path: taskCwd,
        desc,
        repoPath: absRepo,
        entityType: isResearch ? 'research' : 'feature',
        launcherModel: launcherModel || null,
        launcherEffort: launcherEffort || null,
    }, commandType));
    const reviewStore = isResearch ? researchReviewState : featureReviewState;
    reviewStore.startReview(absRepo, String(featureId).padStart(2, '0'), agentId, new Date().toISOString(), 'dashboard/review-launch')
        .catch(() => {});
    return { ok: true, message: `Opened review for ${label}${featureId}`, sessionName };
}

function handleLaunchSpecReview(ctx, options = {}) {
    const {
        absRepo,
        featureId,
        agentId,
        desc,
        isResearch,
        repoName,
    } = ctx;
    const commandName = options.commandName;
    const role = options.role;
    const taskType = options.taskType;
    const taskCwd = absRepo;
    addWorktreePermissions([taskCwd]);
    agentRegistry.ensureAgentTrust(agentId, [taskCwd]);
    const label = isResearch ? 'R' : 'F';
    const entityType = isResearch ? 'r' : 'f';
    const sessionName = buildTmuxSessionName(toUnpaddedId(featureId), agentId, {
        repo: repoName,
        desc,
        entityType,
        role,
    });
    const rawCommand = buildRawAgentCommand({
        agent: agentId,
        featureId,
        path: taskCwd,
        desc,
        repoPath: absRepo,
        entityType: isResearch ? 'research' : 'feature',
        launcherModel: ctx.launcherModel || null,
        launcherEffort: ctx.launcherEffort || null,
    }, taskType);
    // Spec-review sessions run in the main repo, not a worktree — the
    // worktree launch path (lib/worktree.js buildAgentCommand) normally sets
    // these env vars but was bypassed here. Without AIGON_AGENT_ID the
    // `${AIGON_AGENT_ID:-unknown}` substitution in the review commit
    // template produces the literal string "unknown", which the dashboard
    // then surfaces as "1 pending — unknown" on the card. Prefix the raw
    // command with env exports so the reviewer commit trailer and any other
    // agent-aware tooling have the correct identity.
    const absTaskCwd = path.resolve(taskCwd);
    const entityTypeEnv = isResearch ? 'research' : 'feature';
    const wrappedCommand = [
        `export AIGON_ENTITY_TYPE=${entityTypeEnv}`,
        `export AIGON_ENTITY_ID=${featureId}`,
        `export AIGON_AGENT_ID=${agentId}`,
        `export AIGON_PROJECT_PATH=${JSON.stringify(absTaskCwd)}`,
        rawCommand,
    ].join('\n');
    ensureTmuxSession(sessionName, taskCwd, () => wrappedCommand);
    return { ok: true, message: `Opened ${commandName} for ${label}${featureId}`, sessionName };
}

function handleLaunchEval(ctx) {
    const { worktreePath, absRepo, featureId, agentId, desc, isResearch, repoName, launcherModel, launcherEffort } = ctx;
    const label = isResearch ? 'R' : 'F';
    // Feature eval setup may exist only in the main repo checkout until close.
    // Launch evaluators from the main repo so they can always see the moved spec
    // and eval file while still reviewing worktree implementations by path.
    const taskCwd = isResearch
        ? ((worktreePath !== absRepo && fs.existsSync(worktreePath)) ? worktreePath : absRepo)
        : absRepo;
    const sessionName = buildTmuxSessionName(toUnpaddedId(featureId), agentId, { repo: repoName, desc, entityType: label.toLowerCase(), role: 'eval' });
    ensureTmuxSession(sessionName, taskCwd, () =>
        isResearch ? buildResearchAgentCommand(agentId, featureId, 'eval', absRepo, {
            launcherModel: launcherModel || null,
            launcherEffort: launcherEffort || null,
        })
                   : buildAgentCommand({
                       agent: agentId,
                       featureId,
                       path: taskCwd,
                       desc,
                       repoPath: absRepo,
                       launcherModel: launcherModel || null,
                       launcherEffort: launcherEffort || null,
                   }, 'evaluate'));
    return { ok: true, message: `Opened eval for ${label}${featureId}`, sessionName };
}

function handleLaunchCloseResolve(ctx) {
    const { worktreePath, absRepo, featureId, agentId, desc, repoName } = ctx;
    const taskCwd = (worktreePath !== absRepo && fs.existsSync(worktreePath)) ? worktreePath : absRepo;
    if (taskCwd !== absRepo) {
        addWorktreePermissions([taskCwd]);
        agentRegistry.ensureAgentTrust(agentId, [taskCwd]);
    }
    const sessionName = buildTmuxSessionName(toUnpaddedId(featureId), agentId, { repo: repoName, desc, entityType: 'f', role: 'close' });
    const cliConfig = getAgentCliConfig(agentId, absRepo);
    const unsetClaudeCode = cliConfig.command === 'claude' ? 'unset CLAUDECODE && ' : '';
    const implFlag = cliConfig.implementFlag ? ` ${cliConfig.implementFlag}` : '';
    const task = `Run "aigon feature-close" to see why closing this feature failed. Fix whatever is blocking (merge conflicts, security scan issues, etc.) and re-run it until it succeeds.`;
    const rawCommand = `${unsetClaudeCode}${cliConfig.command}${implFlag} ${shellQuote(task)}`;
    ensureTmuxSession(sessionName, taskCwd, () => buildAgentCommand({
        agent: agentId,
        featureId,
        path: taskCwd,
        desc,
        repoPath: absRepo,
        entityType: 'feature',
        rawCommand,
    }));
    return { ok: true, message: `Opened agent to resolve conflicts for F${featureId}`, sessionName };
}

function handleLaunchImplementation(ctx) {
    const { worktreePath, absRepo, featureId, agentId, desc, isResearch, repoName, latestStatus, launcherModel, launcherEffort } = ctx;
    const sessionName = isResearch
        ? buildResearchTmuxSessionName(featureId, agentId, { repo: repoName, role: 'do' })
        : buildTmuxSessionName(featureId, agentId, { repo: repoName, desc, role: 'do' });
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
    const launchExtras = { launcherModel: launcherModel || null, launcherEffort: launcherEffort || null };
    const agentCmd = isResearch
        ? buildResearchAgentCommand(agentId, featureId, 'do', absRepo, launchExtras)
        : buildAgentCommand(Object.assign({
            agent: agentId,
            featureId,
            path: worktreePath,
            desc,
            repoPath: absRepo,
        }, launchExtras));

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
        options: ['warp', 'terminal', 'tmux'],
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

const AGENT_DISPLAY_NAMES = agentRegistry.getDisplayNames();
agentRegistry.getAllAgentIds().forEach(agentId => {
    ['research', 'implement', 'evaluate', 'review'].forEach(task => {
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
        const modelKeyMatch = def.key.match(/^agents\.(\w+)\.(research|implement|evaluate|review)\.model$/);
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
    const serializedAgents = escapeForHtmlScript(agentRegistry.getDashboardAgents());
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
        .replace('${INSTANCE_NAME}', () => serializedName)
        .replace('${AIGON_AGENTS}', () => serializedAgents);
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
    saveGlobalConfig(cfg);
}

function sendMacNotification(message, title = 'Aigon Dashboard', { openUrl } = {}) {
    try {
        // Prefer terminal-notifier when available — supports click-to-open actions
        const tnPath = execSync('which terminal-notifier 2>/dev/null', { encoding: 'utf8' }).trim();
        if (tnPath) {
            const args = ['-title', title, '-message', message, '-group', 'aigon', '-sender', 'com.apple.Terminal'];
            if (openUrl) args.push('-open', openUrl);
            spawnSync(tnPath, args, { stdio: 'ignore' });
            return;
        }
    } catch (_) {
        // terminal-notifier not found — fall through to osascript
    }
    try {
        spawnSync('osascript', ['-e', `display notification ${JSON.stringify(String(message))} with title ${JSON.stringify(String(title))}`], { stdio: 'ignore' });
    } catch (e) {
        // Notification failures are non-fatal.
    }
}

function tokenizeDashboardCommand(command) {
    return String(command || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

function resolveDashboardSessionCommand(command) {
    const tokens = tokenizeDashboardCommand(command);
    if (tokens.length === 0) {
        throw new Error('command is required');
    }

    if (tokens[0] === '/afe' && tokens.length === 2) {
        return { bin: CLI_ENTRY_PATH, args: ['feature-eval', tokens[1]] };
    }
    if (tokens[0] === '/are' && tokens.length === 2) {
        return { bin: CLI_ENTRY_PATH, args: ['research-eval', tokens[1]] };
    }
    if (tokens[0] === 'aigon') {
        return { bin: CLI_ENTRY_PATH, args: tokens.slice(1) };
    }

    throw new Error(`Unsupported dashboard command: ${tokens[0]}`);
}

const DASHBOARD_INTERACTIVE_ACTIONS = new Set([
    'feature-create',
    'feature-prioritise',
    'feature-start',
    'feature-do',
    'feature-open',
    'feature-code-review',
    'feature-code-review-check',
    'research-review',
    'feature-eval',
    'feature-push',
    'feature-rebase',
    'feature-close',
    'feature-reset',
    'research-reset',
    'feature-autonomous-start',
    'feature-stop',
    'dev-server',
    'research-prioritise',
    'research-stop',
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
    // Include all entity definitions (feedback in ENTITY_DEFINITIONS) plus
    // feature/research constants (action derivation moved to engine, but
    // actions are still invocable via the dashboard).
    const allDefs = [
        stateMachine.ENTITY_DEFINITIONS.feedback,
        { transitions: stateMachine.FEATURE_TRANSITIONS, actions: stateMachine.FEATURE_ACTIONS },
        { transitions: stateMachine.RESEARCH_TRANSITIONS, actions: stateMachine.RESEARCH_ACTIONS },
    ];
    allDefs.forEach(def => {
        if (!def) return;
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

function handleSpecReconcileApiRequest(req, res, options = {}) {
    let body = '';
    req.on('data', chunk => { body += chunk.toString('utf8'); });
    req.on('end', () => {
        let payload = {};
        try {
            payload = body ? JSON.parse(body) : {};
        } catch (_) {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ error: 'Invalid JSON body' }));
            return;
        }

        const entityType = String(payload.entityType || '').trim();
        const entityId = String(payload.entityId || '').trim();
        if (entityType !== 'feature' && entityType !== 'research') {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ error: 'entityType must be feature or research' }));
            return;
        }
        if (!entityId) {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ error: 'entityId is required' }));
            return;
        }

        const repoResolution = resolveDashboardActionRepoPath(
            payload.repoPath,
            options.registeredRepos || [],
            options.defaultRepoPath || process.cwd()
        );
        if (!repoResolution.ok) {
            res.writeHead(repoResolution.status || 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ error: repoResolution.error || 'Invalid repoPath' }));
            return;
        }

        try {
            const result = (options.reconcileFn || reconcileEntitySpec)(
                repoResolution.repoPath,
                entityType,
                entityId,
                { dryRun: false, logger: options.logger }
            );
            if (typeof options.onComplete === 'function') options.onComplete(result, repoResolution.repoPath);
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ ok: true, repoPath: repoResolution.repoPath, ...result }));
        } catch (error) {
            if (/unknown-lifecycle/.test(String(error && error.message || ''))) {
                let fallbackCurrentPath = null;
                try {
                    const resolvedSpec = entityType === 'research'
                        ? featureSpecResolver.resolveResearchSpec(repoResolution.repoPath, entityId)
                        : featureSpecResolver.resolveFeatureSpec(repoResolution.repoPath, entityId);
                    fallbackCurrentPath = resolvedSpec && resolvedSpec.path ? resolvedSpec.path : null;
                } catch (_) { /* best effort */ }
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({
                    ok: true,
                    repoPath: repoResolution.repoPath,
                    entityType,
                    entityId,
                    currentPath: fallbackCurrentPath,
                    expectedPath: null,
                    driftDetected: false,
                    moved: false,
                    skipped: 'expected-path-outside-docs',
                }));
                return;
            }
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ error: error.message || 'Failed to reconcile spec drift' }));
        }
    });
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
        stdio: ['ignore', 'pipe', 'pipe'],
        // feature 234: tell child CLI processes (e.g. feature-close → restartServerIfLibChanged)
        // that they are running under the dashboard, so they defer server restart to us
        // instead of self-immolating via execSync('aigon server restart').
        env: { ...process.env, AIGON_INVOKED_BY_DASHBOARD: '1' },
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
        // Extract the meaningful error from stderr. Recognize both ❌ (generic
        // errors) and 🔒 (Pro capability gate) so the user sees a useful
        // message instead of "Action failed with exit code 1".
        const stderrText = (result.stderr || '').trim();
        const errorLine = stderrText.split('\n').find(l => l.includes('❌') || l.includes('🔒'));
        const errorMsg = errorLine
            ? errorLine.replace(/^.*[❌🔒]\s*/, '').trim()
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
        const expectedAgents = parsed.args.slice(1).filter(arg => !String(arg).startsWith('--'));
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

function listRepoBranches(repoPath, options = {}) {
    const exec = options.execFn || execSync;
    try {
        const quotedRepo = shellQuote(repoPath);
        const output = exec(`git -C ${quotedRepo} branch --list --format="%(refname:short)"`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        });
        return String(output || '')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);
    } catch (_) {
        return [];
    }
}

function resolveFeatureBranchForPrStatus(repoPath, featureId, options = {}) {
    const targetId = String(featureId || '').trim();
    if (!targetId) {
        return { ok: false, message: 'featureId is required' };
    }

    const snapshotReader = options.readFeatureSnapshotSync || workflowSnapshotAdapter.readFeatureSnapshotSync;
    const specResolver = options.resolveFeatureSpec || featureSpecResolver.resolveFeatureSpec;
    const branchLister = options.listRepoBranches || listRepoBranches;

    const snapshot = snapshotReader(repoPath, targetId);
    const resolvedSpec = specResolver(repoPath, targetId, { snapshot });
    if (!resolvedSpec || !resolvedSpec.path) {
        return { ok: false, message: `Feature ${targetId} spec not found` };
    }

    const m = path.basename(resolvedSpec.path).match(/^feature-(\d+)-(.+)\.md$/);
    if (!m) {
        return { ok: false, message: `Could not parse feature filename for feature ${targetId}` };
    }

    const num = m[1];
    const desc = m[2];
    const driveBranch = `feature-${num}-${desc}`;
    const allBranches = branchLister(repoPath, options);
    const branchSet = new Set(allBranches);

    const snapshotAgentBranches = Object.keys((snapshot && snapshot.agents) || {})
        .map(agentId => `feature-${num}-${agentId}-${desc}`)
        .filter(branchName => branchSet.has(branchName));
    if (snapshotAgentBranches.length === 1) {
        return { ok: true, branchName: snapshotAgentBranches[0], featureNum: num };
    }
    if (snapshotAgentBranches.length > 1) {
        return {
            ok: false,
            message: `Multiple agent branches found for feature ${num}: ${snapshotAgentBranches.join(', ')}`,
        };
    }

    const matchingBranches = allBranches.filter(branchName =>
        branchName.startsWith(`feature-${num}-`) &&
        (branchName === driveBranch || branchName.endsWith(`-${desc}`))
    );
    const agentBranches = matchingBranches.filter(branchName => branchName !== driveBranch);
    if (agentBranches.length === 1) {
        return { ok: true, branchName: agentBranches[0], featureNum: num };
    }
    if (agentBranches.length > 1) {
        return {
            ok: false,
            message: `Multiple agent branches found for feature ${num}: ${agentBranches.join(', ')}`,
        };
    }
    if (branchSet.has(driveBranch)) {
        return { ok: true, branchName: driveBranch, featureNum: num };
    }
    if (matchingBranches.length === 1) {
        return { ok: true, branchName: matchingBranches[0], featureNum: num };
    }
    if (matchingBranches.length > 1) {
        return {
            ok: false,
            message: `Multiple feature branches found for feature ${num}: ${matchingBranches.join(', ')}`,
        };
    }

    return { ok: false, message: `No local feature branch found for feature ${num}` };
}

function getFeaturePrStatusPayload(repoPath, featureId, options = {}) {
    const branchResult = resolveFeatureBranchForPrStatus(repoPath, featureId, options);
    if (!branchResult.ok) {
        return {
            provider: 'github',
            status: 'unavailable',
            message: branchResult.message,
        };
    }

    const defaultBranch = detectDefaultBranch(repoPath) || 'main';
    return queryGitHubPrStatus(branchResult.branchName, defaultBranch, {
        cwd: repoPath,
        execFn: options.execFn,
    });
}

function runDashboardServer(port, instanceName, serverId, options) {
    const http = require('http');
    const host = '0.0.0.0';
    instanceName = instanceName || 'main';
    options = options || {};
    const templateRoot = options.templateRoot || ROOT_DIR;
    const isPreview = !!options.templateRoot;
    const appId = options.appId || getAppId();
    const localUrl = `http://${host}:${port}`;
    const proxyAvailable = isProxyAvailable();
    const proxyUrl = proxyAvailable ? getDevProxyUrl(appId, serverId || null) : null;
    const dashboardUrl = proxyUrl || localUrl;
    let latestStatus = collectDashboardStatusData();
    const lastStatusByAgent = {};
    const allSubmittedNotified = new Set();
    // Tracks agents for which a sticky-idle panel notification has been emitted.
    // Key: `${repoPath}:${entityPrefix}${entityId}:${agentId}`. Cleared when idle clears.
    const stickyIdleNotified = new Set();
    let globalConfig = loadGlobalConfig();

    // ── Peek mode state — tracks which sessions have active pipe-pane streams ──
    const peekActiveSessions = new Set();

    // ── Logs event buffer ─────────────────────────────────────────────────────
    const LOGS_BUFFER_MAX = 200;
    const logsBuffer = []; // { timestamp, type, action, args, repoPath, command, exitCode, ok, stdout, stderr, duration }
    // Warm buffer from persisted action logs so entries survive server restarts
    try {
        const _saved = fs.readFileSync(ACTION_LOG_FILE, 'utf8').split('\n').filter(Boolean);
        _saved.slice(-LOGS_BUFFER_MAX).forEach(line => {
            try { logsBuffer.push(JSON.parse(line)); } catch (_) {}
        });
    } catch (_) { /* file may not exist yet */ }

    // ── feature 234: in-flight action dedupe ──────────────────────────────────
    // Prevents double-click footguns on Close / Accept / Reject / Adopt. Keyed
    // by `${repoPath}|${action}|${args.join(',')}`. Entries are removed in the
    // request handler's finally block (both success and failure).
    const inflightActions = new Map();
    function inflightKey(repoPath, action, args) {
        return `${repoPath || ''}|${action || ''}|${(args || []).join(',')}`;
    }

    const ACTION_LOG_MAX_LINES = 500;

    function logToLogs(entry) {
        entry.timestamp = new Date().toISOString();
        logsBuffer.push(entry);
        if (logsBuffer.length > LOGS_BUFFER_MAX) logsBuffer.shift();
        log(`${entry.type}: ${entry.command || entry.action} | ok=${entry.ok} exitCode=${entry.exitCode !== undefined ? entry.exitCode : 'n/a'}${entry.stderr ? ' stderr=' + String(entry.stderr).trim().slice(0, 120) : ''}`);
        // Persist to JSONL so entries survive server restarts
        try {
            fs.appendFileSync(ACTION_LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
            // Trim file if it grows beyond ACTION_LOG_MAX_LINES
            const content = fs.readFileSync(ACTION_LOG_FILE, 'utf8');
            const lines = content.split('\n').filter(Boolean);
            if (lines.length > ACTION_LOG_MAX_LINES) {
                fs.writeFileSync(ACTION_LOG_FILE, lines.slice(-ACTION_LOG_MAX_LINES).join('\n') + '\n', 'utf8');
            }
        } catch (_) { /* non-fatal */ }
    }

    function readPersistedActionLogs() {
        try {
            const content = fs.readFileSync(ACTION_LOG_FILE, 'utf8');
            return content.split('\n').filter(Boolean).map(line => {
                try { return JSON.parse(line); } catch (_) { return null; }
            }).filter(Boolean);
        } catch (_) { return []; }
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
        const mem = process.memoryUsage();
        log(`  memory    : rss=${Math.round(mem.rss / 1024 / 1024)}MB heap=${Math.round(mem.heapUsed / 1024 / 1024)}/${Math.round(mem.heapTotal / 1024 / 1024)}MB`);
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
        return resolveDashboardActionRepoPath(decodedRepo, readConductorReposFromGlobalConfig(), process.cwd());
    }

    function resolveRequestedRepoPath(requestedRepoPath) {
        return resolveDashboardActionRepoPath(requestedRepoPath, readConductorReposFromGlobalConfig(), process.cwd());
    }

    function resolveRequestedRepoPathOrRespond(res, requestedRepoPath) {
        const repoResolution = resolveRequestedRepoPath(requestedRepoPath);
        if (!repoResolution.ok) {
            res.writeHead(repoResolution.status || 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ error: repoResolution.error || 'Invalid repoPath' }));
            return null;
        }
        return repoResolution.repoPath;
    }

    // ── Pro extension point ───────────────────────────────────────────────────
    // Initialize the pro-bridge once at server start. This is the single seam
    // through which @aigon/pro registers routes (and, in the future, lifecycle
    // hooks). Open-source code never imports `@aigon/pro` outside of lib/pro.js
    // and lib/pro-bridge.js — see docs/architecture.md § "Aigon Pro".
    proBridge.initialize({
        helpers: {
            loadProjectConfig,
            resolveRequestedRepoPath,
            sendJson(res, status, payload) {
                res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify(payload));
            },
        },
    });

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
                    // Sticky idle panel entry — persists until the idle state clears
                    if (agent.idleState && agent.idleState.level === 'sticky' && !stickyIdleNotified.has(key)) {
                        stickyIdleNotified.add(key);
                        emitNotification('agent-idle-sticky', `${agent.id} idle ${agent.idleState.idleMinutes}m on #${feature.id} ${feature.name} · ${repoShort}`, notifMeta({ featureId: feature.id, agentId: agent.id }));
                    } else if (!agent.idleState || agent.idleState.level !== 'sticky') {
                        stickyIdleNotified.delete(key);
                    }
                });

                const featureKey = `${repo.path}:${feature.id}`;
                const agents = Array.isArray(feature.agents) ? feature.agents : [];
                const featureSmCtx = {
                    agents: agents.map(a => a.id),
                    agentStatuses: Object.fromEntries(agents.map(a => [a.id, a.status])),
                    tmuxSessionStates: {}
                };
                const featureAllSubmitted = feature.stage === 'in-progress' && stateMachine.isFleet(featureSmCtx) && stateMachine.allAgentsSubmitted(featureSmCtx);
                if (featureAllSubmitted && !allSubmittedNotified.has(featureKey)) {
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
                    // Sticky idle panel entry for research agents
                    if (agent.idleState && agent.idleState.level === 'sticky' && !stickyIdleNotified.has(key)) {
                        stickyIdleNotified.add(key);
                        emitNotification('agent-idle-sticky', `${agent.id} idle ${agent.idleState.idleMinutes}m on R#${item.id} ${item.name} · ${repoShort}`, notifMeta({ researchId: item.id, agentId: agent.id }));
                    } else if (!agent.idleState || agent.idleState.level !== 'sticky') {
                        stickyIdleNotified.delete(key);
                    }
                });

                const researchKey = `${repo.path}:R${item.id}`;
                const researchSmCtx = {
                    agents: (item.agents || []).map(a => a.id),
                    agentStatuses: Object.fromEntries((item.agents || []).map(a => [a.id, a.status])),
                    tmuxSessionStates: {}
                };
                const researchAllSubmitted = item.stage === 'in-progress' && stateMachine.allAgentsSubmitted(researchSmCtx);
                if (researchAllSubmitted && !allSubmittedNotified.has(researchKey)) {
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
            try {
                doneCount += countDoneEntities(rp, 'feature');
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

    const dashboardRoutes = createDashboardRouteDispatcher({
        state: {
            getLatestStatus: () => latestStatus,
            setLatestStatus: next => { latestStatus = next; },
            getGlobalConfig: () => globalConfig,
            setGlobalConfig: next => { globalConfig = next; },
            peekActiveSessions,
            logsBuffer,
            notificationBuffer,
            getNotificationUnreadCount: () => notificationUnreadCount,
            setNotificationUnreadCount: next => { notificationUnreadCount = next; },
            inflightActions,
            resetAnalyticsCache: () => { analyticsCache = null; },
        },
        helpers: {
            log,
            logToLogs,
            pollStatus,
            getNotificationConfig,
            getOrRecomputeAnalytics,
            resolveRepoFromPathParam,
            resolveRequestedRepoPath,
            resolveRequestedRepoPathOrRespond,
            findFeatureAgentInStatus,
            inflightKey,
        },
        routes: {
            CLI_ENTRY_PATH,
            DASHBOARD_SETTINGS_SCHEMA,
            parseFeatureSpecFileName,
            safeTmuxSessionExists,
            collectDashboardStatusData,
            collectFeatureDeepStatus,
            readConductorReposFromGlobalConfig,
            resolveDetailRepoPath,
            buildDetailPayload,
            appendDependencyGraph: _appendDependencyGraph,
            platformOpen,
            writeRepoRegistry,
            resolveDashboardSessionCommand,
            buildDashboardActionCommandArgs,
            handleSpecReconcileApiRequest,
            runDashboardInteractiveAction,
            getFeaturePrStatusPayload,
            handleLaunchReview,
            handleLaunchSpecReview,
            handleLaunchEval,
            handleLaunchCloseResolve,
            handleLaunchImplementation,
            readPersistedActionLogs,
            getTmuxSessionPeekMeta,
            parsePeriodDays,
            buildDashboardSettingsPayload,
            coerceDashboardSettingValue,
            readRawGlobalConfig,
            setNestedValue,
            getActiveProfile,
        },
        options,
    });

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

        if (dashboardRoutes.dispatchOssRoute(req.method, reqPath, req, res)) {
            return;
        }

        // Pro-owned routes (e.g. /api/insights, /api/insights/refresh) are
        // dispatched through the pro-bridge — see lib/pro-bridge.js. The
        // dashboard server has zero knowledge of which paths Pro owns.
        if (proBridge.dispatchProRoute(req.method, reqPath, req, res)) {
            return;
        }
        // When Pro is not installed, return a stable upgrade payload for the
        // known Pro path prefixes so the frontend can render the upgrade UI
        // without leaking endpoint names into the open-source dashboard.
        if (!isProAvailable() && reqPath.startsWith('/api/insights')) {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ proRequired: true, error: 'AADE Insights requires @aigon/pro' }));
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
    '<div style="font-size:18px;font-weight:600;margin-bottom:8px">Amplification (Pro — coming later)</div>' +
    '<div style="color:var(--text-secondary);margin-bottom:16px">Workflow insights, cost trends, autonomy metrics, and AI coaching.</div>' +
    '<div style="color:var(--text-tertiary);font-size:12px;margin-top:12px">Pro is in development and not yet available for purchase. Free alternative: <code>aigon board</code>, <code>aigon commits</code>, <code>aigon feature-status</code>.</div>' +
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
        if (err.code === 'EADDRINUSE') {
            // Port is already held by another process (often a stale server
            // process that wasn't cleaned up by `aigon server restart`). Staying alive
            // here is harmful — the process would have no HTTP server and no poll loop,
            // silently doing nothing. Exit so the caller knows the start failed.
            log.error(`Port ${port} already in use — exiting so the caller can retry`);
            process.exit(1);
        }
    });

    const registryServerId = serverId || '';

    const shutdown = (sig) => {
        log(`Dashboard shutting down (PID ${process.pid}, ppid=${process.ppid})${sig ? ` — ${sig}` : ''}`);
        // Caddy route is intentionally NOT removed on shutdown.
        // The route persists in the Caddyfile — Caddy returns 502 while the
        // dashboard is down and auto-recovers when it restarts.
        const exitTimer = setTimeout(() => { log('Forced exit after shutdown timeout'); process.exit(0); }, 3000);
        exitTimer.unref();
        server.close(() => process.exit(0));
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Crash logging — catch unhandled errors so they're written to the log file
    // instead of silently hanging or dying without a trace
    // Crash resilience — log errors but do NOT exit the process.
    // A proper daemon survives transient failures (missing dirs, bad polls, etc.)
    let uncaughtCount = 0;
    function logMemory(label) {
        const mem = process.memoryUsage();
        log(`${label} — rss=${Math.round(mem.rss / 1024 / 1024)}MB heap=${Math.round(mem.heapUsed / 1024 / 1024)}/${Math.round(mem.heapTotal / 1024 / 1024)}MB ext=${Math.round(mem.external / 1024 / 1024)}MB`);
    }

    process.on('uncaughtException', (err) => {
        // EPIPE = client disconnected mid-response — harmless, don't count it
        if (err && err.code === 'EPIPE') {
            log(`EPIPE (client disconnected) — suppressed`);
            return;
        }
        uncaughtCount++;
        log.error(`uncaughtException #${uncaughtCount}: ${err.stack || err.message || err}`);
        logMemory('ERROR memory at crash');
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
        logMemory('ERROR memory at rejection');
    });
    // Note: SIGINT and SIGTERM are already handled by the shutdown() function above.
    // Logging the signal name there keeps the shutdown sequence visible in the log.
    // Catch additional signals that could silently kill the process
    for (const sig of ['SIGHUP', 'SIGUSR1', 'SIGUSR2', 'SIGPIPE']) {
        try {
            process.on(sig, () => { log(`Signal received: ${sig} — ignoring`); });
        } catch (_) { /* some signals not supported on all platforms */ }
    }

    // Log memory every 5 minutes so we can spot leaks before a crash
    setInterval(() => logMemory('Heartbeat memory'), 5 * 60 * 1000).unref();

    // Log before any exit so there's always a trace in the file
    const _origExit = process.exit.bind(process);
    process.exit = (code) => {
        log(`──── Dashboard exiting (code=${code ?? 0}, pid=${process.pid}) ────`);
        logMemory('Exit memory');
        _origExit(code);
    };

    server.listen(port, host, () => {
        // Write the dashboard route to the Caddyfile (persistent — survives crashes)
        try {
            const hostname = buildCaddyHostname(appId, registryServerId || null);
            addCaddyRoute(hostname, port, registryServerId ? `Dashboard: ${registryServerId}` : 'Dashboard');
        } catch (_) { /* non-fatal if Caddy not installed */ }
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
        // Never auto-open the browser — the user already has it open or will
        // navigate there themselves. Auto-opening is especially disruptive when
        // launchd restarts the server or during `aigon update`.
        // Use `aigon server open` to open explicitly.
    });
}

module.exports = {
    readConductorReposFromGlobalConfig,
    parseSimpleFrontMatter,
    normalizeDashboardStatus,
    parseFeatureSpecFileName,
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
    handleSpecReconcileApiRequest,
    resolveFeatureBranchForPrStatus,
    getFeaturePrStatusPayload,
    runDashboardServer,
};
