'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getCachedUpdateCheck, checkForUpdate } = require('./npm-update-check');
const feedbackLib = require('./feedback');
const stateMachine = require('./state-queries');
const { isProAvailable, getProStatus } = require('./pro');
const { reconcileEntitySpec } = require('./spec-reconciliation');
const workflowReadModel = require('./workflow-read-model');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const { getStateRenderMeta } = require('./state-render-meta');
const { computeCardHeadline } = require('./card-headline');
const {
    resolveSpecAuthor,
    resolveAuthorAgentId,
    normalizeLastSpecRevision,
    emptyLastSpecRevision,
} = require('./spec-author-provenance');
const featureSpecResolver = require('./feature-spec-resolver');
const agentStatus = require('./agent-status');
const signalHealth = require('./signal-health');
const autoNudge = require('./auto-nudge');
const {
    normalizeDashboardStatus,
    deriveFeatureDashboardStatus,
    RUNTIME_TASK_FILE_STATUSES,
    parseFeatureSpecFileName,
    safeTmuxSessionExists,
    safeCloseRecoveryTmuxSession,
    safeFeatureAutoSessionExists,
    safeSetAutoSessionExists,
    resolveFeatureWorktreePath,
    parseStatusFlags,
    maybeFlagEndedSession,
} = require('./dashboard-status-helpers');
const { readConductorReposFromGlobalConfig, readDashboardPollRepos, getProjectConfigPath } = require('./config');
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
const { getAgentLiveness, captureAndDetectIdle } = require('./supervisor');
const specRecommendationLib = require('./spec-recommendation');
const featureSets = require('./feature-sets');
const { buildEntityView } = require('./read-model/entity-view');
const { parseFrontMatter } = require('./cli-parse');
const { STAGE_FOLDERS } = require('./workflow-core/paths');
const { readJsonSafe } = require('./io/json');
const { buildSetValidActions } = require('./feature-set-workflow-rules');
const { formatDisplayKey } = require('./spec-identity');
const {
    countReviewableSetMembers,
    countLaunchableSetSpecReviewMembers,
} = require('./feature-set-spec-review');
const { countPendingSpecReviseMembers } = require('./feature-set-spec-revise');
const agentRegistry = require('./agent-registry');
const probeTtlCache = require('./probe-ttl-cache');
const dashboardSpecIndex = require('./dashboard-spec-index');
const {
    buildRepoStorageStatus,
    buildRepoStorageActions,
    attachActiveLeasesToEntities,
} = require('./dashboard-storage');

const PROBE_TTLS_MS = {
    caddyRoutes: 120 * 1000,
    devServer: 60 * 1000,
    gitRemote: 300 * 1000,
    defaultBranch: 300 * 1000,
    scheduleIndex: 60 * 1000,
    storageStatus: 60 * 1000,
};

const _tierCache = new Map();

const DRIVE_BRANCH_LIVE_STATUSES = new Set([
    'implementing', 'waiting', 'reviewing', 'addressing-code-review',
    'feedback-addressed', 'awaiting-input',
]);

function resolveDriveBranchToolAgentId(featureId, absRepoPath) {
    const agentIds = agentRegistry.getAllAgentIds().filter(id => id !== 'solo');
    for (const id of agentIds) {
        const record = agentStatus.readAgentStatus(featureId, id, 'feature', { mainRepoPath: absRepoPath });
        if (record && DRIVE_BRANCH_LIVE_STATUSES.has(record.status)) return id;
    }
    for (const id of agentIds) {
        const session = safeTmuxSessionExists(featureId, id, { repoPath: absRepoPath });
        if (session && session.running) return id;
    }
    return null;
}

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

function readFrontmatterAgent(specPath) {
    if (!specPath || !fs.existsSync(specPath)) return null;
    try {
        const { parseFrontMatter } = require('./cli-parse');
        const content = fs.readFileSync(specPath, 'utf8');
        const { data } = parseFrontMatter(content);
        return data && data.agent != null ? String(data.agent).trim() || null : null;
    } catch (_) {
        return null;
    }
}

function buildProvenanceFields(snapshot, specPath) {
    const fmAgent = readFrontmatterAgent(specPath);
    const specAuthor = resolveSpecAuthor(snapshot, fmAgent);
    const agentKeys = snapshot && snapshot.agents ? Object.keys(snapshot.agents) : [];
    const authorAgentId = resolveAuthorAgentId(snapshot, specAuthor, agentKeys);
    const lastSpecRevision = snapshot && snapshot.lastSpecRevision
        ? normalizeLastSpecRevision(snapshot.lastSpecRevision)
        : emptyLastSpecRevision();
    return { specAuthor, authorAgentId, lastSpecRevision };
}

