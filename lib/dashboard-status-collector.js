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
const agentStatus = require('./agent-status');
const {
    normalizeDashboardStatus,
    deriveFeatureDashboardStatus,
    parseFeatureSpecFileName,
    safeTmuxSessionExists,
    safeFeatureAutoSessionExists,
    safeSetAutoSessionExists,
    resolveFeatureWorktreePath,
    parseStatusFlags,
    maybeFlagEndedSession,
    detectDefaultBranch,
    computeRebaseNeeded,
} = require('./dashboard-status-helpers');
const { readConductorReposFromGlobalConfig } = require('./config');
const {
    getAppId,
    getDevProxyUrl,
    parseCaddyRoutes,
    buildCaddyHostname,
    isPortInUseSync,
} = require('./proxy');
const {
    buildResearchTmuxSessionName,
    tmuxSessionExists,
} = require('./worktree');
const { getAgentLiveness } = require('./supervisor');
const specRecommendationLib = require('./spec-recommendation');
const featureSets = require('./feature-sets');
const { checkUnmetDependencies } = require('./feature-dependencies');

const _tierCache = new Map();

// Feature 313: cheap read of `complexity:` from spec frontmatter for badge
// rendering. Returns null when the spec is missing or has no complexity.
function readComplexityFromSpec(specPath) {
    if (!specPath) return null;
    try {
        const rec = specRecommendationLib.readSpecRecommendation(specPath);
        return rec && rec.complexity ? rec.complexity : null;
    } catch (_) {
        return null;
    }
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
        }
    };
    _tierCache.set(cacheKey, cache);
    return cache;
}

