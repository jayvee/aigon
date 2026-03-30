'use strict';

const stateMachine = require('./state-queries');

function padEntityId(entityId) {
    return String(entityId || '').padStart(2, '0');
}

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

function buildActionReason(entityType, stage, action) {
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

function formatDashboardCommand(entityType, entityId, stage, actionObj) {
    const id = padEntityId(entityId);
    const agentSuffix = actionObj.agentId ? ` ${actionObj.agentId}` : '';

    switch (actionObj.action) {
        case 'feature-open': return `aigon feature-open ${id}${agentSuffix}`;
        case 'feature-attach': return `aigon terminal-attach ${id}${agentSuffix}`;
        case 'feature-focus': return `aigon terminal-focus ${id}${agentSuffix}`;
        case 'feature-stop': return `aigon feature-stop ${id}${agentSuffix}`;
        case 'feature-eval': return `/afe ${id}`;
        case 'feature-review': return `aigon feature-review ${id}`;
        case 'feature-close': return `aigon feature-close ${id}${agentSuffix}`;
        case 'feature-start': return `aigon feature-start ${id}`;
        case 'feature-autopilot': return `aigon feature-autopilot ${id}`;
        case 'research-open':
            return actionObj.agentId ? `aigon terminal-focus ${id}${agentSuffix} --research` : `aigon research-open ${id}`;
        case 'research-attach':
            return `aigon terminal-focus ${id}${agentSuffix} --research`;
        case 'research-eval': return `/are ${id}`;
        case 'research-close': return `aigon research-close ${id}${agentSuffix}`;
        case 'research-start': return `aigon research-start ${id}`;
        case 'feature-prioritise': return `aigon feature-prioritise ${entityId}`;
        case 'research-prioritise': return `aigon research-prioritise ${entityId}`;
        default: return `aigon ${actionObj.action} ${id}${agentSuffix}`;
    }
}

function getDashboardNextActions(entityType, entityId, currentStage, agents) {
    if (!Array.isArray(agents) || agents.length === 0) return [];

    const model = getWorkflowReadModel(entityType, entityId, currentStage, agents);
    return model.recommendedActions.map(actionObj => ({
        command: formatDashboardCommand(entityType, entityId, currentStage, actionObj),
        label: actionObj.label,
        reason: buildActionReason(entityType, currentStage, actionObj.action),
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
    const id = padEntityId(entityId);
    const isSolo = actionObj.agentId === 'solo' || !actionObj.agentId;

    switch (actionObj.action) {
        case 'feature-prioritise': return `aigon feature-prioritise ${entityId}`;
        case 'research-prioritise': return `aigon research-prioritise ${entityId}`;
        case 'feature-start': return `aigon feature-start ${id}`;
        case 'research-start': return `aigon research-start ${id}`;
        case 'feature-open': return isSolo ? `aigon feature-do ${id}` : `aigon feature-open ${id} ${actionObj.agentId}`;
        case 'research-open': return isSolo ? `aigon research-do ${id}` : `aigon terminal-focus ${id} ${actionObj.agentId} --research`;
        case 'feature-attach':
        case 'feature-focus': return isSolo ? `aigon terminal-focus ${id}` : `aigon terminal-focus ${id} ${actionObj.agentId}`;
        case 'research-attach': return `aigon terminal-focus ${id} ${actionObj.agentId} --research`;
        case 'feature-eval': return `aigon feature-eval ${id}`;
        case 'research-eval': return `aigon research-eval ${id}`;
        case 'feature-close': return isSolo ? `aigon feature-close ${id}` : `aigon feature-close ${id} ${actionObj.agentId}`;
        case 'research-close': return isSolo ? `aigon research-close ${id}` : `aigon research-close ${id} ${actionObj.agentId}`;
        case 'feature-review': return `aigon feature-review ${id}`;
        case 'feature-autopilot': return `aigon feature-autopilot ${id}`;
        default: return null;
    }
}

module.exports = {
    buildWorkflowStateContext,
    getWorkflowReadModel,
    buildActionReason,
    getDashboardNextActions,
    getDashboardNextCommand,
    formatBoardCommand,
};
