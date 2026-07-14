'use strict';

const RUNTIME_FACTS_VERSION = 2;

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
}

function normalizeRuntimeFacts(input = {}) {
    // Clone before freezing: the inputs (agents, closeReadiness, …) stay live on
    // the /api/status feature row, so freezing shared references would make any
    // later collector write throw in strict mode.
    const facts = global.structuredClone({
        factsVersion: RUNTIME_FACTS_VERSION,
        agents: Array.isArray(input.agents) ? input.agents : [],
        sessions: Array.isArray(input.sessions) ? input.sessions : [],
        autonomousController: input.autonomousController || null,
        autonomousPlan: input.autonomousPlan || null,
        entityPlan: input.entityPlan || null,
        closeReadiness: input.closeReadiness || null,
        evalSession: input.evalSession || null,
        blockers: Array.isArray(input.blockers) ? input.blockers : [],
        specDrift: Boolean(input.specDrift),
        devServerAvailable: Boolean(input.devServerAvailable),
        extensions: input.extensions && typeof input.extensions === 'object' ? input.extensions : {},
    });
    return deepFreeze(facts);
}

module.exports = {
    RUNTIME_FACTS_VERSION,
    normalizeRuntimeFacts,
};
