'use strict';

const { normalizeRuntimeFacts } = require('./workflow-core');
const { RESEARCH_INTERACTION_DEFINITION } = require('./research-workflow-rules');
const {
    ENTITY_UI_CONTRACT_VERSION,
    buildEntityUiContract,
    entityUiContractFingerprint,
    projectAction,
} = require('./entity-ui-contract');

const RESEARCH_UI_CONTRACT_VERSION = ENTITY_UI_CONTRACT_VERSION;

function collectResearchSessions(research) {
    const sessions = Array.isArray(research.sessions) ? research.sessions.slice() : [];
    (research.agents || []).forEach((agent) => {
        const sessionName = agent.tmuxSession || agent.sessionName;
        if (!sessionName || sessions.some(session => (session.sessionName || session.session) === sessionName)) return;
        sessions.push({
            sessionName,
            agentId: agent.id || null,
            role: agent.role || 'research',
            running: agent.tmuxRunning !== false && agent.sessionRunning !== false,
        });
    });
    const named = [
        [research.evalSession, 'evaluation'],
        ...((research.reviewSessionSummary || []).map(session => [session, 'findings-review'])),
        ...((research.specReviewSessions || []).map(session => [session, 'spec-review'])),
        ...((research.specRevisionSessions || []).map(session => [session, 'spec-revision'])),
    ];
    named.forEach(([source, role]) => {
        if (!source) return;
        const sessionName = source.sessionName || source.session;
        if (!sessionName || sessions.some(session => (session.sessionName || session.session) === sessionName)) return;
        sessions.push({
            ...source,
            sessionName,
            agentId: source.agentId || source.agent || null,
            role,
            running: source.running === true || source.sessionRunning === true,
        });
    });
    return sessions;
}

function choosePrimary(actions, research) {
    let available = actions.filter(action => !action.disabled && action.interaction.surface !== 'agent');
    const pendingReview = (research.specReviewSessions || []).some(review => review && review.status === 'pending');
    if (pendingReview && available.some(action => action.actionId === 'research-spec-revise')) {
        available = available.filter(action => action.actionId !== 'research-start');
    }
    if (available.length === 0) return null;
    const recovery = available.find(action => action.group === 'recovery');
    if (research.cardPresentation && research.cardPresentation.severity === 'error' && recovery) return recovery.actionId;
    return (available.find(action => action.intent === 'primary') || available[0]).actionId;
}

function buildResearchUiContract(research, aggregate = {}, runtimeInput = {}) {
    const runtimeFacts = normalizeRuntimeFacts({
        agents: research.agents,
        sessions: collectResearchSessions(research),
        evalSession: research.evalSession,
        blockers: runtimeInput.blockers,
        specDrift: research.specDrift,
        extensions: runtimeInput.extensions,
    });
    const evalRunning = Boolean(runtimeFacts.evalSession && runtimeFacts.evalSession.running);
    const actions = (research.validActions || [])
        .filter(action => !(evalRunning && ['research-eval', 'research-review'].includes(action.action)))
        .map(action => projectAction(action, 'research'));
    const decisions = actions.filter(action => action.group !== 'tool');
    const lifecycle = aggregate.currentSpecState || aggregate.lifecycle || research.currentSpecState || null;
    const machineStateMeta = RESEARCH_INTERACTION_DEFINITION.stateMeta[lifecycle] || {};
    const stateMeta = research.stateRenderMeta || {};
    const presentation = research.cardPresentation || {};

    return buildEntityUiContract({
        entity: {
            type: 'research',
            id: String(research.id),
            displayKey: research.displayKey || `R${research.id}`,
            name: research.name || '',
        },
        state: {
            lifecycle,
            phase: machineStateMeta.phase || lifecycle,
            lane: machineStateMeta.lane || research.stage || null,
            label: stateMeta.label || presentation.stateLabel || machineStateMeta.label || lifecycle || '',
            severity: presentation.severity || stateMeta.severity || machineStateMeta.severity || 'normal',
        },
        presentation: {
            headline: research.cardHeadline || null,
            contextLine: presentation.contextLine || null,
            timeline: presentation.timeline || null,
            agentSummary: presentation.agentSummary || null,
        },
        actions,
        primaryActionId: choosePrimary(decisions, research),
        blockers: runtimeFacts.blockers,
        history: research.history,
        agents: runtimeFacts.agents,
        sessions: runtimeFacts.sessions,
        plan: runtimeFacts.entityPlan,
    });
}

module.exports = {
    RESEARCH_UI_CONTRACT_VERSION,
    buildResearchUiContract,
    researchUiContractFingerprint: entityUiContractFingerprint,
};