function buildEntityDisplayKey(kind, id) {
    if (id == null || !/^\d+$/.test(String(id))) return null;
    return formatDisplayKey({ kind, number: parseInt(String(id), 10) });
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

function summarizeReviewSessions(sessions) {
    return (Array.isArray(sessions) ? sessions : []).map(session => ({
        agent: session.agent || session.agentId || null,
        session: session.session || null,
        running: Boolean(session.running),
        status: session.status || null,
        statusCls: session.statusCls || null,
        startedAt: session.startedAt || null,
        completedAt: session.completedAt || null,
        requestRevision: session.requestRevision != null ? Boolean(session.requestRevision) : null,
    }));
}

function buildDetailFingerprint(...parts) {
    return parts
        .map(part => {
            if (part == null) return '';
            if (typeof part === 'object') return JSON.stringify(part);
            return String(part);
        })
        .join('|');
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
    // F459: done specs are immutable on disk — enumerate `05-done/` only.
    // No snapshot.json / events.jsonl reads (dominant cost at 600+ features).
    // Recent order: numeric id descending (prioritise order ≈ chronological).
    // Engine-first lifecycle remains `isEntityDone()` elsewhere (F397).
    const entityType = options.entityType || 'feature';
    const idRe = new RegExp(`^${entityType}-(\\d+)-.+\\.md$`);
    const files = safeReadDir(doneDir, file => pattern.test(file));
    const sorted = files
        .map(file => {
            const m = file.match(idRe);
            return { file, numId: m ? Number(m[1]) : -1 };
        })
        .sort((a, b) => b.numId - a.numId)
        .map(({ file }) => ({ file }));

    return {
        total: sorted.length,
        all: sorted,
        recent: sorted.slice(0, limit),
    };
}

// F590: the lean list shape for a `done` feature. Done features never carry the
// heavy per-entity detail (agents, detailFingerprint, startupReadiness,
// cardHeadline, stateRenderMeta, validActions, …) on the poll path — that lives
// behind /api/feature/:id/details (F469). Both enrichment loops and the
// extraDone mapper share this so the shape stays identical (F459 invariant).
function buildLeanDoneFeatureRow({ id, name, specPath, updatedAt, createdAt, set = null, logPaths = [] }) {
    return {
        id,
        displayKey: buildEntityDisplayKey('feature', id),
        name,
        stage: 'done',
        specPath,
        updatedAt,
        createdAt,
        set: set || null,
        logPaths: logPaths || [],
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

function isStaleSetMemberFailure(id, autoState, snapshot) {
    if (!id || !autoState || !snapshot) return false;
    const failedIds = new Set(Array.isArray(autoState.failed) ? autoState.failed.map(String) : []);
    const inFailed = failedIds.has(id) || String(autoState.failedFeature || '') === id;
    if (!inFailed) return false;
    const lifecycle = String(snapshot.currentSpecState || snapshot.lifecycle || '');
    const reviewCompletedAt = snapshot.codeReview && snapshot.codeReview.reviewCompletedAt;
    if (reviewCompletedAt && (lifecycle === 'ready' || lifecycle === 'code_revision_in_progress' || lifecycle === 'closing')) {
        return true;
    }
    return lifecycle === 'done';
}

function buildSetMemberState(member, snapshot, autoState, doneIds, blockedIds) {
    const id = member && member.paddedId ? String(member.paddedId) : '';
    const lifecycle = String(snapshot && (snapshot.currentSpecState || snapshot.lifecycle) || member.stage || '');
    const failedIds = new Set(Array.isArray(autoState && autoState.failed) ? autoState.failed.map(String) : []);
    const failedFeature = autoState && autoState.failedFeature ? String(autoState.failedFeature) : '';
    if (id && !isStaleSetMemberFailure(id, autoState, snapshot) && (failedIds.has(id) || failedFeature === id || member.stage === 'paused')) return 'failed';
    if (id && doneIds.has(id)) return 'done';
    if (lifecycle === 'done' || member.stage === 'done') return 'done';
    if (lifecycle === 'code_review_in_progress' || lifecycle === 'code_revision_in_progress' || lifecycle === 'ready_for_review' || member.stage === 'in-evaluation') return 'in-review';
    if (lifecycle === 'implementing' || lifecycle === 'ready' || lifecycle === 'evaluating' || lifecycle === 'closing' || member.stage === 'in-progress') return 'in-progress';
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

function buildSetDashboardCard(absRepoPath, summary, paths, specIndex) {
    const members = featureSets.getSetMembersSorted(summary.slug, paths, specIndex);
    const edges = featureSets.getSetDependencyEdges(summary.slug, paths, specIndex);
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
            reviewableMemberCount: countReviewableSetMembers(members),
            launchableSpecReviewMemberCount: countLaunchableSetSpecReviewMembers(members),
            pendingSpecReviseMemberCount: countPendingSpecReviseMembers(members, absRepoPath),
        }, {
            requiresPro: false,
            proAvailable: isProAvailable(),
        }),
    };
}

function applyPendingScheduleMetadata(entity, hit, fallbackKind = null) {
    if (!entity || !hit) return;
    entity.scheduledRunAt = hit.runAt || hit.run_at || null;
    entity.scheduledKind = hit.kind || fallbackKind;
    entity.scheduledJobId = hit.jobId || hit.id || null;
    entity.scheduledState = hit.state || hit.status || null;
    const agents = hit.agents || hit.agentIds || hit.agent_ids || null;
    if (Array.isArray(agents)) entity.scheduledAgents = agents.map(String);
    if (hit.reviewAgent || hit.reviewAgentId || hit.review_agent) {
        entity.scheduledReviewAgent = hit.reviewAgent || hit.reviewAgentId || hit.review_agent;
    }
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
        const parsed = readJsonSafe(path.join(dir, file));
        if (parsed !== null) {
            const mapped = mapEntry(parsed, file);
            if (mapped && mapped.key) result[mapped.key] = mapped.value;
        }
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
    const devServerAlive = route
        ? Boolean(probeTtlCache.getOrCompute(`dev-server-port:${route.port}`, PROBE_TTLS_MS.devServer, () => isPortInUseSync(route.port)))
        : false;
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
    const tmux = safeTmuxSessionExists(parsed.id, agent, { repoPath: absRepoPath });
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
    const idleLadder = autoNudge.computeIdleLadder(absRepoPath, {
        entityType: 'feature',
        entityId: parsed.id,
        agentId: agent,
        role: 'do',
        status: flagged.status,
        updatedAt,
        flags: flagged.flags,
        tmuxRunning: tmux ? tmux.running : false,
        sessionName: tmux ? tmux.sessionName : null,
        idleAtPrompt: livenessInfo ? Boolean(livenessInfo.idleAtPrompt) : false,
        idleAtPromptDetectedAt: livenessInfo ? livenessInfo.idleAtPromptDetectedAt : null,
    });
    if (hasStatusFile) {
        signalHealth.recordMissedSignalIfDue({
            repoPath: absRepoPath,
            entityType: 'feature',
            entityId: parsed.id,
            agent,
            lastStatus: flagged.status,
            lastStatusAt: updatedAt,
            sessionName: tmux ? tmux.sessionName : null,
            expected: `advance-from-${flagged.status}`,
        });
    }
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
        idleAtPromptDetectedAt: livenessInfo ? (livenessInfo.idleAtPromptDetectedAt || null) : null,
        idleLadder,
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

function enrichReviewSessionsWithLiveness(absRepoPath, featureId, sessions) {
    if (!Array.isArray(sessions)) return sessions;
    return sessions.map(session => {
        if (!session.running || !session.agent || !session.session) return session;
        const livenessInfo = getAgentLiveness(absRepoPath, 'feature', featureId, session.agent);
        const idleResult = livenessInfo
            ? { idleAtPrompt: livenessInfo.idleAtPrompt, detectedAt: livenessInfo.idleAtPromptDetectedAt }
            : captureAndDetectIdle(session.session, session.agent);
        const idleAtPrompt = idleResult ? Boolean(idleResult.idleAtPrompt) : false;
        const idleAtPromptDetectedAt = idleResult ? (idleResult.detectedAt || idleResult.idleAtPromptDetectedAt || null) : null;
        const idleLadder = autoNudge.computeIdleLadder(absRepoPath, {
            entityType: 'feature',
            entityId: featureId,
            agentId: session.agent,
            role: 'review',
            status: session.status || 'in-progress',
            updatedAt: session.startedAt || new Date().toISOString(),
            flags: {},
            tmuxRunning: true,
            sessionName: session.session,
            idleAtPrompt,
            idleAtPromptDetectedAt,
        });
        return { ...session, idleLadder, idleAtPrompt, idleAtPromptDetectedAt };
    });
}

const COMPLETION_SIGNAL_BY_TASK_TYPE = {
    'do': 'implementation-complete',
    'revise': 'revision-complete',
    'review': 'review-complete',
    'spec-review': 'spec-review-complete',
    'spec-revise': 'spec-review-complete',
    'spec-check': 'spec-review-complete',
};

/** F405: statuses where tmux is up but the agent is not in a completion/idle UI state */
const NON_WORKING_AGENT_STATUSES = new Set([
    'implementation-complete', 'revision-complete', 'research-complete',
    'review-complete', 'spec-review-complete', 'waiting', 'quota-paused',
    'ready', 'feedback-addressed',
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
            let fileUpdatedAt = null;
            let quotaPausedResetAt = null;
            // REGRESSION: workflow dirs use unpadded numeric ids; status files use
            // canonical padded ids — try both (same as agent-status.readAgentStatus).
            for (const cid of agentStatus.candidateIds(featureId)) {
                const statusData = readJsonSafe(path.join(stateDir, `feature-${cid}-${agent}.json`));
                if (statusData) {
                    agentFlags = parseStatusFlags(statusData.flags);
                    hasStatusFile = true;
                    fileStatus = statusData.status || null;
                    fileUpdatedAt = statusData.updatedAt || null;
                    taskType = statusData.taskType || null;
                    if (statusData.quotaPauseMeta && statusData.quotaPauseMeta.resetAt) {
                        quotaPausedResetAt = statusData.quotaPauseMeta.resetAt || null;
                    }
                    if (statusData.awaitingInput && statusData.awaitingInput.message) {
                        awaitingInput = statusData.awaitingInput;
                    }
                    break;
                }
            }

            const row = buildFeatureAgentRow({
                absRepoPath,
                parsed,
                agent,
                status: snapshotStatuses[agent] || 'implementing',
                updatedAt: fileUpdatedAt || updatedAt || new Date().toISOString(),
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
            // Runtime vs slot identity. After a failover, the slot keeps its
            // original id (e.g. cx) but `currentAgentId` becomes the new
            // runtime (e.g. cu). The frontend uses this to render "Cursor (was
            // cx)" instead of staying labelled as the original agent.
            row.runtimeAgentId = snapAgent.currentAgentId != null ? snapAgent.currentAgentId : agent;
            row.previousAgentId = snapAgent.previousAgentId != null ? snapAgent.previousAgentId : null;
            row.tokenExhausted = snapAgent.tokenExhausted ? { source: snapAgent.tokenExhausted.source || null, at: snapAgent.tokenExhausted.at || null } : null;
            row.quotaPausedResetAt = quotaPausedResetAt;
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

function workflowFeatureIdsCovers(workflowFeatureIds, featureId) {
    if (workflowFeatureIds.has(featureId)) return true;
    const raw = String(featureId);
    if (!/^\d+$/.test(raw)) return false;
    const padded = String(parseInt(raw, 10)).padStart(2, '0');
    const unpadded = String(parseInt(raw, 10));
    return workflowFeatureIds.has(padded) || workflowFeatureIds.has(unpadded);
}

function resolveFeatureIdentity(absRepoPath, featureId, manifestsByFeatureId, snapshot, specIndex = null) {
    const manifest = manifestsByFeatureId[featureId] || null;
    const resolvedSpec = featureSpecResolver.resolveFeatureSpec(absRepoPath, featureId, { snapshot, specIndex });
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

/** @typedef {object} WorkflowFeatureScanCtx */

/**
 * Enrich one engine-backed workflow feature for the poll payload.
 * @param {string} featureId
 * @param {WorkflowFeatureScanCtx} scanCtx
 */
function processWorkflowFeatureForPoll(featureId, scanCtx) {
    const {
        absRepoPath,
        manifestsByFeatureId,
        specIndex,
        recentDoneIds,
        logPathsByFeatureId,
        lookupSet,
        features,
        response,
        stateDir,
        worktreeBaseDir,
        devServerEnabled,
        caddyRoutes,
        repoAppId,
    } = scanCtx;
    // REGRESSION: long-lived repos accumulate hundreds of done engine dirs.
    // getFeatureDashboardState reads events/eval/review/tmux per id (~15ms each);
    // calling it for every historical done feature blocked the event loop for
    // 10s+ per poll and made the dashboard unresponsive. Peek lifecycle from
    // the cached snapshot read and skip done rows outside the recent-N window
    // before the expensive read-model pass (F459/F469 lean done invariant).
    const peekSnapshot = workflowSnapshotAdapter.readFeatureSnapshotSync(absRepoPath, featureId);
    if (!peekSnapshot) return;
    const peekStage = workflowSnapshotAdapter.snapshotToStage(peekSnapshot);
    if (!peekStage) return;
    if (peekStage === 'done') {
        if (!recentDoneIds.has(String(featureId))) return;
        const doneIdentity = resolveFeatureIdentity(absRepoPath, featureId, manifestsByFeatureId, peekSnapshot, specIndex);
        const doneSpecPath = doneIdentity.specPath || peekSnapshot.specPath;
        features.push(buildLeanDoneFeatureRow({
            id: featureId,
            name: doneIdentity.name,
            specPath: doneSpecPath,
            updatedAt: peekSnapshot.updatedAt || new Date().toISOString(),
            createdAt: peekSnapshot.createdAt || peekSnapshot.updatedAt || new Date().toISOString(),
            set: lookupSet(featureId, doneSpecPath),
            logPaths: logPathsByFeatureId[featureId] || [],
        }));
        return;
    }
    let initialState;
    try {
        initialState = workflowReadModel.getFeatureDashboardState(absRepoPath, featureId, peekStage, []);
    } catch (e) {
        console.warn(`⚠️  Skipping feature ${featureId} (state error): ${e.message}`);
        return;
    }
    const snapshot = initialState.workflowSnapshot;
    const stage = initialState.stage;
    if (!snapshot || !stage) return;
    const identity = resolveFeatureIdentity(absRepoPath, featureId, manifestsByFeatureId, snapshot, specIndex);
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
    const featureState = workflowReadModel.getFeatureDashboardState(absRepoPath, featureId, stage, agents, { baseState: initialState });
    const autonomousSession = stage !== 'done' ? safeFeatureAutoSessionExists(featureId, absRepoPath) : null;
    agents.forEach(agent => {
        const isDerivedReviewState = RUNTIME_TASK_FILE_STATUSES.has(agent.status);
        if (featureState.snapshotStatuses[agent.id] && !isDerivedReviewState && agent.status !== 'quota-paused') {
            agent.status = featureState.snapshotStatuses[agent.id];
        }
        response.summary.total++;
        if (['implementation-complete', 'revision-complete', 'research-complete', 'review-complete', 'spec-review-complete'].includes(agent.status)) {
            response.summary.complete = (response.summary.complete || 0) + 1;
        } else {
            response.summary[agent.status] = (response.summary[agent.status] || 0) + 1;
        }
    });

    const enrichedReviewSessions = enrichReviewSessionsWithLiveness(absRepoPath, featureId, featureState.reviewSessions);
    const startupReadiness = featureState.startupReadiness || null;
    const agentsAreWorking = agents.some(a =>
        a.status === 'implementing' || a.status === 'idle'
        || a.status === 'implementation-complete' || a.status === 'revision-complete'
        || a.status === 'addressing-code-review' || a.status === 'reviewing'
        || a.status === 'review-complete' || a.status === 'research-complete'
        || a.status === 'spec-review-complete' || a.status === 'quota-paused'
    );
    const startupPhase = startupReadiness
        && stage === 'in-progress'
        && (
            startupReadiness.phase === 'agents_booting'
            || startupReadiness.phase === 'agents_partially_booted'
            || (startupReadiness.phase === 'agents_active' && !agentsAreWorking)
        )
        ? startupReadiness.phaseLabel
        : null;
    const detailFingerprint = buildDetailFingerprint(
        snapshot.updatedAt,
        safeStatMtimeMs(identity.specPath || snapshot.specPath),
        (featureState.workflowEvents || []).length,
        startupReadiness,
        summarizeReviewSessions(enrichedReviewSessions),
        featureState.autonomousPlan && featureState.autonomousPlan.updatedAt
    );

    features.push({
        id: featureId,
        displayKey: buildEntityDisplayKey('feature', featureId),
        name: identity.name,
        stage,
        complexity: readComplexityFromSpec(identity.specPath || snapshot.specPath),
        set: lookupSet(featureId, identity.specPath || snapshot.specPath),
        ...buildProvenanceFields(snapshot, identity.specPath || snapshot.specPath),
        specPath: identity.specPath || snapshot.specPath,
        updatedAt: snapshot.updatedAt || new Date().toISOString(),
        createdAt: snapshot.createdAt || snapshot.updatedAt || new Date().toISOString(),
        evalStatus: featureState.evalStatus,
        winnerAgent: featureState.winnerAgent,
        evalPath: featureState.evalPath,
        evalSession: featureState.evalSession,
        reviewStatus: featureState.reviewStatus,
        reviewSessionSummary: summarizeReviewSessions(enrichedReviewSessions),
        specReviewSessions: featureState.specReviewSessions,
        specRevisionSessions: featureState.specRevisionSessions,
        specCheckSessions: featureState.specCheckSessions,
        autonomousPlanSummary: featureState.autonomousPlan ? {
            status: featureState.autonomousPlan.status || null,
            currentStage: featureState.autonomousPlan.currentStage || null,
            error: featureState.autonomousPlan.error ? { message: featureState.autonomousPlan.error.message || String(featureState.autonomousPlan.error) } : null,
        } : null,
        autonomousPlan: featureState.autonomousPlan ? {
            mode: featureState.autonomousPlan.mode || null,
            workflowSlug: featureState.autonomousPlan.workflowSlug || null,
            error: featureState.autonomousPlan.error ? { message: featureState.autonomousPlan.error.message || String(featureState.autonomousPlan.error) } : null,
            stages: Array.isArray(featureState.autonomousPlan.stages)
                ? featureState.autonomousPlan.stages.map(s => ({
                    key: s.key,
                    type: s.type,
                    label: s.label,
                    status: s.status,
                    agents: Array.isArray(s.agents) ? s.agents.slice() : [],
                }))
                : [],
        } : null,
        autonomousController: featureState.autonomousController || null,
        agents,
        anyAwaitingInput: agents.some(a => a.awaitingInput && a.awaitingInput.message),
        anyIdleAtPrompt: agents.some(a => a.idleAtPrompt === true),
        startupReadiness,
        startupPhase,
        pending: [],
        nextAction: featureState.nextAction,
        nextActions: featureState.nextActions,
        validActions: featureState.validActions,
        specDrift: featureState.specDrift,
        workflowEventCount: Array.isArray(featureState.workflowEvents) ? featureState.workflowEvents.length : 0,
        detailFingerprint,
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
        cardHeadline: computeCardHeadline(
            {
                ...featureState,
                lastCloseFailure: snapshot.lastCloseFailure || null,
                evalStatus: featureState.evalStatus,
                winnerAgent: featureState.winnerAgent,
                updatedAt: snapshot.updatedAt || null,
            },
            snapshot,
            agents,
            featureState.autonomousPlan,
            stage,
            { entityType: 'feature' }
        ),
        reviewCycles: Array.isArray(snapshot.reviewCycles) ? snapshot.reviewCycles : [],
        mode: snapshot.mode || null,
        driveToolAgentId: (snapshot.mode === 'solo_branch' && agents.length === 1 && agents[0].id === 'solo')
            ? resolveDriveBranchToolAgentId(featureId, absRepoPath)
            : null,
    });
}

async function scanWorkflowFeaturesForPoll(sortedWorkflowIds, scanCtx, yieldEvery = 6) {
    for (let wi = 0; wi < sortedWorkflowIds.length; wi++) {
        if (yieldEvery > 0 && wi > 0 && wi % yieldEvery === 0) {
            await new Promise(resolve => setImmediate(resolve));
        }
        try {
            processWorkflowFeatureForPoll(sortedWorkflowIds[wi], scanCtx);
        } catch (error) {
            console.warn(`⚠️  Skipping feature ${sortedWorkflowIds[wi]} (collector error): ${error.message}`);
        }
    }
}

function collectFeatures(repoContext, response) {
    const {
        absRepoPath,
        stateDir,
        devServerEnabled,
        caddyRoutes,
        repoAppId,
        includeAllFeatures = false,
    } = repoContext;
    const inboxDir = path.join(absRepoPath, 'docs', 'specs', 'features', STAGE_FOLDERS.INBOX);
    const backlogDir = path.join(absRepoPath, 'docs', 'specs', 'features', STAGE_FOLDERS.BACKLOG);
    const pausedDir = path.join(absRepoPath, 'docs', 'specs', 'features', STAGE_FOLDERS.PAUSED);
    const doneDir = path.join(absRepoPath, 'docs', 'specs', 'features', STAGE_FOLDERS.DONE);
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
        { dir: path.join(absRepoPath, 'docs', 'specs', 'features', STAGE_FOLDERS.IN_PROGRESS), stage: 'in-progress', pattern: /^feature-\d+-.+\.md$/ },
        { dir: path.join(absRepoPath, 'docs', 'specs', 'features', STAGE_FOLDERS.IN_EVALUATION), stage: 'in-evaluation', pattern: /^feature-\d+-.+\.md$/ },
        ]),
        ...tierCache.warm.paused,
    ];

    const doneDirMtime = safeStat(doneDir)?.mtimeMs || 0;
    if (doneDirMtime !== tierCache.cold.featuresDirMtime) {
        tierCache.cold.featuresDirMtime = doneDirMtime;
        // F590: 10 → 15. The poll payload ships at most this many recent done
        // features per repo (numeric-id-descending), comfortably above
        // DONE_CAP=6 so the kanban done column always has enough cards.
        tierCache.cold.features = collectDoneSpecs(doneDir, /^feature-\d+-.+\.md$/, 15, { entityType: 'feature' });
        tierCache.cold.doneTotal = tierCache.cold.features.total;
    }
    const doneSpecs = tierCache.cold.features;
    doneSpecs.recent.forEach(({ file }) => specFiles.push({ file, stage: 'done', dir: doneDir }));

    // F590: the set of done ids inside the recent-N window. Engine-backed done
    // features outside this window are omitted from the poll payload entirely
    // (not enriched) — they remain reachable via /api/repos/all-features.
    const recentDoneIds = new Set();
    doneSpecs.recent.forEach(({ file }) => {
        const parsed = parseFeatureSpecFileName(file);
        if (parsed && parsed.id) recentDoneIds.add(String(parsed.id));
    });

    // F590: log paths indexed per feature id — built up-front so lean done rows
    // in `features` can carry `logPaths` (previously computed only for allFeatures).
    const logPathsByFeatureId = {};
    safeReadDir(mainLogsDir, file => /^feature-\d+-.+-log\.md$/.test(file) && !fs.lstatSync(path.join(mainLogsDir, file)).isDirectory())
        .forEach(file => {
            const match = file.match(/^feature-(\d+)-/);
            if (!match) return;
            if (!logPathsByFeatureId[match[1]]) logPathsByFeatureId[match[1]] = [];
            logPathsByFeatureId[match[1]].push(path.join(mainLogsDir, file));
        });

    const manifestsByFeatureId = readFeatureManifests(stateDir);
    const workflowFeatureIds = new Set(listWorkflowFeatureIds(absRepoPath));
    const features = [];
    // Build the set membership index once per repo pass. Key lookups below:
    //   setByFeatureId : paddedId / slug (inbox) → setSlug
    //   setBySpecPath  : absolute spec path       → setSlug
    // specPath lookups cover renames between stages where the id/slug may have
    // changed but the underlying file is the same.
    const featureSetPaths = featureSets.featurePathsForRepo(absRepoPath);
    const specIndex = dashboardSpecIndex.getRepoSpecIndex(absRepoPath);
    const setIndex = featureSets.scanFeatureSets(featureSetPaths, specIndex);
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

    const sortedWorkflowIds = [...workflowFeatureIds].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const workflowScanCtx = {
        absRepoPath,
        manifestsByFeatureId,
        specIndex,
        recentDoneIds,
        logPathsByFeatureId,
        lookupSet,
        features,
        response,
        stateDir,
        worktreeBaseDir,
        devServerEnabled,
        caddyRoutes,
        repoAppId,
    };
    const finalizeFeatureCollect = () => {
    specFiles.forEach(({ file: specFile, stage, dir: specDir }) => {
        const parsed = parseFeatureSpecFileName(specFile);
        if (!parsed) return;
        // Inbox features have no numeric ID — use name as identifier
        const featureId = parsed.id || parsed.name;
        if (workflowFeatureIdsCovers(workflowFeatureIds, featureId)) return;
        const specPath = path.join(specDir, specFile);
        const { updatedAt: fallbackUpdatedAt, createdAt } = safeStatIsoTimes(specPath);
        // F590: folder-only done features (no engine dir) get the lean shape too —
        // no getFeatureDashboardState read, no heavy fields. specFiles already
        // bounds done entries to the recent-N window.
        if (stage === 'done') {
            features.push(buildLeanDoneFeatureRow({
                id: featureId,
                name: parsed.name,
                specPath,
                updatedAt: fallbackUpdatedAt,
                createdAt,
                set: lookupSet(featureId, specPath),
                logPaths: logPathsByFeatureId[featureId] || [],
            }));
            return;
        }
        let featureState;
        try {
            featureState = workflowReadModel.getFeatureDashboardState(absRepoPath, featureId, stage, []);
        } catch (e) {
            console.warn(`⚠️  Skipping feature ${featureId} (state error): ${e.message}`);
            return;
        }
        const autonomousSession = featureState.stage !== 'done' && /^\d+$/.test(String(featureId)) ? safeFeatureAutoSessionExists(featureId, absRepoPath) : null;
        const fallbackReviewSessions = enrichReviewSessionsWithLiveness(absRepoPath, featureId, featureState.reviewSessions);
        const fallbackDetailFingerprint = buildDetailFingerprint(
            fallbackUpdatedAt,
            safeStatMtimeMs(specPath),
            (featureState.workflowEvents || []).length,
            summarizeReviewSessions(fallbackReviewSessions),
            featureState.autonomousPlan && featureState.autonomousPlan.updatedAt
        );
        features.push({
            id: featureId,
            displayKey: buildEntityDisplayKey('feature', featureId),
            name: parsed.name,
            stage: featureState.stage,
            complexity: readComplexityFromSpec(specPath),
            set: lookupSet(featureId, specPath),
            ...buildProvenanceFields(featureState.workflowSnapshot, specPath),
            specPath,
            updatedAt: fallbackUpdatedAt,
            createdAt,
            evalStatus: featureState.evalStatus,
            winnerAgent: featureState.winnerAgent,
            evalPath: featureState.evalPath,
            evalSession: featureState.evalSession,
            reviewStatus: featureState.reviewStatus,
            reviewSessionSummary: summarizeReviewSessions(fallbackReviewSessions),
            specReviewSessions: featureState.specReviewSessions,
            specRevisionSessions: featureState.specRevisionSessions,
            specCheckSessions: featureState.specCheckSessions,
            autonomousPlanSummary: featureState.autonomousPlan ? {
                status: featureState.autonomousPlan.status || null,
                currentStage: featureState.autonomousPlan.currentStage || null,
                error: featureState.autonomousPlan.error ? { message: featureState.autonomousPlan.error.message || String(featureState.autonomousPlan.error) } : null,
            } : null,
            agents: [],
            pending: [],
            nextAction: featureState.nextAction,
            nextActions: featureState.nextActions,
            validActions: featureState.validActions,
            specDrift: featureState.specDrift,
            workflowEventCount: Array.isArray(featureState.workflowEvents) ? featureState.workflowEvents.length : 0,
            detailFingerprint: fallbackDetailFingerprint,
            autonomousSession,
            autonomousController: featureState.autonomousController || null,
            nudges: featureState.nudges || [],
            lastCloseFailure: (featureState.workflowSnapshot && featureState.workflowSnapshot.lastCloseFailure) || null,
            stateRenderMeta: getStateRenderMeta(featureState.workflowSnapshot && (featureState.workflowSnapshot.currentSpecState || featureState.workflowSnapshot.lifecycle)),
            cardHeadline: computeCardHeadline(
                {
                    ...featureState,
                    lastCloseFailure: (featureState.workflowSnapshot && featureState.workflowSnapshot.lastCloseFailure) || null,
                    blockedBy: undefined, // backlog blockedBy is annotated below; recomputed there
                },
                featureState.workflowSnapshot || null,
                [],
                featureState.autonomousPlan,
                featureState.stage,
                { entityType: 'feature' }
            ),
            reviewCycles: Array.isArray(featureState.workflowSnapshot && featureState.workflowSnapshot.reviewCycles) ? featureState.workflowSnapshot.reviewCycles : [],
        });
    });

    // F590: logPathsByFeatureId is computed up-front (before the enrichment
    // loops) so lean done rows in `features` already carry logPaths.

    // F590: the full uncapped lean list (F67) is built only for the on-demand
    // GET /api/repos/all-features path — skip on the hot poll pass.
    let allFeatures;
    if (includeAllFeatures) {
        const seenIds = new Set(features.map(feature => String(feature.id)).filter(Boolean));
        const extraDone = doneSpecs.all
            .filter(({ file }) => {
                const parsed = parseFeatureSpecFileName(file);
                return parsed && parsed.id && !seenIds.has(String(parsed.id));
            })
            .map(({ file }) => {
                const parsed = parseFeatureSpecFileName(file);
                const specPath = path.join(doneDir, file);
                const { updatedAt, createdAt } = safeStatIsoTimes(specPath);
                return buildLeanDoneFeatureRow({
                    id: parsed.id,
                    name: parsed.name,
                    specPath,
                    updatedAt,
                    createdAt,
                    set: lookupSet(parsed.id, specPath),
                    logPaths: logPathsByFeatureId[parsed.id] || [],
                });
            });
        allFeatures = [
            ...features.map(feature => ({
                id: feature.id,
                displayKey: feature.displayKey || buildEntityDisplayKey('feature', feature.id),
                name: feature.name,
                stage: feature.stage,
                specPath: feature.specPath,
                updatedAt: feature.updatedAt,
                createdAt: feature.createdAt,
                logPaths: logPathsByFeatureId[feature.id] || [],
            })),
            ...extraDone,
        ];
    }

    // Annotate backlog features with blockedBy (unmet dependencies).
    // F517: project the blocked facet from the canonical entity view instead of
    // mapping checkUnmetDependencies output by hand here. `includeSessions:false`
    // keeps this off the session-enumeration path; `specPath` is reused so the
    // view does no spec resolution. blockedBy is backlog-only — not a hot path.
    const featurePaths = {
        root: path.join(absRepoPath, 'docs', 'specs', 'features'),
        folders: [STAGE_FOLDERS.INBOX, STAGE_FOLDERS.BACKLOG, STAGE_FOLDERS.IN_PROGRESS, STAGE_FOLDERS.IN_EVALUATION, STAGE_FOLDERS.DONE, STAGE_FOLDERS.PAUSED],
        repoPath: absRepoPath,
    };
    features.forEach(feature => {
        if (feature.stage !== 'backlog' || !feature.specPath) return;
        const blockedView = buildEntityView(absRepoPath, 'feature', feature.id, {
            specPath: feature.specPath,
            folderFallback: STAGE_FOLDERS.BACKLOG,
            featurePaths,
            includeSessions: false,
        });
        if (blockedView.blocked) {
            feature.blockedBy = blockedView.blockedBy;
            // Recompute headline now that blockedBy is known.
            feature.cardHeadline = computeCardHeadline(
                feature,
                feature.workflowSnapshot || null,
                feature.agents || [],
                feature.autonomousPlan,
                feature.stage,
                { entityType: 'feature' }
            );
        }
    });

    // Sets rollup: derived entirely from member stage, no new files written.
    // Exposed on the repo payload so the dashboard can offer "group by set".
    const sets = featureSets.summarizeSets(featureSetPaths, specIndex)
        .filter(s => !s.isComplete)
        .map(s => ({
            ...s,
            ...buildSetDashboardCard(absRepoPath, s, featureSetPaths, specIndex),
        }));

    return {
        features,
        ...(includeAllFeatures ? { allFeatures } : {}),
        doneTotal: tierCache.cold.doneTotal,
        sets,
    };
    };

    if (repoContext.yieldDuringWorkflowScan) {
        return scanWorkflowFeaturesForPoll(sortedWorkflowIds, workflowScanCtx).then(finalizeFeatureCollect);
    }

    for (let wi = 0; wi < sortedWorkflowIds.length; wi++) {
        try {
            processWorkflowFeatureForPoll(sortedWorkflowIds[wi], workflowScanCtx);
        } catch (error) {
            console.warn(`⚠️  Skipping feature ${sortedWorkflowIds[wi]} (collector error): ${error.message}`);
        }
    }
    return finalizeFeatureCollect();
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
        { dir: path.join(researchRoot, STAGE_FOLDERS.INBOX), stage: 'inbox', pattern: /^research-.+\.md$/ },
        { dir: path.join(researchRoot, STAGE_FOLDERS.BACKLOG), stage: 'backlog', pattern: /^research-\d+-.+\.md$/ },
        { dir: path.join(researchRoot, STAGE_FOLDERS.IN_PROGRESS), stage: 'in-progress', pattern: /^research-\d+-.+\.md$/ },
        { dir: path.join(researchRoot, STAGE_FOLDERS.IN_EVALUATION), stage: 'in-evaluation', pattern: /^research-\d+-.+\.md$/ },
        { dir: path.join(researchRoot, STAGE_FOLDERS.PAUSED), stage: 'paused', pattern: /^research-\d+-.+\.md$/ },
    ]);

    const researchDoneDir = path.join(researchRoot, STAGE_FOLDERS.DONE);
    const doneDirMtime = safeStat(researchDoneDir)?.mtimeMs || 0;
    if (doneDirMtime !== tierCache.cold.researchDirMtime) {
        tierCache.cold.researchDirMtime = doneDirMtime;
        tierCache.cold.research = collectDoneSpecs(researchDoneDir, /^research-\d+-.+\.md$/, 10, { entityType: 'research' });
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
                let quotaPausedResetAt = null;

                try {
                    if (fs.existsSync(statusFile)) {
                        const parsedStatus = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
                        normalizedUpdatedAt = parsedStatus.updatedAt || normalizedUpdatedAt;
                        agentFlags = parseStatusFlags(parsedStatus.flags);
                        hasStatusFile = true;
                        if (parsedStatus.awaitingInput && parsedStatus.awaitingInput.message) {
                            awaitingInput = parsedStatus.awaitingInput;
                        }
                        if (parsedStatus.quotaPauseMeta && parsedStatus.quotaPauseMeta.resetAt) {
                            quotaPausedResetAt = parsedStatus.quotaPauseMeta.resetAt || null;
                        }
                        const fileNorm = normalizeDashboardStatus(parsedStatus.status);
                        if (RUNTIME_TASK_FILE_STATUSES.has(fileNorm)) {
                            normalizedStatus = fileNorm;
                        } else {
                            normalizedStatus = snapshotStatuses[agent] || fileNorm;
                        }
                    } else {
                        normalizedStatus = snapshotStatuses[agent] || 'implementing';
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
                const displayStatus = normalizedStatus === 'quota-paused' ? 'quota-paused' : flagged.status;
                const findingsFile = path.join(researchLogsDir, `research-${id}-${agent}-findings.md`);
                const RESEARCH_DONE_STATUSES = new Set(['research-complete', 'ready', 'submitted', 'implementation-complete', 'revision-complete', 'feedback-addressed']);
                const canViewFindings = RESEARCH_DONE_STATUSES.has(flagged.status) || Boolean(flagged.flags && flagged.flags.sessionEnded);
                const researchLiveness = getAgentLiveness(absRepoPath, 'research', id, agent);
                const idleLadder = autoNudge.computeIdleLadder(absRepoPath, {
                    entityType: 'research',
                    entityId: id,
                    agentId: agent,
                    role: 'do',
                    status: displayStatus,
                    updatedAt: normalizedUpdatedAt,
                    flags: flagged.flags,
                    tmuxRunning,
                    sessionName,
                    idleAtPrompt: researchLiveness ? Boolean(researchLiveness.idleAtPrompt) : false,
                    idleAtPromptDetectedAt: researchLiveness ? researchLiveness.idleAtPromptDetectedAt : null,
                });
                const researchSnapshotStatus = snapshotStatuses[agent] || null;
                // F405: escape hatch for research agents — all research agents have role 'do'
                const researchPendingSignal = hasStatusFile
                    ? computePendingCompletionSignal(displayStatus, null, 'do', researchSnapshotStatus, 'research')
                    : null;
                if (hasStatusFile) {
                    signalHealth.recordMissedSignalIfDue({
                        repoPath: absRepoPath,
                        entityType: 'research',
                        entityId: id,
                        agent,
                        lastStatus: displayStatus,
                        lastStatusAt: normalizedUpdatedAt,
                        sessionName,
                        expected: `advance-from-${displayStatus}`,
                    });
                }
                const snapResearchAgent = snapshot && snapshot.agents && snapshot.agents[agent]
                    ? snapshot.agents[agent]
                    : null;
                agents.push({
                    id: agent,
                    status: displayStatus,
                    updatedAt: normalizedUpdatedAt,
                    flags: flagged.flags,
                    liveness: researchLiveness ? researchLiveness.liveness : null,
                    lastSeenAt: researchLiveness ? researchLiveness.lastSeenAt : null,
                    heartbeatAgeMs: researchLiveness ? researchLiveness.heartbeatAgeMs : null,
                    idleState: researchLiveness ? (researchLiveness.idleState || null) : null,
                    idleAtPrompt: researchLiveness ? Boolean(researchLiveness.idleAtPrompt) : false,
                    idleAtPromptDetectedAt: researchLiveness ? (researchLiveness.idleAtPromptDetectedAt || null) : null,
                    idleLadder,
                    findingsPath: canViewFindings ? findingsFile : null,
                    slashCommand: displayStatus === 'waiting' ? `aigon terminal-focus ${String(id).padStart(2, '0')} ${agent} --research` : null,
                    tmuxSession: tmuxRunning ? sessionName : null,
                    tmuxRunning,
                    attachCommand: tmuxRunning ? `tmux attach -t ${sessionName}` : null,
                    awaitingInput,
                    pendingCompletionSignal: researchPendingSignal,
                    isWorking: tmuxRunning && !NON_WORKING_AGENT_STATUSES.has(displayStatus),
                    modelOverride: snapResearchAgent && snapResearchAgent.modelOverride != null ? snapResearchAgent.modelOverride : null,
                    effortOverride: snapResearchAgent && snapResearchAgent.effortOverride != null ? snapResearchAgent.effortOverride : null,
                    quotaPausedResetAt,
                });
                response.summary.total++;
                if (['implementation-complete', 'revision-complete', 'research-complete', 'review-complete', 'spec-review-complete'].includes(displayStatus)) {
                    response.summary.complete = (response.summary.complete || 0) + 1;
                } else {
                    response.summary[displayStatus] = (response.summary[displayStatus] || 0) + 1;
                }
            });
        }

        // F460: reuse the baseState resolved by the empty-agents call above to
        // skip a duplicate snapshot+events read for the agent-aware pass.
        const researchState = workflowReadModel.getResearchDashboardState(absRepoPath, id || name, effectiveStage, agents, { baseState: initialResearchState });

        const researchReviewSummary = summarizeReviewSessions(researchState.reviewSessions);
        const researchSpecPath = path.join(specDir, file);
        const researchTimes = snapshot
            ? {
                updatedAt: snapshot.updatedAt || new Date().toISOString(),
                createdAt: snapshot.createdAt || snapshot.updatedAt || new Date().toISOString(),
            }
            : safeStatIsoTimes(researchSpecPath);
        research.push({
            id: id || name,
            displayKey: buildEntityDisplayKey('research', id),
            name,
            stage: effectiveStage,
            complexity: readComplexityFromSpec(researchSpecPath),
            ...buildProvenanceFields(snapshot, researchSpecPath),
            specPath: researchSpecPath,
            updatedAt: researchTimes.updatedAt,
            createdAt: researchTimes.createdAt,
            agents,
            anyAwaitingInput: agents.some(a => a.awaitingInput && a.awaitingInput.message),
            anyIdleAtPrompt: agents.some(a => a.idleAtPrompt === true),
            evalStatus: researchState.evalStatus,
            evalSession: researchState.evalSession,
            reviewStatus: researchState.reviewStatus,
            reviewSessionSummary: researchReviewSummary,
            specReviewSessions: researchState.specReviewSessions,
            specRevisionSessions: researchState.specRevisionSessions,
            specCheckSessions: researchState.specCheckSessions,
            reviewState: researchState.reviewState,
            validActions: researchState.validActions,
            nextAction: researchState.nextAction,
            nextActions: researchState.nextActions,
            specDrift: researchState.specDrift,
            workflowEventCount: Array.isArray(researchState.workflowEvents) ? researchState.workflowEvents.length : 0,
            detailFingerprint: buildDetailFingerprint(
                researchTimes.updatedAt,
                safeStatMtimeMs(researchSpecPath),
                (researchState.workflowEvents || []).length,
                researchReviewSummary
            ),
            stateRenderMeta: getStateRenderMeta(snapshot && (snapshot.currentSpecState || snapshot.lifecycle)),
            cardHeadline: computeCardHeadline(
                {
                    evalStatus: researchState.evalStatus,
                    specDrift: researchState.specDrift,
                },
                snapshot || null,
                agents,
                null,
                effectiveStage,
                { entityType: 'research' }
            ),
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
            validActions: stateMachine.getAvailableActions('feedback', stage, feedbackSmContext),
            cardHeadline: computeCardHeadline({}, null, [], null, stage, { entityType: 'feedback' })
        });
    });

    return {
        feedback,
        feedbackDoneTotal: items.filter(item => (feedbackLib.normalizeFeedbackStatus(item.metadata.status) || 'inbox') === 'done').length,
    };
}

