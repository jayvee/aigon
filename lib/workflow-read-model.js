'use strict';

const fs = require('fs');
const path = require('path');
const stateMachine = require('./state-queries');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const { LifecycleState } = require('./workflow-core/types');
const reviewStateStore = require('./feature-review-state');
const {
    findTmuxSessionsByPrefix,
    findFirstTmuxSessionByPrefix,
} = require('./dashboard-status-helpers');
const {
    tmuxSessionExists,
    toUnpaddedId,
} = require('./worktree');
const {
    formatDashboardActionCommand,
    formatBoardActionCommand,
} = require('./action-command-mapper');

function buildWorkflowStateContext(entityType, currentStage, agents) {
    const safeAgents = Array.isArray(agents) ? agents : [];
    const realAgents = safeAgents.filter(a => a && a.id !== 'solo');
    const smAgents = realAgents.length > 0 ? realAgents : safeAgents;

    return {
        mode: realAgents.length > 1 ? 'fleet' : 'solo',
        agents: smAgents.map(a => a.id),
        agentStatuses: Object.fromEntries(smAgents.map(a => [a.id, a.status || 'implementing'])),
        tmuxSessionStates: Object.fromEntries(smAgents.map(a => [
            a.id,
            a.tmuxRunning ? 'running' : (a.tmuxSession ? 'exited' : 'none')
        ])),
        currentStage,
        entityType
    };
}

function buildActionReason(stage, action) {
    const reasons = {
        'feature-open': 'Launch agent on this feature',
        'research-open': 'Launch agent on this research topic',
        'feature-attach': 'Open terminal to view progress',
        'research-attach': 'Open terminal to view progress',
        'feature-focus': 'Agent is waiting for input',
        'research-focus': 'Agent is waiting for input',
        'feature-stop': 'Kill the agent session',
        'research-stop': 'Kill the agent session',
        'feature-eval': stage === 'in-evaluation' ? 'Evaluation in progress' : 'All agents submitted; compare implementations',
        'research-eval': stage === 'in-evaluation' ? 'Evaluation in progress' : 'All agents submitted; evaluate findings',
        'feature-review': 'Get a code review before closing',
        'feature-close': stage === 'in-evaluation' ? 'Close without further evaluation' : 'Close and merge implementation',
        'research-close': 'Close research and move to done',
        'feature-start': 'Set up workspace and begin',
        'research-start': 'Set up workspace and begin',
        'feature-autopilot': 'Run parallel agents in autopilot mode',
        'research-prioritise': 'Assign an ID and move this topic to backlog',
        'feature-prioritise': 'Assign an ID and move this feature to backlog'
    };
    return reasons[action] || '';
}

function getWorkflowReadModel(entityType, entityId, currentStage, agents) {
    const context = buildWorkflowStateContext(entityType, currentStage, agents);
    const validActions = stateMachine.getAvailableActions(entityType, currentStage, context);
    const recommendedActions = stateMachine.getRecommendedActions(entityType, currentStage, context);

    return {
        entityType,
        entityId,
        currentStage,
        agents: Array.isArray(agents) ? agents : [],
        agentStatuses: context.agentStatuses,
        validActions,
        recommendedActions,
        context
    };
}

function getFeatureDashboardState(repoPath, featureId, currentStage, agents) {
    const model = getWorkflowReadModel('feature', featureId, currentStage, agents);
    const snapshot = featureId
        ? workflowSnapshotAdapter.readFeatureSnapshotSync(repoPath, featureId)
        : null;

    const snapshotStatuses = snapshot
        ? workflowSnapshotAdapter.snapshotAgentStatuses(snapshot)
        : {};

    if (snapshot) {
        const snapshotActions = workflowSnapshotAdapter.snapshotToDashboardActions('feature', featureId, snapshot);
        const review = readFeatureReviewState(repoPath, featureId, currentStage);
        const evaluation = readFeatureEvalState(repoPath, featureId, currentStage, snapshot);
        return {
            workflowEngine: 'workflow-core',
            workflowSnapshot: snapshot,
            snapshotStatuses,
            nextAction: snapshotActions.nextAction,
            nextActions: snapshotActions.nextActions,
            validActions: snapshotActions.validActions,
            workflowEvents: workflowSnapshotAdapter.filterAgentSignalEvents(
                workflowSnapshotAdapter.readFeatureEventsSync(repoPath, featureId)
            ),
            winnerAgentId: snapshot.winnerAgentId || null,
            winnerAgent: evaluation.winnerAgent || snapshot.winnerAgentId || null,
            evalStatus: evaluation.evalStatus,
            evalPath: evaluation.evalPath,
            evalSession: evaluation.evalSession,
            reviewStatus: review.reviewStatus,
            reviewSessions: review.reviewSessions,
            reviewState: review.reviewState,
            context: model.context,
            readModel: model,
        };
    }

    const review = readFeatureReviewState(repoPath, featureId, currentStage);
    const evaluation = readFeatureEvalState(repoPath, featureId, currentStage, null);
    return {
        workflowEngine: 'legacy',
        workflowSnapshot: null,
        snapshotStatuses,
        nextAction: getDashboardNextCommand('feature', featureId, currentStage, agents),
        nextActions: getDashboardNextActions('feature', featureId, currentStage, agents),
        validActions: model.validActions,
        workflowEvents: [],
        winnerAgentId: null,
        winnerAgent: evaluation.winnerAgent,
        evalStatus: evaluation.evalStatus,
        evalPath: evaluation.evalPath,
        evalSession: evaluation.evalSession,
        reviewStatus: review.reviewStatus,
        reviewSessions: review.reviewSessions,
        reviewState: review.reviewState,
        context: model.context,
        readModel: model,
    };
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
        const remainder = session.slice(reviewPrefix.length);
        const agentCode = remainder.split('-')[0];
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
            const suffix = session.slice(evalPrefix.length);
            const agent = suffix.startsWith('-') ? suffix.slice(1) : null;
            return { session, agent, running: tmuxSessionExists(session) };
        });
    }

    return { evalStatus, winnerAgent, evalPath, evalSession };
}

function getDashboardNextActions(entityType, entityId, currentStage, agents) {
    if (!Array.isArray(agents) || agents.length === 0) return [];

    const model = getWorkflowReadModel(entityType, entityId, currentStage, agents);
    return model.recommendedActions.map(actionObj => ({
        command: formatDashboardActionCommand(actionObj.action, entityId, {
            entityType,
            stage: currentStage,
            agentId: actionObj.agentId || null,
        }),
        label: actionObj.label,
        reason: buildActionReason(currentStage, actionObj.action),
        mode: actionObj.mode,
        action: actionObj.action,
        agentId: actionObj.agentId || null
    }));
}

function getDashboardNextCommand(entityType, entityId, currentStage, agents) {
    const actions = getDashboardNextActions(entityType, entityId, currentStage, agents);
    if (actions.length === 0) return null;
    const first = actions[0];
    return { command: first.command, reason: first.reason };
}

function formatBoardCommand(entityType, entityId, actionObj) {
    return formatBoardActionCommand(actionObj.action, entityId, {
        entityType,
        agentId: actionObj.agentId || null,
    });
}

module.exports = {
    buildWorkflowStateContext,
    getWorkflowReadModel,
    getFeatureDashboardState,
    readFeatureReviewState,
    readFeatureEvalState,
    buildActionReason,
    getDashboardNextActions,
    getDashboardNextCommand,
    formatBoardCommand,
};
