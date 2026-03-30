'use strict';

const fs = require('fs');
const path = require('path');
const {
    FEATURE_STAGE_TRANSITIONS,
    FEATURE_STAGE_ACTIONS,
} = require('./feature-workflow-rules');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
const { deriveAvailableActions } = require('./workflow-core/actions');
const { ManualActionKind, LifecycleState } = require('./workflow-core/types');
const {
    formatDashboardActionCommand,
} = require('./action-command-mapper');
const {
    findTmuxSessionsByPrefix,
    findFirstTmuxSessionByPrefix,
} = require('./dashboard-status-helpers');
const reviewStateStore = require('./feature-review-state');
const {
    tmuxSessionExists,
    toUnpaddedId,
} = require('./worktree');

const ACTION_REASON_BY_NAME = Object.freeze({
    'feature-open': 'Open the feature worktree or launch the agent session',
    'feature-attach': 'Open terminal to view progress',
    'feature-focus': 'Agent is waiting for input',
    'feature-stop': 'Kill the agent session',
    'feature-eval': 'All agents submitted; compare implementations',
    'feature-review': 'Run a code review before closing',
    'feature-close': 'Close and merge implementation',
    'feature-start': 'Set up workspace and begin',
    'feature-pause': 'Pause feature execution',
    'feature-resume': 'Resume paused feature',
    'feature-autopilot': 'Run parallel agents in autopilot mode',
    'feature-prioritise': 'Assign an ID and move this feature to backlog',
    'force-agent-ready': 'Force agent to ready state',
    'drop-agent': 'Drop the agent from the feature',
});

const ACTION_DISPLAY_ORDER = Object.freeze({
    'feature-start': 10,
    'research-start': 10,
    'feature-open': 20,
    'feature-attach': 20,
    'feature-focus': 20,
    'feature-review': 30,
    'feature-eval': 30,
    'research-eval': 30,
    'feature-close': 40,
    'research-close': 40,
    'feature-autopilot': 50,
    'feature-pause': 60,
    'feature-resume': 60,
    'feature-stop': 70,
    'research-stop': 70,
});

const SNAPSHOT_ACTION_MAP = Object.freeze({
    [ManualActionKind.PAUSE_FEATURE]: { action: 'feature-pause', type: 'transition' },
    [ManualActionKind.RESUME_FEATURE]: { action: 'feature-resume', type: 'transition' },
    [ManualActionKind.FEATURE_REVIEW]: { action: 'feature-review', type: 'action' },
    [ManualActionKind.FEATURE_EVAL]: { action: 'feature-eval', type: 'transition', priority: 'high' },
    [ManualActionKind.FEATURE_CLOSE]: { action: 'feature-close', type: 'transition', priority: 'high' },
    [ManualActionKind.RESTART_AGENT]: { action: 'feature-open', type: 'action' },
    [ManualActionKind.FORCE_AGENT_READY]: { action: 'force-agent-ready', type: 'action' },
    [ManualActionKind.DROP_AGENT]: { action: 'drop-agent', type: 'action' },
    [ManualActionKind.SELECT_WINNER]: { action: 'feature-close', type: 'transition', priority: 'high' },
});

function buildFeatureContext(stage, agents) {
    const safeAgents = Array.isArray(agents) ? agents : [];
    const realAgents = safeAgents.filter(agent => agent && agent.id !== 'solo');
    const contextAgents = realAgents.length > 0 ? realAgents : safeAgents;
    return {
        mode: realAgents.length > 1 ? 'fleet' : 'solo',
        agents: contextAgents.map(agent => agent.id),
        agentStatuses: Object.fromEntries(contextAgents.map(agent => [agent.id, agent.status || 'implementing'])),
        tmuxSessionStates: Object.fromEntries(contextAgents.map(agent => [
            agent.id,
            agent.tmuxRunning ? 'running' : (agent.tmuxSession ? 'exited' : 'none'),
        ])),
        currentStage: stage,
        entityType: 'feature',
    };
}

function allAgentsSubmitted(context) {
    const statuses = Object.values(context.agentStatuses || {});
    return statuses.length > 0 && statuses.every(status => status === 'submitted');
}

function isFleet(context) {
    const agents = (context.agents || []).filter(agentId => agentId !== 'solo');
    return agents.length > 1;
}

