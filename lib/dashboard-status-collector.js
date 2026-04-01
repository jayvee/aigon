'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const stateMachine = require('./state-queries');
const { isProAvailable } = require('./pro');
const workflowReadModel = require('./workflow-read-model');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const featureSpecResolver = require('./feature-spec-resolver');
const {
    normalizeDashboardStatus,
    parseFeatureSpecFileName,
    findTmuxSessionsByPrefix,
    findFirstTmuxSessionByPrefix,
    safeTmuxSessionExists,
    resolveFeatureWorktreePath,
    parseStatusFlags,
    maybeFlagEndedSession,
} = require('./dashboard-status-helpers');
const { readConductorReposFromGlobalConfig } = require('./config');
const {
    getAppId,
    getDevProxyUrl,
    loadProxyRegistry,
    isProcessAlive,
} = require('./proxy');
const {
    buildTmuxSessionName,
    buildResearchTmuxSessionName,
    tmuxSessionExists,
} = require('./worktree');
const { getAgentLiveness } = require('./supervisor');

function safeReadDir(dir, predicate = null) {
    if (!fs.existsSync(dir)) return [];
    try {
        const entries = fs.readdirSync(dir);
        return predicate ? entries.filter(predicate) : entries;
    } catch (_) {
        return [];
    }
}

function safeStatMtimeMs(filePath) {
    try {
        return fs.statSync(filePath).mtimeMs;
    } catch (_) {
        return 0;
    }
}

function safeStatIsoTimes(filePath) {
    try {
        const stat = fs.statSync(filePath);
        return {
            updatedAt: stat.mtime.toISOString(),
            createdAt: stat.birthtime.toISOString()
        };
    } catch (_) {
        const now = new Date().toISOString();
        return { updatedAt: now, createdAt: now };
    }
}

function listStageSpecFiles(stageDirs) {
    const specFiles = [];
    stageDirs.forEach(({ dir, stage, pattern }) => {
        safeReadDir(dir, file => pattern.test(file))
            .sort((a, b) => safeStatMtimeMs(path.join(dir, b)) - safeStatMtimeMs(path.join(dir, a)))
            .forEach(file => specFiles.push({ file, stage, dir }));
    });
    return specFiles;
}

function listRecentDoneSpecFiles(doneDir, pattern, limit = 10) {
    const allDone = safeReadDir(doneDir, file => pattern.test(file));
    const doneWithStats = allDone
        .map(file => {
            const fullPath = path.join(doneDir, file);
            let birthtime = null;
            let mtime = 0;
            try {
                const stat = fs.statSync(fullPath);
                birthtime = stat.birthtime.toISOString();
                mtime = stat.mtime.getTime();
            } catch (_) { /* ignore */ }
            return { file, mtime, birthtime };
        })
        .sort((a, b) => b.mtime - a.mtime);

    return {
        total: allDone.length,
        all: doneWithStats,
        recent: doneWithStats.slice(0, limit),
    };
}

function readJsonFilesByPattern(dir, pattern, mapEntry) {
    const result = {};
    safeReadDir(dir, file => pattern.test(file)).forEach(file => {
        try {
            const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
            const mapped = mapEntry(parsed, file);
            if (mapped && mapped.key) result[mapped.key] = mapped.value;
        } catch (_) { /* ignore */ }
    });
    return result;
}

function isDevServerPokeEligible(status, flags, tmuxRunning) {
    const normalized = String(status || '').toLowerCase();
    const ended = Boolean(flags && flags.sessionEnded);
    if (normalized === 'submitted' || normalized === 'idle') return true;
    if (ended) return true;
    if (normalized === 'implementing' && !tmuxRunning) return true;
    return false;
}

function getDevServerState(devProxyRegistry, repoAppId, serverId) {
    const devEntry = devProxyRegistry[serverId];
    const devServerAlive = Boolean(devEntry && devEntry.pid > 0 && isProcessAlive(devEntry.pid));
    return {
        running: devServerAlive,
        url: devServerAlive ? getDevProxyUrl(repoAppId, serverId) : null
    };
}

