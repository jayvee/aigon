'use strict';

const fs = require('fs');
const path = require('path');
const agentRegistry = require('./agent-registry');
const { readJsonSafe, writeJsonAtomic } = require('./io/json');

const HANDOFF_VERSION = 1;
const HANDOFF_FIELDS = Object.freeze([
    'decisions',
    'constraints',
    'nonGoals',
    'unresolvedQuestions',
    'implementationNotes',
    'specReferences',
]);

function entityContextPath(repoPath, entityType, entityId) {
    const plural = entityType === 'research' ? 'research' : 'features';
    return path.join(path.resolve(repoPath), '.aigon', 'context', plural, `${String(entityId).padStart(2, '0')}.json`);
}

function operationalEntityContextPath(repoPath, entityType, entityId) {
    const plural = entityType === 'research' ? 'research' : 'features';
    return path.join(path.resolve(repoPath), '.aigon', 'state', 'entity-context', plural, `${String(entityId).padStart(2, '0')}.json`);
}

function readEntityContext(repoPath, entityType, entityId) {
    const durable = readJsonSafe(entityContextPath(repoPath, entityType, entityId), null);
    const operational = readJsonSafe(operationalEntityContextPath(repoPath, entityType, entityId), null);
    if (!durable && !operational) return null;
    return {
        schemaVersion: HANDOFF_VERSION,
        entityType,
        entityId: String(entityId).padStart(2, '0'),
        originSession: operational && operational.originSession || null,
        authorHandoff: durable && durable.authorHandoff || null,
        continuityDecisions: operational && operational.continuityDecisions || [],
        updatedAt: [durable && durable.updatedAt, operational && operational.updatedAt].filter(Boolean).sort().pop() || null,
    };
}

function resolveCreationAuthor(options = {}, env = process.env, detectActiveAgentSession = () => ({ detected: false })) {
    const explicit = String(options.agent || '').trim();
    if (explicit) return explicit;
    const fromEnv = String(env.AIGON_AGENT_ID || '').trim();
    if (fromEnv && agentRegistry.getAgent(fromEnv)) return fromEnv;
    let detected = null;
    try { detected = detectActiveAgentSession(); } catch (_) { /* authorless fallback */ }
    const detectedId = detected && detected.detected ? String(detected.agentId || '').trim() : '';
    return detectedId && agentRegistry.getAgent(detectedId) ? detectedId : null;
}

/**
 * Resolve a provider-native session ID from a direct agent conversation only
 * when that agent declares an environment variable which it owns. This is not
 * a transcript-directory scan: a "newest file" heuristic cannot attribute one
 * of several concurrent conversations to this create.
 */
function resolveDirectNativeSession(agentId, env = process.env) {
    if (!agentId) return null;
    const runtime = agentRegistry.getAgentRuntime(agentId) || {};
    const envName = runtime.directSessionIdEnv;
    if (!envName || !/^[A-Z][A-Z0-9_]*$/.test(envName)) return null;
    const sessionId = String(env[envName] || '').trim();
    if (!sessionId) return null;
    return {
        sessionId,
        provenance: 'runtime-env',
        capturedAt: new Date().toISOString(),
    };
}

function establishOriginSession(repoPath, entityType, entityId, options = {}) {
    const now = options.capturedAt || new Date().toISOString();
    const authorAgentId = options.authorAgentId || null;
    const agent = authorAgentId ? agentRegistry.getAgent(authorAgentId) : null;
    const source = options.aigonLaunched ? 'aigon-launched' : 'direct-agent-session';
    const directNativeSession = source === 'direct-agent-session' ? options.directNativeSession : null;
    const hasDirectNativeSession = Boolean(directNativeSession && directNativeSession.sessionId);
    const originSession = {
        aigonSessionId: `spec-draft-${entityType}-${String(entityId).padStart(2, '0')}`,
        role: 'spec-draft',
        source,
        authorAgentId,
        provider: agent ? (agent.providerFamily || null) : null,
        captureStartedAt: now,
        captureState: hasDirectNativeSession ? 'captured' : (source === 'aigon-launched' ? 'pending' : 'unavailable'),
        nativeProvenance: hasDirectNativeSession ? (directNativeSession.provenance || 'runtime-env') : (source === 'aigon-launched' ? 'pending' : 'unavailable'),
        providerSessionId: hasDirectNativeSession ? String(directNativeSession.sessionId) : null,
        capturedAt: hasDirectNativeSession ? (directNativeSession.capturedAt || now) : null,
        createdAt: now,
        addressable: false,
    };
    const operationalPath = operationalEntityContextPath(repoPath, entityType, entityId);
    const previous = readJsonSafe(operationalPath, {}) || {};
    const value = {
        schemaVersion: HANDOFF_VERSION,
        entityType,
        entityId: String(entityId).padStart(2, '0'),
        originSession,
        continuityDecisions: previous.continuityDecisions || [],
        updatedAt: now,
    };
    writeJsonAtomic(operationalPath, value);
    return value.originSession;
}