function resolveFeatureGuard(name, context, agentId) {
    const status = agentId ? (context.agentStatuses || {})[agentId] : null;
    const tmuxState = agentId ? (context.tmuxSessionStates || {})[agentId] : null;
    switch (name) {
    case 'fleetAndAllAgentsSubmitted':
        return isFleet(context) && allAgentsSubmitted(context);
    case 'soloAndAllAgentsSubmitted':
        return !isFleet(context) && allAgentsSubmitted(context);
    case 'isFleet':
        return isFleet(context);
    case 'isSolo':
        return !isFleet(context);
    case 'noRunningTmuxSessions':
        return !Object.values(context.tmuxSessionStates || {}).some(state => state === 'running');
    case 'agentIdleOrErrorOrMissing':
        return status === 'idle' || status === 'error' || status === undefined;
    case 'agentImplementingOrSubmittedWithTmux':
        return (status === 'implementing' || status === 'submitted') && tmuxState === 'running';
    case 'agentImplementingWithoutTmux':
        return status === 'implementing' && tmuxState !== 'running';
    case 'agentSubmittedWithoutTmux':
        return status === 'submitted' && tmuxState !== 'running';
    case 'agentWaiting':
        return status === 'waiting';
    case 'agentImplementingOrWaiting':
        return status === 'implementing' || status === 'waiting';
    default:
        return true;
    }
}

function resolveStageActionLabel(def, context, agentId) {
    if (def.label) return def.label;
    switch (def.labelType) {
    case 'agent-open':
        return (context.agentStatuses || {})[agentId] === 'error' ? `Restart ${agentId}` : `Start ${agentId}`;
    case 'agent-view':
        return `Open ${agentId}`;
    case 'agent-start':
        return `Start ${agentId}`;
    case 'agent-focus':
        return `Focus ${agentId}`;
    case 'agent-stop':
        return `Stop ${agentId}`;
    default:
        return def.action;
    }
}

function buildDashboardAction(action, featureId, extras = {}) {
    return {
        command: formatDashboardActionCommand(action, featureId, {
            entityType: 'feature',
            agentId: extras.agentId || null,
        }),
        label: extras.label || action,
        reason: extras.reason || ACTION_REASON_BY_NAME[action] || '',
        action,
        agentId: extras.agentId || null,
        type: extras.type || 'action',
        mode: extras.mode,
        priority: extras.priority || 'normal',
        ...(extras.from ? { from: extras.from } : {}),
        ...(extras.to ? { to: extras.to } : {}),
        ...(extras.requiresInput ? { requiresInput: extras.requiresInput } : {}),
        ...(extras.uiTrigger ? { uiTrigger: extras.uiTrigger } : {}),
    };
}

function buildStageActions(featureId, stage, context) {
    const actions = [];

    FEATURE_STAGE_TRANSITIONS
        .filter(transition => transition.from === stage)
        .forEach(transition => {
            if (!resolveFeatureGuard(transition.guardName, context, null)) return;
            actions.push(buildDashboardAction(transition.action, featureId, {
                type: 'transition',
                label: transition.label,
                from: transition.from,
                to: transition.to,
                requiresInput: transition.requiresInput || null,
                uiTrigger: transition.uiTrigger || null,
            }));
        });

    FEATURE_STAGE_ACTIONS
        .filter(def => def.stage === stage)
        .forEach(def => {
            if (def.perAgent) {
                const agentIds = (context.agents || []).length > 0
                    ? context.agents
                    : Object.keys(context.agentStatuses || {});
                agentIds.forEach(agentId => {
                    if (!resolveFeatureGuard(def.guardName, context, agentId)) return;
                    actions.push(buildDashboardAction(def.action, featureId, {
                        type: 'action',
                        label: resolveStageActionLabel(def, context, agentId),
                        mode: def.mode || 'fire-and-forget',
                        priority: def.priority || 'normal',
                        agentId,
                        requiresInput: def.requiresInput || null,
                    }));
                });
                return;
            }
            if (!resolveFeatureGuard(def.guardName, context, null)) return;
            actions.push(buildDashboardAction(def.action, featureId, {
                type: 'action',
                label: resolveStageActionLabel(def, context, null),
                mode: def.mode || 'fire-and-forget',
                priority: def.priority || 'normal',
                requiresInput: def.requiresInput || null,
            }));
        });

    return actions;
}

