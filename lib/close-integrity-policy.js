'use strict';

const CLOSE_INTEGRITY_GATES = Object.freeze([
    'review-escalation',
    'preauth-validation',
    'post-merge-gate',
]);

const CLOSE_INTEGRITY_GATE_SET = new Set(CLOSE_INTEGRITY_GATES);

function normalizeGateName(value) {
    const gate = String(value || '').trim();
    return CLOSE_INTEGRITY_GATE_SET.has(gate) ? gate : null;
}

function normalizeGateList(value) {
    if (!Array.isArray(value)) return [];
    return value.map(normalizeGateName).filter(Boolean);
}

function resolveCloseIntegrityPolicy(config = {}) {
    const featureClose = (config && config.featureClose) || {};
    const rawPreset = String(featureClose.integrityPolicy || 'advisory').trim().toLowerCase();
    const preset = rawPreset === 'blocking' || rawPreset === 'strict' ? 'blocking' : 'advisory';
    const blockingGates = new Set(preset === 'blocking' ? CLOSE_INTEGRITY_GATES : []);
    normalizeGateList(featureClose.blockingGates).forEach((gate) => blockingGates.add(gate));
    normalizeGateList(featureClose.advisoryGates).forEach((gate) => blockingGates.delete(gate));

    const perGate = featureClose.integrityGates || featureClose.integrityGateOverrides || {};
    if (perGate && typeof perGate === 'object' && !Array.isArray(perGate)) {
        for (const [rawGate, rawMode] of Object.entries(perGate)) {
            const gate = normalizeGateName(rawGate);
            if (!gate) continue;
            const mode = String(rawMode || '').trim().toLowerCase();
            if (mode === 'blocking' || mode === 'strict') blockingGates.add(gate);
            if (mode === 'advisory' || mode === 'warn') blockingGates.delete(gate);
        }
    }

    return {
        preset,
        blockingGates: [...blockingGates],
    };
}

function isCloseFindingBlocking(policy, gateName) {
    const gate = normalizeGateName(gateName);
    if (!gate) return false;
    const blocking = policy && Array.isArray(policy.blockingGates) ? policy.blockingGates : [];
    return blocking.includes(gate);
}

module.exports = {
    CLOSE_INTEGRITY_GATES,
    normalizeGateName,
    resolveCloseIntegrityPolicy,
    isCloseFindingBlocking,
};
