'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const workflowReadModel = require('../workflow-read-model');
const workflowSnapshotAdapter = require('../workflow-snapshot-adapter');
const { resolveStateRenderMeta } = require('../pause-semantics');
const { computeCardHeadline } = require('../card-headline');
const { buildCardPresentation } = require('../card-presentation');
const { buildCloseReadiness, applyCloseReadinessActionPriority } = require('../close-readiness');
const { buildFeatureUiContract } = require('../feature-ui-contract');
const { buildFeatureSetUiContract } = require('../feature-set-ui-contract');
const featureSets = require('../feature-sets');
const dashboardSpecIndex = require('../dashboard-spec-index');
const { buildEntityView } = require('../read-model/entity-view');
const { STAGE_FOLDERS } = require('../workflow-core/paths');
const {
    parseFeatureSpecFileName,
    safeFeatureAutoSessionExists,
    safeCloseRecoveryTmuxSession,
    RUNTIME_TASK_FILE_STATUSES,
} = require('../dashboard-status-helpers');
const { getTierCache } = require('./tier-cache');
const {
    safeReadDir,
    safeStat,
    safeStatMtimeMs,
    safeStatIsoTimes,
    buildDetailFingerprint,
    listStageSpecFiles,
    collectDoneSpecs,
    buildEntityDisplayKey,
} = require('./safe-reads');
const { readComplexityFromSpec, buildProvenanceFields, resolveDriveBranchToolAgentId } = require('./spec-meta');
const {
    summarizeReviewSessions,
    buildLeanDoneFeatureRow,
    buildSetDashboardCard,
} = require('./set-cards');
const {
    readFeatureManifests,
    buildFeatureAgentsFromSnapshot,
    listWorkflowFeatureIds,
    workflowFeatureIdsCovers,
    resolveFeatureIdentity,
    enrichReviewSessionsWithLiveness,
} = require('./entity-core');