function applySpecReviewFromSnapshots(repoPath, items) {
    // F283 authoritative path: pendingCount/pendingAgents live on the engine
    // snapshot as `specReview`. Dashboard rows copy it verbatim; actions are
    // already produced by snapshotToDashboardActions during read-model
    // assembly, so there's nothing to merge here.
    (Array.isArray(items) ? items : []).forEach(entry => {
        const item = entry.item;
        const snapshot = workflowSnapshotAdapter.readWorkflowSnapshotSync(repoPath, entry.entityType, item.id);
        const record = snapshot && snapshot.specReview
            ? snapshot.specReview
            : { pendingCount: 0, pendingAgents: [], pendingLabel: '' };
        const isDone = item.stage === 'done';
        item.specReview = {
            pendingCount: isDone ? 0 : (record.pendingCount || 0),
            pendingAgents: isDone ? [] : (Array.isArray(record.pendingAgents) ? record.pendingAgents.slice() : []),
            pendingLabel: isDone ? '' : (record.pendingLabel || ''),
        };
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
        worktreeBaseDir,
        devServerEnabled,
        caddyRoutes,
        repoAppId,
        reviewStatus,
        fileStatus,
    } = options;
    const tmux = safeTmuxSessionExists(parsed.id, agent);
    const normalizedStatus = deriveFeatureDashboardStatus(status, {
        reviewStatus,
        tmuxRunning: tmux ? tmux.running : false,
        fileStatus,
    });
    const worktreePath = resolveFeatureWorktreePath(worktreeBaseDir, parsed.id, agent, absRepoPath);
    const flagged = maybeFlagEndedSession(absRepoPath, {
        entityType: 'feature',
        id: parsed.id,
        agent,
        status: normalizedStatus,
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
        idleState: livenessInfo ? (livenessInfo.idleState || null) : null,
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
        snapshotAgents,
        updatedAt,
        stateDir,
        worktreeBaseDir,
        devServerEnabled,
        caddyRoutes,
        repoAppId,
        reviewStatus,
    } = options;
    const parsed = { id: featureId };
    const agentMap = snapshotAgents || {};
    return Object.keys(snapshotStatuses)
        .sort((a, b) => a.localeCompare(b))
        .map(agent => {
            let agentFlags = {};
            let hasStatusFile = false;
            let awaitingInput = null;
            let fileStatus = null;
            try {
                const statusData = JSON.parse(fs.readFileSync(path.join(stateDir, `feature-${featureId}-${agent}.json`), 'utf8'));
                agentFlags = parseStatusFlags(statusData.flags);
                hasStatusFile = true;
                fileStatus = statusData.status || null;
                if (statusData.awaitingInput && statusData.awaitingInput.message) {
                    awaitingInput = statusData.awaitingInput;
                }
            } catch (_) { /* ignore */ }

            const row = buildFeatureAgentRow({
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
                reviewStatus,
                fileStatus,
            });
            row.awaitingInput = awaitingInput;
            // Surface per-feature {model, effort} overrides captured at start time
            // so dashboard cards can display the intended triplet next to the
            // agent badge. Null when the agent uses project defaults.
            const snapAgent = agentMap[agent] || {};
            row.modelOverride = snapAgent.modelOverride != null ? snapAgent.modelOverride : null;
            row.effortOverride = snapAgent.effortOverride != null ? snapAgent.effortOverride : null;
            return row;
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
    const defaultBranch = detectDefaultBranch(absRepoPath);

    // Build the set membership index once per repo pass. Key lookups below:
    //   setByFeatureId : paddedId / slug (inbox) → setSlug
    //   setBySpecPath  : absolute spec path       → setSlug
    // specPath lookups cover renames between stages where the id/slug may have
    // changed but the underlying file is the same.
    const featureSetPaths = featureSets.featurePathsForRepo(absRepoPath);
    const setIndex = featureSets.scanFeatureSets(featureSetPaths);
    const setByFeatureId = new Map();
    const setBySpecPath = new Map();
    for (const [setSlug, members] of setIndex.entries()) {
        for (const m of members) {
            if (m.paddedId) setByFeatureId.set(m.paddedId, setSlug);
            if (m.slug) setByFeatureId.set(m.slug, setSlug);
            if (m.fullPath) setBySpecPath.set(m.fullPath, setSlug);
        }
    }
    const lookupSet = (featureId, specPath) => {
        if (specPath && setBySpecPath.has(specPath)) return setBySpecPath.get(specPath);
        if (featureId && setByFeatureId.has(String(featureId))) return setByFeatureId.get(String(featureId));
        return null;
    };

    [...workflowFeatureIds].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).forEach(featureId => {
        try {
            let initialState;
            try {
                initialState = workflowReadModel.getFeatureDashboardState(absRepoPath, featureId, null, []);
            } catch (e) {
                console.warn(`⚠️  Skipping feature ${featureId} (state error): ${e.message}`);
                return;
            }
            const snapshot = initialState.workflowSnapshot;
            const stage = initialState.stage;
            if (!snapshot || !stage) return;
            const identity = resolveFeatureIdentity(absRepoPath, featureId, manifestsByFeatureId, snapshot);
            const agents = buildFeatureAgentsFromSnapshot({
                absRepoPath,
                featureId,
                snapshotStatuses: initialState.snapshotStatuses,
                snapshotAgents: snapshot.agents,
                updatedAt: snapshot.updatedAt,
                stateDir,
                worktreeBaseDir,
                devServerEnabled,
                caddyRoutes,
                repoAppId,
                reviewStatus: initialState.reviewStatus,
            });
            const featureState = workflowReadModel.getFeatureDashboardState(absRepoPath, featureId, stage, agents);
            const autonomousSession = stage !== 'done' ? safeFeatureAutoSessionExists(featureId, absRepoPath) : null;
            const rebaseProbeWorktree = agents.length > 0
                ? resolveFeatureWorktreePath(worktreeBaseDir, featureId, agents[0].id, absRepoPath)
                : null;
            const rebaseNeeded = stage === 'in-progress'
                ? computeRebaseNeeded(rebaseProbeWorktree, defaultBranch)
                : false;
            agents.forEach(agent => {
                // Preserve review-loop statuses derived in buildFeatureAgentRow —
                // snapshotStatuses only carries engine states, so this override
                // would otherwise clobber 'addressing-review' / 'feedback-addressed'.
                const isDerivedReviewState = agent.status === 'addressing-review' || agent.status === 'feedback-addressed';
                if (featureState.snapshotStatuses[agent.id] && !isDerivedReviewState) {
                    agent.status = featureState.snapshotStatuses[agent.id];
                }
                response.summary.total++;
                response.summary[agent.status] = (response.summary[agent.status] || 0) + 1;
            });

            features.push({
                id: featureId,
                name: identity.name,
                stage,
                complexity: readComplexityFromSpec(identity.specPath || snapshot.specPath),
                set: lookupSet(featureId, identity.specPath || snapshot.specPath),
                authorAgentId: snapshot.authorAgentId || null,
                specPath: identity.specPath || snapshot.specPath,
                updatedAt: snapshot.updatedAt || new Date().toISOString(),
                createdAt: snapshot.createdAt || snapshot.updatedAt || new Date().toISOString(),
                evalStatus: featureState.evalStatus,
                winnerAgent: featureState.winnerAgent,
                evalPath: featureState.evalPath,
                evalSession: featureState.evalSession,
                reviewStatus: featureState.reviewStatus,
                reviewSessions: featureState.reviewSessions,
                specReviewSessions: featureState.specReviewSessions,
                autonomousPlan: featureState.autonomousPlan,
                agents,
                anyAwaitingInput: agents.some(a => a.awaitingInput && a.awaitingInput.message),
                pending: [],
                nextAction: featureState.nextAction,
                nextActions: featureState.nextActions,
                validActions: (rebaseNeeded && featureState.validActions.some(a => a.action === 'feature-close'))
                    ? [
                        {
                            command: `aigon feature-rebase ${featureId}`,
                            label: 'Rebase',
                            reason: 'Rebase feature branch onto main before closing',
                            action: 'feature-rebase',
                            kind: 'feature-rebase',
                            agentId: null,
                            mode: null,
                            category: 'lifecycle',
                            type: 'action',
                            to: null,
                            priority: 'normal',
                            requiresInput: null,
                            scope: null,
                            metadata: { confirmationMessage: 'Rebase this branch onto main? If there are conflicts, the rebase will abort and you\'ll need to resolve them in the terminal.' },
                            clientOnly: false,
                        },
                        ...featureState.validActions,
                    ]
                    : featureState.validActions,
                specDrift: featureState.specDrift,
                workflowEvents: featureState.workflowEvents,
                autonomousSession,
                nudges: featureState.nudges || [],
            });
        } catch (error) {
            console.warn(`⚠️  Skipping feature ${featureId} (collector error): ${error.message}`);
        }
    });

    specFiles.forEach(({ file: specFile, stage, dir: specDir }) => {
        const parsed = parseFeatureSpecFileName(specFile);
        if (!parsed) return;
        // Inbox features have no numeric ID — use name as identifier
        const featureId = parsed.id || parsed.name;
        if (workflowFeatureIds.has(featureId)) return;
        const specPath = path.join(specDir, specFile);
        const { updatedAt: fallbackUpdatedAt, createdAt } = safeStatIsoTimes(specPath);
        let featureState;
        try {
            featureState = workflowReadModel.getFeatureDashboardState(absRepoPath, featureId, stage, []);
        } catch (e) {
            console.warn(`⚠️  Skipping feature ${featureId} (state error): ${e.message}`);
            return;
        }
        const autonomousSession = featureState.stage !== 'done' && /^\d+$/.test(String(featureId)) ? safeFeatureAutoSessionExists(featureId, absRepoPath) : null;
        features.push({
            id: featureId,
            name: parsed.name,
            stage: featureState.stage,
            complexity: readComplexityFromSpec(specPath),
            set: lookupSet(featureId, specPath),
            authorAgentId: featureState.workflowSnapshot ? (featureState.workflowSnapshot.authorAgentId || null) : null,
            specPath,
            updatedAt: fallbackUpdatedAt,
            createdAt,
            evalStatus: featureState.evalStatus,
            winnerAgent: featureState.winnerAgent,
            evalPath: featureState.evalPath,
            evalSession: featureState.evalSession,
            reviewStatus: featureState.reviewStatus,
            reviewSessions: featureState.reviewSessions,
            specReviewSessions: featureState.specReviewSessions,
            autonomousPlan: featureState.autonomousPlan,
            agents: [],
            pending: [],
            nextAction: featureState.nextAction,
            nextActions: featureState.nextActions,
            validActions: featureState.validActions,
            specDrift: featureState.specDrift,
            workflowEvents: featureState.workflowEvents,
            autonomousSession,
            nudges: featureState.nudges || [],
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

    // Annotate backlog features with blockedBy (unmet dependencies).
    const featurePaths = {
        root: path.join(absRepoPath, 'docs', 'specs', 'features'),
        folders: ['01-inbox', '02-backlog', '03-in-progress', '04-in-evaluation', '05-done', '06-paused'],
    };
    features.forEach(feature => {
        if (feature.stage !== 'backlog' || !feature.specPath) return;
        const unmet = checkUnmetDependencies(feature.specPath, featurePaths);
        if (unmet.length > 0) {
            feature.blockedBy = unmet.map(d => ({
                id: d.id,
                name: d.slug.replace(/-/g, ' '),
                stage: d.stage,
            }));
        }
    });

    // Sets rollup: derived entirely from member stage, no new files written.
    // Exposed on the repo payload so the dashboard can offer "group by set".
    const sets = featureSets.summarizeSets(featureSetPaths).map(s => ({
        slug: s.slug,
        memberCount: s.memberCount,
        completed: s.completed,
        counts: s.counts,
        isComplete: s.isComplete,
        lastUpdatedAt: s.lastUpdatedAt,
        autonomous: safeSetAutoSessionExists(s.slug, absRepoPath),
    }));

    return {
        features,
        allFeatures,
        doneTotal: tierCache.cold.doneTotal,
        sets,
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
                let normalizedStatus = 'implementing';
                let normalizedUpdatedAt = new Date().toISOString();
                let agentFlags = {};
                let hasStatusFile = false;
                let awaitingInput = null;

                try {
                    if (fs.existsSync(statusFile)) {
                        const parsedStatus = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
                        normalizedStatus = snapshotStatuses[agent] || normalizeDashboardStatus(parsedStatus.status);
                        normalizedUpdatedAt = parsedStatus.updatedAt || normalizedUpdatedAt;
                        agentFlags = parseStatusFlags(parsedStatus.flags);
                        hasStatusFile = true;
                        if (parsedStatus.awaitingInput && parsedStatus.awaitingInput.message) {
                            awaitingInput = parsedStatus.awaitingInput;
                        }
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
                    idleState: researchLiveness ? (researchLiveness.idleState || null) : null,
                    findingsPath: canViewFindings ? findingsFile : null,
                    slashCommand: flagged.status === 'waiting' ? `aigon terminal-focus ${String(id).padStart(2, '0')} ${agent} --research` : null,
                    tmuxSession: tmuxRunning ? sessionName : null,
                    tmuxRunning,
                    attachCommand: tmuxRunning ? `tmux attach -t ${sessionName}` : null,
                    awaitingInput
                });
                response.summary.total++;
                response.summary[flagged.status] = (response.summary[flagged.status] || 0) + 1;
            });
        }

        const researchState = workflowReadModel.getResearchDashboardState(absRepoPath, id || name, effectiveStage, agents);

        research.push({
            id: id || name,
            name,
            stage: effectiveStage,
            complexity: readComplexityFromSpec(path.join(specDir, file)),
            authorAgentId: snapshot ? (snapshot.authorAgentId || null) : null,
            specPath: path.join(specDir, file),
            updatedAt: snapshot ? (snapshot.updatedAt || new Date().toISOString()) : safeStatIsoTimes(path.join(specDir, file)).updatedAt,
            createdAt: snapshot ? (snapshot.createdAt || snapshot.updatedAt || new Date().toISOString()) : safeStatIsoTimes(path.join(specDir, file)).createdAt,
            agents,
            anyAwaitingInput: agents.some(a => a.awaitingInput && a.awaitingInput.message),
            evalStatus: researchState.evalStatus,
            evalSession: researchState.evalSession,
            reviewStatus: researchState.reviewStatus,
            reviewSessions: researchState.reviewSessions,
            specReviewSessions: researchState.specReviewSessions,
            reviewState: researchState.reviewState,
            validActions: researchState.validActions,
            nextAction: researchState.nextAction,
            nextActions: researchState.nextActions,
            specDrift: researchState.specDrift,
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
    applySpecReviewFromSnapshots(absRepoPath, [
        ...featureStatus.features.map(item => ({ item, entityType: 'feature' })),
        ...researchStatus.research.map(item => ({ item, entityType: 'research' })),
    ]);
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

function collectDashboardHealth() {
    const startedAt = new Date().toISOString();
    const status = collectDashboardStatusData();
    return {
        ok: true,
        startedAt,
        completedAt: new Date().toISOString(),
        repoCount: Array.isArray(status.repos) ? status.repos.length : 0,
    };
}

// Maximum size of a single log payload before truncation (256 KB).
// Prevents pathological logs from bloating the /api/detail HTTP response.
const AGENT_LOG_MAX_BYTES = 256 * 1024;

function stripFrontmatter(raw) {
    return String(raw || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function extractMarkdownSection(content, heading) {
    if (!content || !heading) return '';
    const escaped = String(heading).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^##\\s+${escaped}\\s*\\r?\\n([\\s\\S]*?)(?=^##\\s+|$)`, 'im');
    const match = String(content).match(re);
    return match ? match[1].trim() : '';
}

function readEntityLog(repoPath, entityType, entityId, agentId, options = {}) {
    const absRepo = path.resolve(repoPath);
    if (entityType === 'research') {
        const findingsPath = path.join(
            absRepo,
            'docs',
            'specs',
            'research-topics',
            'logs',
            `research-${entityId}-${agentId}-findings.md`
        );
        try {
            return {
                path: findingsPath,
                content: fs.readFileSync(findingsPath, 'utf8'),
            };
        } catch (_) {
            return null;
        }
    }

    const logsDirs = [
        path.join(absRepo, 'docs', 'specs', 'features', 'logs'),
    ];
    const worktreePath = options.worktreePath;
    if (worktreePath) {
        logsDirs.push(path.join(worktreePath, 'docs', 'specs', 'features', 'logs'));
    }

    const candidates = [];
    logsDirs.forEach(dir => {
        safeReadDir(dir)
            .filter(file => new RegExp(`^feature-${entityId}-${agentId}-.+-log\\.md$`).test(file))
            .forEach(file => candidates.push(path.join(dir, file)));
    });
    candidates.sort((left, right) => safeStatMtimeMs(right) - safeStatMtimeMs(left));
    const logPath = candidates[0];
    if (!logPath) return null;
    try {
        return {
            path: logPath,
            content: fs.readFileSync(logPath, 'utf8'),
        };
    } catch (_) {
        return null;
    }
}

function readEntityLogExcerpts(repoPath, entityType, entityId, agentId, options = {}) {
    const logEntry = readEntityLog(repoPath, entityType, entityId, agentId, options);
    if (!logEntry || !logEntry.content) return {};
    if (entityType === 'research') {
        return {
            findings: extractMarkdownSection(logEntry.content, 'Findings'),
            progress: extractMarkdownSection(logEntry.content, 'Progress'),
            summary: extractMarkdownSection(logEntry.content, 'Summary'),
        };
    }
    return {
        plan: extractMarkdownSection(logEntry.content, 'Plan'),
        progress: extractMarkdownSection(logEntry.content, 'Progress'),
        summary: extractMarkdownSection(logEntry.content, 'Summary'),
    };
}

function collectEntityAgentLogs(repoPath, featureId, agentFiles, resolvedSpecPath) {
    const absRepo = path.resolve(repoPath);
    const repoLogDir = path.join(absRepo, 'docs', 'specs', 'features', 'logs');
    const logsDirs = [repoLogDir];
    Object.values(agentFiles || {}).forEach(file => {
        if (file && file.worktreePath) {
            logsDirs.push(path.join(file.worktreePath, 'docs', 'specs', 'features', 'logs'));
        }
    });

    const expectedLogs = {};
    const parsedSpec = resolvedSpecPath ? parseFeatureSpecFileName(path.basename(resolvedSpecPath)) : null;
    const featureName = parsedSpec && parsedSpec.name ? parsedSpec.name : null;
    if (featureName) {
        Object.entries(agentFiles || {}).forEach(([agentId, file]) => {
            const baseDir = file && file.worktreePath
                ? path.join(file.worktreePath, 'docs', 'specs', 'features', 'logs')
                : repoLogDir;
            expectedLogs[agentId] = path.join(baseDir, `feature-${featureId}-${agentId}-${featureName}-log.md`);
        });
    }

    return collectAgentLogs(logsDirs, featureId, expectedLogs);
}

function countDoneEntities(repoPath, entityType = 'feature') {
    const absRepo = path.resolve(repoPath);
    const doneDir = path.join(
        absRepo,
        'docs',
        'specs',
        entityType === 'research' ? 'research-topics' : 'features',
        '05-done'
    );
    return safeReadDir(doneDir, file => new RegExp(`^${entityType}-\\d+-.+\\.md$`).test(file)).length;
}

function getAgentDetailRecords(repoPath, entityType, entityId, snapshotAgents = []) {
    const prefixes = entityType === 'research'
        ? ['research', 'feature']
        : ['feature', 'research'];
    const discoveredAgents = new Set(Array.isArray(snapshotAgents) ? snapshotAgents : []);
    agentStatus.listAgentStatuses(repoPath, entityId, { prefixes }).forEach(record => {
        if (record && record.data && record.data.agent) discoveredAgents.add(record.data.agent);
    });

    const agentFiles = {};
    const rawAgentFiles = {};
    Array.from(discoveredAgents)
        .sort((left, right) => left.localeCompare(right))
        .forEach(agentId => {
            const record = agentStatus.readAgentStatusRecordAt(repoPath, entityId, agentId, { prefixes });
            agentFiles[agentId] = record && record.data ? record.data : {};
            rawAgentFiles[agentId] = record && record.raw
                ? record.raw
                : JSON.stringify(agentFiles[agentId] || {}, null, 2);
        });

    return { agentFiles, rawAgentFiles };
}

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
    collectDashboardHealth,
    collectRepoStatus,
    clearTierCache,
    collectAgentLogs,
    collectEntityAgentLogs,
    countDoneEntities,
    getAgentDetailRecords,
    readEntityLog,
    readEntityLogExcerpts,
    applySpecReviewFromSnapshots,
    AGENT_LOG_MAX_BYTES,
};
