'use strict';

const fs = require('fs');
const path = require('path');
const workflowDefinitions = require('./workflow-definitions');
const { readFeatureAutoState } = require('./auto-session-state');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const { reconcileEntitySpec } = require('./spec-reconciliation');
const { LifecycleState } = require('./workflow-core/types');
const reviewStateStore = require('./feature-review-state');
const researchReviewStateStore = require('./research-review-state');
const {
    findTmuxSessionsByPrefix,
    findFirstTmuxSessionByPrefix,
} = require('./dashboard-status-helpers');
const {
    tmuxSessionExists,
    toUnpaddedId,
    parseTmuxSessionName,
} = require('./worktree');

const WORKFLOW_SOURCE = Object.freeze({
    SNAPSHOT: 'workflow-snapshot',
    MISSING_SNAPSHOT: 'missing-snapshot',
    // Feature 341: snapshot carries sidecar `specReview` (pendingCount>0 or
    // activeReviewers>0) but currentSpecState is still `inbox`/`backlog` —
    // the engine state did not track the spec review. Flag loudly and cite
    // `aigon doctor --fix`; do not silently degrade.
    MISSING_MIGRATION: 'missing-migration',
});

const ENTITY_WORKFLOW_DIRS = Object.freeze({
    feature: ['features', 'docs/specs/features'],
    research: ['research', 'docs/specs/research-topics'],
});

const STAGE_TO_VISIBLE_DIR = Object.freeze({
    inbox: '01-inbox',
    backlog: '02-backlog',
    'in-progress': '03-in-progress',
    'in-evaluation': '04-in-evaluation',
    done: '05-done',
    paused: '06-paused',
});

const AUTONOMOUS_STAGE_LABELS = Object.freeze({
    implement: 'Implement',
    review: 'Review',
    revision: 'Revision',
    eval: 'Evaluate',
    close: 'Close',
});

function listWorkflowEntityIds(repoPath, entityType) {
    const workflowDirName = entityType === 'research' ? ENTITY_WORKFLOW_DIRS.research[0] : ENTITY_WORKFLOW_DIRS.feature[0];
    const workflowRoot = path.join(repoPath, '.aigon', 'workflows', workflowDirName);
    try {
        return fs.readdirSync(workflowRoot)
            .filter(dir => /^\d+$/.test(dir) && fs.existsSync(path.join(workflowRoot, dir, 'snapshot.json')))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    } catch (_) {
        return [];
    }
}

function toRelativeRepoPath(repoPath, targetPath) {
    return targetPath ? path.relative(repoPath, targetPath).replace(/\\/g, '/') : null;
}

function toSpecDrift(repoPath, specReconciliation) {
    if (!specReconciliation || specReconciliation.driftDetected !== true || specReconciliation.moved) return null;
    return {
        currentPath: toRelativeRepoPath(repoPath, specReconciliation.currentPath),
        expectedPath: toRelativeRepoPath(repoPath, specReconciliation.expectedPath),
        lifecycle: specReconciliation.lifecycle || null,
    };
}

function buildMissingSnapshotState(currentStage, entityType, entityId) {
    // A spec file exists but no workflow-core snapshot is on disk.
    //
    // Dashboard: return this shape (do not throw) so one bad row does not
    // 500 the whole grid. CLI/commands use console.error + non-zero exit.
    //
    // Actions derivation: even without a snapshot, the visible folder stage
    // tells the action registry which *pre-engine* lifecycle actions are valid.
    // - inbox → prioritise (slug-keyed inbox before F296 snapshot bootstrap)
    // - backlog → start / autonomous-start / spec-review / delete, etc.
    // Seed repos (e.g. brewboard-seed) ship backlog specs without engine state
    // until the operator runs `aigon doctor --fix` or starts a feature; those
    // rows must still show Start. Limit to inbox+backlog so we never invent
    // in-progress/eval actions without a real snapshot.
    const actionStage = (currentStage === 'inbox' || currentStage === 'backlog') ? currentStage : null;
    const stageActions = (entityType && actionStage)
        ? workflowSnapshotAdapter.snapshotToDashboardActions(entityType, entityId || null, null, actionStage)
        : { nextAction: null, nextActions: [], validActions: [] };
    return {
        stage: currentStage || null,
        visibleStage: currentStage || null,
        specDrift: null,
        workflowSnapshot: null,
        snapshotStatuses: {},
        nextAction: stageActions.nextAction,
        nextActions: stageActions.nextActions,
        validActions: stageActions.validActions,
        workflowEvents: [],
        readModelSource: WORKFLOW_SOURCE.MISSING_SNAPSHOT,
    };
}

