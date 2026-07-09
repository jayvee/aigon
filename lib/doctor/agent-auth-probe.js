'use strict';

/**
 * Doctor auth probes must never launch interactive `agy` (opens Google sign-in).
 * REGRESSION: F616 incident class — same guard as agent-quota-poller / probe-agent.
 */

const NON_PROBE_AGENT_IDS = new Set(['ag']);

function authCommandSpawnsAgy(command) {
    return /\bagy\b/.test(String(command || ''));
}

function shouldSkipDoctorAuthProbe(agentId, authCheck = {}) {
    const id = String(agentId || '').trim().toLowerCase();
    if (NON_PROBE_AGENT_IDS.has(id)) return true;
    if (authCheck.skipDoctorProbe === true) return true;
    if (authCheck.method === 'command' && authCommandSpawnsAgy(authCheck.command)) return true;
    return false;
}

function doctorAuthStatusForSkippedAgent(authCheck = {}) {
    const token = String(process.env.ANTIGRAVITY_TOKEN || process.env.AGY_TOKEN || '').trim();
    if (token) {
        return { status: 'authenticated', message: 'ANTIGRAVITY_TOKEN set' };
    }
    const hint = authCheck.loginHint
        || 'launch agy interactively for Google sign-in, or set ANTIGRAVITY_TOKEN';
    return { status: 'external', message: `doctor does not launch agy — ${hint}` };
}

module.exports = {
    NON_PROBE_AGENT_IDS,
    authCommandSpawnsAgy,
    shouldSkipDoctorAuthProbe,
    doctorAuthStatusForSkippedAgent,
};