function bindOriginNativeSession(repoPath, entityType, entityId, found) {
    const operationalPath = operationalEntityContextPath(repoPath, entityType, entityId);
    const current = readJsonSafe(operationalPath, null);
    if (!current || !current.originSession) return null;
    const now = new Date().toISOString();
    current.originSession = {
        ...current.originSession,
        captureState: found && found.sessionId ? 'captured' : 'unavailable',
        nativeProvenance: found && found.sessionId ? 'attributed' : 'unavailable',
        providerSessionId: found && found.sessionId ? String(found.sessionId) : null,
        capturedAt: now,
    };
    current.updatedAt = now;
    writeJsonAtomic(operationalPath, current);
    return current.originSession;
}

function validateHandoff(input) {
    const issues = [];
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { valid: false, issues: ['input must be a JSON object'] };
    }
    for (const field of HANDOFF_FIELDS) {
        if (!Array.isArray(input[field])) issues.push(`${field} must be an array`);
        else if (input[field].some(value => typeof value !== 'string' || !value.trim())) {
            issues.push(`${field} entries must be non-empty strings`);
        }
        else if (input[field].some(value => value.length > 1000)) {
            issues.push(`${field} entries must be concise (1000 characters or fewer)`);
        }
        else if (input[field].some(value => /(?:\/Users\/[^/]+\/(?:\.claude|\.codex)|\.jsonl\b|transcript(?:Path)?\s*[:=])/i.test(value))) {
            issues.push(`${field} must not contain provider-local transcript paths`);
        }
    }
    if (Array.isArray(input.decisions) && input.decisions.length === 0) issues.push('decisions must include at least one durable decision');
    if (Array.isArray(input.specReferences) && input.specReferences.length === 0) issues.push('specReferences must include at least one current spec section');
    return { valid: issues.length === 0, issues };
}

function recordAuthorHandoff(repoPath, entityType, entityId, input, options = {}) {
    const validation = validateHandoff(input);
    if (!validation.valid) {
        const error = new Error(`Author handoff is incomplete; repair: ${validation.issues.join('; ')}`);
        error.code = 'INVALID_AUTHOR_HANDOFF';
        error.issues = validation.issues;
        throw error;
    }
    const durablePath = entityContextPath(repoPath, entityType, entityId);
    const current = readJsonSafe(durablePath, null) || {
        schemaVersion: HANDOFF_VERSION,
        entityType,
        entityId: String(entityId).padStart(2, '0'),
    };
    const now = options.recordedAt || new Date().toISOString();
    const priorVersion = current.authorHandoff && Number(current.authorHandoff.artifactVersion) || 0;
    current.authorHandoff = {
        schemaVersion: HANDOFF_VERSION,
        artifactVersion: priorVersion + 1,
        status: 'valid',
        recordedAt: now,
        recordedBy: options.recordedBy || process.env.AIGON_AGENT_ID || null,
        ...Object.fromEntries(HANDOFF_FIELDS.map(field => [field, input[field].map(value => value.trim())])),
    };
    current.updatedAt = now;
    writeJsonAtomic(durablePath, current);
    return current.authorHandoff;
}

function recordContinuityDecision(repoPath, entityType, entityId, decision) {
    const operationalPath = operationalEntityContextPath(repoPath, entityType, entityId);
    const current = readJsonSafe(operationalPath, null) || {
        schemaVersion: HANDOFF_VERSION,
        entityType,
        entityId: String(entityId).padStart(2, '0'),
        originSession: null,
        continuityDecisions: [],
    };
    const entry = { ...decision, decidedAt: decision.decidedAt || new Date().toISOString() };
    current.continuityDecisions = [...(current.continuityDecisions || []), entry].slice(-20);
    current.updatedAt = entry.decidedAt;
    writeJsonAtomic(operationalPath, current);
    return entry;
}

