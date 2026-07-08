'use strict';

const fs = require('fs');
const agentRegistry = require('../agent-registry');
const agentStatus = require('../agent-status');
const specRecommendationLib = require('../spec-recommendation');
const { parseFrontMatter } = require('../cli-parse');
const {
    resolveSpecAuthor,
    resolveAuthorAgentId,
    normalizeLastSpecRevision,
    emptyLastSpecRevision,
} = require('../spec-author-provenance');
const { safeTmuxSessionExists } = require('../dashboard-status-helpers');
const { DRIVE_BRANCH_LIVE_STATUSES } = require('./constants');

function resolveDriveBranchToolAgentId(featureId, absRepoPath) {
    const agentIds = agentRegistry.getAllAgentIds().filter(id => id !== 'solo');
    for (const id of agentIds) {
        const record = agentStatus.readAgentStatus(featureId, id, 'feature', { mainRepoPath: absRepoPath });
        if (record && DRIVE_BRANCH_LIVE_STATUSES.has(record.status)) return id;
    }
    for (const id of agentIds) {
        const session = safeTmuxSessionExists(featureId, id, { repoPath: absRepoPath });
        if (session && session.running) return id;
    }
    return null;
}

// Feature 313: cheap read of `complexity:` from spec frontmatter for badge
// rendering. Returns null when the spec is missing or has no complexity.
function readComplexityFromSpec(specPath) {
    if (!specPath) return null;
    try {
        const rec = specRecommendationLib.readSpecRecommendation(specPath);
        return rec && rec.complexity ? rec.complexity : null;
    } catch (_) {
        return null;
    }
}

function readFrontmatterAgent(specPath) {
    if (!specPath || !fs.existsSync(specPath)) return null;
    try {
        const { parseFrontMatter } = require('../cli-parse');
        const content = fs.readFileSync(specPath, 'utf8');
        const { data } = parseFrontMatter(content);
        return data && data.agent != null ? String(data.agent).trim() || null : null;
    } catch (_) {
        return null;
    }
}

function buildProvenanceFields(snapshot, specPath) {
    const fmAgent = readFrontmatterAgent(specPath);
    const specAuthor = resolveSpecAuthor(snapshot, fmAgent);
    const agentKeys = snapshot && snapshot.agents ? Object.keys(snapshot.agents) : [];
    const authorAgentId = resolveAuthorAgentId(snapshot, specAuthor, agentKeys);
    const lastSpecRevision = snapshot && snapshot.lastSpecRevision
        ? normalizeLastSpecRevision(snapshot.lastSpecRevision)
        : emptyLastSpecRevision();
    return { specAuthor, authorAgentId, lastSpecRevision };
}

module.exports = {
    resolveDriveBranchToolAgentId,
    readComplexityFromSpec,
    readFrontmatterAgent,
    buildProvenanceFields,
};
