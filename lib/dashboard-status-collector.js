'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const stateMachine = require('./state-queries');
const { isProAvailable } = require('./pro');
const workflowReadModel = require('./workflow-read-model');
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
    toUnpaddedId,
    tmuxSessionExists,
} = require('./worktree');

function parseSimpleFrontMatter(content) {
    const match = String(content || '').match(/^---\n([\s\S]*?)\n---\n/);
    if (!match) return {};
    const result = {};
    match[1].split('\n').forEach(line => {
        const idx = line.indexOf(':');
        if (idx === -1) return;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        result[key] = value;
    });
    return result;
}

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

function buildFeatureLogState(absRepoPath, mainLogsDir, worktreeBaseDir) {
    const allLogDirs = [];
    if (fs.existsSync(mainLogsDir)) allLogDirs.push(mainLogsDir);

    safeReadDir(worktreeBaseDir, dirName => /^feature-\d+-[a-z]{2}-.+$/.test(dirName)).forEach(dirName => {
        const wtLogsDir = path.join(worktreeBaseDir, dirName, 'docs', 'specs', 'features', 'logs');
        if (fs.existsSync(wtLogsDir)) allLogDirs.push(wtLogsDir);
    });

    const logsByFeatureAgent = {};
    const logsByFeatureSolo = {};
    const knownAgentsByFeature = {};

    allLogDirs.forEach(logDir => {
        safeReadDir(logDir, file => /^feature-\d+-.+-log\.md$/.test(file)).forEach(logFile => {
            const logPath = path.join(logDir, logFile);
            let content = '';
            try {
                content = fs.readFileSync(logPath, 'utf8');
            } catch (_) {
                return;
            }

            const fm = parseSimpleFrontMatter(content);
            const status = normalizeDashboardStatus(fm.status);
            const updatedAt = fm.updated || new Date(safeStatMtimeMs(logPath) || Date.now()).toISOString();

            const arena = logFile.match(/^feature-(\d+)-([a-z]{2})-(.+)-log\.md$/);
            const solo = !arena && logFile.match(/^feature-(\d+)-(.+)-log\.md$/);
            if (arena) {
                const featureId = arena[1];
                const agent = arena[2];
                logsByFeatureAgent[`${featureId}:${agent}`] = { status, updatedAt };
                if (!knownAgentsByFeature[featureId]) knownAgentsByFeature[featureId] = new Set();
                knownAgentsByFeature[featureId].add(agent);
                return;
            }

            if (solo) {
                logsByFeatureSolo[solo[1]] = { status, updatedAt };
            }
        });
    });

    return { logsByFeatureAgent, logsByFeatureSolo, knownAgentsByFeature };
}

function readFeatureManifests(stateDir) {
    return readJsonFilesByPattern(stateDir, /^feature-\d+\.json$/, (parsed, file) => {
        const match = file.match(/^feature-(\d+)\.json$/);
        return match ? { key: match[1], value: parsed } : null;
    });
}

function overlayFeatureStatusFiles(stateDir, featureLogState) {
    safeReadDir(stateDir, file => /^feature-\d+-[a-z]{2}\.json$/.test(file)).forEach(file => {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(stateDir, file), 'utf8'));
            const match = file.match(/^feature-(\d+)-([a-z]{2})\.json$/);
            if (!match) return;
            const featureId = match[1];
            const agent = match[2];
            featureLogState.logsByFeatureAgent[`${featureId}:${agent}`] = {
                status: normalizeDashboardStatus(data.status),
                updatedAt: data.updatedAt || new Date().toISOString(),
            };
            if (!featureLogState.knownAgentsByFeature[featureId]) {
                featureLogState.knownAgentsByFeature[featureId] = new Set();
            }
            featureLogState.knownAgentsByFeature[featureId].add(agent);
        } catch (_) { /* ignore */ }
    });

    safeReadDir(stateDir, file => /^feature-\d+-solo\.json$/.test(file)).forEach(file => {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(stateDir, file), 'utf8'));
            const match = file.match(/^feature-(\d+)-solo\.json$/);
            if (!match) return;
            featureLogState.logsByFeatureSolo[match[1]] = {
                status: normalizeDashboardStatus(data.status),
                updatedAt: data.updatedAt || new Date().toISOString(),
            };
        } catch (_) { /* ignore */ }
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
    const worktreePath = resolveFeatureWorktreePath(worktreeBaseDir, parsed.id, agent);
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

