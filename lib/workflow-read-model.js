'use strict';

const stateMachine = require('./state-queries');
const workflowSnapshotAdapter = require('./workflow-snapshot-adapter');
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
            context: model.context,
            readModel: model,
        };
    }

    return {
        workflowEngine: 'legacy',
        workflowSnapshot: null,
        snapshotStatuses,
        nextAction: getDashboardNextCommand('feature', featureId, currentStage, agents),
        nextActions: getDashboardNextActions('feature', featureId, currentStage, agents),
        validActions: model.validActions,
        workflowEvents: [],
        winnerAgentId: null,
        context: model.context,
        readModel: model,
    };
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
    buildActionReason,
    getDashboardNextActions,
    getDashboardNextCommand,
    formatBoardCommand,
};