function mapSnapshotAction(featureId, snapshotAction) {
    const mapped = SNAPSHOT_ACTION_MAP[snapshotAction.kind];
    if (!mapped) return null;
    return buildDashboardAction(mapped.action, featureId, {
        type: mapped.type,
        label: snapshotAction.label,
        agentId: snapshotAction.agentId || null,
        priority: mapped.priority || 'normal',
    });
}

function mergeActions(snapshotActions, stageActions) {
    const merged = [];
    const seen = new Set();
    [...snapshotActions, ...stageActions].forEach(action => {
        if (!action) return;
        const key = `${action.action}:${action.agentId || ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(action);
    });
    merged.sort((left, right) => {
        const rank = value => value.priority === 'high' ? 0 : 1;
        const order = value => ACTION_DISPLAY_ORDER[value.action] || 999;
        return rank(left) - rank(right)
            || order(left) - order(right)
            || String(left.label).localeCompare(String(right.label));
    });
    return merged;
}

function readFeatureReviewState(repoPath, featureId, isActiveStage) {
    let reviewStatus = null;
    let reviewSessions = [];
    if (!isActiveStage) return { reviewStatus, reviewSessions };

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

function readFeatureEvalState(repoPath, featureId, stage, snapshot, context) {
    let evalStatus = null;
    let winnerAgent = snapshot && snapshot.winnerAgentId ? snapshot.winnerAgentId : null;
    let evalPath = null;
    let evalSession = null;

    const lifecycle = snapshot && snapshot.lifecycle ? snapshot.lifecycle : null;
    const isInEvaluation = stage === 'in-evaluation'
        || lifecycle === LifecycleState.EVALUATING
        || lifecycle === LifecycleState.READY_FOR_REVIEW
        || lifecycle === LifecycleState.CLOSING;

    if (isInEvaluation) {
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
            } catch (_) {}
        }
    }

    if (stage === 'in-evaluation') {
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

function getFeatureDashboardModel(repoPath, featureId, stage, agents) {
    const context = buildFeatureContext(stage, agents);
    const snapshot = featureId ? workflowSnapshotAdapter.readFeatureSnapshotSync(repoPath, featureId) : null;
    const workflowEvents = featureId
        ? workflowSnapshotAdapter.filterAgentSignalEvents(
            workflowSnapshotAdapter.readFeatureEventsSync(repoPath, featureId)
        )
        : [];
    const snapshotStatuses = snapshot ? workflowSnapshotAdapter.snapshotAgentStatuses(snapshot) : {};
    Object.entries(snapshotStatuses).forEach(([agentId, status]) => {
        context.agentStatuses[agentId] = status;
    });
    const snapshotActions = snapshot
        ? deriveAvailableActions(snapshot).map(action => mapSnapshotAction(featureId, action)).filter(Boolean)
        : [];
    const stageActions = buildStageActions(featureId, stage, context);
    const validActions = mergeActions(snapshotActions, stageActions);
    const nextActions = validActions;
    const nextAction = nextActions.length > 0
        ? { command: nextActions[0].command, reason: nextActions[0].reason }
        : null;
    const isActiveStage = stage === 'in-progress' || stage === 'in-evaluation';
    const review = readFeatureReviewState(repoPath, featureId, isActiveStage);
    const evaluation = readFeatureEvalState(repoPath, featureId, stage, snapshot, context);

    return {
        workflowEngine: snapshot ? 'workflow-core' : 'legacy',
        workflowSnapshot: snapshot,
        workflowEvents,
        snapshotStatuses,
        context,
        nextAction,
        nextActions,
        validActions,
        reviewStatus: review.reviewStatus,
        reviewSessions: review.reviewSessions,
        reviewState: review.reviewState,
        evalStatus: evaluation.evalStatus,
        winnerAgent: evaluation.winnerAgent,
        evalPath: evaluation.evalPath,
        evalSession: evaluation.evalSession,
    };
}

module.exports = {
    ACTION_REASON_BY_NAME,
    buildFeatureContext,
    buildStageActions,
    readFeatureReviewState,
    readFeatureEvalState,
    getFeatureDashboardModel,
};