function buildFeatureAgents(options) {
    const {
        absRepoPath,
        parsed,
        stage,
        fallbackUpdatedAt,
        featureManifest,
        featureLogState,
        stateDir,
        worktreeBaseDir,
        devServerEnabled,
        devProxyRegistry,
        repoAppId,
    } = options;

    const isActiveStage = stage === 'in-progress' || stage === 'in-evaluation';
    if (!isActiveStage) return [];

    const agents = [];
    const manifestAgents = featureManifest && Array.isArray(featureManifest.agents) && featureManifest.agents.length > 0
        ? featureManifest.agents
        : null;

    if (manifestAgents) {
        manifestAgents.slice().sort((a, b) => a.localeCompare(b)).forEach(agent => {
            let agentStatus = 'implementing';
            let agentUpdatedAt = fallbackUpdatedAt;
            let agentFlags = {};
            let hasStatusFile = false;
            try {
                const statusData = JSON.parse(fs.readFileSync(path.join(stateDir, `feature-${parsed.id}-${agent}.json`), 'utf8'));
                agentStatus = normalizeDashboardStatus(statusData.status);
                agentUpdatedAt = statusData.updatedAt || agentUpdatedAt;
                agentFlags = parseStatusFlags(statusData.flags);
                hasStatusFile = true;
            } catch (_) { /* ignore */ }

            agents.push(buildFeatureAgentRow({
                absRepoPath,
                parsed,
                agent,
                status: agentStatus,
                updatedAt: agentUpdatedAt,
                flags: agentFlags,
                hasStatusFile,
                stateDir,
                worktreeBaseDir,
                devServerEnabled,
                devProxyRegistry,
                repoAppId,
            }));
        });
        return agents;
    }

    const agentSet = featureLogState.knownAgentsByFeature[parsed.id] || new Set();
    if (agentSet.size > 0) {
        [...agentSet].sort((a, b) => a.localeCompare(b)).forEach(agent => {
            const row = featureLogState.logsByFeatureAgent[`${parsed.id}:${agent}`] || {
                status: 'implementing',
                updatedAt: fallbackUpdatedAt
            };
            let agentFlags = {};
            let hasStatusFile = false;
            try {
                const statusData = JSON.parse(fs.readFileSync(path.join(stateDir, `feature-${parsed.id}-${agent}.json`), 'utf8'));
                agentFlags = parseStatusFlags(statusData.flags);
                hasStatusFile = true;
            } catch (_) { /* ignore */ }

            agents.push(buildFeatureAgentRow({
                absRepoPath,
                parsed,
                agent,
                status: normalizeDashboardStatus(row.status),
                updatedAt: row.updatedAt,
                flags: agentFlags,
                hasStatusFile,
                stateDir,
                worktreeBaseDir,
                devServerEnabled,
                devProxyRegistry,
                repoAppId,
            }));
        });
        return agents;
    }

    const row = featureLogState.logsByFeatureSolo[parsed.id] || { status: 'implementing', updatedAt: fallbackUpdatedAt };
    const launchSessionName = buildTmuxSessionName(parsed.id, 'do', { repo: path.basename(absRepoPath), desc: 'launch' });
    const soloTmuxRunning = tmuxSessionExists(launchSessionName);
    const worktreePath = resolveFeatureWorktreePath(worktreeBaseDir, parsed.id, 'solo');
    const devServer = getDevServerState(devProxyRegistry, repoAppId, `solo-${parsed.id}`);
    agents.push({
        id: 'solo',
        status: normalizeDashboardStatus(row.status),
        updatedAt: row.updatedAt,
        slashCommand: row.status === 'waiting' ? `aigon terminal-focus ${String(parsed.id).padStart(2, '0')}` : null,
        tmuxSession: soloTmuxRunning ? launchSessionName : null,
        tmuxRunning: soloTmuxRunning,
        attachCommand: soloTmuxRunning ? `tmux attach -t ${launchSessionName}` : null,
        worktreePath: worktreePath || null,
        flags: {},
        devServerEligible: Boolean(devServerEnabled),
        devServerPokeEligible: false,
        devServerUrl: devServer.url
    });
    return agents;
}