function readFeatureManifests(stateDir) {
    return readJsonFilesByPattern(stateDir, /^feature-\d+\.json$/, (parsed, file) => {
        const match = file.match(/^feature-(\d+)\.json$/);
        return match ? { key: match[1], value: parsed } : null;
    });
}

function buildFeatureAgentRow(options) {
    const {
        absRepoPath,
        parsed,
        agent,
        status,
        updatedAt,
        flags,
        hasStatusFile,
        stateDir,
        worktreeBaseDir,
        devServerEnabled,
        devProxyRegistry,
        repoAppId,
    } = options;
    const tmux = safeTmuxSessionExists(parsed.id, agent);
    const worktreePath = resolveFeatureWorktreePath(worktreeBaseDir, parsed.id, agent, absRepoPath);
    const flagged = maybeFlagEndedSession(absRepoPath, {
        entityType: 'feature',
        id: parsed.id,
        agent,
        status,
        flags,
        tmuxRunning: tmux ? tmux.running : false,
        worktreePath,
        hasStatusFile
    });
    const serverId = `${agent}-${parsed.id}`;
    const devServer = getDevServerState(devProxyRegistry, repoAppId, serverId);
    const livenessInfo = getAgentLiveness(absRepoPath, 'feature', parsed.id, agent);
    return {
        id: agent,
        status: flagged.status,
        updatedAt,
        slashCommand: flagged.status === 'waiting' ? `aigon terminal-focus ${String(parsed.id).padStart(2, '0')} ${agent}` : null,
        tmuxSession: tmux ? tmux.sessionName : null,
        tmuxRunning: tmux ? tmux.running : false,
        attachCommand: tmux ? `tmux attach -t ${tmux.sessionName}` : null,
        worktreePath: worktreePath || null,
        flags: flagged.flags,
        liveness: livenessInfo ? livenessInfo.liveness : null,
        lastSeenAt: livenessInfo ? livenessInfo.lastSeenAt : null,
        heartbeatAgeMs: livenessInfo ? livenessInfo.heartbeatAgeMs : null,
        devServerEligible: Boolean(devServerEnabled && worktreePath),
        devServerPokeEligible: Boolean(
            devServerEnabled &&
            worktreePath &&
            !devServer.url &&
            isDevServerPokeEligible(flagged.status, flagged.flags, tmux ? tmux.running : false)
        ),
        devServerUrl: devServer.url
    };
}

function buildFeatureAgentsFromSnapshot(options) {
    const {
        absRepoPath,
        featureId,
        snapshot,
        updatedAt,
        stateDir,
        worktreeBaseDir,
        devServerEnabled,
        devProxyRegistry,
        repoAppId,
    } = options;
    const parsed = { id: featureId };
    const snapshotStatuses = workflowSnapshotAdapter.snapshotAgentStatuses(snapshot);
    return Object.keys(snapshotStatuses)
        .sort((a, b) => a.localeCompare(b))
        .map(agent => {
            let agentFlags = {};
            let hasStatusFile = false;
            try {
                const statusData = JSON.parse(fs.readFileSync(path.join(stateDir, `feature-${featureId}-${agent}.json`), 'utf8'));
                agentFlags = parseStatusFlags(statusData.flags);
                hasStatusFile = true;
            } catch (_) { /* ignore */ }

            return buildFeatureAgentRow({
                absRepoPath,
                parsed,
                agent,
                status: snapshotStatuses[agent] || 'implementing',
                updatedAt: updatedAt || new Date().toISOString(),
                flags: agentFlags,
                hasStatusFile,
                stateDir,
                worktreeBaseDir,
                devServerEnabled,
                devProxyRegistry,
                repoAppId,
            });
        });
}

function listWorkflowFeatureIds(absRepoPath) {
    const workflowRoot = path.join(absRepoPath, '.aigon', 'workflows', 'features');
    return safeReadDir(workflowRoot, dir => /^\d+$/.test(dir) && fs.existsSync(path.join(workflowRoot, dir, 'snapshot.json')));
}

