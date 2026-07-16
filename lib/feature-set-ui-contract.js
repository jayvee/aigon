'use strict';

const { FEATURE_SET_INTERACTION_DEFINITION, resolveSetLifecycle } = require('./feature-set-workflow-rules');
const {
    ENTITY_UI_CONTRACT_VERSION,
    buildEntityUiContract,
    entityUiContractFingerprint,
    normalizeSessions,
    projectAction,
} = require('./entity-ui-contract');

const FEATURE_SET_UI_CONTRACT_VERSION = ENTITY_UI_CONTRACT_VERSION;

// F678: set spec-cycle status is a server fact derived from member snapshots and
// workflow events — never from whether a tmux session still exists. The session
// reference is carried alongside it, deliberately separate, so the browser can
// offer inspection without ever reading liveness as progress.
function projectSpecCycleSide(side, normalizedSessions) {
    const source = side || {};
    const sessionRef = source.session || null;
    const sessionId = sessionRef && (sessionRef.sessionName || sessionRef.session) || null;
    const normalized = sessionId
        ? normalizedSessions.find(session => session.sessionId === sessionId) || null
        : null;
    return {
        status: source.status || 'inactive',
        label: source.label || '',
        pendingCount: Number(source.pendingCount) || 0,
        memberCount: Number(source.memberCount) || 0,
        completedAt: source.completedAt || null,
        commitSha: source.commitSha || null,
        sessionId,
        sessionRunning: Boolean(normalized && normalized.running),
        inspectable: Boolean(normalized && normalized.inspectable),
        inspection: normalized ? normalized.inspection : null,
    };
}

function projectSpecCycle(specCycle, normalizedSessions) {
    if (!specCycle) return null;
    return {
        review: projectSpecCycleSide(specCycle.review, normalizedSessions),
        revision: projectSpecCycleSide(specCycle.revision, normalizedSessions),
    };
}

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
        const running = source.running === true || source.sessionRunning === true || source.status === 'running';
        sessions.push({
            sessionName,
            agentId: source.agentId || source.agent || null,
            role,
            running,
            // A conductor that has ended keeps its retained console: carry the
            // real status through so inspection survives the tmux session.
            status: source.status || (running ? 'running' : null),
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
            status: node.stage === 'inbox' ? 'inbox'
                : node.state === 'done' ? 'complete'
                : node.state === 'in-progress' ? 'running'
                : node.state === 'in-review' ? 'in-review'
                : node.state === 'failed' ? 'failed'
                : node.state === 'blocked' ? 'blocked'
                : (node.state || 'waiting'),
            stage: node.stage || null,
            isCurrent: Boolean(node.isCurrent),
        })),
        dependencies: setCard.depGraph && Array.isArray(setCard.depGraph.edges)
            ? setCard.depGraph.edges.slice()
            : [],
        presentation: {
            suppressProgress: false,
            suppressMemberList: true,
        },
    };
}

function chooseSetPrimaryAction(decisions, setCard) {
    const available = decisions.filter(action => !action.disabled && action.interaction.surface !== 'agent');
    if (available.length === 0) return null;
    const inbox = Number(setCard.inboxMemberCount) || 0;
    if (inbox > 0) {
        const prioritise = available.find(action => action.actionId === 'set-prioritise');
        if (prioritise) return prioritise.actionId;
    }
    for (const actionId of ['feature-set-spec-review', 'feature-set-spec-revise', 'set-autonomous-start']) {
        const match = available.find(action => action.actionId === actionId);
        if (match) return match.actionId;
    }
    const preferred = available.find(action => action.intent === 'primary');
    return (preferred || available[0]).actionId;
}

function buildFeatureSetUiContract(setCard) {
    const lifecycle = resolveSetLifecycle(setCard);
    const inboxOnly = lifecycle === 'inbox';
    const stateMeta = FEATURE_SET_INTERACTION_DEFINITION.stateMeta[lifecycle]
        || FEATURE_SET_INTERACTION_DEFINITION.stateMeta.idle;
    const actions = (setCard.validActions || []).map(action => projectAction(action, 'feature-set'));
    const decisions = actions.filter(action => action.group !== 'tool' && !action.disabled && action.interaction.surface !== 'agent');
    const primaryActionId = chooseSetPrimaryAction(decisions, setCard);
    const sessions = collectSetSessions(setCard);
    const normalizedSessions = normalizeSessions(sessions);

    return buildEntityUiContract({
        entity: {
            type: 'feature-set',
            id: String(setCard.slug),
            numericId: null,
            displayKey: String(setCard.slug),
            name: setCard.goal || String(setCard.slug).replace(/-/g, ' '),
            title: setCard.goal || String(setCard.slug).replace(/-/g, ' '),
            slug: String(setCard.slug),
        },
        state: {
            lifecycle,
            phase: stateMeta.phase,
            lane: stateMeta.lane,
            label: stateMeta.label,
            severity: stateMeta.severity,
            specCycle: projectSpecCycle(setCard.specCycle, normalizedSessions),
        },
        presentation: {
            headline: setCard.lastEvent || null,
            contextLine: inboxOnly ? null : (setCard.goal || null),
            timeline: null,
            agentSummary: null,
            suppressStateLine: inboxOnly,
        },
        actions,
        primaryActionId,
        sessions,
        plan: buildSetPlan(setCard),
    });
}

module.exports = {
    FEATURE_SET_UI_CONTRACT_VERSION,
    buildFeatureSetUiContract,
    featureSetUiContractFingerprint: entityUiContractFingerprint,
};
