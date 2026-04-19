'use strict';

const fs = require('fs');
const path = require('path');
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
    COMPAT_INBOX: 'compatibility-inbox',
    LEGACY_MISSING_WORKFLOW: 'legacy-missing-workflow',
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

function isNumericEntityId(entityId) {
    return /^\d+$/.test(String(entityId || ''));
}

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

function createCompatibilityState(entityId, currentStage) {
    return {
        stage: currentStage || 'inbox',
        visibleStage: currentStage || 'inbox',
        workflowSnapshot: null,
        snapshotStatuses: {},
        nextAction: null,
        nextActions: [],
        validActions: [],
        workflowEvents: [],
        readOnly: false,
        legacy: false,
        missingWorkflowState: false,
        readModelSource: WORKFLOW_SOURCE.COMPAT_INBOX,
    };
}

function createLegacyMissingWorkflowState(entityId, currentStage) {
    return {
        stage: currentStage || 'backlog',
        visibleStage: currentStage || 'backlog',
        workflowSnapshot: null,
        snapshotStatuses: {},
        nextAction: null,
        nextActions: [],
        validActions: [],
        workflowEvents: [],
        readOnly: true,
        legacy: true,
        missingWorkflowState: true,
        readModelSource: WORKFLOW_SOURCE.LEGACY_MISSING_WORKFLOW,
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
    const specReconciliation = snapshot && entityId
        ? reconcileEntitySpec(repoPath, entityType, entityId, { snapshot })
        : null;

    if (snapshot) {
        const stage = workflowSnapshotAdapter.snapshotToStage(snapshot) || currentStage || null;
        const snapshotStatuses = workflowSnapshotAdapter.snapshotAgentStatuses(snapshot);
        const snapshotActions = workflowSnapshotAdapter.snapshotToDashboardActions(entityType, entityId, snapshot, stage);
        return {
            stage,
            visibleStage: (specReconciliation && specReconciliation.visibleStage) || currentStage || stage,
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
            readOnly: false,
            legacy: false,
            missingWorkflowState: false,
            readModelSource: WORKFLOW_SOURCE.SNAPSHOT,
        };
    }

    if (isNumericEntityId(entityId)) {
        return createLegacyMissingWorkflowState(entityId, currentStage);
    }

    return createCompatibilityState(entityId, currentStage);
}

function appendReadModelFlags(state, extras = {}) {
    return {
        ...state,
        workflowEngine: state.readModelSource === WORKFLOW_SOURCE.SNAPSHOT ? 'workflow-core' : 'compatibility',
        compatibilityLabel: state.readModelSource === WORKFLOW_SOURCE.LEGACY_MISSING_WORKFLOW
            ? 'legacy/missing-workflow'
            : (state.readModelSource === WORKFLOW_SOURCE.COMPAT_INBOX ? 'compatibility-inbox' : null),
        visibleStageDir: STAGE_TO_VISIBLE_DIR[state.stage] || null,
        ...extras,
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
    }
    return enriched;
}

function getFeatureDashboardState(repoPath, featureId, currentStage, agents) {
    const baseState = getBaseDashboardState('feature', repoPath, featureId, currentStage);
    const snapshot = baseState.workflowSnapshot;

    // Compute review + eval state first so we can enrich the context
    const review = snapshot ? readFeatureReviewState(repoPath, featureId, baseState.stage) : { reviewStatus: null, reviewSessions: [], reviewState: { current: null, history: [] } };
    const evaluation = snapshot ? readFeatureEvalState(repoPath, featureId, baseState.stage, snapshot) : {
        evalStatus: null,
        winnerAgent: null,
        evalPath: null,
        evalSession: null,
    };

    // Enrich snapshot with infra data for unified action derivation
    const enrichedSnapshot = enrichSnapshotWithInfraData(snapshot, agents, {
        evalPath: evaluation.evalPath,
        evalSession: evaluation.evalSession,
        reviewSessions: review.reviewSessions,
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
        reviewState: review.reviewState,
    });
}

function getResearchDashboardState(repoPath, researchId, currentStage, agents) {
    const baseState = getBaseDashboardState('research', repoPath, researchId, currentStage);
    const snapshot = baseState.workflowSnapshot;

    // Compute review + eval state first so we can enrich the context
    const review = snapshot ? readResearchReviewState(repoPath, researchId, baseState.stage) : { reviewStatus: null, reviewSessions: [], reviewState: { current: null, history: [] } };
    const evaluation = snapshot ? readResearchEvalState(repoPath, researchId, baseState.stage, snapshot) : {
        evalStatus: null,
        evalSession: null,
    };

    // Enrich snapshot with infra data (findings, flags) and review/eval data for unified action derivation
    const enrichedSnapshot = enrichSnapshotWithInfraData(snapshot, agents, {
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
        reviewState: review.reviewState,
    });
}

function readFeatureReviewState(repoPath, featureId, currentStage) {
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
                    reviewStateStore.writeReviewState(repoPath, featureId, state);
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
            // New-style: {repo}-f{id}-eval-{agent}-{desc}. Legacy: {repo}-f{id}-eval-{desc} (no agent).
            // Try parsing the session name first; fall back to heartbeat/log heuristics.
            let evalAgent = null;
            const parsed = parseTmuxSessionName(session);
            if (parsed && parsed.role === 'eval' && parsed.agent) evalAgent = parsed.agent;
            // Fallback: extract eval agent from heartbeat in pane start command (legacy sessions)
            if (!evalAgent) {
                try {
                    const paneCmd = require('child_process')
                        .execSync(`tmux list-panes -t ${JSON.stringify(session)} -F '#{pane_start_command}'`, { encoding: 'utf8', timeout: 2000 })
                        .trim();
                    const hbMatch = paneCmd.match(/heartbeat-\d+-(\w+)/);
                    if (hbMatch) evalAgent = hbMatch[1];
                } catch (_) {}
            }
            // Fallback: check eval log files
            if (!evalAgent) {
                const evalLogPattern = new RegExp(`feature-${toUnpaddedId(featureId)}-\\w+-eval`, 'i');
                const logsDir = path.join(repoPath, 'docs', 'specs', 'features', 'logs');
                try {
                    const evalLog = fs.readdirSync(logsDir).find(f => evalLogPattern.test(f));
                    if (evalLog) {
                        const agentMatch = evalLog.match(/feature-\d+-(\w+)-/);
                        if (agentMatch) evalAgent = agentMatch[1];
                    }
                } catch (_) {}
            }
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

function readResearchReviewState(repoPath, researchId, currentStage) {
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

module.exports = {
    WORKFLOW_SOURCE,
    isNumericEntityId,
    listWorkflowEntityIds,
    getFeatureDashboardState,
    getResearchDashboardState,
    readFeatureReviewState,
    readFeatureEvalState,
    readResearchEvalState,
    readResearchReviewState,
};
