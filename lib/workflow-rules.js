'use strict';

const featureRules = require('./feature-workflow-rules');
const researchRules = require('./research-workflow-rules');

function getEngineStateRules(entityType = 'feature') {
    return entityType === 'research'
        ? researchRules.RESEARCH_ENGINE_STATES
        : featureRules.FEATURE_ENGINE_STATES;
}

function getActionCandidates(entityType = 'feature') {
    return entityType === 'research'
        ? researchRules.RESEARCH_ACTION_CANDIDATES
        : featureRules.FEATURE_ACTION_CANDIDATES;
}

module.exports = {
    getEngineStateRules,
    getActionCandidates,
    FEATURE_ENGINE_STATES: featureRules.FEATURE_ENGINE_STATES,
    FEATURE_ACTION_CANDIDATES: featureRules.FEATURE_ACTION_CANDIDATES,
    RESEARCH_ENGINE_STATES: researchRules.RESEARCH_ENGINE_STATES,
    RESEARCH_ACTION_CANDIDATES: researchRules.RESEARCH_ACTION_CANDIDATES,
};