function buildFeatureReviewState(absRepoPath, featureId, isActiveStage) {
    let reviewStatus = null;
    const reviewSessions = [];
    if (!isActiveStage) return { reviewStatus, reviewSessions };

    const repoBaseName = path.basename(absRepoPath);
    const reviewPrefix = `${repoBaseName}-f${toUnpaddedId(featureId)}-review-`;
    reviewSessions.push(...findTmuxSessionsByPrefix(reviewPrefix, session => {
        const remainder = session.slice(reviewPrefix.length);
        const agentCode = remainder.split('-')[0];
        return { session, agent: agentCode, running: tmuxSessionExists(session) };
    }));

    const logsDir = path.join(absRepoPath, 'docs', 'specs', 'features', 'logs');
    safeReadDir(logsDir, file => file.startsWith(`feature-${featureId}-`) && file.endsWith('-log.md')).forEach(file => {
        try {
            const content = fs.readFileSync(path.join(logsDir, file), 'utf8');
            const reviewMatch = content.match(/## Code Review\s*\n+\*\*Reviewed by\*\*:\s*(\w+)/);
            if (reviewMatch && !reviewSessions.some(session => session.agent === reviewMatch[1])) {
                reviewSessions.push({ session: null, agent: reviewMatch[1], running: false });
            }
        } catch (_) { /* ignore */ }
    });

    if (reviewSessions.length > 0) {
        reviewStatus = reviewSessions.some(session => session.running) ? 'running' : 'done';
    }
    return { reviewStatus, reviewSessions };
}

function buildFeatureEvalState(absRepoPath, evalsDir, parsed, stage, featureSmContext, featureState, isActiveStage) {
    let evalStatus = null;
    let winnerAgent = null;
    let evalPath = null;
    let evalSession = null;

    const isInEvaluation = stateMachine.getValidTransitions('feature', stage, featureSmContext)
        .some(transition => transition.action === 'feature-close');
    if (isInEvaluation) {
        evalStatus = 'evaluating';
        const evalFile = path.join(evalsDir, `feature-${parsed.id}-eval.md`);
        if (fs.existsSync(evalFile)) {
            evalPath = evalFile;
            try {
                const content = fs.readFileSync(evalFile, 'utf8');
                const winnerMatch = content.match(/\*\*Winner[:\s]*\*?\*?\s*(.+)/i);
                if (winnerMatch) {
                    const value = winnerMatch[1].replace(/\*+/g, '').trim();
                    if (value && !value.includes('to be determined') && !value.includes('TBD') && value !== '()') {
                        evalStatus = 'pick winner';
                        winnerAgent = value.split(/[\s(]/)[0].toLowerCase() || null;
                    }
                }
            } catch (_) { /* ignore */ }
        }
    }

    if (isActiveStage && stage === 'in-evaluation') {
        const repoBaseName = path.basename(absRepoPath);
        const evalPrefix = `${repoBaseName}-f${parsed.id}-eval-`;
        evalSession = findFirstTmuxSessionByPrefix(evalPrefix, session => ({
            session,
            agent: session.slice(evalPrefix.length),
            running: tmuxSessionExists(session)
        }));
    }

    if (featureState.winnerAgentId && !winnerAgent) {
        winnerAgent = featureState.winnerAgentId;
    }

    return { evalStatus, winnerAgent, evalPath, evalSession };
}

function collectFeatures(repoContext, response) {
    const {
        absRepoPath,
        stateDir,
        devServerEnabled,
        devProxyRegistry,
        repoAppId,
    } = repoContext;
    const inProgressDir = path.join(absRepoPath, 'docs', 'specs', 'features', '03-in-progress');
    const inEvalDir = path.join(absRepoPath, 'docs', 'specs', 'features', '04-in-evaluation');
    const inboxDir = path.join(absRepoPath, 'docs', 'specs', 'features', '01-inbox');
    const backlogDir = path.join(absRepoPath, 'docs', 'specs', 'features', '02-backlog');
    const pausedDir = path.join(absRepoPath, 'docs', 'specs', 'features', '06-paused');
    const doneDir = path.join(absRepoPath, 'docs', 'specs', 'features', '05-done');
    const evalsDir = path.join(absRepoPath, 'docs', 'specs', 'features', 'evaluations');
    const mainLogsDir = path.join(absRepoPath, 'docs', 'specs', 'features', 'logs');
    const worktreeBaseDir = absRepoPath + '-worktrees';

    const specFiles = listStageSpecFiles([
        { dir: inboxDir, stage: 'inbox', pattern: /^feature-.+\.md$/ },
        { dir: backlogDir, stage: 'backlog', pattern: /^feature-\d+-.+\.md$/ },
        { dir: inProgressDir, stage: 'in-progress', pattern: /^feature-\d+-.+\.md$/ },
        { dir: inEvalDir, stage: 'in-evaluation', pattern: /^feature-\d+-.+\.md$/ },
        { dir: pausedDir, stage: 'paused', pattern: /^feature-.+\.md$/ },
    ]);

    const doneSpecs = listRecentDoneSpecFiles(doneDir, /^feature-\d+-.+\.md$/);
    doneSpecs.recent.forEach(({ file }) => specFiles.push({ file, stage: 'done', dir: doneDir }));

    const featureLogState = buildFeatureLogState(absRepoPath, mainLogsDir, worktreeBaseDir);
    const manifestsByFeatureId = readFeatureManifests(stateDir);
    overlayFeatureStatusFiles(stateDir, featureLogState);

    const features = specFiles
        .map(({ file: specFile, stage, dir: specDir }) => {
            const parsed = parseFeatureSpecFileName(specFile);
            if (!parsed) return null;

            const specPath = path.join(specDir, specFile);
            const { updatedAt: fallbackUpdatedAt, createdAt } = safeStatIsoTimes(specPath);
            const featureManifest = parsed.id ? manifestsByFeatureId[parsed.id] : null;
            const agents = buildFeatureAgents({
                absRepoPath,
                parsed,
                stage,
                fallbackUpdatedAt,
                featureManifest,
                featureLogState,
                stateDir,
                worktreeBaseDir,
                devServerEnabled,
                devProxyRegistry,
                repoAppId,
            });

            const featureState = workflowReadModel.getFeatureDashboardState(absRepoPath, parsed.id, stage, agents);
            if (featureState.workflowSnapshot) {
                agents.forEach(agent => {
                    if (featureState.snapshotStatuses[agent.id]) {
                        agent.status = featureState.snapshotStatuses[agent.id];
                    }
                });
            }
            agents.forEach(agent => {
                response.summary.total++;
                response.summary[agent.status] = (response.summary[agent.status] || 0) + 1;
            });

            const isActiveStage = stage === 'in-progress' || stage === 'in-evaluation';
            const featureSmContext = featureState.context;
            const evalState = buildFeatureEvalState(absRepoPath, evalsDir, parsed, stage, featureSmContext, featureState, isActiveStage);
            const reviewState = buildFeatureReviewState(absRepoPath, parsed.id, isActiveStage);

            return {
                id: parsed.id,
                name: parsed.name,
                stage,
                specPath,
                updatedAt: fallbackUpdatedAt,
                createdAt,
                evalStatus: evalState.evalStatus,
                winnerAgent: evalState.winnerAgent,
                evalPath: evalState.evalPath,
                evalSession: evalState.evalSession,
                reviewStatus: reviewState.reviewStatus,
                reviewSessions: reviewState.reviewSessions,
                agents,
                pending: featureManifest ? (featureManifest.pending || []) : [],
                nextAction: featureState.nextAction,
                nextActions: featureState.nextActions,
                validActions: featureState.validActions,
                workflowEngine: featureState.workflowEngine,
                workflowEvents: featureState.workflowEvents,
            };
        })
        .filter(Boolean);

    const seenIds = new Set(features.map(feature => feature.id));
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

    const researchManifestsById = readResearchManifests(stateDir);
    const researchLogsByAgent = {};
    safeReadDir(researchLogsDir, file => /^research-(\d+)-([a-z]{2})-findings\.md$/.test(file)).forEach(file => {
        const match = file.match(/^research-(\d+)-([a-z]{2})-findings\.md$/);
        if (!match) return;
        if (!researchLogsByAgent[match[1]]) researchLogsByAgent[match[1]] = [];
        researchLogsByAgent[match[1]].push(match[2]);
    });

    const research = [];
    researchSpecFiles.forEach(({ file, stage, dir: specDir }) => {
        const match = file.match(/^research-(\d+)-(.+)\.md$/) || file.match(/^research-(.+)\.md$/);
        if (!match) return;
        const hasId = /^\d+$/.test(match[1]);
        const id = hasId ? match[1] : null;
        const name = hasId ? match[2] : match[1];
        const agents = [];
        const isActiveStage = stage === 'in-progress' || stage === 'in-evaluation';

        if (id && isActiveStage) {
            const researchManifest = researchManifestsById[id] || null;
            const manifestAgents = researchManifest && Array.isArray(researchManifest.agents) && researchManifest.agents.length > 0
                ? researchManifest.agents
                : null;
            const agentList = manifestAgents || (researchLogsByAgent[id] ? [...new Set(researchLogsByAgent[id])] : []);

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
                        normalizedStatus = normalizeDashboardStatus(parsedStatus.status);
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
                const findingsFile = path.join(researchLogsDir, `research-${id}-${agent}-findings.md`);
                const canViewFindings = flagged.status === 'submitted' || Boolean(flagged.flags && flagged.flags.sessionEnded);
                agents.push({
                    id: agent,
                    status: flagged.status,
                    updatedAt: normalizedUpdatedAt,
                    flags: flagged.flags,
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

        const researchReadModel = workflowReadModel.getWorkflowReadModel('research', id, stage, agents);
        let evalSession = null;
        if (stage === 'in-evaluation') {
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
            stage,
            specPath: path.join(specDir, file),
            agents,
            evalSession,
            validActions: researchReadModel.validActions
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