function resolveFeatureIdentity(absRepoPath, featureId, manifestsByFeatureId, snapshot) {
    const manifest = manifestsByFeatureId[featureId] || null;
    const resolvedSpec = featureSpecResolver.resolveFeatureSpec(absRepoPath, featureId, { snapshot });
    if (resolvedSpec.path) {
        const parsed = parseFeatureSpecFileName(path.basename(resolvedSpec.path));
        if (parsed) {
            return {
                id: featureId,
                name: parsed.name,
                specPath: resolvedSpec.path,
            };
        }
    }

    if (manifest && manifest.name) {
        return {
            id: featureId,
            name: manifest.name,
            specPath: resolvedSpec.path || manifest.specPath || (snapshot ? snapshot.specPath : null),
        };
    }

    return {
        id: featureId,
        name: `feature-${featureId}`,
        specPath: resolvedSpec.path || (snapshot ? snapshot.specPath : null),
    };
}

function collectFeatures(repoContext, response) {
    const {
        absRepoPath,
        stateDir,
        devServerEnabled,
        devProxyRegistry,
        repoAppId,
    } = repoContext;
    const inboxDir = path.join(absRepoPath, 'docs', 'specs', 'features', '01-inbox');
    const backlogDir = path.join(absRepoPath, 'docs', 'specs', 'features', '02-backlog');
    const pausedDir = path.join(absRepoPath, 'docs', 'specs', 'features', '06-paused');
    const doneDir = path.join(absRepoPath, 'docs', 'specs', 'features', '05-done');
    const mainLogsDir = path.join(absRepoPath, 'docs', 'specs', 'features', 'logs');
    const worktreeBaseDir = path.join(os.homedir(), '.aigon', 'worktrees', path.basename(absRepoPath));

    const specFiles = listStageSpecFiles([
        { dir: inboxDir, stage: 'inbox', pattern: /^feature-.+\.md$/ },
        { dir: backlogDir, stage: 'backlog', pattern: /^feature-\d+-.+\.md$/ },
        { dir: path.join(absRepoPath, 'docs', 'specs', 'features', '03-in-progress'), stage: 'in-progress', pattern: /^feature-\d+-.+\.md$/ },
        { dir: path.join(absRepoPath, 'docs', 'specs', 'features', '04-in-evaluation'), stage: 'in-evaluation', pattern: /^feature-\d+-.+\.md$/ },
        { dir: pausedDir, stage: 'paused', pattern: /^feature-.+\.md$/ },
    ]);
    const doneSpecs = listRecentDoneSpecFiles(doneDir, /^feature-\d+-.+\.md$/);
    doneSpecs.recent.forEach(({ file }) => specFiles.push({ file, stage: 'done', dir: doneDir }));

    const manifestsByFeatureId = readFeatureManifests(stateDir);
    const workflowFeatureIds = new Set(listWorkflowFeatureIds(absRepoPath));
    const features = [];

    [...workflowFeatureIds].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).forEach(featureId => {
        const snapshot = workflowSnapshotAdapter.readFeatureSnapshotSync(absRepoPath, featureId);
        const stage = workflowSnapshotAdapter.snapshotToStage(snapshot);
        if (!snapshot || !stage) return;
        const identity = resolveFeatureIdentity(absRepoPath, featureId, manifestsByFeatureId, snapshot);
        const agents = buildFeatureAgentsFromSnapshot({
            absRepoPath,
            featureId,
            snapshot,
            updatedAt: snapshot.updatedAt,
            stateDir,
            worktreeBaseDir,
            devServerEnabled,
            devProxyRegistry,
            repoAppId,
        });
        const featureState = workflowReadModel.getFeatureDashboardState(absRepoPath, featureId, stage, agents);
        agents.forEach(agent => {
            if (featureState.snapshotStatuses[agent.id]) {
                agent.status = featureState.snapshotStatuses[agent.id];
            }
            response.summary.total++;
            response.summary[agent.status] = (response.summary[agent.status] || 0) + 1;
        });

        features.push({
            id: featureId,
            name: identity.name,
            stage,
            specPath: identity.specPath || snapshot.specPath,
            updatedAt: snapshot.updatedAt || new Date().toISOString(),
            createdAt: snapshot.createdAt || snapshot.updatedAt || new Date().toISOString(),
            evalStatus: featureState.evalStatus,
            winnerAgent: featureState.winnerAgent,
            evalPath: featureState.evalPath,
            evalSession: featureState.evalSession,
            reviewStatus: featureState.reviewStatus,
            reviewSessions: featureState.reviewSessions,
            agents,
            pending: [],
            nextAction: featureState.nextAction,
            nextActions: featureState.nextActions,
            validActions: featureState.validActions,
            workflowEngine: featureState.workflowEngine,
            workflowEvents: featureState.workflowEvents,
        });
    });

    specFiles.forEach(({ file: specFile, stage, dir: specDir }) => {
        const parsed = parseFeatureSpecFileName(specFile);
        if (!parsed) return;
        // Inbox features have no numeric ID — use name as identifier
        const featureId = parsed.id || parsed.name;
        if (workflowFeatureIds.has(featureId)) return;
        const specPath = path.join(specDir, specFile);
        const { updatedAt: fallbackUpdatedAt, createdAt } = safeStatIsoTimes(specPath);
        const featureState = workflowReadModel.getFeatureDashboardState(absRepoPath, featureId, stage, []);
        features.push({
            id: featureId,
            name: parsed.name,
            stage,
            specPath,
            updatedAt: fallbackUpdatedAt,
            createdAt,
            evalStatus: featureState.evalStatus,
            winnerAgent: featureState.winnerAgent,
            evalPath: featureState.evalPath,
            evalSession: featureState.evalSession,
            reviewStatus: featureState.reviewStatus,
            reviewSessions: featureState.reviewSessions,
            agents: [],
            pending: [],
            nextAction: featureState.nextAction,
            nextActions: featureState.nextActions,
            validActions: featureState.validActions,
            workflowEngine: featureState.workflowEngine,
            workflowEvents: featureState.workflowEvents,
        });
    });

    const seenIds = new Set(features.map(feature => feature.id).filter(Boolean));
    const logPathsByFeatureId = {};
    safeReadDir(mainLogsDir, file => /^feature-\d+-.+-log\.md$/.test(file) && !fs.lstatSync(path.join(mainLogsDir, file)).isDirectory())
        .forEach(file => {
            const match = file.match(/^feature-(\d+)-/);
            if (!match) return;
            if (!logPathsByFeatureId[match[1]]) logPathsByFeatureId[match[1]] = [];
            logPathsByFeatureId[match[1]].push(path.join(mainLogsDir, file));
        });

    const extraDone = doneSpecs.all
        .filter(({ file }) => {
            const parsed = parseFeatureSpecFileName(file);
            return parsed && !seenIds.has(parsed.id);
        })
        .map(({ file, mtime, birthtime }) => {
            const parsed = parseFeatureSpecFileName(file);
            return {
                id: parsed.id,
                name: parsed.name,
                stage: 'done',
                specPath: path.join(doneDir, file),
                updatedAt: new Date(mtime).toISOString(),
                createdAt: birthtime || new Date(mtime).toISOString()
            };
        });

    const allFeatures = [
        ...features.map(feature => ({
            id: feature.id,
            name: feature.name,
            stage: feature.stage,
            specPath: feature.specPath,
            updatedAt: feature.updatedAt,
            createdAt: feature.createdAt,
            logPaths: logPathsByFeatureId[feature.id] || []
        })),
        ...extraDone.map(feature => ({ ...feature, logPaths: logPathsByFeatureId[feature.id] || [] }))
    ];

    return {
        features,
        allFeatures,
        doneTotal: doneSpecs.total,
    };
}