function nowMs() {
    return Number(process.hrtime.bigint()) / 1e6;
}

function beginCollectRepoStatus(absRepoPath, options = {}) {
    const perfEnabled = options.collectPerf === true;
    const perfStart = perfEnabled ? nowMs() : 0;
    const perfSteps = [];
    const markPerf = perfEnabled
        ? (step, startMs) => { perfSteps.push({ step, ms: Math.round((nowMs() - startMs) * 100) / 100 }); }
        : null;
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
    const caddyRoutes = devServerEnabled
        ? probeTtlCache.getOrCompute(
            `caddy-routes:${absRepoPath}`,
            PROBE_TTLS_MS.caddyRoutes,
            () => parseCaddyRoutes()
        )
        : [];
    const mainDevServer = getDevServerState(caddyRoutes, repoAppId, '');
    const stateDir = path.join(absRepoPath, '.aigon', 'state');
    const repoContext = { absRepoPath, stateDir, devServerEnabled, caddyRoutes, repoAppId };

    return {
        perfEnabled,
        perfStart,
        perfSteps,
        markPerf,
        devServerEnabled,
        mainDevServer,
        repoContext,
    };
}

function assembleRepoStatusAfterFeatures(absRepoPath, response, options, assemblyCtx) {
    const {
        featureStatus,
        repoContext,
        perfEnabled,
        perfStart,
        perfSteps,
        markPerf,
        devServerEnabled,
        mainDevServer,
    } = assemblyCtx;
    let t = perfEnabled ? nowMs() : 0;
    const researchStatus = collectResearch(repoContext, response);
    if (markPerf) markPerf('research', t);
    try {
        const { getPro } = require('./pro');
        const pro = getPro();
        const buildPendingScheduleIndex = pro && pro.scheduledKickoff && pro.scheduledKickoff.buildPendingScheduleIndex;
        if (typeof buildPendingScheduleIndex !== 'function') throw new Error('no-pro-scheduler');
        const schedIdx = probeTtlCache.getOrCompute(
            `schedule-index:${absRepoPath}`,
            PROBE_TTLS_MS.scheduleIndex,
            () => buildPendingScheduleIndex(absRepoPath)
        );
        (featureStatus.features || []).forEach((f) => {
            const hit = schedIdx.lookupFeature(f.id);
            if (hit) applyPendingScheduleMetadata(f, hit);
        });
        (researchStatus.research || []).forEach((r) => {
            const hit = schedIdx.lookupResearch(r.id);
            if (hit) applyPendingScheduleMetadata(r, hit);
        });
        if (typeof schedIdx.lookupSet === 'function') {
            (featureStatus.sets || []).forEach((set) => {
                const hit = schedIdx.lookupSet(set.slug);
                if (hit) applyPendingScheduleMetadata(set, hit, 'set_autonomous');
            });
        }
    } catch (_) { /* non-fatal: schedule store optional */ }
    t = perfEnabled ? nowMs() : 0;
    applySpecReviewFromSnapshots(absRepoPath, [
        ...featureStatus.features.map(item => ({ item, entityType: 'feature' })),
        ...researchStatus.research.map(item => ({ item, entityType: 'research' })),
    ]);
    if (markPerf) markPerf('spec-review-snapshots', t);
    t = perfEnabled ? nowMs() : 0;
    const feedbackStatus = collectFeedback(absRepoPath);
    if (markPerf) markPerf('feedback', t);
    const tierCache = getTierCache(absRepoPath);
    t = perfEnabled ? nowMs() : 0;
    tierCache.cold.githubRemote = probeTtlCache.getOrCompute(
        `github-remote:${absRepoPath}`,
        PROBE_TTLS_MS.gitRemote,
        () => {
            let ghEnabled = detectGitHubRemote(absRepoPath);
            if (ghEnabled) {
                try {
                    const projectCfg = JSON.parse(require('fs').readFileSync(getProjectConfigPath(absRepoPath), 'utf8'));
                    if (projectCfg && projectCfg.github && projectCfg.github.prCheck === false) ghEnabled = false;
                } catch (_) { /* no project config — keep auto-detected value */ }
            }
            return ghEnabled;
        }
    );
    if (markPerf) markPerf('github-remote', t);

    const storage = probeTtlCache.getOrCompute(
        `storage-status:${absRepoPath}`,
        PROBE_TTLS_MS.storageStatus,
        () => buildRepoStorageStatus(absRepoPath),
    );
    attachActiveLeasesToEntities(absRepoPath, featureStatus.features, 'feature');
    attachActiveLeasesToEntities(absRepoPath, researchStatus.research, 'research');

    const result = {
        path: absRepoPath,
        displayPath: absRepoPath.replace(os.homedir(), '~'),
        name: path.basename(absRepoPath),
        githubRemote: tierCache.cold.githubRemote,
        storage,
        validActions: buildRepoStorageActions(storage),
        ...featureStatus,
        ...researchStatus,
        ...feedbackStatus,
        mainDevServerEligible: Boolean(devServerEnabled),
        mainDevServerRunning: mainDevServer.running,
        mainDevServerUrl: mainDevServer.url
    };
    if (perfEnabled) {
        result._perf = {
            name: result.name,
            totalMs: Math.round((nowMs() - perfStart) * 100) / 100,
            steps: perfSteps,
            featureCount: (featureStatus.features || []).length,
            researchCount: (researchStatus.research || []).length,
        };
    }
    return result;
}

