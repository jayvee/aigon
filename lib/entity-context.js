'use strict';

const fs = require('fs');
const path = require('path');
const agentRegistry = require('./agent-registry');
const { readJsonSafe, writeJsonAtomic, ensureDir } = require('./io/json');

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

function readEntityContext(repoPath, entityType, entityId) {
    return readJsonSafe(entityContextPath(repoPath, entityType, entityId), null);
}

function writeEntityContext(repoPath, entityType, entityId, value) {
    writeJsonAtomic(entityContextPath(repoPath, entityType, entityId), value);
    return value;
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

function establishOriginSession(repoPath, entityType, entityId, options = {}) {
    const now = options.capturedAt || new Date().toISOString();
    const authorAgentId = options.authorAgentId || null;
    const agent = authorAgentId ? agentRegistry.getAgent(authorAgentId) : null;
    const source = options.aigonLaunched ? 'aigon-launched' : 'direct-agent-session';
    const originSession = {
        aigonSessionId: `spec-draft-${entityType}-${String(entityId).padStart(2, '0')}`,
        role: 'spec-draft',
        source,
        authorAgentId,
        provider: agent ? (agent.providerFamily || null) : null,
        captureStartedAt: now,
        captureState: source === 'aigon-launched' ? 'pending' : 'unavailable',
        nativeProvenance: source === 'aigon-launched' ? 'pending' : 'unavailable',
        providerSessionId: null,
        createdAt: now,
        addressable: false,
    };
    const previous = readEntityContext(repoPath, entityType, entityId) || {};
    return writeEntityContext(repoPath, entityType, entityId, {
        schemaVersion: HANDOFF_VERSION,
        entityType,
        entityId: String(entityId).padStart(2, '0'),
        originSession,
        authorHandoff: previous.authorHandoff || null,
        continuityDecisions: previous.continuityDecisions || [],
        updatedAt: now,
    }).originSession;
}

function bindOriginNativeSession(repoPath, entityType, entityId, found) {
    const current = readEntityContext(repoPath, entityType, entityId);
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
    writeEntityContext(repoPath, entityType, entityId, current);
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
    const current = readEntityContext(repoPath, entityType, entityId) || {
        schemaVersion: HANDOFF_VERSION,
        entityType,
        entityId: String(entityId).padStart(2, '0'),
        originSession: null,
        continuityDecisions: [],
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
    return writeEntityContext(repoPath, entityType, entityId, current).authorHandoff;
}

function recordContinuityDecision(repoPath, entityType, entityId, decision) {
    const current = readEntityContext(repoPath, entityType, entityId) || {
        schemaVersion: HANDOFF_VERSION,
        entityType,
        entityId: String(entityId).padStart(2, '0'),
        originSession: null,
        authorHandoff: null,
        continuityDecisions: [],
    };
    const entry = { ...decision, decidedAt: decision.decidedAt || new Date().toISOString() };
    current.continuityDecisions = [...(current.continuityDecisions || []), entry].slice(-20);
    current.updatedAt = entry.decidedAt;
    writeEntityContext(repoPath, entityType, entityId, current);
    return entry;
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
    readEntityContext,
    readPublicEntityContext,
    publicEntityContext,
    resolveCreationAuthor,
    establishOriginSession,
    bindOriginNativeSession,
    validateHandoff,
    recordAuthorHandoff,
    recordContinuityDecision,
};