function readResearchManifests(stateDir) {
    return readJsonFilesByPattern(stateDir, /^research-\d+\.json$/, (parsed, file) => {
        const match = file.match(/^research-(\d+)\.json$/);
        return match ? { key: match[1], value: parsed } : null;
    });
}

function collectResearch(repoContext, response) {
    const { absRepoPath, stateDir } = repoContext;
    const researchRoot = path.join(absRepoPath, 'docs', 'specs', 'research-topics');
    const researchLogsDir = path.join(researchRoot, 'logs');
    const stagePriority = {
        'inbox': 0,
        'backlog': 1,
        'in-progress': 2,
        'in-evaluation': 3,
        'paused': 4,
        'done': 5,
    };

    const researchSpecFiles = listStageSpecFiles([
        { dir: path.join(researchRoot, '01-inbox'), stage: 'inbox', pattern: /^research-.+\.md$/ },
        { dir: path.join(researchRoot, '02-backlog'), stage: 'backlog', pattern: /^research-\d+-.+\.md$/ },
        { dir: path.join(researchRoot, '03-in-progress'), stage: 'in-progress', pattern: /^research-\d+-.+\.md$/ },
        { dir: path.join(researchRoot, '04-in-evaluation'), stage: 'in-evaluation', pattern: /^research-\d+-.+\.md$/ },
        { dir: path.join(researchRoot, '06-paused'), stage: 'paused', pattern: /^research-\d+-.+\.md$/ },
    ]);

    const doneSpecs = listRecentDoneSpecFiles(path.join(researchRoot, '05-done'), /^research-\d+-.+\.md$/);
    doneSpecs.recent.forEach(({ file }) => {
        researchSpecFiles.push({ file, stage: 'done', dir: path.join(researchRoot, '05-done') });
    });

    const dedupedResearchSpecFiles = [];
    const researchSpecByKey = new Map();
    researchSpecFiles.forEach(specEntry => {
        const match = specEntry.file.match(/^research-(\d+)-(.+)\.md$/) || specEntry.file.match(/^research-(.+)\.md$/);
        if (!match) return;
        const hasNumericId = /^\d+$/.test(match[1]);
        const dedupeKey = hasNumericId ? match[1] : specEntry.file;
        const existing = researchSpecByKey.get(dedupeKey);
        if (!existing || (stagePriority[specEntry.stage] ?? -1) > (stagePriority[existing.stage] ?? -1)) {
            researchSpecByKey.set(dedupeKey, specEntry);
        }
    });
    dedupedResearchSpecFiles.push(...researchSpecByKey.values());

    const researchManifestsById = readResearchManifests(stateDir);
    const researchLogsByAgent = {};
    safeReadDir(researchLogsDir, file => /^research-(\d+)-([a-z]{2})-findings\.md$/.test(file)).forEach(file => {
        const match = file.match(/^research-(\d+)-([a-z]{2})-findings\.md$/);
        if (!match) return;
        if (!researchLogsByAgent[match[1]]) researchLogsByAgent[match[1]] = [];
        researchLogsByAgent[match[1]].push(match[2]);
    });

    const research = [];
    dedupedResearchSpecFiles.forEach(({ file, stage, dir: specDir }) => {
        const match = file.match(/^research-(\d+)-(.+)\.md$/) || file.match(/^research-(.+)\.md$/);
        if (!match) return;
        const hasId = /^\d+$/.test(match[1]);
        const id = hasId ? match[1] : null;
        const name = hasId ? match[2] : match[1];
        let effectiveStage = stage;
        const snapshot = id
            ? workflowSnapshotAdapter.readWorkflowSnapshotSync(absRepoPath, 'research', id)
            : null;
        if (snapshot) {
            effectiveStage = workflowSnapshotAdapter.snapshotToStage(snapshot) || effectiveStage;
        }
        const agents = [];
        const isActiveStage = effectiveStage === 'in-progress' || effectiveStage === 'in-evaluation';
        const snapshotStatuses = snapshot ? workflowSnapshotAdapter.snapshotAgentStatuses(snapshot) : {};

        if (id && isActiveStage) {
            const researchManifest = researchManifestsById[id] || null;
            const manifestAgents = researchManifest && Array.isArray(researchManifest.agents) && researchManifest.agents.length > 0
                ? researchManifest.agents
                : null;
            const fromLogs = researchLogsByAgent[id] ? [...new Set(researchLogsByAgent[id])] : [];
            const fromSnapshot = Object.keys(snapshotStatuses);
            const agentList = [...new Set([...(manifestAgents || []), ...fromLogs, ...fromSnapshot])];

            agentList.slice().sort((a, b) => a.localeCompare(b)).forEach(agent => {
                const sessionName = buildResearchTmuxSessionName(id, agent, { repo: path.basename(absRepoPath) });
                const tmuxRunning = tmuxSessionExists(sessionName);
                const statusFile = path.join(stateDir, `research-${id}-${agent}.json`);
                const legacyStatusFile = path.join(stateDir, `feature-${id}-${agent}.json`);
                let normalizedStatus = 'implementing';
                let normalizedUpdatedAt = new Date().toISOString();
                let agentFlags = {};
                let hasStatusFile = false;

                try {
                    const actualStatusFile = fs.existsSync(statusFile)
                        ? statusFile
                        : (fs.existsSync(legacyStatusFile) ? legacyStatusFile : null);
                    if (actualStatusFile) {
                        const parsedStatus = JSON.parse(fs.readFileSync(actualStatusFile, 'utf8'));
                        normalizedStatus = snapshotStatuses[agent] || normalizeDashboardStatus(parsedStatus.status);
                        normalizedUpdatedAt = parsedStatus.updatedAt || normalizedUpdatedAt;
                        agentFlags = parseStatusFlags(parsedStatus.flags);
                        hasStatusFile = true;
                    }
                } catch (_) { /* ignore */ }

                const flagged = maybeFlagEndedSession(absRepoPath, {
                    entityType: 'research',
                    id,
                    agent,
                    status: normalizedStatus,
                    flags: agentFlags,
                    tmuxRunning,
                    researchLogsDir,
                    hasStatusFile
                });
                normalizedStatus = snapshotStatuses[agent] || normalizedStatus;
                const findingsFile = path.join(researchLogsDir, `research-${id}-${agent}-findings.md`);
                const canViewFindings = flagged.status === 'submitted' || Boolean(flagged.flags && flagged.flags.sessionEnded);
                const researchLiveness = getAgentLiveness(absRepoPath, 'research', id, agent);
                agents.push({
                    id: agent,
                    status: flagged.status,
                    updatedAt: normalizedUpdatedAt,
                    flags: flagged.flags,
                    liveness: researchLiveness ? researchLiveness.liveness : null,
                    lastSeenAt: researchLiveness ? researchLiveness.lastSeenAt : null,
                    heartbeatAgeMs: researchLiveness ? researchLiveness.heartbeatAgeMs : null,
                    findingsPath: canViewFindings ? findingsFile : null,
                    slashCommand: flagged.status === 'waiting' ? `aigon terminal-focus ${String(id).padStart(2, '0')} ${agent} --research` : null,
                    tmuxSession: tmuxRunning ? sessionName : null,
                    tmuxRunning,
                    attachCommand: tmuxRunning ? `tmux attach -t ${sessionName}` : null
                });
                response.summary.total++;
                response.summary[flagged.status] = (response.summary[flagged.status] || 0) + 1;
            });
        }

        const researchState = workflowReadModel.getResearchDashboardState(absRepoPath, id, effectiveStage, agents);
        let evalSession = null;
        if (effectiveStage === 'in-evaluation') {
            const repoBaseName = path.basename(absRepoPath);
            const unpaddedId = String(parseInt(id, 10));
            const evalPrefix = `${repoBaseName}-r${unpaddedId}-eval-`;
            evalSession = findFirstTmuxSessionByPrefix(evalPrefix, session => ({
                session,
                agent: session.slice(evalPrefix.length),
                running: tmuxSessionExists(session)
            }));
        }

        research.push({
            id,
            name,
            stage: effectiveStage,
            specPath: path.join(specDir, file),
            agents,
            evalSession,
            reviewStatus: researchState.reviewStatus,
            reviewSessions: researchState.reviewSessions,
            reviewState: researchState.reviewState,
            validActions: researchState.validActions,
            nextAction: researchState.nextAction,
            nextActions: researchState.nextActions,
            workflowEngine: researchState.workflowEngine,
            workflowEvents: researchState.workflowEvents,
        });
    });

    return {
        research,
        researchDoneTotal: doneSpecs.total,
    };
}