function getBaseDashboardState(entityType, repoPath, entityId, currentStage, snapshotOverride) {
    const snapshot = snapshotOverride === undefined
        ? (entityId
            ? (entityType === 'feature'
                ? workflowSnapshotAdapter.readFeatureSnapshotSync(repoPath, entityId)
                : workflowSnapshotAdapter.readWorkflowSnapshotSync(repoPath, entityType, entityId))
            : null)
        : snapshotOverride;
    // Detect-only on read paths: compute drift but do not move files.
    // F272 originally made dashboard reads auto-reconcile folder drift, which
    // turned every refresh into a silent filesystem mutation across every
    // registered repo. That behaviour now lives behind an explicit command
    // (`aigon repair`) and an opt-in env var for users who want auto-heal.
    // See feature-275 for the planned per-row "reconcile" UI.
    const reconcileMutates = process.env.AIGON_AUTO_RECONCILE === '1';
    const specReconciliation = snapshot && entityId
        ? reconcileEntitySpec(repoPath, entityType, entityId, { snapshot, dryRun: !reconcileMutates })
        : null;
    const specDrift = toSpecDrift(repoPath, specReconciliation);

    if (snapshot) {
        const stage = workflowSnapshotAdapter.snapshotToStage(snapshot) || currentStage || null;
        const snapshotStatuses = workflowSnapshotAdapter.snapshotAgentStatuses(snapshot);
        const snapshotActions = workflowSnapshotAdapter.snapshotToDashboardActions(entityType, entityId, snapshot, stage);
        return {
            stage,
            visibleStage: (specReconciliation && specReconciliation.visibleStage) || currentStage || stage,
            specDrift,
            workflowSnapshot: snapshot,
            snapshotStatuses,
            nextAction: snapshotActions.nextAction,
            nextActions: snapshotActions.nextActions,
            validActions: snapshotActions.validActions,
            workflowEvents: entityId ? workflowSnapshotAdapter.filterAgentSignalEvents(
                entityType === 'feature'
                    ? workflowSnapshotAdapter.readFeatureEventsSync(repoPath, entityId)
                    : workflowSnapshotAdapter.readWorkflowEventsSync(repoPath, entityType, entityId)
            ) : [],
            readModelSource: detectMissingMigration(snapshot)
                ? WORKFLOW_SOURCE.MISSING_MIGRATION
                : WORKFLOW_SOURCE.SNAPSHOT,
        };
    }

    return buildMissingSnapshotState(currentStage, entityType, entityId);
}

/**
 * Feature 341: a snapshot carrying sidecar `specReview` state whose
 * `currentSpecState` is still a pre-review (`inbox`/`backlog`) lifecycle
 * has not had its engine-state migration applied. Flag it so the read
 * path fails loudly (dashboard badge + CLI exit cite `aigon doctor --fix`).
 */
function detectMissingMigration(snapshot) {
    if (!snapshot || !snapshot.specReview) return false;
    const state = snapshot.currentSpecState || snapshot.lifecycle;
    if (!['inbox', 'backlog'].includes(state)) return false;
    const activeReviewers = Array.isArray(snapshot.specReview.activeReviewers)
        ? snapshot.specReview.activeReviewers
        : [];
    const pendingCount = Number(snapshot.specReview.pendingCount || 0);
    return activeReviewers.length > 0 || pendingCount > 0;
}

function appendReadModelFlags(state) {
    return {
        ...state,
        workflowEngine: 'workflow-core',
        visibleStageDir: STAGE_TO_VISIBLE_DIR[state.stage] || null,
    };
}

/**
 * Enrich a workflow snapshot with infra data from dashboard agent rows
 * and feature-level data (eval, review). This allows infra action guards
 * to evaluate against the enriched context.
 */
function enrichSnapshotWithInfraData(snapshot, dashboardAgents, featureData) {
    if (!snapshot) return snapshot;
    const enriched = { ...snapshot };
    if (dashboardAgents && dashboardAgents.length > 0) {
        enriched.agents = { ...enriched.agents };
        dashboardAgents.forEach(da => {
            if (enriched.agents[da.id]) {
                enriched.agents[da.id] = {
                    ...enriched.agents[da.id],
                    devServerPokeEligible: da.devServerPokeEligible || false,
                    devServerUrl: da.devServerUrl || null,
                    flags: da.flags || {},
                    findingsPath: da.findingsPath || null,
                };
            }
        });
    }
    if (featureData) {
        enriched.evalPath = featureData.evalPath || null;
        enriched.evalSession = featureData.evalSession || null;
        enriched.reviewSessions = featureData.reviewSessions || [];
        enriched.reviewStatus = featureData.reviewStatus || null;
    }
    return enriched;
}

function buildAutonomousPlanError(featureId, detail) {
    const repairCommand = 'aigon doctor --fix';
    const message = `Autonomous plan unavailable for feature ${featureId}: ${detail}. Run: ${repairCommand}`;
    return {
        error: {
            code: 'AUTONOMOUS_PLAN_UNAVAILABLE',
            message,
            repairCommand,
        },
        stages: [],
    };
}

