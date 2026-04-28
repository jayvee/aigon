'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getCachedUpdateCheck, checkForUpdate } = require('./npm-update-check');
const feedbackLib = require('./feedback');
const stateMachine = require('./state-queries');
const { isProAvailable } = require('./pro');
const { reconcileEntitySpec } = require('./spec-reconciliation');
const workflowReadModel = require('./workflow-read-model');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const { getStateRenderMeta } = require('./state-render-meta');
const featureSpecResolver = require('./feature-spec-resolver');
const agentStatus = require('./agent-status');
const {
    normalizeDashboardStatus,
    deriveFeatureDashboardStatus,
    parseFeatureSpecFileName,
    safeTmuxSessionExists,
    safeCloseRecoveryTmuxSession,
    safeFeatureAutoSessionExists,
    safeSetAutoSessionExists,
    resolveFeatureWorktreePath,
    parseStatusFlags,
    maybeFlagEndedSession,
    detectDefaultBranch,
    computeRebaseNeeded,
} = require('./dashboard-status-helpers');
const { readConductorReposFromGlobalConfig, getProjectConfigPath } = require('./config');
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
const { parseFrontMatter } = require('./cli-parse');
const { buildSetValidActions } = require('./feature-set-workflow-rules');

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

function collectDoneSpecs(doneDir, pattern, limit = 10, options = {}) {
    // F397: engine-first enumeration for "recent completions".
    //   1. Engine snapshots with lifecycle === 'done' → authoritative,
    //      sorted by feature.closed event timestamp (best signal).
    //   2. Legacy 05-done/ folder scan → adds pre-engine done features
    //      whose IDs aren't present in the engine workflow root.
    // Deduplicated by featureNum so an engine-done feature whose spec is
    // also in 05-done shows only once.
    const repoPath = options.repoPath || null;
    const entityType = options.entityType || 'feature';
    const workflowSubdir = entityType === 'research' ? 'research' : 'features';
    const collected = new Map(); // featureNum -> { file, mtime, birthtime }

    // 1. Engine-done enumeration
    if (repoPath) {
        const workflowRoot = path.join(repoPath, '.aigon', 'workflows', workflowSubdir);
        if (fs.existsSync(workflowRoot)) {
            try {
                fs.readdirSync(workflowRoot)
                    .filter(d => /^\d+$/.test(d))
                    .forEach(idDir => {
                        const snapshotPath = path.join(workflowRoot, idDir, 'snapshot.json');
                        let snapshot = null;
                        try { snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')); } catch (_) { return; }
                        if (!snapshot) return;
                        const lifecycle = String(snapshot.currentSpecState || snapshot.lifecycle || '').toLowerCase();
                        if (lifecycle !== 'done') return;
                        // Read the closed timestamp from events.jsonl when available.
                        let closedAtMs = 0;
                        try {
                            const eventsPath = path.join(workflowRoot, idDir, 'events.jsonl');
                            if (fs.existsSync(eventsPath)) {
                                const lines = fs.readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean);
                                for (const line of lines) {
                                    try {
                                        const ev = JSON.parse(line);
                                        if (ev.type === `${entityType}.closed` && ev.at) {
                                            const ts = new Date(ev.at).getTime();
                                            if (!Number.isNaN(ts)) closedAtMs = ts;
                                        }
                                    } catch (_) { /* skip */ }
                                }
                            }
                        } catch (_) { /* ignore */ }
                        // Resolve the spec file: prefer 05-done/, otherwise snapshot.specPath.
                        let file = null;
                        let mtime = closedAtMs;
                        let birthtime = null;
                        if (fs.existsSync(doneDir)) {
                            try {
                                file = safeReadDir(doneDir, f => f.startsWith(`${entityType}-${idDir}-`) && pattern.test(f))[0] || null;
                            } catch (_) { /* ignore */ }
                        }
                        if (!file && snapshot.specPath) {
                            const abs = path.isAbsolute(snapshot.specPath) ? snapshot.specPath : path.resolve(repoPath, snapshot.specPath);
                            if (fs.existsSync(abs)) file = path.basename(abs);
                        }
                        if (file) {
                            const fullPath = path.join(doneDir, file);
                            try {
                                const stat = fs.statSync(fullPath);
                                if (!mtime) mtime = stat.mtime.getTime();
                                birthtime = stat.birthtime.toISOString();
                            } catch (_) { /* spec file missing — keep file=null below */ }
                        }
                        if (!birthtime && closedAtMs) birthtime = new Date(closedAtMs).toISOString();
                        collected.set(idDir, {
                            file: file || `${entityType}-${idDir}.md`,
                            mtime: mtime || 0,
                            birthtime: birthtime || (closedAtMs ? new Date(closedAtMs).toISOString() : null),
                        });
                    });
            } catch (_) { /* ignore */ }
        }
    }

    // 2. Folder scan supplementary — only adds rows the engine didn't already cover.
    const allDone = safeReadDir(doneDir, file => pattern.test(file));
    allDone.forEach(file => {
        const m = file.match(new RegExp(`^${entityType}-(\\d+)-.+\\.md$`));
        const key = m ? m[1] : `file:${file}`;
        if (collected.has(key)) return;
        const fullPath = path.join(doneDir, file);
        let birthtime = null;
        let mtime = 0;
        try {
            const stat = fs.statSync(fullPath);
            birthtime = stat.birthtime.toISOString();
            mtime = stat.mtime.getTime();
        } catch (_) { /* ignore */ }
        collected.set(key, { file, mtime, birthtime });
    });

    const doneWithStats = [...collected.values()].sort((a, b) => b.mtime - a.mtime);

    return {
        total: collected.size,
        all: doneWithStats,
        recent: doneWithStats.slice(0, limit),
    };
}

