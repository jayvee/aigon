'use strict';

const { FEATURE_SET_INTERACTION_DEFINITION } = require('./feature-set-workflow-rules');
const {
    ENTITY_UI_CONTRACT_VERSION,
    buildEntityUiContract,
    entityUiContractFingerprint,
    projectAction,
} = require('./entity-ui-contract');

const FEATURE_SET_UI_CONTRACT_VERSION = ENTITY_UI_CONTRACT_VERSION;

function collectSetSessions(setCard) {
    const sessions = [];
    const sources = [
        [setCard.specReview, 'set-spec-review'],
        [setCard.specRevision, 'set-spec-revision'],
        [setCard.autonomous, 'set-conductor'],
    ];
    sources.forEach(([source, role]) => {
        if (!source) return;
        const sessionName = source.sessionName || source.session;
        if (!sessionName) return;
        sessions.push({
            sessionName,
            agentId: source.agentId || source.agent || null,
            role,
            running: source.running === true || source.sessionRunning === true || source.status === 'running',
        });
    });
    return sessions;
}

function buildSetPlan(setCard) {
    const nodes = setCard.depGraph && Array.isArray(setCard.depGraph.nodes)
        ? setCard.depGraph.nodes
        : [];
    return {
        controller: setCard.autonomous || null,
        progress: {
            ...(setCard.progress || { merged: 0, total: nodes.length, percent: 0 }),
            complete: Number(setCard.progress && setCard.progress.merged) || 0,
        },
        currentFeature: setCard.currentFeature || null,
        currentFeatureContract: setCard.currentFeatureContract || null,
        members: nodes.map(node => ({
            id: node.featureId || node.id,
            label: node.label || '',
            state: node.state || 'backlog',
            status: node.state === 'done' ? 'complete' : (node.state === 'in-progress' ? 'running' : (node.state || 'waiting')),
            stage: node.stage || null,
            isCurrent: Boolean(node.isCurrent),
        })),
        dependencies: setCard.depGraph && Array.isArray(setCard.depGraph.edges)
            ? setCard.depGraph.edges.slice()
            : [],
    };
}

function buildFeatureSetUiContract(setCard) {
    const status = String(setCard.status || (setCard.isComplete ? 'done' : 'idle'));
    const stateMeta = FEATURE_SET_INTERACTION_DEFINITION.stateMeta[status]
        || FEATURE_SET_INTERACTION_DEFINITION.stateMeta.idle;
    const actions = (setCard.validActions || []).map(action => projectAction(action, 'feature-set'));
    const decisions = actions.filter(action => action.group !== 'tool' && !action.disabled && action.interaction.surface !== 'agent');
    const primary = decisions.find(action => action.intent === 'primary') || decisions[0] || null;

    return buildEntityUiContract({
        entity: {
            type: 'feature-set',
            id: String(setCard.slug),
            displayKey: String(setCard.slug),
            name: setCard.goal || String(setCard.slug).replace(/-/g, ' '),
        },
        state: {
            lifecycle: status,
            phase: stateMeta.phase,
            lane: stateMeta.lane,
            label: stateMeta.label,
            severity: stateMeta.severity,
        },
        presentation: {
            headline: setCard.lastEvent || null,
            contextLine: setCard.goal || null,
            timeline: null,
            agentSummary: null,
        },
        actions,
        primaryActionId: primary ? primary.actionId : null,
        sessions: collectSetSessions(setCard),
        plan: buildSetPlan(setCard),
    });
}

module.exports = {
    FEATURE_SET_UI_CONTRACT_VERSION,
    buildFeatureSetUiContract,
    featureSetUiContractFingerprint: entityUiContractFingerprint,
};