function normalizeAutonomousWorkflow(repoPath, featureId, autoState) {
    if (!autoState || typeof autoState !== 'object') return null;

    if (autoState.workflowSlug) {
        const resolved = workflowDefinitions.resolve(autoState.workflowSlug, repoPath);
        if (!resolved) {
            return buildAutonomousPlanError(featureId, `workflow "${autoState.workflowSlug}" could not be resolved`);
        }
        return {
            workflowSlug: autoState.workflowSlug,
            workflowLabel: resolved.label || autoState.workflowSlug,
            source: 'workflow-definition',
            stages: resolved.stages,
        };
    }

    const agents = Array.isArray(autoState.agents)
        ? autoState.agents.map(agent => String(agent || '').trim()).filter(Boolean)
        : [];
    const stopAfter = String(autoState.stopAfter || '').trim();
    if (agents.length === 0) {
        return buildAutonomousPlanError(featureId, 'missing implementing agents in autonomous state');
    }
    if (!workflowDefinitions.VALID_STOP_AFTER.includes(stopAfter)) {
        return buildAutonomousPlanError(featureId, 'missing or invalid stopAfter in autonomous state');
    }

    const isFleet = String(autoState.mode || '').trim() === 'fleet' || agents.length > 1;
    const stages = [{ type: 'implement', agents: agents.slice() }];

    if (isFleet) {
        if (stopAfter === 'review') {
            return buildAutonomousPlanError(featureId, 'fleet autonomous runs cannot stop after review');
        }
        if (stopAfter === 'eval' || stopAfter === 'close') {
            const evalAgent = String(autoState.evalAgent || '').trim();
            if (!evalAgent) {
                return buildAutonomousPlanError(featureId, 'fleet autonomous run is missing evalAgent');
            }
            stages.push({ type: 'eval', agents: [evalAgent] });
        }
        if (stopAfter === 'close') stages.push({ type: 'close' });
    } else {
        const implementAgent = agents[0];
        const reviewAgent = String(autoState.reviewAgent || '').trim() || null;
        if (reviewAgent) stages.push({ type: 'review', agents: [reviewAgent] });
        if (stopAfter === 'review' && !reviewAgent) {
            return buildAutonomousPlanError(featureId, 'solo autonomous run stopping after review is missing reviewAgent');
        }
        if (stopAfter === 'close' && reviewAgent) {
            stages.push({ type: 'revision', agents: [implementAgent] });
        }
        if (stopAfter === 'close') stages.push({ type: 'close' });
    }

    return {
        workflowSlug: autoState.workflowSlug || null,
        workflowLabel: null,
        source: 'autonomous-state',
        stages,
    };
}

function isAgentReadyStatus(status) {
    return status === 'ready' || status === 'submitted';
}

function isAgentFailedStatus(status) {
    return status === 'error' || status === 'failed';
}

function findAutonomousStageFailure(stageType, autoState) {
    if (!autoState || autoState.status !== 'failed') return false;
    const reason = String(autoState.reason || '').trim();
    if (!reason) return false;
    if (stageType === 'implement') return !/^(review|eval|feedback|feature-close|snapshot)/.test(reason);
    if (stageType === 'review') return /^review-/.test(reason);
    if (stageType === 'revision') return /^feedback-/.test(reason);
    if (stageType === 'eval') return /^eval-/.test(reason);
    if (stageType === 'close') return /close/.test(reason);
    return false;
}

