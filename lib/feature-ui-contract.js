'use strict';

const { normalizeRuntimeFacts } = require('./workflow-core');
const { FEATURE_INTERACTION_DEFINITION } = require('./feature-workflow-rules');
const {
    ENTITY_UI_CONTRACT_VERSION,
    buildEntityUiContract,
    entityUiContractFingerprint,
    projectAction,
    slugFromSpecPath,
} = require('./entity-ui-contract');

const FEATURE_UI_CONTRACT_VERSION = ENTITY_UI_CONTRACT_VERSION;

function choosePrimary(actions, feature, runtimeFacts) {
    let available = actions.filter(action => !action.disabled && action.interaction.surface !== 'agent');

    // A pending spec review demotes Start: revising the spec is the decision.
    const pendingSpecReview = (feature.specReviewSessions || []).some(review => review && review.status === 'pending');
    if (pendingSpecReview && available.some(action => action.actionId === 'feature-spec-revise')) {
        available = available.filter(action => action.actionId !== 'feature-start');
    }
    if (available.length === 0) return null;

    const blockerKind = runtimeFacts.closeReadiness
        && runtimeFacts.closeReadiness.applicable
        && runtimeFacts.closeReadiness.primaryBlocker
        && runtimeFacts.closeReadiness.primaryBlocker.actionKind;
    if (blockerKind && available.some(action => action.actionId === blockerKind)) return blockerKind;

    // Once a winner is picked, closing is the decision — not another eval round.
    if (feature.evalStatus === 'pick winner' && feature.winnerAgent
        && available.some(action => action.actionId === 'feature-close')) {
        return 'feature-close';
    }

    const recovery = available.find(action => action.group === 'recovery');
    if (feature.cardPresentation && feature.cardPresentation.severity === 'error' && recovery) {
        return recovery.actionId;
    }
    const preferred = available.find(action => action.intent === 'primary');
    return (preferred || available[0]).actionId;
}

function buildBlockers(feature, runtimeFacts) {
    const blockers = runtimeFacts.blockers.slice();
    (feature.blockedBy || []).forEach(item => blockers.push({
        kind: 'dependency',
        id: item.id,
        label: item.name || `Feature ${item.id}`,
    }));
    const readiness = runtimeFacts.closeReadiness;
    if (readiness && readiness.applicable && !readiness.ready && readiness.primaryBlocker) {
        blockers.push({ ...readiness.primaryBlocker, kind: readiness.primaryBlocker.kind || 'close-readiness' });
    }
    return blockers;
}

function collectFeatureSessions(feature) {
    const sessions = Array.isArray(feature.sessions) ? feature.sessions.slice() : [];
    (feature.agents || []).forEach((agent) => {
        const sessionName = agent.tmuxSession || agent.sessionName;
        if (!sessionName || sessions.some(session => (session.sessionName || session.session) === sessionName)) return;
        sessions.push({
            sessionName,
            agentId: agent.id || null,
            role: agent.role || 'implementation',
            running: agent.tmuxRunning !== false && agent.sessionRunning !== false,
        });
    });
    const named = [
        [feature.evalSession, 'evaluation'],
        [feature.autonomousSession, 'autonomous'],
        [feature.recoveryTmuxSession, 'close-recovery'],
        ...((feature.reviewSessionSummary || []).map(session => [session, 'code-review'])),
        ...((feature.specReviewSessions || []).map(session => [session, 'spec-review'])),
        ...((feature.specRevisionSessions || []).map(session => [session, 'spec-revision'])),
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
            status: source.status || (source.completedAt ? 'complete' : null),
        });
    });
    return sessions;
}

