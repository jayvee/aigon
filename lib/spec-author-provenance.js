'use strict';

/**
 * Spec author provenance — original authorship metadata for feature/research specs.
 * Distinct from revision provenance (`lastSpecRevision`) and implementation agents.
 */

function emptySpecAuthor() {
    return { agentId: null, model: null, effort: null, authoredAt: null };
}

function emptyLastSpecRevision() {
    return { agentId: null, model: null, effort: null, revisedAt: null, commitSha: null };
}

function normalizeSpecAuthor(raw) {
    if (!raw || typeof raw !== 'object') return emptySpecAuthor();
    const agentId = raw.agentId != null ? String(raw.agentId).trim() || null : null;
    const model = raw.model != null ? String(raw.model).trim() || null : null;
    const effort = raw.effort != null ? String(raw.effort).trim() || null : null;
    const authoredAt = raw.authoredAt != null ? String(raw.authoredAt) : null;
    return { agentId, model, effort, authoredAt };
}

function normalizeLastSpecRevision(raw) {
    if (!raw || typeof raw !== 'object') return emptyLastSpecRevision();
    return {
        agentId: raw.agentId != null ? String(raw.agentId).trim() || null : null,
        model: raw.model != null ? String(raw.model).trim() || null : null,
        effort: raw.effort != null ? String(raw.effort).trim() || null : null,
        revisedAt: raw.revisedAt != null ? String(raw.revisedAt) : null,
        commitSha: raw.commitSha != null ? String(raw.commitSha).trim() || null : null,
    };
}

/**
 * Build a specAuthor object for persistence on bootstrap/start events.
 * Explicit nulls for unknown model/effort — never infer from config defaults.
 */
function buildSpecAuthor({ agentId = null, model = null, effort = null, authoredAt = null } = {}) {
    return normalizeSpecAuthor({
        agentId,
        model: model != null ? model : null,
        effort: effort != null ? effort : null,
        authoredAt: authoredAt || (agentId ? new Date().toISOString() : null),
    });
}

function buildLastSpecRevision({ agentId = null, model = null, effort = null, revisedAt = null, commitSha = null } = {}) {
    return normalizeLastSpecRevision({
        agentId,
        model,
        effort,
        revisedAt: revisedAt || (agentId ? new Date().toISOString() : null),
        commitSha,
    });
}

/**
 * Resolve the effective spec author from snapshot + optional spec frontmatter `agent:`.
 * Read-side only — does not mutate snapshots.
 */
function resolveSpecAuthor(snapshot, specFrontmatterAgent = null) {
    if (snapshot && snapshot.specAuthor && snapshot.specAuthor.agentId) {
        return normalizeSpecAuthor(snapshot.specAuthor);
    }
    const legacyAgent = snapshot && snapshot.authorAgentId
        ? String(snapshot.authorAgentId).trim() || null
        : null;
    const fmAgent = specFrontmatterAgent != null
        ? String(specFrontmatterAgent).trim() || null
        : null;
    const agentId = legacyAgent || fmAgent || null;
    if (!agentId) return emptySpecAuthor();
    const authoredAt = snapshot && (snapshot.createdAt || snapshot.updatedAt)
        ? (snapshot.createdAt || snapshot.updatedAt)
        : null;
    return normalizeSpecAuthor({ agentId, model: null, effort: null, authoredAt });
}

/**
 * Compatibility alias: same fallback chain as dashboard-status-collector before F584.
 */
function resolveAuthorAgentId(snapshot, specAuthor, agentIds = []) {
    if (specAuthor && specAuthor.agentId) return specAuthor.agentId;
    if (snapshot && snapshot.authorAgentId) return String(snapshot.authorAgentId).trim() || null;
    if (agentIds.length > 0) return agentIds[0];
    if (snapshot && snapshot.agents) {
        const keys = Object.keys(snapshot.agents);
        if (keys.length > 0) return keys[0];
    }
    return null;
}

function formatSpecAuthorLabel(specAuthor, displayNames = {}) {
    const normalized = normalizeSpecAuthor(specAuthor);
    if (!normalized.agentId) return null;
    const name = displayNames[normalized.agentId] || normalized.agentId;
    if (normalized.model) {
        const effortSuffix = normalized.effort ? `/${normalized.effort}` : '';
        return `Spec by ${name} · ${normalized.model}${effortSuffix}`;
    }
    return `Spec by ${name}`;
}

function mergeSpecAuthorFromEvent(priorContext, event) {
    const prior = priorContext && priorContext.specAuthor
        ? normalizeSpecAuthor(priorContext.specAuthor)
        : emptySpecAuthor();
    let fromEvent = emptySpecAuthor();
    if (event.specAuthor) {
        fromEvent = normalizeSpecAuthor(event.specAuthor);
    } else if (event.authorAgentId != null) {
        fromEvent = buildSpecAuthor({
            agentId: event.authorAgentId,
            model: event.specAuthorModel != null ? event.specAuthorModel : null,
            effort: event.specAuthorEffort != null ? event.specAuthorEffort : null,
            authoredAt: event.at || null,
        });
    }
    const specAuthor = prior.agentId ? prior : (fromEvent.agentId ? fromEvent : prior);
    let authorAgentId = specAuthor.agentId;
    if (!authorAgentId && event.authorAgentId != null) {
        authorAgentId = String(event.authorAgentId).trim() || null;
    }
    if (!authorAgentId && priorContext && priorContext.authorAgentId) {
        authorAgentId = priorContext.authorAgentId;
    }
    return { specAuthor, authorAgentId: authorAgentId || null };
}

module.exports = {
    emptySpecAuthor,
    emptyLastSpecRevision,
    normalizeSpecAuthor,
    normalizeLastSpecRevision,
    buildSpecAuthor,
    buildLastSpecRevision,
    resolveSpecAuthor,
    resolveAuthorAgentId,
    formatSpecAuthorLabel,
    mergeSpecAuthorFromEvent,
};