function attachFeatureCloseProjection(feature, snapshot, agents, autonomousPlan, stage, pollCtx) {
    const closeReadiness = buildCloseReadiness(feature, snapshot, {
        repoPath: pollCtx.absRepoPath,
        featureId: feature.id,
        specPath: feature.specPath,
        stage: stage || feature.stage,
        worktreePath: pollCtx.worktreePath || null,
        closingInProgress: pollCtx.closingFeatureIds
            && pollCtx.closingFeatureIds.has(String(feature.id)),
    });
    feature.closeReadiness = closeReadiness;
    if (Array.isArray(feature.validActions)) {
        feature.validActions = applyCloseReadinessActionPriority(feature.validActions, closeReadiness);
    }
    feature.cardHeadline = computeCardHeadline(
        { ...feature, closeReadiness },
        snapshot,
        agents,
        autonomousPlan,
        stage,
        {
            entityType: 'feature',
            closeReadiness,
            closingInProgress: pollCtx.closingFeatureIds
                && pollCtx.closingFeatureIds.has(String(feature.id)),
        },
    );
}

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
        // F678: the lifecycle is a server fact the contract resolves state from
        // and computeStatusFingerprint already reads as `f.currentSpecState` —
        // this path never carried it, so contract.state.lifecycle came out null
        // and that fingerprint component was always empty.
        currentSpecState: snapshot.currentSpecState || snapshot.lifecycle || null,
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
        openEscalations: Array.isArray(snapshot.openEscalations) ? snapshot.openEscalations : [],
        recoveryTmuxSession: (snapshot.currentSpecState === 'close_recovery_in_progress'
            && snapshot.closeRecovery
            && snapshot.closeRecovery.agentId)
            ? safeCloseRecoveryTmuxSession(featureId, snapshot.closeRecovery.agentId)
            : null,
        stateRenderMeta: resolveStateRenderMeta(snapshot.currentSpecState || snapshot.lifecycle, snapshot),
        reviewCycles: Array.isArray(snapshot.reviewCycles) ? snapshot.reviewCycles : [],
        mode: snapshot.mode || null,
        driveToolAgentId: (snapshot.mode === 'solo_branch' && agents.length === 1 && agents[0].id === 'solo')
            ? resolveDriveBranchToolAgentId(featureId, absRepoPath)
            : null,
    });
    const pollCtx = {
        absRepoPath,
        closingFeatureIds: scanCtx.closingFeatureIds,
    };
    const lastFeature = features[features.length - 1];
    attachFeatureCloseProjection(
        lastFeature,
        snapshot,
        agents,
        featureState.autonomousPlan,
        stage,
        pollCtx,
    );
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
        closingFeatureIds = null,
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
        closingFeatureIds,
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
            openEscalations: (featureState.workflowSnapshot && Array.isArray(featureState.workflowSnapshot.openEscalations))
                ? featureState.workflowSnapshot.openEscalations
                : [],
            workflowSnapshot: featureState.workflowSnapshot || null,
            autonomousPlan: featureState.autonomousPlan || null,
            stateRenderMeta: resolveStateRenderMeta(
                featureState.workflowSnapshot && (featureState.workflowSnapshot.currentSpecState || featureState.workflowSnapshot.lifecycle),
                featureState.workflowSnapshot,
            ),
            reviewCycles: Array.isArray(featureState.workflowSnapshot && featureState.workflowSnapshot.reviewCycles) ? featureState.workflowSnapshot.reviewCycles : [],
        });
        const fallbackRow = features[features.length - 1];
        attachFeatureCloseProjection(
            fallbackRow,
            featureState.workflowSnapshot || null,
            [],
            featureState.autonomousPlan,
            featureState.stage,
            { absRepoPath, closingFeatureIds },
        );
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
            attachFeatureCloseProjection(
                feature,
                feature.workflowSnapshot || null,
                feature.agents || [],
                feature.autonomousPlan,
                feature.stage,
                { absRepoPath, closingFeatureIds },
            );
        }
    });

    features.forEach((feature) => {
        // Done rows ship the lean shape (F459/F469/F590): bounded to 15, no
        // enrichment keys, detail fetched via /api/feature/:id/details. They
        // have no actions or sessions, so a contract would be an empty envelope
        // that only breaks the lean-shape invariant. Interactive cards only.
        if (feature.stage === 'done') return;
        // Presentation still needs a headline — the contract does not. F678:
        // inbox and backlog rows carry real actions (Prioritise, Start, Delete)
        // but never get a headline, so gating the contract on one left the most
        // numerous cards on the legacy read path.
        if (feature.cardHeadline) {
            feature.cardPresentation = buildCardPresentation(feature, { entityType: 'feature' });
        }
        // A contract that cannot be built is a collector defect. Fail with the
        // entity id attached rather than shipping a row the browser must guess about.
        try {
            feature.uiContract = buildFeatureUiContract(feature, feature.workflowSnapshot || {});
        } catch (error) {
            throw new Error(`Feature ${feature.id} UI contract build failed: ${error.message}`);
        }
    });

    // Sets rollup: derived entirely from member stage, no new files written.
    // Exposed on the repo payload so the dashboard can offer "group by set".
    // F678: the set's current member embeds that member's own full contract —
    // already built above — so a set run is never flattened to a generic
    // "working" row and keeps its review/revision stages.
    const featureContractById = new Map(
        features.filter(feature => feature.uiContract).map(feature => [String(feature.id), feature.uiContract]),
    );
    const sets = featureSets.summarizeSets(featureSetPaths, specIndex)
        .filter(s => !s.isComplete)
        .map(s => {
            const card = {
                ...s,
                ...buildSetDashboardCard(absRepoPath, s, featureSetPaths, specIndex),
            };
            card.currentFeatureContract = card.currentFeature
                ? featureContractById.get(String(card.currentFeature.id)) || null
                : null;
            try {
                card.uiContract = buildFeatureSetUiContract(card);
            } catch (error) {
                throw new Error(`Feature set ${card.slug} UI contract build failed: ${error.message}`);
            }
            return card;
        });

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

module.exports = {
    processWorkflowFeatureForPoll,
    scanWorkflowFeaturesForPoll,
    collectFeatures,
};
