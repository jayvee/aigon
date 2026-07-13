'use strict';

const RUNTIME_FACTS_VERSION = 1;

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
}

function normalizeRuntimeFacts(input = {}) {
    const facts = {
        factsVersion: RUNTIME_FACTS_VERSION,
        agents: Array.isArray(input.agents) ? input.agents.map(agent => ({ ...agent })) : [],
        sessions: Array.isArray(input.sessions) ? input.sessions.map(session => ({ ...session })) : [],
        autonomousController: input.autonomousController ? { ...input.autonomousController } : null,
        closeReadiness: input.closeReadiness ? { ...input.closeReadiness } : null,
        blockers: Array.isArray(input.blockers) ? input.blockers.map(blocker => ({ ...blocker })) : [],
        specDrift: Boolean(input.specDrift),
        devServerAvailable: Boolean(input.devServerAvailable),
        extensions: input.extensions && typeof input.extensions === 'object' ? { ...input.extensions } : {},
    };
    return deepFreeze(facts);
}

module.exports = {
    RUNTIME_FACTS_VERSION,
    normalizeRuntimeFacts,
};