function collectFeedback(absRepoPath) {
    const feedbackRoot = path.join(absRepoPath, 'docs', 'specs', 'feedback');
    const feedbackSpecFiles = listStageSpecFiles([
        { dir: path.join(feedbackRoot, '01-inbox'), stage: 'inbox', pattern: /^feedback-.+\.md$/ },
        { dir: path.join(feedbackRoot, '02-triaged'), stage: 'triaged', pattern: /^feedback-.+\.md$/ },
        { dir: path.join(feedbackRoot, '03-actionable'), stage: 'actionable', pattern: /^feedback-.+\.md$/ },
        { dir: path.join(feedbackRoot, '05-wont-fix'), stage: 'wont-fix', pattern: /^feedback-.+\.md$/ },
        { dir: path.join(feedbackRoot, '06-duplicate'), stage: 'duplicate', pattern: /^feedback-.+\.md$/ },
    ]);

    const doneSpecs = listRecentDoneSpecFiles(path.join(feedbackRoot, '04-done'), /^feedback-.+\.md$/);
    doneSpecs.recent.forEach(({ file }) => {
        feedbackSpecFiles.push({ file, stage: 'done', dir: path.join(feedbackRoot, '04-done') });
    });

    const feedback = [];
    feedbackSpecFiles.forEach(({ file, stage, dir: specDir }) => {
        const match = file.match(/^feedback-(\d+)-(.+)\.md$/) || file.match(/^feedback-(.+)\.md$/);
        if (!match) return;
        const hasId = /^\d+$/.test(match[1]);
        const feedbackSmContext = {
            mode: 'solo',
            agents: [],
            agentStatuses: {},
            tmuxSessionStates: {},
            currentStage: stage,
            entityType: 'feedback'
        };
        feedback.push({
            id: hasId ? match[1] : null,
            name: hasId ? match[2] : match[1],
            stage,
            specPath: path.join(specDir, file),
            agents: [],
            validActions: stateMachine.getAvailableActions('feedback', stage, feedbackSmContext)
        });
    });

    return {
        feedback,
        feedbackDoneTotal: doneSpecs.total,
    };
}

