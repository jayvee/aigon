'use strict';

const stateQueries = require('./state-queries');
const { ACTION_SCOPES } = require('./action-scope');
const {
    FEATURE_ENGINE_STATES,
    FEATURE_ENGINE_GUARDS,
} = require('./feature-workflow-rules');

function formatValue(value, fallback = '-') {
    return value === undefined || value === null || value === '' ? fallback : String(value);
}

function renderFeatureEngineRules() {
    const lines = [];
    lines.push('# Feature Engine Rules');
    lines.push('');
    Object.entries(FEATURE_ENGINE_RULES).forEach(([state, transitions]) => {
        lines.push(`## ${state}`);
        lines.push('');
        if (transitions.length === 0) {
            lines.push('- No outgoing transitions.');
            lines.push('');
            return;
        }
        transitions.forEach(transition => {
            const parts = [
                `- ${transition.event} -> ${transition.to}`,
                transition.guard ? `guard: ${transition.guard}` : null,
                transition.effect ? `effect: ${transition.effect}` : null,
            ].filter(Boolean);
            lines.push(parts.join(' | '));
        });
        lines.push('');
    });

    lines.push('# Feature Engine Guards');
    lines.push('');
    Object.entries(FEATURE_ENGINE_GUARDS).forEach(([guard, description]) => {
        lines.push(`- ${guard}: ${description}`);
    });
    lines.push('');
    return lines.join('\n');
}

function renderStateQueryEntity(entityType) {
    const def = stateQueries.ENTITY_DEFINITIONS[entityType];
    const lines = [];
    lines.push(`# ${entityType[0].toUpperCase()}${entityType.slice(1)} Read-Side Rules`);
    lines.push('');
    lines.push('## Stages');
    lines.push('');
    def.stages.forEach(stage => lines.push(`- ${stage}`));
    lines.push('');

    lines.push('## Stage Transitions');
    lines.push('');
    def.transitions.forEach(transition => {
        const parts = [
            `- ${transition.from} -> ${transition.to}`,
            `action: ${transition.action}`,
            transition.requiresInput ? `requiresInput: ${transition.requiresInput}` : null,
            transition.uiTrigger ? `uiTrigger: ${transition.uiTrigger}` : null,
            transition.guard && transition.guard.name ? `guard: ${transition.guard.name}` : null,
        ].filter(Boolean);
        lines.push(parts.join(' | '));
    });
    if (def.transitions.length === 0) lines.push('- None');
    lines.push('');

    lines.push('## In-State Actions');
    lines.push('');
    def.actions.forEach(action => {
        const parts = [
            `- stage: ${action.stage}`,
            `action: ${action.action}`,
            action.perAgent ? 'perAgent: true' : null,
            action.mode ? `mode: ${action.mode}` : null,
            action.priority ? `priority: ${action.priority}` : null,
            action.requiresInput ? `requiresInput: ${action.requiresInput}` : null,
            action.guard && action.guard.name ? `guard: ${action.guard.name}` : null,
        ].filter(Boolean);
        lines.push(parts.join(' | '));
    });
    if (def.actions.length === 0) lines.push('- None');
    lines.push('');
    return lines.join('\n');
}

function renderActionScopes() {
    const lines = [];
    lines.push('# Action Scopes');
    lines.push('');
    Object.entries(ACTION_SCOPES)
        .sort(([left], [right]) => left.localeCompare(right))
        .forEach(([action, def]) => {
            lines.push(`- ${action}: ${def.scope}`);
        });
    lines.push('');
    return lines.join('\n');
}

function buildWorkflowRulesReport() {
    return [
        renderFeatureEngineRules(),
        renderStateQueryEntity('feature'),
        renderStateQueryEntity('research'),
        renderStateQueryEntity('feedback'),
        renderActionScopes(),
    ].join('\n');
}

function buildWorkflowRulesJson() {
    return {
        featureEngine: {
            states: FEATURE_ENGINE_STATES,
            guards: FEATURE_ENGINE_GUARDS,
        },
        stateQueries: {
            feature: stateQueries.ENTITY_DEFINITIONS.feature,
            research: stateQueries.ENTITY_DEFINITIONS.research,
            feedback: stateQueries.ENTITY_DEFINITIONS.feedback,
        },
        actionScopes: ACTION_SCOPES,
    };
}

module.exports = {
    FEATURE_ENGINE_STATES,
    FEATURE_ENGINE_GUARDS,
    buildWorkflowRulesReport,
    buildWorkflowRulesJson,
    formatValue,
};