function collectRepoStatus(absRepoPath, response, options = {}) {
    const begin = beginCollectRepoStatus(absRepoPath, options);
    if (!begin) return null;

    let t = begin.perfEnabled ? nowMs() : 0;
    const featureStatus = collectFeatures(begin.repoContext, response);
    if (begin.markPerf) begin.markPerf('features', t);
    return assembleRepoStatusAfterFeatures(absRepoPath, response, options, {
        ...begin,
        featureStatus,
    });
}

async function collectRepoStatusAsync(absRepoPath, response, options = {}) {
    const begin = beginCollectRepoStatus(absRepoPath, options);
    if (!begin) return null;

    let t = begin.perfEnabled ? nowMs() : 0;
    const featureStatus = await collectFeatures(
        { ...begin.repoContext, yieldDuringWorkflowScan: true },
        response
    );
    if (begin.markPerf) begin.markPerf('features', t);
    return assembleRepoStatusAfterFeatures(absRepoPath, response, options, {
        ...begin,
        featureStatus,
    });
}

// F590: full uncapped lean feature list for a single repo (F67 contract),
// served on demand to the All Items / Logs view via GET /api/repos/all-features.
// Reuses collectFeatures' allFeatures construction with a throwaway response so
// the lean shape stays identical to what the kanban poll path produces.
function collectAllFeaturesLean(absRepoPath) {
    if (!fs.existsSync(absRepoPath)) return [];
    const stateDir = path.join(absRepoPath, '.aigon', 'state');
    // devServer probing is irrelevant to the lean list — force it off so this
    // on-demand path never touches caddy/port probes.
    const repoContext = {
        absRepoPath,
        stateDir,
        devServerEnabled: false,
        caddyRoutes: [],
        repoAppId: getAppId(absRepoPath),
        includeAllFeatures: true,
    };
    const throwaway = { summary: { implementing: 0, waiting: 0, complete: 0, error: 0, total: 0 } };
    const featureStatus = collectFeatures(repoContext, throwaway);
    return featureStatus.allFeatures || [];
}