function readSetGoal(members) {
    for (const member of Array.isArray(members) ? members : []) {
        if (!member || !member.fullPath) continue;
        try {
            const raw = fs.readFileSync(member.fullPath, 'utf8');
            const { data } = parseFrontMatter(raw);
            if (data && data.goal) return String(data.goal).trim();
        } catch (_) { /* ignore */ }
    }
    return '';
}

function buildSetMemberState(member, snapshot, autoState, doneIds, blockedIds) {
    const id = member && member.paddedId ? String(member.paddedId) : '';
    const lifecycle = String(snapshot && (snapshot.currentSpecState || snapshot.lifecycle) || member.stage || '');
    const failedIds = new Set(Array.isArray(autoState && autoState.failed) ? autoState.failed.map(String) : []);
    const failedFeature = autoState && autoState.failedFeature ? String(autoState.failedFeature) : '';
    if (id && (failedIds.has(id) || failedFeature === id || member.stage === 'paused')) return 'failed';
    if (id && doneIds.has(id)) return 'done';
    if (lifecycle === 'done' || member.stage === 'done') return 'done';
    if (lifecycle === 'code_review_in_progress' || lifecycle === 'code_revision_in_progress' || lifecycle === 'ready_for_review' || member.stage === 'in-evaluation') return 'in-review';
    if (lifecycle === 'implementing' || lifecycle === 'submitted' || lifecycle === 'evaluating' || lifecycle === 'closing' || member.stage === 'in-progress') return 'in-progress';
    if (id && blockedIds.has(id)) return 'blocked';
    return 'backlog';
}

function humanizeSetEvent(reason, status) {
    const raw = String(reason || status || '').trim();
    if (!raw) return '';
    return raw
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, ch => ch.toUpperCase());
}