function recordContinuityCheckpoint(repoPath, entityType, entityId, checkpoint) {
    const operationalPath = operationalEntityContextPath(repoPath, entityType, entityId);
    const current = readJsonSafe(operationalPath, null) || {
        schemaVersion: HANDOFF_VERSION,
        entityType,
        entityId: String(entityId).padStart(2, '0'),
        originSession: null,
        continuityDecisions: [],
    };
    const now = checkpoint.at || new Date().toISOString();
    const decisions = current.continuityDecisions || [];
    const index = decisions.findIndex(item => item.currentSessionId === checkpoint.aigonSessionId);
    if (index >= 0) {
        decisions[index] = { ...decisions[index], checkpoint: { ...checkpoint, at: now } };
    }
    if (checkpoint.state === 'fallback'
        && !decisions.some(item => item.recoveryOfSessionId === checkpoint.aigonSessionId)) {
        decisions.push({
            strategy: 'fresh-with-handoff',
            confidence: 'high',
            reasons: ['checkpoint-fallback', checkpoint.reason],
            selectedAgent: checkpoint.agentId || null,
            parentOriginSessionId: current.originSession && current.originSession.aigonSessionId || null,
            recoveryOfSessionId: checkpoint.aigonSessionId,
            fallbackAttempt: 1,
            decidedAt: now,
        });
    }
    current.continuityDecisions = decisions.slice(-20);
    current.updatedAt = now;
    writeJsonAtomic(operationalPath, current);
    return current.continuityDecisions[current.continuityDecisions.length - 1] || null;
}

function recordFallbackLaunchOutcome(repoPath, entityType, entityId, recoveryOfSessionId, outcome) {
    const operationalPath = operationalEntityContextPath(repoPath, entityType, entityId);
    const current = readJsonSafe(operationalPath, null);
    if (!current) return null;
    const decisions = current.continuityDecisions || [];
    const index = decisions.findIndex(item => item.recoveryOfSessionId === recoveryOfSessionId);
    if (index < 0) return null;
    decisions[index] = {
        ...decisions[index],
        fallbackLaunch: {
            state: outcome.state,
            sessionId: outcome.sessionId || null,
            error: outcome.error || null,
            at: outcome.at || new Date().toISOString(),
        },
    };
    current.continuityDecisions = decisions;
    current.updatedAt = decisions[index].fallbackLaunch.at;
    writeJsonAtomic(operationalPath, current);
    return decisions[index];
}

function publicEntityContext(value) {
    if (!value) return { originSession: null, authorHandoff: null, latestContinuityDecision: null };
    const origin = value.originSession;
    return {
        originSession: origin ? {
            aigonSessionId: origin.aigonSessionId || null,
            role: origin.role || 'spec-draft',
            source: origin.source || null,
            authorAgentId: origin.authorAgentId || null,
            provider: origin.provider || null,
            captureState: origin.captureState || 'unavailable',
            nativeProvenance: origin.nativeProvenance || 'unavailable',
            hasNativeSession: Boolean(origin.providerSessionId),
            createdAt: origin.createdAt || null,
        } : null,
        authorHandoff: value.authorHandoff || null,
        latestContinuityDecision: Array.isArray(value.continuityDecisions) && value.continuityDecisions.length
            ? value.continuityDecisions[value.continuityDecisions.length - 1]
            : null,
    };
}

function readPublicEntityContext(repoPath, entityType, entityId) {
    return publicEntityContext(readEntityContext(repoPath, entityType, entityId));
}

module.exports = {
    HANDOFF_VERSION,
    HANDOFF_FIELDS,
    entityContextPath,
    operationalEntityContextPath,
    readEntityContext,
    readPublicEntityContext,
    publicEntityContext,
    resolveCreationAuthor,
    resolveDirectNativeSession,
    establishOriginSession,
    bindOriginNativeSession,
    validateHandoff,
    recordAuthorHandoff,
    recordContinuityDecision,
    recordContinuityCheckpoint,
    recordFallbackLaunchOutcome,
};