// Kick off a background npm registry check so subsequent poll cycles
// see a warm cache without blocking the first status response.
let _npmCheckScheduled = false;
function scheduleNpmUpdateCheck() {
    if (_npmCheckScheduled) return;
    _npmCheckScheduled = true;
    checkForUpdate().catch(() => {}).finally(() => { _npmCheckScheduled = false; });
}

function collectDashboardStatusData(options = {}) {
    const perfEnabled = options.collectPerf === true;
    const perfStart = perfEnabled ? nowMs() : 0;
    const response = {
        generatedAt: new Date().toISOString(),
        repos: [],
        summary: { implementing: 0, waiting: 0, complete: 0, error: 0, total: 0 },
        proAvailable: isProAvailable(),
        proStatus: getProStatus(),
        updateCheck: getCachedUpdateCheck(),
    };

    readDashboardPollRepos().forEach(repoPath => {
        const repoStatus = collectRepoStatus(path.resolve(repoPath), response, options);
        if (!repoStatus) return;
        if (perfEnabled && repoStatus._perf) {
            if (!response._perf) response._perf = { totalMs: 0, repos: [] };
            response._perf.repos.push(repoStatus._perf);
            delete repoStatus._perf;
        }
        response.repos.push(repoStatus);
    });

    // Refresh npm check in the background so the next poll cycle has fresh data
    scheduleNpmUpdateCheck();
    if (perfEnabled) {
        response._perf = response._perf || { repos: [] };
        response._perf.totalMs = Math.round((nowMs() - perfStart) * 100) / 100;
    }

    return response;
}