function buildAutonomousStagePlan(options) {
    const {
        repoPath,
        featureId,
        currentStage,
        snapshot,
        dashboardAgents,
        autoState,
        review,
        evaluation,
    } = options;

    if (!autoState) return null;
    const resolved = normalizeAutonomousWorkflow(repoPath, featureId, autoState);
    if (!resolved) return null;
    if (resolved.error) return resolved;

    const dashboardAgentMap = new Map((dashboardAgents || []).map(agent => [agent.id, agent]));
    const reviewAgent = String(autoState.reviewAgent || '').trim() || null;
    const evalAgent = String(autoState.evalAgent || '').trim() || null;
    const implementStatuses = (resolved.stages[0]?.agents || [])
        .map(agent => {
            const agentId = typeof agent === 'string' ? agent : agent.id;
            const dashboardStatus = dashboardAgentMap.get(agentId)?.status || null;
            const snapshotStatus = snapshot?.agents?.[agentId]?.status || null;
            return dashboardStatus || snapshotStatus || null;
        })
        .filter(Boolean);
    const implementReady = implementStatuses.length > 0 && implementStatuses.every(isAgentReadyStatus);
    const implementFailed = implementStatuses.some(isAgentFailedStatus) || findAutonomousStageFailure('implement', autoState);
    const reviewRunning = Boolean(
        review?.reviewStatus === 'running'
        || (review?.reviewSessions || []).some(session => session.running && (!reviewAgent || session.agent === reviewAgent))
    );
    const reviewCurrentlyActive = Boolean(
        review?.reviewState?.current?.status === 'in-progress'
        && (!reviewAgent || review?.reviewState?.current?.agent === reviewAgent)
    );
    const reviewComplete = !reviewCurrentlyActive && Boolean(
        review?.reviewStatus === 'done'
        || (review?.reviewState?.history || []).some(entry => !reviewAgent || entry.agent === reviewAgent)
    );
    const feedbackAddressed = (resolved.stages[0]?.agents || []).some(agent => {
        const agentId = typeof agent === 'string' ? agent : agent.id;
        const status = dashboardAgentMap.get(agentId)?.status || snapshot?.agents?.[agentId]?.status || null;
        return status === 'feedback-addressed';
    });
    const evalRunning = Boolean(
        evaluation?.evalStatus === 'evaluating'
        || (evaluation?.evalSession && evaluation.evalSession.running)
        || autoState.evalTriggered
    );
    const evalComplete = Boolean(
        evaluation?.winnerAgent
        || snapshot?.winnerAgentId
        || autoState.closeTriggered
        || currentStage === 'done'
    );
    const closeRunning = Boolean(
        autoState.closeTriggered
        || snapshot?.lifecycle === LifecycleState.CLOSING
    );
    const closeComplete = Boolean(
        currentStage === 'done'
        || snapshot?.currentSpecState === 'done'
        || snapshot?.lifecycle === 'done'
        || autoState.status === 'completed'
    );

    const stages = resolved.stages.map((rawStage, index) => {
        const type = rawStage.type;
        const agents = Array.isArray(rawStage.agents)
            ? rawStage.agents.map(agent => workflowDefinitions.normalizeStageAgent(agent))
            : [];
        let status = 'waiting';

        if (type === 'implement') {
            if (implementFailed) status = 'failed';
            else if (
                implementReady
                || reviewRunning
                || reviewComplete
                || evalRunning
                || evalComplete
                || closeRunning
                || closeComplete
            ) status = 'complete';
            else status = 'running';
        } else if (type === 'review') {
            if (findAutonomousStageFailure(type, autoState)) status = 'failed';
            else if (reviewComplete || closeRunning || closeComplete) status = 'complete';
            else if (reviewRunning) status = 'running';
        } else if (type === 'revision') {
            if (findAutonomousStageFailure(type, autoState)) status = 'failed';
            else if (feedbackAddressed || closeRunning || closeComplete) status = 'complete';
            else if (autoState.feedbackInjected) status = 'running';
        } else if (type === 'eval') {
            if (findAutonomousStageFailure(type, autoState)) status = 'failed';
            else if (evalComplete || closeRunning || closeComplete) status = 'complete';
            else if (evalRunning) status = 'running';
        } else if (type === 'close') {
            if (findAutonomousStageFailure(type, autoState)) status = 'failed';
            else if (closeComplete) status = 'complete';
            else if (closeRunning) status = 'running';
        }

        return {
            key: `${type}-${index}`,
            type,
            label: AUTONOMOUS_STAGE_LABELS[type] || type,
            status,
            agents: agents.map(agent => ({
                id: agent.id,
                model: agent.model,
                effort: agent.effort,
            })),
        };
    });

    return {
        workflowSlug: resolved.workflowSlug,
        workflowLabel: resolved.workflowLabel,
        source: resolved.source,
        mode: autoState.mode || null,
        controllerStatus: autoState.status || null,
        stages,
    };
}

function getFeatureDashboardState(repoPath, featureId, currentStage, agents) {
    const baseState = getBaseDashboardState('feature', repoPath, featureId, currentStage);
    const snapshot = baseState.workflowSnapshot;
    const actionContext = snapshot ? { ...snapshot, specDrift: baseState.specDrift } : snapshot;
    const specReviewSessions = readSpecReviewSessions(repoPath, 'feature', featureId, baseState.stage, snapshot);
    const specCheckSessions = readSpecCheckSessions(repoPath, 'feature', featureId, baseState.stage, snapshot);

    // Compute review + eval state first so we can enrich the context
    const review = snapshot ? readFeatureReviewState(repoPath, featureId, baseState.stage, snapshot) : { reviewStatus: null, reviewSessions: [], reviewState: { current: null, history: [] } };
    const evaluation = snapshot ? readFeatureEvalState(repoPath, featureId, baseState.stage, snapshot) : {
        evalStatus: null,
        winnerAgent: null,
        evalPath: null,
        evalSession: null,
    };
    const autoState = baseState.stage !== 'done' ? readFeatureAutoState(repoPath, featureId) : null;

    // Enrich snapshot with infra data for unified action derivation
    const enrichedSnapshot = enrichSnapshotWithInfraData(actionContext, agents, {
        evalPath: evaluation.evalPath,
        evalSession: evaluation.evalSession,
        reviewSessions: review.reviewSessions,
        reviewStatus: review.reviewStatus,
    });

    const snapshotActions = snapshot
        ? workflowSnapshotAdapter.snapshotToDashboardActions('feature', featureId, enrichedSnapshot, baseState.stage)
        : { nextAction: null, nextActions: [], validActions: [] };
    return appendReadModelFlags({
        ...baseState,
        nextAction: snapshot ? snapshotActions.nextAction : baseState.nextAction,
        nextActions: snapshot ? snapshotActions.nextActions : baseState.nextActions,
        validActions: snapshot ? snapshotActions.validActions : baseState.validActions,
        winnerAgentId: snapshot ? snapshot.winnerAgentId || null : null,
        winnerAgent: evaluation.winnerAgent || (snapshot ? snapshot.winnerAgentId : null) || null,
        evalStatus: evaluation.evalStatus,
        evalPath: evaluation.evalPath,
        evalSession: evaluation.evalSession,
        reviewStatus: review.reviewStatus,
        reviewSessions: review.reviewSessions,
        specReviewSessions,
        specCheckSessions,
        reviewState: review.reviewState,
        autonomousPlan: buildAutonomousStagePlan({
            repoPath,
            featureId,
            currentStage: baseState.stage,
            snapshot,
            dashboardAgents: agents,
            autoState,
            review,
            evaluation,
        }),
        nudges: snapshot && Array.isArray(snapshot.nudges) ? snapshot.nudges.slice() : [],
    });
}

