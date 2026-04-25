'use strict';

const featureRules = require('./feature-workflow-rules');
const researchRules = require('./research-workflow-rules');

function getEngineStateRules(entityType = 'feature') {
    return entityType === 'research'
        ? researchRules.RESEARCH_ENGINE_STATES
        : featureRules.FEATURE_ENGINE_STATES;
}

function getTransientStates(entityType = 'feature') {
    return entityType === 'research'
        ? researchRules.RESEARCH_TRANSIENT_STATES
        : featureRules.FEATURE_TRANSIENT_STATES;
}

function getActionCandidates(entityType = 'feature') {
    if (entityType === 'research') {
        return [
            ...researchRules.RESEARCH_ACTION_CANDIDATES,
            ...researchRules.RESEARCH_INFRA_CANDIDATES,
        ];
    }
    return [
        ...featureRules.FEATURE_ACTION_CANDIDATES,
        ...featureRules.FEATURE_INFRA_CANDIDATES,
    ];
}

module.exports = {
    getEngineStateRules,
    getTransientStates,
    getActionCandidates,
    FEATURE_ENGINE_STATES: featureRules.FEATURE_ENGINE_STATES,
    FEATURE_TRANSIENT_STATES: featureRules.FEATURE_TRANSIENT_STATES,
    FEATURE_ACTION_CANDIDATES: featureRules.FEATURE_ACTION_CANDIDATES,
    FEATURE_INFRA_CANDIDATES: featureRules.FEATURE_INFRA_CANDIDATES,
    RESEARCH_ENGINE_STATES: researchRules.RESEARCH_ENGINE_STATES,
    RESEARCH_TRANSIENT_STATES: researchRules.RESEARCH_TRANSIENT_STATES,
    RESEARCH_ACTION_CANDIDATES: researchRules.RESEARCH_ACTION_CANDIDATES,
    RESEARCH_INFRA_CANDIDATES: researchRules.RESEARCH_INFRA_CANDIDATES,
};
