'use strict';

const { normalizeRuntimeFacts } = require('./workflow-core/runtime-facts');

const FEATURE_UI_CONTRACT_VERSION = 1;
const TOOL_CATEGORIES = new Set(['session', 'infra', 'view', 'agent-control']);
const TOOL_ACTIONS = new Set([
    'feature-push',
    'feature-nudge',
    'feature-reset',
    'feature-stop',
    'feature-delete',
    'open-session',
    'open-eval-session',
    'view-eval',
    'view-work',
    'dev-server-poke',
    'reconcile-spec-drift',
    'mark-submitted',
    'reopen-agent',
    'switch-agent',
    'restart-agent',
    'force-agent-ready',
    'drop-agent',
]);

function actionGroup(action) {
    if (TOOL_CATEGORIES.has(action.category) || TOOL_ACTIONS.has(action.action)) return 'tool';
    if (action.metadata && (action.metadata.recovery || action.metadata.recoverySurface)) return 'recovery';
    return 'decision';
}

function interactionFor(action) {
    const metadata = action.metadata || {};
    return {
        surface: action.agentId ? 'agent' : (metadata.clientAction || action.requiresInput || 'dispatch'),
        handler: metadata.apiEndpoint || metadata.clientAction || action.action,
        requiredInput: action.requiresInput || null,
        confirmation: metadata.confirmationMessage || null,
        destructive: Boolean(metadata.destructive),
    };
}

function projectAction(action) {
    return Object.freeze({
        actionId: action.action,
        label: action.label,
        group: actionGroup(action),
        order: Number.isFinite(action.recommendedOrder) ? action.recommendedOrder : 999,
        intent: action.priority === 'high' ? 'primary' : (action.metadata && action.metadata.destructive ? 'danger' : 'default'),
        scope: action.agentId ? 'agent' : (action.scope || 'feature'),
        agentId: action.agentId || null,
        eventType: action.eventType || null,
        transition: action.type === 'transition' ? { to: action.to || null } : null,
        disabled: Boolean(action.disabled),
        unavailableReason: action.disabledReason || null,
        interaction: Object.freeze(interactionFor(action)),
        metadata: Object.freeze({ ...(action.metadata || {}) }),
    });
}

function choosePrimary(actions, feature, runtimeFacts) {
    const available = actions.filter(action => !action.disabled && action.interaction.surface !== 'agent');
    if (available.length === 0) return null;

    const blockerKind = runtimeFacts.closeReadiness
        && runtimeFacts.closeReadiness.applicable
        && runtimeFacts.closeReadiness.primaryBlocker
        && runtimeFacts.closeReadiness.primaryBlocker.actionKind;
    if (blockerKind && available.some(action => action.actionId === blockerKind)) return blockerKind;

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

function buildFeatureUiContract(feature, aggregate = {}, runtimeInput = {}) {
    const runtimeFacts = normalizeRuntimeFacts({
        agents: feature.agents,
        sessions: feature.sessions,
        autonomousController: feature.autonomousController,
        closeReadiness: feature.closeReadiness,
        blockers: runtimeInput.blockers,
        specDrift: feature.specDrift,
        devServerAvailable: runtimeInput.devServerAvailable,
        extensions: runtimeInput.extensions,
    });
    const projected = (feature.validActions || []).map(projectAction);
    const decisions = projected.filter(action => action.group !== 'tool');
    const tools = projected.filter(action => action.group === 'tool');
    const primaryActionId = choosePrimary(decisions, feature, runtimeFacts);
    const primaryIds = primaryActionId ? [primaryActionId] : [];
    if (new Set(primaryIds).size > 1) throw new Error('Feature UI contract permits at most one primary action');

    const lifecycle = aggregate.currentSpecState || aggregate.lifecycle || feature.currentSpecState || null;
    const stateMeta = feature.stateRenderMeta || {};
    const presentation = feature.cardPresentation || {};
    const contract = {
        contractVersion: FEATURE_UI_CONTRACT_VERSION,
        entity: {
            id: String(feature.id),
            displayKey: feature.displayKey || `F${feature.id}`,
            name: feature.name || '',
        },
        state: {
            lifecycle,
            phase: lifecycle,
            lane: feature.stage || null,
            label: stateMeta.label || presentation.stateLabel || lifecycle || '',
            severity: presentation.severity || stateMeta.severity || 'normal',
        },
        presentation: {
            headline: feature.cardHeadline || null,
            contextLine: presentation.contextLine || null,
            timeline: presentation.timeline || null,
            agentSummary: presentation.agentSummary || null,
            closeReadiness: runtimeFacts.closeReadiness,
        },
        decisions: {
            primaryActionId,
            actions: decisions,
        },
        tools,
        blockers: buildBlockers(feature, runtimeFacts),
        allowedDrops: decisions
            .filter(action => action.transition && action.transition.to)
            .map(action => ({ actionId: action.actionId, lane: action.transition.to })),
        history: Array.isArray(feature.history) ? feature.history.slice() : [],
        agents: runtimeFacts.agents,
        sessions: runtimeFacts.sessions,
    };
    return Object.freeze(contract);
}

function featureUiContractFingerprint(contract) {
    if (!contract) return '';
    const actionKey = contract.decisions.actions.concat(contract.tools)
        .map(action => `${action.actionId}:${action.agentId || ''}:${action.disabled ? 1 : 0}`)
        .join('|');
    return [
        contract.contractVersion,
        contract.state.lifecycle,
        contract.state.lane,
        contract.state.severity,
        contract.decisions.primaryActionId || '',
        actionKey,
        contract.blockers.map(blocker => blocker.kind || '').join('|'),
    ].join(':');
}

module.exports = {
    FEATURE_UI_CONTRACT_VERSION,
    buildFeatureUiContract,
    featureUiContractFingerprint,
};
