'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const feedbackLib = require('./feedback');
const stateMachine = require('./state-queries');
const { isProAvailable } = require('./pro');
const { reconcileEntitySpec } = require('./spec-reconciliation');
const workflowReadModel = require('./workflow-read-model');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const featureSpecResolver = require('./feature-spec-resolver');
const {
    normalizeDashboardStatus,
    parseFeatureSpecFileName,
    safeTmuxSessionExists,
    safeFeatureAutoSessionExists,
    resolveFeatureWorktreePath,
    parseStatusFlags,
    maybeFlagEndedSession,
} = require('./dashboard-status-helpers');
const { readConductorReposFromGlobalConfig } = require('./config');
const {
    getAppId,
    getDevProxyUrl,
    parseCaddyRoutes,
    buildCaddyHostname,
    isProcessAlive,
    isPortInUseSync,
} = require('./proxy');
const {
    buildTmuxSessionName,
    buildResearchTmuxSessionName,
    tmuxSessionExists,
} = require('./worktree');
const { getAgentLiveness } = require('./supervisor');

const _tierCache = new Map();

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

function safeStat(filePath) {
    try {
        return fs.statSync(filePath);
    } catch (_) {
        return null;
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

function detectGitHubRemote(repoPath) {
    try {
        const originUrl = execSync('git remote get-url origin', {
            cwd: repoPath,
            encoding: 'utf8',
            stdio: 'pipe'
        }).trim();
        return /github\.com[:/]/i.test(originUrl);
    } catch (_) {
        return false;
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

function collectDoneSpecs(doneDir, pattern, limit = 10) {
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

function getTierCache(repoPath) {
    const cacheKey = path.resolve(repoPath);
    let cache = _tierCache.get(cacheKey);
    if (cache) return cache;

    cache = {
        cold: {
            featuresDirMtime: null,
            features: { total: 0, all: [], recent: [] },
            doneTotal: 0,
            researchDirMtime: null,
            research: { total: 0, all: [], recent: [] },
            feedbackDirMtime: null,
            githubRemote: null,
            feedback: { total: 0, all: [], recent: [] },
        },
        warm: {
            backlogMtime: null,
            backlog: [],
            inboxMtime: null,
            inbox: [],
            pausedMtime: null,
            paused: [],
            specReviewHead: null,
            specReviewEntries: new Map(),
        }
    };
    _tierCache.set(cacheKey, cache);
    return cache;
}

function safeGitRead(repoPath, command) {
    try {
        return execSync(command, {
            cwd: repoPath,
            encoding: 'utf8',
            stdio: 'pipe',
        }).trim();
    } catch (_) {
        return '';
    }
}

function parseResearchSpecFileName(fileName) {
    const match = String(fileName || '').match(/^research-(?:(\d+)-)?(.+)\.md$/);
    if (!match) return null;
    return {
        id: match[1] || match[2],
        name: match[2],
    };
}

function parseSpecReviewNameStatusEntry(line) {
    if (!line) return null;
    const parts = String(line).split('\t');
    const status = parts[0] || '';
    if (!status) return null;
    if (status.startsWith('R')) {
        return {
            type: 'rename',
            oldPath: parts[1] || '',
            newPath: parts[2] || '',
            paths: [parts[1] || '', parts[2] || ''].filter(Boolean),
        };
    }
    return {
        type: 'change',
        path: parts[1] || '',
        paths: [parts[1] || ''].filter(Boolean),
    };
}

function extractSpecReviewerId(body) {
    const reviewerLine = String(body || '').match(/^Reviewer:\s*([a-z]{2,10})$/mi);
    if (reviewerLine) return reviewerLine[1];
    return null;
}

function readSpecReviewCommitBody(repoPath, sha, cache) {
    if (cache.has(sha)) return cache.get(sha);
    const body = safeGitRead(repoPath, `git show -s --format=%B ${JSON.stringify(sha)}`);
    cache.set(sha, body);
    return body;
}

function buildSpecReviewActionContext(entityType, item, metadata) {
    const stage = item.stage || 'backlog';
    const lifecycle = stage === 'in-progress' ? 'implementing'
        : stage === 'in-evaluation' ? 'evaluating'
        : stage;
    return {
        entityType,
        currentSpecState: lifecycle,
        lifecycle,
        mode: 'solo_branch',
        agents: {},
        winnerAgentId: null,
        updatedAt: item.updatedAt || new Date().toISOString(),
        specReview: metadata,
    };
}

function mergeSpecReviewActions(entityType, item, metadata) {
    const syntheticContext = buildSpecReviewActionContext(entityType, item, metadata);
    const actionSet = workflowSnapshotAdapter.snapshotToDashboardActions(entityType, item.id, syntheticContext, item.stage);
    const actionNames = new Set(
        entityType === 'research'
            ? ['research-spec-review', 'research-spec-review-check']
            : ['feature-spec-review', 'feature-spec-review-check']
    );
    const existing = Array.isArray(item.validActions) ? item.validActions : [];
    const extras = actionSet.validActions.filter(action => actionNames.has(action.action));
    const deduped = [];
    const seen = new Set();
    [...existing, ...extras].forEach(action => {
        const key = `${action.action}:${action.agentId || ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        deduped.push(action);
    });
    item.validActions = deduped;
    item.nextActions = Array.isArray(item.nextActions) ? [...item.nextActions, ...extras] : extras.slice();
    if (!item.nextAction && item.nextActions.length > 0) {
        item.nextAction = {
            command: item.nextActions[0].command,
            reason: item.nextActions[0].reason,
        };
    }
}

function getSpecReviewEntries(repoPath, items) {
    const tierCache = getTierCache(repoPath);
    const headSha = safeGitRead(repoPath, 'git rev-parse HEAD');
    if (headSha && tierCache.warm.specReviewHead === headSha && tierCache.warm.specReviewEntries.size > 0) {
        return tierCache.warm.specReviewEntries;
    }

    const trackedItems = (Array.isArray(items) ? items : [])
        .filter(item => item && item.specPath && fs.existsSync(item.specPath))
        .map(item => ({
            key: item.specPath,
            entityType: item.entityType,
            id: item.id,
            relPath: path.relative(repoPath, item.specPath).replace(/\\/g, '/'),
        }));
    const entries = new Map();
    const pathIndex = new Map();

    function addAlias(record, relPath) {
        if (!relPath || record.closed) return;
        record.aliases.add(relPath);
        if (!pathIndex.has(relPath)) pathIndex.set(relPath, new Set());
        pathIndex.get(relPath).add(record.key);
    }

    function removeAlias(record, relPath) {
        if (!relPath) return;
        record.aliases.delete(relPath);
        const keys = pathIndex.get(relPath);
        if (!keys) return;
        keys.delete(record.key);
        if (keys.size === 0) pathIndex.delete(relPath);
    }

    trackedItems.forEach(item => {
        const record = {
            key: item.key,
            entityType: item.entityType,
            id: item.id,
            aliases: new Set(),
            pending: [],
            pendingAgents: [],
            closed: false,
            pendingCount: 0,
        };
        entries.set(item.key, record);
        addAlias(record, item.relPath);
    });

    const logOutput = safeGitRead(
        repoPath,
        'git log --format=%x1e%H%x1f%s --name-status --find-renames=90% -- docs/specs/features docs/specs/research-topics'
    );
    const bodyCache = new Map();

    logOutput.split('\x1e').forEach(block => {
        const trimmed = block.trim();
        if (!trimmed) return;
        const lines = trimmed.split('\n').filter(Boolean);
        const header = lines.shift() || '';
        const [sha, subject] = header.split('\x1f');
        if (!sha || !subject) return;
        const changes = lines.map(parseSpecReviewNameStatusEntry).filter(Boolean);
        const touchedKeys = new Set();
        changes.forEach(change => {
            change.paths.forEach(changedPath => {
                const keys = pathIndex.get(changedPath);
                if (!keys) return;
                keys.forEach(key => touchedKeys.add(key));
            });
        });

        touchedKeys.forEach(key => {
            const record = entries.get(key);
            if (!record || record.closed) return;

            if (/^spec-review-check:/.test(subject)) {
                record.closed = true;
                [...record.aliases].forEach(alias => removeAlias(record, alias));
                return;
            }

            if (/^spec-review:/.test(subject)) {
                const body = readSpecReviewCommitBody(repoPath, sha, bodyCache);
                const reviewerId = extractSpecReviewerId(body);
                record.pending.push({ sha, subject, reviewerId });
                if (reviewerId && !record.pendingAgents.includes(reviewerId)) {
                    record.pendingAgents.push(reviewerId);
                }
                record.pendingCount = record.pending.length;
            }

            changes.forEach(change => {
                if (change.type !== 'rename' || !record.aliases.has(change.newPath)) return;
                removeAlias(record, change.newPath);
                addAlias(record, change.oldPath);
            });
        });
    });

    tierCache.warm.specReviewHead = headSha || null;
    tierCache.warm.specReviewEntries = entries;
    return entries;
}

function applySpecReviewStatus(repoPath, features, research) {
    const items = [
        ...(Array.isArray(features) ? features.map(item => ({ item, entityType: 'feature' })) : []),
        ...(Array.isArray(research) ? research.map(item => ({ item, entityType: 'research' })) : []),
    ];
    const entries = getSpecReviewEntries(repoPath, items.map(({ item, entityType }) => ({ ...item, entityType })));

    items.forEach(({ item, entityType }) => {
        const record = entries.get(item.specPath);
        const metadata = {
            pendingCount: record ? record.pendingCount : 0,
            pendingAgents: record ? record.pendingAgents.slice() : [],
            pendingLabel: record && record.pendingCount > 0
                ? `${record.pendingCount} pending — ${record.pendingAgents.join(', ')}`
                : '',
        };
        item.specReview = metadata;
        mergeSpecReviewActions(entityType, item, metadata);
    });
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

function getDevServerState(caddyRoutes, repoAppId, serverId) {
    const hostname = buildCaddyHostname(repoAppId, serverId || null);
    const route = caddyRoutes.find(r => r.hostname === hostname);
    const devServerAlive = Boolean(route && isPortInUseSync(route.port));
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
        caddyRoutes,
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
    const devServer = getDevServerState(caddyRoutes, repoAppId, serverId);
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
        snapshotStatuses,
        updatedAt,
        stateDir,
        worktreeBaseDir,
        devServerEnabled,
        caddyRoutes,
        repoAppId,
    } = options;
    const parsed = { id: featureId };
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
                caddyRoutes,
                repoAppId,
            });
        });
}

function listWorkflowFeatureIds(absRepoPath) {
    return workflowReadModel.listWorkflowEntityIds(absRepoPath, 'feature');
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
        caddyRoutes,
        repoAppId,
    } = repoContext;
    const inboxDir = path.join(absRepoPath, 'docs', 'specs', 'features', '01-inbox');
    const backlogDir = path.join(absRepoPath, 'docs', 'specs', 'features', '02-backlog');
    const pausedDir = path.join(absRepoPath, 'docs', 'specs', 'features', '06-paused');
    const doneDir = path.join(absRepoPath, 'docs', 'specs', 'features', '05-done');
    const mainLogsDir = path.join(absRepoPath, 'docs', 'specs', 'features', 'logs');
    const worktreeBaseDir = path.join(os.homedir(), '.aigon', 'worktrees', path.basename(absRepoPath));
    const tierCache = getTierCache(absRepoPath);

    const backlogDirMtime = safeStat(backlogDir)?.mtimeMs || 0;
    if (backlogDirMtime !== tierCache.warm.backlogMtime) {
        tierCache.warm.backlogMtime = backlogDirMtime;
        tierCache.warm.backlog = listStageSpecFiles([
            { dir: backlogDir, stage: 'backlog', pattern: /^feature-\d+-.+\.md$/ },
        ]);
    }
    const inboxDirMtime = safeStat(inboxDir)?.mtimeMs || 0;
    if (inboxDirMtime !== tierCache.warm.inboxMtime) {
        tierCache.warm.inboxMtime = inboxDirMtime;
        tierCache.warm.inbox = listStageSpecFiles([
            { dir: inboxDir, stage: 'inbox', pattern: /^feature-.+\.md$/ },
        ]);
    }
    const pausedDirMtime = safeStat(pausedDir)?.mtimeMs || 0;
    if (pausedDirMtime !== tierCache.warm.pausedMtime) {
        tierCache.warm.pausedMtime = pausedDirMtime;
        tierCache.warm.paused = listStageSpecFiles([
            { dir: pausedDir, stage: 'paused', pattern: /^feature-.+\.md$/ },
        ]);
    }

    const specFiles = [
        ...tierCache.warm.inbox,
        ...tierCache.warm.backlog,
        ...listStageSpecFiles([
        { dir: path.join(absRepoPath, 'docs', 'specs', 'features', '03-in-progress'), stage: 'in-progress', pattern: /^feature-\d+-.+\.md$/ },
        { dir: path.join(absRepoPath, 'docs', 'specs', 'features', '04-in-evaluation'), stage: 'in-evaluation', pattern: /^feature-\d+-.+\.md$/ },
        ]),
        ...tierCache.warm.paused,
    ];

    const doneDirMtime = safeStat(doneDir)?.mtimeMs || 0;
    if (doneDirMtime !== tierCache.cold.featuresDirMtime) {
        tierCache.cold.featuresDirMtime = doneDirMtime;
        tierCache.cold.features = collectDoneSpecs(doneDir, /^feature-\d+-.+\.md$/);
        tierCache.cold.doneTotal = tierCache.cold.features.total;
    }
    const doneSpecs = tierCache.cold.features;
    doneSpecs.recent.forEach(({ file }) => specFiles.push({ file, stage: 'done', dir: doneDir }));

    const manifestsByFeatureId = readFeatureManifests(stateDir);
    const workflowFeatureIds = new Set(listWorkflowFeatureIds(absRepoPath));
    const features = [];

    [...workflowFeatureIds].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).forEach(featureId => {
        const initialState = workflowReadModel.getFeatureDashboardState(absRepoPath, featureId, null, []);
        const snapshot = initialState.workflowSnapshot;
        const stage = initialState.stage;
        if (!snapshot || !stage) return;
        const identity = resolveFeatureIdentity(absRepoPath, featureId, manifestsByFeatureId, snapshot);
        const agents = buildFeatureAgentsFromSnapshot({
            absRepoPath,
            featureId,
            snapshotStatuses: initialState.snapshotStatuses,
            updatedAt: snapshot.updatedAt,
            stateDir,
            worktreeBaseDir,
            devServerEnabled,
            caddyRoutes,
            repoAppId,
        });
        const featureState = workflowReadModel.getFeatureDashboardState(absRepoPath, featureId, stage, agents);
        const autonomousSession = stage !== 'done' ? safeFeatureAutoSessionExists(featureId, absRepoPath) : null;
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
            readOnly: featureState.readOnly,
            legacy: featureState.legacy,
            missingWorkflowState: featureState.missingWorkflowState,
            specDrift: featureState.specDrift,
            readModelSource: featureState.readModelSource,
            compatibilityLabel: featureState.compatibilityLabel,
            workflowEngine: featureState.workflowEngine,
            workflowEvents: featureState.workflowEvents,
            autonomousSession,
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
        const autonomousSession = featureState.stage !== 'done' && /^\d+$/.test(String(featureId)) ? safeFeatureAutoSessionExists(featureId, absRepoPath) : null;
        features.push({
            id: featureId,
            name: parsed.name,
            stage: featureState.stage,
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
            readOnly: featureState.readOnly,
            legacy: featureState.legacy,
            missingWorkflowState: featureState.missingWorkflowState,
            specDrift: featureState.specDrift,
            readModelSource: featureState.readModelSource,
            compatibilityLabel: featureState.compatibilityLabel,
            workflowEngine: featureState.workflowEngine,
            workflowEvents: featureState.workflowEvents,
            autonomousSession,
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
        doneTotal: tierCache.cold.doneTotal,
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
    const tierCache = getTierCache(absRepoPath);
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

    const researchDoneDir = path.join(researchRoot, '05-done');
    const doneDirMtime = safeStat(researchDoneDir)?.mtimeMs || 0;
    if (doneDirMtime !== tierCache.cold.researchDirMtime) {
        tierCache.cold.researchDirMtime = doneDirMtime;
        tierCache.cold.research = collectDoneSpecs(researchDoneDir, /^research-\d+-.+\.md$/);
    }
    const doneSpecs = tierCache.cold.research;
    doneSpecs.recent.forEach(({ file }) => {
        researchSpecFiles.push({ file, stage: 'done', dir: researchDoneDir });
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
        const initialResearchState = workflowReadModel.getResearchDashboardState(absRepoPath, id || name, stage, []);
        const snapshot = initialResearchState.workflowSnapshot;
        const effectiveStage = initialResearchState.stage || stage;
        const agents = [];
        const isActiveStage = effectiveStage === 'in-progress' || effectiveStage === 'in-evaluation';
        const snapshotStatuses = initialResearchState.snapshotStatuses || {};

        if (id && isActiveStage) {
            const researchManifest = researchManifestsById[id] || null;
            const manifestAgents = researchManifest && Array.isArray(researchManifest.agents) && researchManifest.agents.length > 0
                ? researchManifest.agents
                : null;
            const fromLogs = researchLogsByAgent[id] ? [...new Set(researchLogsByAgent[id])] : [];
            const fromSnapshot = Object.keys(snapshotStatuses);
            const agentList = [...new Set([...(manifestAgents || []), ...fromLogs, ...fromSnapshot])];

            agentList.slice().sort((a, b) => a.localeCompare(b)).forEach(agent => {
                const sessionName = buildResearchTmuxSessionName(id, agent, { repo: path.basename(absRepoPath), role: 'do' });
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

        const researchState = workflowReadModel.getResearchDashboardState(absRepoPath, id || name, effectiveStage, agents);

        research.push({
            id,
            name,
            stage: effectiveStage,
            specPath: path.join(specDir, file),
            updatedAt: snapshot ? (snapshot.updatedAt || new Date().toISOString()) : safeStatIsoTimes(path.join(specDir, file)).updatedAt,
            createdAt: snapshot ? (snapshot.createdAt || snapshot.updatedAt || new Date().toISOString()) : safeStatIsoTimes(path.join(specDir, file)).createdAt,
            agents,
            evalStatus: researchState.evalStatus,
            evalSession: researchState.evalSession,
            reviewStatus: researchState.reviewStatus,
            reviewSessions: researchState.reviewSessions,
            reviewState: researchState.reviewState,
            validActions: researchState.validActions,
            nextAction: researchState.nextAction,
            nextActions: researchState.nextActions,
            readOnly: researchState.readOnly,
            legacy: researchState.legacy,
            missingWorkflowState: researchState.missingWorkflowState,
            specDrift: researchState.specDrift,
            readModelSource: researchState.readModelSource,
            compatibilityLabel: researchState.compatibilityLabel,
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
    let items = feedbackLib.collectFeedbackItems({ repoPath: absRepoPath });
    let reconciliationMoved = false;
    items.forEach(item => {
        if (!Number.isFinite(item.metadata.id) || item.metadata.id <= 0) return;
        const result = reconcileEntitySpec(absRepoPath, 'feedback', item.metadata.id);
        if (result && result.moved) {
            reconciliationMoved = true;
        }
    });
    if (reconciliationMoved) {
        items = feedbackLib.collectFeedbackItems({ repoPath: absRepoPath });
    }

    const feedback = [];
    items.forEach(item => {
        const stage = feedbackLib.normalizeFeedbackStatus(item.metadata.status) || 'inbox';
        const specPath = item.fullPath;
        const { updatedAt, createdAt } = safeStatIsoTimes(specPath);
        const feedbackSmContext = {
            mode: 'solo',
            agents: [],
            agentStatuses: {},
            tmuxSessionStates: {},
            currentStage: stage,
            entityType: 'feedback'
        };
        feedback.push({
            id: item.metadata.id > 0 ? String(item.metadata.id) : null,
            name: item.metadata.title || path.basename(item.file, '.md'),
            stage,
            specPath,
            updatedAt,
            createdAt,
            agents: [],
            validActions: stateMachine.getAvailableActions('feedback', stage, feedbackSmContext)
        });
    });

    return {
        feedback,
        feedbackDoneTotal: items.filter(item => (feedbackLib.normalizeFeedbackStatus(item.metadata.status) || 'inbox') === 'done').length,
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
    const caddyRoutes = devServerEnabled ? parseCaddyRoutes() : [];
    const mainDevServer = getDevServerState(caddyRoutes, repoAppId, '');
    const stateDir = path.join(absRepoPath, '.aigon', 'state');
    const repoContext = { absRepoPath, stateDir, devServerEnabled, caddyRoutes, repoAppId };

    const featureStatus = collectFeatures(repoContext, response);
    const researchStatus = collectResearch(repoContext, response);
    applySpecReviewStatus(absRepoPath, featureStatus.features, researchStatus.research);
    const feedbackStatus = collectFeedback(absRepoPath);
    const tierCache = getTierCache(absRepoPath);
    if (typeof tierCache.cold.githubRemote !== 'boolean') {
        tierCache.cold.githubRemote = detectGitHubRemote(absRepoPath);
    }

    return {
        path: absRepoPath,
        displayPath: absRepoPath.replace(os.homedir(), '~'),
        name: path.basename(absRepoPath),
        githubRemote: tierCache.cold.githubRemote,
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

// Maximum size of a single log payload before truncation (256 KB).
// Prevents pathological logs from bloating the /api/detail HTTP response.
const AGENT_LOG_MAX_BYTES = 256 * 1024;

/**
 * Collect agent implementation logs for a feature.
 *
 * Scans each provided logs directory for files matching
 *   feature-{id}-*-log.md
 * and keys them by agent id (the 2-char code after the feature id) or by
 * the literal string `"solo"` when no agent infix is present.
 *
 * Returns: { [agentId]: { path: string, content: string | null } }
 *
 * @param {string[]} logsDirs   Directories to scan (main repo + any worktree logs dirs)
 * @param {string|number} featureId  Feature id (will be matched as a number, padded or unpadded)
 * @param {Object<string, string>} [expectedEntries]  Optional expected log paths keyed by agent id
 * @returns {Object<string, {path: string, content: string|null}>}
 */
function collectAgentLogs(logsDirs, featureId, expectedEntries = {}) {
    const out = {};
    const dirs = Array.isArray(logsDirs) ? logsDirs : [logsDirs];
    const idStr = String(featureId);
    // Accept either padded ("07") or unpadded ("7") forms in filenames.
    const idNum = Number(idStr);
    const pattern = /^feature-(\d+)-(.+?)-log\.md$/;

    // Strip YAML frontmatter if present. Log files are supposed to be pure
    // narrative markdown per CLAUDE.md, but telemetry metadata (commit counts,
    // token usage, cost) gets written as frontmatter by the feature close /
    // feature-close anyway. Rendering that frontmatter through marked.parse()
    // produces a wall of bold text at the top of the log; users care about
    // the narrative, not the metadata dump. The metadata still lives in the
    // Stats tab for anyone who wants it.
    const stripFrontmatter = (raw) => raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

    for (const dir of dirs) {
        if (!dir || !fs.existsSync(dir)) continue;
        let entries;
        try { entries = fs.readdirSync(dir); } catch (_) { continue; }
        for (const file of entries) {
            const m = file.match(pattern);
            if (!m) continue;
            if (Number(m[1]) !== idNum) continue;
            const rest = m[2];
            // If the next token is a 2-letter agent code, key by that;
            // otherwise it's a solo log.
            const agentMatch = rest.match(/^([a-z]{2})(?:-|$)/);
            const agentId = agentMatch ? agentMatch[1] : 'solo';
            // Don't overwrite an entry already filled from an earlier dir.
            if (out[agentId] && out[agentId].content !== null) continue;
            const fullPath = path.join(dir, file);
            let content = null;
            try {
                const raw = stripFrontmatter(fs.readFileSync(fullPath, 'utf8'));
                if (Buffer.byteLength(raw, 'utf8') > AGENT_LOG_MAX_BYTES) {
                    // Truncate on a UTF-8 boundary by slicing characters until we
                    // fit, then append the footer.
                    const sliced = raw.slice(0, AGENT_LOG_MAX_BYTES);
                    content = sliced + `\n\n… (log truncated — view full file at ${fullPath})`;
                } else {
                    content = raw;
                }
            } catch (_) {
                content = null;
            }
            out[agentId] = { path: fullPath, content };
        }
    }

    Object.entries(expectedEntries || {}).forEach(([agentId, expectedPath]) => {
        if (!agentId || out[agentId]) return;
        out[agentId] = { path: expectedPath, content: null };
    });

    return out;
}

function clearTierCache(repoPath = null) {
    if (!repoPath) {
        _tierCache.clear();
        return;
    }
    _tierCache.delete(path.resolve(repoPath));
}

module.exports = {
    collectDashboardStatusData,
    clearTierCache,
    collectAgentLogs,
    AGENT_LOG_MAX_BYTES,
    applySpecReviewStatus,
    getSpecReviewEntries,
};