function buildFeaturePlan(plan, sessions, controller) {
    if (!plan || !Array.isArray(plan.stages)) return null;
    const stages = plan.stages.map((stage) => {
        const stageAgents = new Set((stage.agents || []).map(agent => String(agent.id)));
        const sessionIds = sessions
            .filter(session => (session.sessionId || session.sessionName || session.session) && (
                (session.stageType && session.stageType === stage.type)
                || (!session.stageType && session.agentId && stageAgents.has(String(session.agentId)))
                || (stage.type === 'eval' && session.role === 'evaluation')
                || (stage.type === 'review' && ['review', 'code-review', 'findings-review'].includes(session.role))
                || (stage.type === 'revision' && ['revision', 'code-revision'].includes(session.role))
                || (stage.type === 'close' && session.role === 'close-recovery')
            ))
            .map(session => session.sessionId || session.sessionName || session.session);
        return { ...stage, sessionIds };
    });
    const controllerSession = sessions.find(session => session.role === 'autonomous');
    return {
        ...plan,
        controller: controller || null,
        controllerSessionId: controllerSession
            ? (controllerSession.sessionId || controllerSession.sessionName || controllerSession.session)
            : null,
        ownedSessionIds: [...new Set(stages.flatMap(stage => stage.sessionIds))],
        stages,
    };
}

function buildFeatureUiContract(feature, aggregate = {}, runtimeInput = {}) {
    const runtimeFacts = normalizeRuntimeFacts({
        agents: feature.agents,
        sessions: collectFeatureSessions(feature),
        autonomousController: feature.autonomousController,
        autonomousPlan: feature.autonomousPlan,
        closeReadiness: feature.closeReadiness,
        evalSession: feature.evalSession,
        blockers: runtimeInput.blockers,
        specDrift: feature.specDrift,
        devServerAvailable: runtimeInput.devServerAvailable,
        extensions: runtimeInput.extensions,
    });
    const evalRunning = Boolean(runtimeFacts.evalSession && runtimeFacts.evalSession.running);
    const dependencyIds = (feature.blockedBy || []).map(item => item.id);
    const projected = (feature.validActions || [])
        // A running eval session makes re-evaluation/review unavailable with no
        // stable reason to show, so the actions are absent rather than disabled.
        .filter(action => !(evalRunning && (action.action === 'feature-eval' || action.action === 'feature-code-review')))
        .map(action => (dependencyIds.length > 0 && action.action === 'feature-start'
            ? {
                ...action,
                disabled: true,
                disabledReason: `Start unlocks when these are done: ${dependencyIds.map(id => `#${id}`).join(', ')}`,
            }
            : action))
        .map(action => projectAction(action, 'feature'));
    const decisions = projected.filter(action => action.group !== 'tool');
    const primaryActionId = choosePrimary(decisions, feature, runtimeFacts);

    const lifecycle = aggregate.currentSpecState || aggregate.lifecycle || feature.currentSpecState || null;
    const machineStateMeta = FEATURE_INTERACTION_DEFINITION.stateMeta[lifecycle] || {};
    const stateMeta = feature.stateRenderMeta || {};
    const presentation = feature.cardPresentation || {};
    return buildEntityUiContract({
        entity: {
            type: 'feature',
            id: String(feature.id),
            numericId: feature.numericId !== undefined ? feature.numericId : feature.id,
            displayKey: feature.displayKey
                || (/^\d+$/.test(String(feature.id || '')) ? `F${feature.id}` : null),
            name: feature.name || '',
            title: feature.name || '',
            slug: feature.slug || slugFromSpecPath(feature.specPath),
            setSlug: feature.set || null,
        },
        state: {
            lifecycle,
            phase: machineStateMeta.phase || lifecycle,
            lane: machineStateMeta.lane || feature.stage || null,
            label: stateMeta.label || presentation.stateLabel || machineStateMeta.label || lifecycle || '',
            severity: presentation.severity || stateMeta.severity || machineStateMeta.severity || 'normal',
        },
        presentation: {
            headline: feature.cardHeadline || null,
            contextLine: presentation.contextLine || null,
            timeline: presentation.timeline || null,
            agentSummary: presentation.agentSummary || null,
            closeReadiness: runtimeFacts.closeReadiness,
        },
        actions: projected,
        primaryActionId,
        blockers: buildBlockers(feature, runtimeFacts),
        history: Array.isArray(feature.history) ? feature.history.slice() : [],
        agents: runtimeFacts.agents,
        sessions: runtimeFacts.sessions,
        plan: buildFeaturePlan(runtimeFacts.autonomousPlan, runtimeFacts.sessions, runtimeFacts.autonomousController),
    });
}

function featureUiContractFingerprint(contract) {
    return entityUiContractFingerprint(contract);
}

module.exports = {
    FEATURE_UI_CONTRACT_VERSION,
    buildFeatureUiContract,
    featureUiContractFingerprint,
};