function buildSetDashboardCard(absRepoPath, summary, paths) {
    const members = featureSets.getSetMembersSorted(summary.slug, paths);
    const edges = featureSets.getSetDependencyEdges(summary.slug, paths);
    const autonomous = safeSetAutoSessionExists(summary.slug, absRepoPath);
    const status = autonomous && autonomous.status
        ? String(autonomous.status)
        : (summary.isComplete ? 'done' : 'idle');
    const completedIds = new Set((autonomous && autonomous.completed) || members.filter(m => m.stage === 'done').map(m => m.paddedId).filter(Boolean));
    const memberById = new Map(members.filter(m => m.paddedId).map(m => [String(m.paddedId), m]));
    const blockedIds = new Set();
    edges.forEach(edge => {
        if (!completedIds.has(String(edge.to))) blockedIds.add(String(edge.from));
    });

    const graphNodes = members.map(member => {
        const snapshot = member.paddedId
            ? workflowSnapshotAdapter.readWorkflowSnapshotSync(absRepoPath, 'feature', member.paddedId)
            : null;
        return {
            id: member.paddedId || member.slug,
            featureId: member.paddedId || null,
            label: member.slug.replace(/-/g, ' '),
            stage: member.stage,
            state: buildSetMemberState(member, snapshot, autonomous, completedIds, blockedIds),
            isCurrent: Boolean(autonomous && autonomous.currentFeature && member.paddedId === String(autonomous.currentFeature)),
        };
    });

    const currentMember = autonomous && autonomous.currentFeature
        ? memberById.get(String(autonomous.currentFeature)) || null
        : null;

    return {
        slug: summary.slug,
        goal: readSetGoal(members),
        memberCount: summary.memberCount,
        completed: summary.completed,
        progress: {
            merged: summary.completed,
            total: summary.memberCount,
            percent: summary.memberCount > 0 ? Math.round((summary.completed / summary.memberCount) * 100) : 0,
        },
        status,
        isComplete: summary.isComplete,
        lastUpdatedAt: summary.lastUpdatedAt,
        currentFeature: currentMember ? {
            id: currentMember.paddedId,
            label: currentMember.slug.replace(/-/g, ' '),
            stage: currentMember.stage,
        } : null,
        lastEvent: autonomous ? {
            label: humanizeSetEvent(autonomous.reason, autonomous.status),
            at: autonomous.updatedAt || autonomous.endedAt || autonomous.startedAt || null,
        } : null,
        autonomous,
        depGraph: {
            nodes: graphNodes,
            edges: edges.map(edge => ({ from: String(edge.from), to: String(edge.to) })),
        },
        validActions: buildSetValidActions({
            slug: summary.slug,
            status,
            isComplete: summary.isComplete,
            autonomous,
            inboxMemberCount: Number(summary.counts && summary.counts.inbox) || 0,
        }, {
            requiresPro: false,
            proAvailable: isProAvailable(),
        }),
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

function applySpecReviewFromSnapshots(_repoPath, _items) {
    // F344: no-op shim. specReview sidecar reads removed; stateRenderMeta
    // is now attached per feature row from the engine snapshot.currentSpecState.
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
    if (normalized === 'idle') return true;
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
        idleAtPrompt: livenessInfo ? Boolean(livenessInfo.idleAtPrompt) : false,
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

const COMPLETION_SIGNAL_BY_TASK_TYPE = {
    'do': 'implementation-complete',
    'revise': 'revision-complete',
    'review': 'review-complete',
    'spec-review': 'spec-review-complete',
    'spec-check': 'spec-review-complete',
};

/** F405: statuses where tmux is up but the agent is not in a completion/idle UI state */
const NON_WORKING_AGENT_STATUSES = new Set([
    'implementation-complete', 'revision-complete', 'research-complete',
    'review-complete', 'spec-review-complete', 'waiting',
]);

function computePendingCompletionSignal(dashboardStatus, fileStatus, taskType, snapshotAgentStatus, entityType) {
    if (!taskType) return null;
    const signal = entityType === 'research' && taskType === 'do'
        ? 'research-complete'
        : COMPLETION_SIGNAL_BY_TASK_TYPE[taskType];
    if (!signal) return null;
    const eff = fileStatus || dashboardStatus || '';
    if (signal === 'implementation-complete' || signal === 'research-complete') {
        // Do not short-circuit on snapshot `ready` alone: after `session-lost` the
        // engine may mark the slot ready while the status file still shows an open
        // `do` task — that is exactly when the escape hatch should appear (F405).
        if (['implementation-complete', 'research-complete', 'revision-complete'].includes(eff)) return null;
    } else if (signal === 'revision-complete') {
        if (snapshotAgentStatus === 'ready') return null;
        if (eff === 'revision-complete') return null;
    } else if (signal === 'review-complete') {
        if (eff === 'review-complete') return null;
    } else if (signal === 'spec-review-complete') {
        if (eff === 'spec-review-complete') return null;
    }
    return signal;
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
            let taskType = null;
            // REGRESSION: workflow dirs use unpadded numeric ids; status files use
            // canonical padded ids — try both (same as agent-status.readAgentStatus).
            for (const cid of agentStatus.candidateIds(featureId)) {
                try {
                    const statusData = JSON.parse(fs.readFileSync(path.join(stateDir, `feature-${cid}-${agent}.json`), 'utf8'));
                    agentFlags = parseStatusFlags(statusData.flags);
                    hasStatusFile = true;
                    fileStatus = statusData.status || null;
                    taskType = statusData.taskType || null;
                    if (statusData.awaitingInput && statusData.awaitingInput.message) {
                        awaitingInput = statusData.awaitingInput;
                    }
                    break;
                } catch (_) { /* try next candidate */ }
            }

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
            // F405: escape hatch — show "Mark X complete" when agent status file exists
            // but the expected completion signal has not been recorded.
            const snapshotAgentStatus = snapshotStatuses[agent] || null;
            row.pendingCompletionSignal = hasStatusFile
                ? computePendingCompletionSignal(row.status, fileStatus, taskType, snapshotAgentStatus, 'feature')
                : null;
            // isWorking mirrors the ● Running spinner: tmux session exists and the
            // agent is not in a terminal/completion status. The escape hatch (Mark X
            // complete) is hidden while the session is running — it is only useful
            // after the session has ended without emitting a completion signal.
            row.isWorking = row.tmuxRunning && !NON_WORKING_AGENT_STATUSES.has(row.status);
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
        tierCache.cold.features = collectDoneSpecs(doneDir, /^feature-\d+-.+\.md$/, 10, { repoPath: absRepoPath, entityType: 'feature' });
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
                // would otherwise clobber 'revision-complete'.
                const isDerivedReviewState = agent.status === 'revision-complete';
                if (featureState.snapshotStatuses[agent.id] && !isDerivedReviewState) {
                    agent.status = featureState.snapshotStatuses[agent.id];
                }
                response.summary.total++;
                if (['implementation-complete', 'revision-complete', 'research-complete', 'review-complete', 'spec-review-complete'].includes(agent.status)) {
                    response.summary.complete = (response.summary.complete || 0) + 1;
                } else {
                    response.summary[agent.status] = (response.summary[agent.status] || 0) + 1;
                }
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
                specCheckSessions: featureState.specCheckSessions,
                autonomousPlan: featureState.autonomousPlan,
                agents,
                anyAwaitingInput: agents.some(a => a.awaitingInput && a.awaitingInput.message),
                anyIdleAtPrompt: agents.some(a => a.idleAtPrompt === true),
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
                lastCloseFailure: snapshot.lastCloseFailure || null,
                closeRecovery: snapshot.closeRecovery || null,
                recoveryTmuxSession: (snapshot.currentSpecState === 'close_recovery_in_progress'
                    && snapshot.closeRecovery
                    && snapshot.closeRecovery.agentId)
                    ? safeCloseRecoveryTmuxSession(featureId, snapshot.closeRecovery.agentId)
                    : null,
                stateRenderMeta: getStateRenderMeta(snapshot.currentSpecState || snapshot.lifecycle),
                reviewCycles: Array.isArray(snapshot.reviewCycles) ? snapshot.reviewCycles : [],
                mode: snapshot.mode || null,
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
            specCheckSessions: featureState.specCheckSessions,
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
            lastCloseFailure: (featureState.workflowSnapshot && featureState.workflowSnapshot.lastCloseFailure) || null,
            stateRenderMeta: getStateRenderMeta(featureState.workflowSnapshot && (featureState.workflowSnapshot.currentSpecState || featureState.workflowSnapshot.lifecycle)),
            reviewCycles: Array.isArray(featureState.workflowSnapshot && featureState.workflowSnapshot.reviewCycles) ? featureState.workflowSnapshot.reviewCycles : [],
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
    const sets = featureSets.summarizeSets(featureSetPaths)
        .filter(s => !s.isComplete)
        .map(s => ({
            ...s,
            ...buildSetDashboardCard(absRepoPath, s, featureSetPaths),
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
        tierCache.cold.research = collectDoneSpecs(researchDoneDir, /^research-\d+-.+\.md$/, 10, { repoPath: absRepoPath, entityType: 'research' });
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
                const canViewFindings = flagged.status === 'research-complete' || Boolean(flagged.flags && flagged.flags.sessionEnded);
                const researchLiveness = getAgentLiveness(absRepoPath, 'research', id, agent);
                const researchSnapshotStatus = snapshotStatuses[agent] || null;
                // F405: escape hatch for research agents — all research agents have role 'do'
                const researchPendingSignal = hasStatusFile
                    ? computePendingCompletionSignal(flagged.status, null, 'do', researchSnapshotStatus, 'research')
                    : null;
                agents.push({
                    id: agent,
                    status: flagged.status,
                    updatedAt: normalizedUpdatedAt,
                    flags: flagged.flags,
                    liveness: researchLiveness ? researchLiveness.liveness : null,
                    lastSeenAt: researchLiveness ? researchLiveness.lastSeenAt : null,
                    heartbeatAgeMs: researchLiveness ? researchLiveness.heartbeatAgeMs : null,
                    idleState: researchLiveness ? (researchLiveness.idleState || null) : null,
                    idleAtPrompt: researchLiveness ? Boolean(researchLiveness.idleAtPrompt) : false,
                    findingsPath: canViewFindings ? findingsFile : null,
                    slashCommand: flagged.status === 'waiting' ? `aigon terminal-focus ${String(id).padStart(2, '0')} ${agent} --research` : null,
                    tmuxSession: tmuxRunning ? sessionName : null,
                    tmuxRunning,
                    attachCommand: tmuxRunning ? `tmux attach -t ${sessionName}` : null,
                    awaitingInput,
                    pendingCompletionSignal: researchPendingSignal,
                    isWorking: tmuxRunning && !NON_WORKING_AGENT_STATUSES.has(flagged.status),
                });
                response.summary.total++;
                if (['implementation-complete', 'revision-complete', 'research-complete', 'review-complete', 'spec-review-complete'].includes(flagged.status)) {
                    response.summary.complete = (response.summary.complete || 0) + 1;
                } else {
                    response.summary[flagged.status] = (response.summary[flagged.status] || 0) + 1;
                }
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
            anyIdleAtPrompt: agents.some(a => a.idleAtPrompt === true),
            evalStatus: researchState.evalStatus,
            evalSession: researchState.evalSession,
            reviewStatus: researchState.reviewStatus,
            reviewSessions: researchState.reviewSessions,
            specReviewSessions: researchState.specReviewSessions,
            specCheckSessions: researchState.specCheckSessions,
            reviewState: researchState.reviewState,
            validActions: researchState.validActions,
            nextAction: researchState.nextAction,
            nextActions: researchState.nextActions,
            specDrift: researchState.specDrift,
            workflowEvents: researchState.workflowEvents,
            stateRenderMeta: getStateRenderMeta(snapshot && (snapshot.currentSpecState || snapshot.lifecycle)),
            reviewCycles: Array.isArray(snapshot && snapshot.reviewCycles) ? snapshot.reviewCycles : [],
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
    try {
        // Scheduled-kickoff engine moved to @aigon/pro (feature 236).
        // When Pro is installed, decorate features/research with their next
        // scheduled run; otherwise no decoration (free tier has no scheduler).
        const { getPro } = require('./pro');
        const pro = getPro();
        const buildPendingScheduleIndex = pro && pro.scheduledKickoff && pro.scheduledKickoff.buildPendingScheduleIndex;
        if (typeof buildPendingScheduleIndex !== 'function') throw new Error('no-pro-scheduler');
        const schedIdx = buildPendingScheduleIndex(absRepoPath);
        (featureStatus.features || []).forEach((f) => {
            const hit = schedIdx.lookupFeature(f.id);
            if (hit) {
                f.scheduledRunAt = hit.runAt;
                f.scheduledKind = hit.kind;
            }
        });
        (researchStatus.research || []).forEach((r) => {
            const hit = schedIdx.lookupResearch(r.id);
            if (hit) {
                r.scheduledRunAt = hit.runAt;
                r.scheduledKind = hit.kind;
            }
        });
    } catch (_) { /* non-fatal: schedule store optional */ }
    applySpecReviewFromSnapshots(absRepoPath, [
        ...featureStatus.features.map(item => ({ item, entityType: 'feature' })),
        ...researchStatus.research.map(item => ({ item, entityType: 'research' })),
    ]);
    const feedbackStatus = collectFeedback(absRepoPath);
    const tierCache = getTierCache(absRepoPath);
    if (typeof tierCache.cold.githubRemote !== 'boolean') {
        let ghEnabled = detectGitHubRemote(absRepoPath);
        if (ghEnabled) {
            try {
                const projectCfg = JSON.parse(require('fs').readFileSync(getProjectConfigPath(absRepoPath), 'utf8'));
                if (projectCfg && projectCfg.github && projectCfg.github.prCheck === false) ghEnabled = false;
            } catch (_) { /* no project config — keep auto-detected value */ }
        }
        tierCache.cold.githubRemote = ghEnabled;
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

// Kick off a background npm registry check so subsequent poll cycles
// see a warm cache without blocking the first status response.
let _npmCheckScheduled = false;
function scheduleNpmUpdateCheck() {
    if (_npmCheckScheduled) return;
    _npmCheckScheduled = true;
    checkForUpdate().catch(() => {}).finally(() => { _npmCheckScheduled = false; });
}

function collectDashboardStatusData() {
    const response = {
        generatedAt: new Date().toISOString(),
        repos: [],
        summary: { implementing: 0, waiting: 0, complete: 0, error: 0, total: 0 },
        proAvailable: isProAvailable(),
        updateCheck: getCachedUpdateCheck(),
    };

    readConductorReposFromGlobalConfig().forEach(repoPath => {
        const repoStatus = collectRepoStatus(path.resolve(repoPath), response);
        if (repoStatus) response.repos.push(repoStatus);
    });

    // Refresh npm check in the background so the next poll cycle has fresh data
    scheduleNpmUpdateCheck();

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

function collectFeaturesForResearch(repoPath, researchId) {
    const id = parseInt(researchId, 10);
    if (!Number.isFinite(id) || id <= 0) return [];
    const absRepo = path.resolve(repoPath);
    const paths = featureSets.featurePathsForRepo(absRepo);
    const out = [];
    for (const folder of paths.folders) {
        const dir = path.join(paths.root, folder);
        if (!fs.existsSync(dir)) continue;
        let entries;
        try { entries = fs.readdirSync(dir); } catch (_) { continue; }
        for (const file of entries) {
            if (!file.startsWith(`${paths.prefix}-`) || !file.endsWith('.md')) continue;
            const fullPath = path.join(dir, file);
            let content;
            try { content = fs.readFileSync(fullPath, 'utf8'); } catch (_) { continue; }
            const { data } = parseFrontMatter(content);
            const ids = data && Array.isArray(data.research) ? data.research : null;
            if (!ids || !ids.includes(id)) continue;
            const idMatch = file.match(/^feature-(\d+)-(.+)\.md$/);
            const noIdMatch = !idMatch && file.match(/^feature-(.+)\.md$/);
            const featureId = idMatch ? idMatch[1] : null;
            const slug = idMatch ? idMatch[2] : (noIdMatch ? noIdMatch[1] : null);
            if (!slug) continue;
            out.push({
                id: featureId,
                name: slug.replace(/-/g, ' '),
                stage: featureSets.STAGE_BY_FOLDER[folder] || 'unknown',
                set: data && typeof data.set === 'string' ? data.set : null,
                complexity: data && data.complexity ? String(data.complexity) : null,
                specPath: fullPath,
            });
        }
    }
    out.sort((a, b) => {
        const sa = featureSets.STAGE_ORDER.indexOf(a.stage);
        const sb = featureSets.STAGE_ORDER.indexOf(b.stage);
        if (sa !== sb) return (sa === -1 ? 99 : sa) - (sb === -1 ? 99 : sb);
        const na = a.id ? parseInt(a.id, 10) : Number.POSITIVE_INFINITY;
        const nb = b.id ? parseInt(b.id, 10) : Number.POSITIVE_INFINITY;
        if (na !== nb) return na - nb;
        return a.name.localeCompare(b.name);
    });
    return out;
}

function collectResearchFindings(repoPath, researchId) {
    const absRepo = path.resolve(repoPath);
    const logsDir = path.join(absRepo, 'docs', 'specs', 'research-topics', 'logs');
    const out = {};
    if (!fs.existsSync(logsDir)) return out;
    const idNum = Number(researchId);
    const pattern = /^research-(\d+)-([a-z]{2})-findings\.md$/;
    let entries;
    try { entries = fs.readdirSync(logsDir); } catch (_) { return out; }
    for (const file of entries) {
        const m = file.match(pattern);
        if (!m || Number(m[1]) !== idNum) continue;
        const agentId = m[2];
        const fullPath = path.join(logsDir, file);
        let content = null;
        try {
            const raw = stripFrontmatter(fs.readFileSync(fullPath, 'utf8'));
            if (Buffer.byteLength(raw, 'utf8') > AGENT_LOG_MAX_BYTES) {
                content = raw.slice(0, AGENT_LOG_MAX_BYTES) + `\n\n… (truncated — view full file at ${fullPath})`;
            } else {
                content = raw;
            }
        } catch (_) { content = null; }
        out[agentId] = { path: fullPath, content };
    }
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
    collectFeaturesForResearch,
    collectResearchFindings,
    countDoneEntities,
    getAgentDetailRecords,
    readEntityLog,
    readEntityLogExcerpts,
    applySpecReviewFromSnapshots,
    AGENT_LOG_MAX_BYTES,
    // F397: exported for tests covering engine-first done-spec enumeration.
    collectDoneSpecs,
};