function collectRepoStatus(absRepoPath, response) {
    if (!fs.existsSync(absRepoPath)) return null;

    const { getActiveProfile } = require('./config');
    let profile;
    try {
        profile = getActiveProfile(absRepoPath);
    } catch (_) {
        return null;
    }

    const devServerEnabled = profile.devServer.enabled;
    const repoAppId = getAppId(absRepoPath);
    const devProxyRegistry = devServerEnabled ? (loadProxyRegistry()[repoAppId] || {}) : {};
    const mainDevServer = getDevServerState(devProxyRegistry, repoAppId, '');
    const stateDir = path.join(absRepoPath, '.aigon', 'state');
    const repoContext = { absRepoPath, stateDir, devServerEnabled, devProxyRegistry, repoAppId };

    const featureStatus = collectFeatures(repoContext, response);
    const researchStatus = collectResearch(repoContext, response);
    const feedbackStatus = collectFeedback(absRepoPath);

    return {
        path: absRepoPath,
        displayPath: absRepoPath.replace(os.homedir(), '~'),
        name: path.basename(absRepoPath),
        ...featureStatus,
        ...researchStatus,
        ...feedbackStatus,
        mainDevServerEligible: Boolean(devServerEnabled),
        mainDevServerRunning: mainDevServer.running,
        mainDevServerUrl: mainDevServer.url
    };
}

function collectDashboardStatusData() {
    const response = {
        generatedAt: new Date().toISOString(),
        repos: [],
        summary: { implementing: 0, waiting: 0, submitted: 0, error: 0, total: 0 },
        proAvailable: isProAvailable()
    };

    readConductorReposFromGlobalConfig().forEach(repoPath => {
        const repoStatus = collectRepoStatus(path.resolve(repoPath), response);
        if (repoStatus) response.repos.push(repoStatus);
    });

    return response;
}

module.exports = {
    collectDashboardStatusData,
};