// F471: async variant that yields the event loop between repo scans via
// setImmediate. Used by the background poll path so /api/action POSTs aren't
// blocked behind a 750ms+ synchronous collection. Each per-repo chunk stays
// ≤~160ms, allowing HTTP requests to be processed between yields.
async function collectDashboardStatusDataAsync(options = {}) {
    const perfEnabled = options.collectPerf === true;
    const perfStart = perfEnabled ? nowMs() : 0;
    const response = {
        generatedAt: new Date().toISOString(),
        repos: [],
        summary: { implementing: 0, waiting: 0, complete: 0, error: 0, total: 0 },
        proAvailable: isProAvailable(),
        proStatus: getProStatus(),
        updateCheck: getCachedUpdateCheck(),
    };

    const repoPaths = readDashboardPollRepos();
    for (const repoPath of repoPaths) {
        await new Promise(resolve => setImmediate(resolve));
        const repoStatus = await collectRepoStatusAsync(path.resolve(repoPath), response, options);
        if (!repoStatus) continue;
        if (perfEnabled && repoStatus._perf) {
            if (!response._perf) response._perf = { totalMs: 0, repos: [] };
            response._perf.repos.push(repoStatus._perf);
            delete repoStatus._perf;
        }
        response.repos.push(repoStatus);
    }

    scheduleNpmUpdateCheck();
    if (perfEnabled) {
        response._perf = response._perf || { repos: [] };
        response._perf.totalMs = Math.round((nowMs() - perfStart) * 100) / 100;
    }

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
    if (candidates.length === 0 && entityType === 'feature' && options.allowAgentlessFallback === true) {
        logsDirs.forEach(dir => {
            safeReadDir(dir)
                .filter(file => isAgentlessFeatureLogFile(file, entityId))
                .forEach(file => candidates.push(path.join(dir, file)));
        });
    }
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

    const logs = collectAgentLogs(logsDirs, featureId, expectedLogs);
    const knownAgentIds = Object.keys(agentFiles || {}).filter(id => id && id !== 'solo');
    const implementerId = knownAgentIds[0];
    if (logs.solo && knownAgentIds.length === 1 && (!logs[implementerId] || !logs[implementerId].content)) {
        logs[implementerId] = logs.solo;
        delete logs.solo;
    }
    return logs;
}