function getResearchDashboardState(repoPath, researchId, currentStage, agents) {
    const baseState = getBaseDashboardState('research', repoPath, researchId, currentStage);
    const snapshot = baseState.workflowSnapshot;
    const actionContext = snapshot ? { ...snapshot, specDrift: baseState.specDrift } : snapshot;
    const specReviewSessions = readSpecReviewSessions(repoPath, 'research', researchId, baseState.stage, snapshot);
    const specCheckSessions = readSpecCheckSessions(repoPath, 'research', researchId, baseState.stage, snapshot);

    // Compute review + eval state first so we can enrich the context
    const review = snapshot ? readResearchReviewState(repoPath, researchId, baseState.stage, snapshot) : { reviewStatus: null, reviewSessions: [], reviewState: { current: null, history: [] } };
    const evaluation = snapshot ? readResearchEvalState(repoPath, researchId, baseState.stage, snapshot) : {
        evalStatus: null,
        evalSession: null,
    };

    // Enrich snapshot with infra data (findings, flags) and review/eval data for unified action derivation
    const enrichedSnapshot = enrichSnapshotWithInfraData(actionContext, agents, {
        evalSession: evaluation.evalSession,
        reviewSessions: review.reviewSessions,
    });

    const snapshotActions = snapshot
        ? workflowSnapshotAdapter.snapshotToDashboardActions('research', researchId, enrichedSnapshot, baseState.stage)
        : { nextAction: null, nextActions: [], validActions: [] };
    return appendReadModelFlags({
        ...baseState,
        nextAction: snapshot ? snapshotActions.nextAction : baseState.nextAction,
        nextActions: snapshot ? snapshotActions.nextActions : baseState.nextActions,
        validActions: snapshot ? snapshotActions.validActions : baseState.validActions,
        evalStatus: evaluation.evalStatus,
        evalSession: evaluation.evalSession,
        reviewStatus: review.reviewStatus,
        reviewSessions: review.reviewSessions,
        specReviewSessions,
        specCheckSessions,
        reviewState: review.reviewState,
        nudges: snapshot && Array.isArray(snapshot.nudges) ? snapshot.nudges.slice() : [],
    });
}

function readFeatureReviewState(repoPath, featureId, currentStage, snapshot = null) {
    let reviewStatus = null;
    let reviewSessions = [];
    const isActiveStage = currentStage === 'in-progress' || currentStage === 'in-evaluation';
    if (!isActiveStage || !featureId) {
        return { reviewStatus, reviewSessions, reviewState: { current: null, history: [] } };
    }

    const repoBaseName = path.basename(repoPath);
    const reviewPrefix = `${repoBaseName}-f${toUnpaddedId(featureId)}-review-`;
    reviewSessions = findTmuxSessionsByPrefix(reviewPrefix, session => {
        const parsed = parseTmuxSessionName(session);
        const agentCode = parsed && parsed.role === 'review' ? parsed.agent : session.slice(reviewPrefix.length).split('-')[0];
        return { session, agent: agentCode, running: tmuxSessionExists(session) };
    });

    const codeReview = snapshot && snapshot.codeReview ? snapshot.codeReview : null;
    if (snapshot && snapshot.currentSpecState === LifecycleState.CODE_REVIEW_IN_PROGRESS) {
        const agent = codeReview && (codeReview.activeReviewerId || codeReview.reviewerId);
        reviewStatus = 'running';
        if (agent && !reviewSessions.some(session => session.agent === agent)) {
            reviewSessions.push({
                session: null,
                agent,
                running: true,
                status: 'in-progress',
                startedAt: codeReview.reviewStartedAt || null,
                completedAt: null,
                cycle: 1,
            });
        }
        return {
            reviewStatus,
            reviewSessions,
            reviewState: {
                current: agent ? {
                    agent,
                    status: 'in-progress',
                    startedAt: codeReview.reviewStartedAt || null,
                    completedAt: null,
                    cycle: 1,
                    source: 'workflow-engine',
                } : null,
                history: [],
            },
        };
    }
    if (codeReview && codeReview.reviewCompletedAt) {
        const agent = codeReview.reviewerId || codeReview.activeReviewerId || null;
        reviewStatus = 'done';
        if (agent && !reviewSessions.some(session => session.agent === agent && !session.running)) {
            reviewSessions.push({
                session: null,
                agent,
                running: false,
                status: 'complete',
                startedAt: codeReview.reviewStartedAt || null,
                completedAt: codeReview.reviewCompletedAt,
                cycle: 1,
            });
        }
        return {
            reviewStatus,
            reviewSessions,
            reviewState: {
                current: null,
                history: agent ? [{
                    agent,
                    status: 'complete',
                    startedAt: codeReview.reviewStartedAt || null,
                    completedAt: codeReview.reviewCompletedAt,
                    cycle: 1,
                    source: 'workflow-engine',
                }] : [],
            },
        };
    }

    let state = reviewStateStore.readReviewState(repoPath, featureId);
    if (!state.current && (!state.history || state.history.length === 0) && reviewSessions.some(session => session.running)) {
        const running = reviewSessions.find(session => session.running);
        state = reviewStateStore.startReviewSync(
            repoPath,
            featureId,
            running.agent,
            new Date().toISOString(),
            'reconcile/live-session'
        );
    }
    state = reviewStateStore.reconcileReviewState(repoPath, featureId, reviewSessions.some(session => session.running));

    const lastCompleted = (state.history || []).length > 0 ? state.history[state.history.length - 1] : null;
    if (!state.current && lastCompleted) {
        reviewSessions = reviewSessions.map(session => {
            if (session.agent !== lastCompleted.agent) return session;
            return {
                ...session,
                running: false,
                status: 'complete',
                completedAt: lastCompleted.completedAt,
                startedAt: lastCompleted.startedAt,
                cycle: lastCompleted.cycle,
            };
        });
    }

    if (!state.current && (!state.history || state.history.length === 0)) {
        const logsDir = path.join(repoPath, 'docs', 'specs', 'features', 'logs');
        try {
            fs.readdirSync(logsDir)
                .filter(file => file.startsWith(`feature-${featureId}-`) && file.endsWith('-log.md'))
                .forEach(file => {
                    const content = fs.readFileSync(path.join(logsDir, file), 'utf8');
                    const reviewMatch = content.match(/## Code Review\s*\n+\*\*Reviewed by\*\*:\s*(\w+)/);
                    if (!reviewMatch) return;
                    const stat = fs.statSync(path.join(logsDir, file));
                    state = {
                        current: null,
                        history: [{
                            agent: reviewMatch[1],
                            status: 'complete',
                            startedAt: stat.mtime.toISOString(),
                            completedAt: stat.mtime.toISOString(),
                            cycle: 1,
                            source: 'reconcile/log-section',
                        }],
                    };
                });
        } catch (_) { /* ignore */ }
    }

    if (state.current) {
        const existing = reviewSessions.find(session => session.agent === state.current.agent);
        if (!existing) {
            reviewSessions.push({
                session: null,
                agent: state.current.agent,
                running: state.current.status === 'in-progress',
                status: state.current.status,
                startedAt: state.current.startedAt,
                completedAt: state.current.completedAt,
                cycle: state.current.cycle,
            });
        }
    }

    (state.history || []).forEach(entry => {
        if (!reviewSessions.some(session => session.agent === entry.agent && !session.running)) {
            reviewSessions.push({
                session: null,
                agent: entry.agent,
                running: false,
                status: entry.status,
                startedAt: entry.startedAt,
                completedAt: entry.completedAt,
                cycle: entry.cycle,
            });
        }
    });

    if (state.current && state.current.status === 'in-progress') {
        reviewStatus = 'running';
    } else if ((state.history || []).length > 0 || reviewSessions.length > 0) {
        reviewStatus = 'done';
    }
    return { reviewStatus, reviewSessions, reviewState: state };
}

function readFeatureEvalState(repoPath, featureId, currentStage, snapshot) {
    let evalStatus = null;
    let winnerAgent = snapshot && snapshot.winnerAgentId ? snapshot.winnerAgentId : null;
    let evalPath = null;
    let evalSession = null;

    const lifecycle = snapshot && snapshot.lifecycle ? snapshot.lifecycle : null;
    const isInEvaluation = currentStage === 'in-evaluation'
        || lifecycle === LifecycleState.EVALUATING
        || lifecycle === LifecycleState.READY_FOR_REVIEW
        || lifecycle === LifecycleState.CLOSING;

    if (isInEvaluation && featureId) {
        evalStatus = 'evaluating';
        const evalFile = path.join(repoPath, 'docs', 'specs', 'features', 'evaluations', `feature-${featureId}-eval.md`);
        if (fs.existsSync(evalFile)) {
            evalPath = evalFile;
            try {
                const content = fs.readFileSync(evalFile, 'utf8');
                const winnerMatch = content.match(/\*\*Winner[:\s]*\*?\*?\s*(.+)/i);
                if (winnerMatch) {
                    const value = winnerMatch[1].replace(/\*+/g, '').trim();
                    if (value && !value.includes('to be determined') && !value.includes('TBD') && value !== '()') {
                        evalStatus = 'pick winner';
                        winnerAgent = value.split(/[\s(]/)[0].toLowerCase() || winnerAgent;
                    }
                }
            } catch (_) { /* ignore */ }
        }
    }

    if (currentStage === 'in-evaluation' && featureId) {
        const repoBaseName = path.basename(repoPath);
        const evalPrefix = `${repoBaseName}-f${toUnpaddedId(featureId)}-eval`;
        evalSession = findFirstTmuxSessionByPrefix(evalPrefix, session => {
            const parsed = parseTmuxSessionName(session);
            const evalAgent = parsed && parsed.role === 'eval' && parsed.agent ? parsed.agent : null;
            return { session, agent: evalAgent, running: tmuxSessionExists(session) };
        });
    }

    return { evalStatus, winnerAgent, evalPath, evalSession };
}

function readResearchEvalState(repoPath, researchId, currentStage, snapshot) {
    let evalStatus = null;
    let evalSession = null;

    const lifecycle = snapshot && snapshot.lifecycle ? snapshot.lifecycle : null;
    const isInEvaluation = currentStage === 'in-evaluation'
        || lifecycle === LifecycleState.EVALUATING;

    if (isInEvaluation && researchId) {
        evalStatus = 'evaluating';
        const repoBaseName = path.basename(repoPath);
        const evalPrefix = `${repoBaseName}-r${toUnpaddedId(researchId)}-eval`;
        evalSession = findFirstTmuxSessionByPrefix(evalPrefix, session => {
            let evalAgent = null;
            const parsed = parseTmuxSessionName(session);
            if (parsed && parsed.role === 'eval' && parsed.agent) evalAgent = parsed.agent;
            return { session, agent: evalAgent, running: tmuxSessionExists(session) };
        });
    }

    return { evalStatus, evalSession };
}

function readResearchReviewState(repoPath, researchId, currentStage, snapshot = null) {
    let reviewStatus = null;
    let reviewSessions = [];
    const isActiveStage = currentStage === 'in-progress' || currentStage === 'in-evaluation';
    if (!isActiveStage || !researchId) {
        return { reviewStatus, reviewSessions, reviewState: { current: null, history: [] } };
    }

    const repoBaseName = path.basename(repoPath);
    const reviewPrefix = `${repoBaseName}-r${toUnpaddedId(researchId)}-review-`;
    reviewSessions = findTmuxSessionsByPrefix(reviewPrefix, session => {
        const parsed = parseTmuxSessionName(session);
        const agentCode = parsed && parsed.role === 'review' ? parsed.agent : session.slice(reviewPrefix.length).split('-')[0];
        return { session, agent: agentCode, running: tmuxSessionExists(session) };
    });

    const codeReview = snapshot && snapshot.codeReview ? snapshot.codeReview : null;
    if (snapshot && snapshot.currentSpecState === LifecycleState.CODE_REVIEW_IN_PROGRESS) {
        const agent = codeReview && (codeReview.activeReviewerId || codeReview.reviewerId);
        reviewStatus = 'running';
        if (agent && !reviewSessions.some(session => session.agent === agent)) {
            reviewSessions.push({
                session: null,
                agent,
                running: true,
                status: 'in-progress',
                startedAt: codeReview.reviewStartedAt || null,
                completedAt: null,
                cycle: 1,
            });
        }
        return {
            reviewStatus,
            reviewSessions,
            reviewState: {
                current: agent ? {
                    agent,
                    status: 'in-progress',
                    startedAt: codeReview.reviewStartedAt || null,
                    completedAt: null,
                    cycle: 1,
                    source: 'workflow-engine',
                } : null,
                history: [],
            },
        };
    }
    if (codeReview && codeReview.reviewCompletedAt) {
        const agent = codeReview.reviewerId || codeReview.activeReviewerId || null;
        reviewStatus = 'done';
        if (agent && !reviewSessions.some(session => session.agent === agent && !session.running)) {
            reviewSessions.push({
                session: null,
                agent,
                running: false,
                status: 'complete',
                startedAt: codeReview.reviewStartedAt || null,
                completedAt: codeReview.reviewCompletedAt,
                cycle: 1,
            });
        }
        return {
            reviewStatus,
            reviewSessions,
            reviewState: {
                current: null,
                history: agent ? [{
                    agent,
                    status: 'complete',
                    startedAt: codeReview.reviewStartedAt || null,
                    completedAt: codeReview.reviewCompletedAt,
                    cycle: 1,
                    source: 'workflow-engine',
                }] : [],
            },
        };
    }

    let state = researchReviewStateStore.readReviewState(repoPath, researchId);
    if (!state.current && (!state.history || state.history.length === 0) && reviewSessions.some(session => session.running)) {
        const running = reviewSessions.find(session => session.running);
        state = researchReviewStateStore.startReviewSync(
            repoPath,
            researchId,
            running.agent,
            new Date().toISOString(),
            'reconcile/live-session'
        );
    }
    state = researchReviewStateStore.reconcileReviewState(repoPath, researchId, reviewSessions.some(session => session.running));

    const lastCompleted = (state.history || []).length > 0 ? state.history[state.history.length - 1] : null;
    if (!state.current && lastCompleted) {
        reviewSessions = reviewSessions.map(session => {
            if (session.agent !== lastCompleted.agent) return session;
            return {
                ...session,
                running: false,
                status: 'complete',
                completedAt: lastCompleted.completedAt,
                startedAt: lastCompleted.startedAt,
                cycle: lastCompleted.cycle,
            };
        });
    }

    if (state.current) {
        const existing = reviewSessions.find(session => session.agent === state.current.agent);
        if (!existing) {
            reviewSessions.push({
                session: null,
                agent: state.current.agent,
                running: state.current.status === 'in-progress',
                status: state.current.status,
                startedAt: state.current.startedAt,
                completedAt: state.current.completedAt,
                cycle: state.current.cycle,
            });
        }
    }

    (state.history || []).forEach(entry => {
        if (!reviewSessions.some(session => session.agent === entry.agent && !session.running)) {
            reviewSessions.push({
                session: null,
                agent: entry.agent,
                running: false,
                status: entry.status,
                startedAt: entry.startedAt,
                completedAt: entry.completedAt,
                cycle: entry.cycle,
            });
        }
    });

    if (state.current && state.current.status === 'in-progress') {
        reviewStatus = 'running';
    } else if ((state.history || []).length > 0 || reviewSessions.length > 0) {
        reviewStatus = 'done';
    }
    return { reviewStatus, reviewSessions, reviewState: state };
}

function buildSpecReviewSessionPrefix(repoPath, entityType, entityId, role) {
    const repoBaseName = path.basename(repoPath);
    const typePrefix = entityType === 'research' ? 'r' : 'f';
    return `${repoBaseName}-${typePrefix}${toUnpaddedId(entityId)}-${role}-`;
}

function findSpecReviewTmuxSession(repoPath, entityType, entityId, role, agentId) {
    if (!agentId) return null;
    const prefix = buildSpecReviewSessionPrefix(repoPath, entityType, entityId, role);
    const match = findTmuxSessionsByPrefix(prefix, session => {
        const parsed = parseTmuxSessionName(session);
        const code = parsed && parsed.role === role
            ? parsed.agent
            : session.slice(prefix.length).split('-')[0];
        return code === agentId ? session : null;
    }).find(Boolean);
    return match || null;
}

function readSpecReviewSessions(repoPath, entityType, entityId, currentStage, snapshot) {
    const isActiveStage = currentStage === 'inbox' || currentStage === 'backlog';
    if (!isActiveStage || !entityId || !snapshot || !snapshot.specReview) return [];

    const { activeReviewers = [], pendingReviews = [] } = snapshot.specReview;

    const active = activeReviewers
        .filter(entry => entry && entry.agentId)
        // A reviewer that's already submitted is in pendingReviews — exclude from active.
        .filter(entry => !pendingReviews.some(review => review && review.reviewerId === entry.agentId))
        .map(entry => ({
            session: findSpecReviewTmuxSession(repoPath, entityType, entityId, 'spec-review', entry.agentId),
            agent: entry.agentId,
            running: true,
            status: 'reviewing',
            source: 'active-reviewer',
            startedAt: entry.startedAt || null,
        }));

    const pending = pendingReviews
        .filter(review => review && review.reviewerId)
        .map(review => ({
            session: findSpecReviewTmuxSession(repoPath, entityType, entityId, 'spec-review', review.reviewerId),
            agent: review.reviewerId,
            running: false,
            status: 'pending',
            source: 'pending-review',
            reviewId: review.reviewId || null,
            summary: review.summary || '',
            submittedAt: review.submittedAt || null,
            commitSha: review.commitSha || null,
        }));

    return [...active, ...pending].sort((left, right) => {
        if (left.running !== right.running) return left.running ? -1 : 1;
        return String(left.agent || '').localeCompare(String(right.agent || ''));
    });
}

function readSpecCheckSessions(repoPath, entityType, entityId, currentStage, snapshot) {
    const isActiveStage = currentStage === 'inbox' || currentStage === 'backlog';
    if (!isActiveStage || !entityId || !snapshot || !snapshot.specReview) return [];

    const { activeCheckers = [] } = snapshot.specReview;
    return activeCheckers
        .filter(entry => entry && entry.agentId)
        .map(entry => ({
            session: findSpecReviewTmuxSession(repoPath, entityType, entityId, 'spec-check', entry.agentId),
            agent: entry.agentId,
            running: true,
            status: 'checking',
            source: 'active-checker',
            startedAt: entry.startedAt || null,
        }))
        .sort((left, right) => String(left.agent || '').localeCompare(String(right.agent || '')));
}

module.exports = {
    WORKFLOW_SOURCE,
    detectMissingMigration,
    listWorkflowEntityIds,
    getFeatureDashboardState,
    getResearchDashboardState,
    readFeatureReviewState,
    readFeatureEvalState,
    readResearchEvalState,
    readResearchReviewState,
    readSpecReviewSessions,
    readSpecCheckSessions,
};