function isAgentlessFeatureLogFile(file, featureId) {
    const m = String(file || '').match(/^feature-(\d+)-(.+?)-log\.md$/);
    if (!m || Number(m[1]) !== Number(featureId)) return false;
    return !/^([a-z]{2})(?:-|$)/.test(m[2]);
}

function countDoneEntities(repoPath, entityType = 'feature') {
    const absRepo = path.resolve(repoPath);
    const doneDir = path.join(
        absRepo,
        'docs',
        'specs',
        entityType === 'research' ? 'research-topics' : 'features',
        STAGE_FOLDERS.DONE
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

function rebuildDashboardSummary(repos) {
    const summary = { implementing: 0, waiting: 0, complete: 0, error: 0, total: 0 };
    const completeStatuses = new Set([
        'implementation-complete',
        'revision-complete',
        'research-complete',
        'review-complete',
        'spec-review-complete',
    ]);
    for (const repo of repos || []) {
        for (const feature of repo.features || []) {
            for (const agent of feature.agents || []) {
                summary.total++;
                if (completeStatuses.has(agent.status)) {
                    summary.complete = (summary.complete || 0) + 1;
                } else {
                    summary[agent.status] = (summary[agent.status] || 0) + 1;
                }
            }
        }
        for (const research of repo.research || []) {
            for (const agent of research.agents || []) {
                summary.total++;
                if (completeStatuses.has(agent.status)) {
                    summary.complete = (summary.complete || 0) + 1;
                } else {
                    summary[agent.status] = (summary[agent.status] || 0) + 1;
                }
            }
        }
    }
    return summary;
}

function clearTierCache(repoPath = null) {
    if (!repoPath) {
        _tierCache.clear();
        probeTtlCache.clear();
        return;
    }
    const resolved = path.resolve(repoPath);
    _tierCache.delete(resolved);
    probeTtlCache.invalidateKeysIncluding(resolved);
}

/**
 * Re-collect status for one repo and merge into an existing dashboard payload.
 * Invalidates per-repo spec/tier caches so deletes and spec moves show up immediately.
 */
function refreshRepoInDashboardStatus(currentStatus, repoPath, options = {}) {
    const { clearRepoSpecIndexCache } = require('./dashboard-spec-index');
    const absPath = path.resolve(repoPath);
    clearTierCache(absPath);
    clearRepoSpecIndexCache(absPath);

    const summaryScratch = { implementing: 0, waiting: 0, complete: 0, error: 0, total: 0 };
    const repoStatus = collectRepoStatus(absPath, { summary: summaryScratch }, options);

    const repos = [...((currentStatus && currentStatus.repos) || [])];
    const idx = repos.findIndex(r => path.resolve(String(r.path || '')) === absPath);
    if (repoStatus) {
        if (idx >= 0) repos[idx] = repoStatus;
        else repos.push(repoStatus);
    } else if (idx >= 0) {
        repos.splice(idx, 1);
    }

    return {
        ...(currentStatus || {}),
        generatedAt: new Date().toISOString(),
        repos,
        summary: rebuildDashboardSummary(repos),
    };
}

module.exports = {
    collectDashboardStatusData,
    collectDashboardStatusDataAsync,
    collectDashboardHealth,
    collectRepoStatus,
    collectRepoStatusAsync,
    collectAllFeaturesLean,
    clearTierCache,
    rebuildDashboardSummary,
    refreshRepoInDashboardStatus,
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
