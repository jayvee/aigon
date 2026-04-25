'use strict';

/**
 * Shared validation + argv construction for feature-autonomous-start payloads.
 * Keeps dashboard POST /api/features/:id/run aligned with scheduled kickoffs (F367).
 */

const STOP_AFTER = ['implement', 'eval', 'review', 'close'];
const AGENT_PATTERN = /^[a-z]{2,4}$/;

/**
 * @param {object} payload
 * @param {string} payload.featureId
 * @param {string[]} payload.agents
 * @param {string} [payload.stopAfter]
 * @param {string} [payload.evalAgent]
 * @param {string} [payload.reviewAgent]
 * @param {string} [payload.models]
 * @param {string} [payload.efforts]
 * @param {string} [payload.reviewModel]
 * @param {string} [payload.reviewEffort]
 * @param {string} [payload.workflow]
 * @param {{ getAllAgentIds: () => string[] }} registry
 * @returns {{ ok: true, normalized: object } | { ok: false, error: string }}
 */
function validateFeatureAutonomousPayload(payload, registry) {
    const featureId = String(payload.featureId || '').trim();
    const agents = Array.isArray(payload.agents) ? payload.agents.map(v => String(v || '').trim()).filter(Boolean) : [];
    const stopAfter = String(payload.stopAfter || 'close').trim();
    const evalAgent = String(payload.evalAgent || '').trim();
    const reviewAgent = String(payload.reviewAgent || '').trim();
    const modelsCsv = typeof payload.models === 'string' ? payload.models.trim() : '';
    const effortsCsv = typeof payload.efforts === 'string' ? payload.efforts.trim() : '';
    const reviewModel = typeof payload.reviewModel === 'string' ? payload.reviewModel.trim() : '';
    const reviewEffort = typeof payload.reviewEffort === 'string' ? payload.reviewEffort.trim() : '';
    const workflowSlug = typeof payload.workflow === 'string' ? payload.workflow.trim() : '';

    if (!featureId || !/^\d+$/.test(featureId)) {
        return { ok: false, error: 'Feature id must be numeric' };
    }
    if (agents.length === 0) {
        return { ok: false, error: 'At least one implementation agent is required' };
    }
    if (!STOP_AFTER.includes(stopAfter)) {
        return { ok: false, error: 'stopAfter must be one of: implement, eval, review, close' };
    }
    const invalidAgents = agents.filter(a => !AGENT_PATTERN.test(a));
    if (invalidAgents.length > 0) {
        return { ok: false, error: `Invalid agent identifier(s): ${invalidAgents.join(', ')}` };
    }
    if (evalAgent && !AGENT_PATTERN.test(evalAgent)) {
        return { ok: false, error: `Invalid eval agent identifier: ${evalAgent}` };
    }
    if (reviewAgent && !AGENT_PATTERN.test(reviewAgent)) {
        return { ok: false, error: `Invalid review agent identifier: ${reviewAgent}` };
    }
    const availableAgents = new Set(registry.getAllAgentIds());
    const unknownAgents = agents.filter(a => !availableAgents.has(a));
    if (unknownAgents.length > 0) {
        return { ok: false, error: `Unknown agent(s): ${unknownAgents.join(', ')}` };
    }
    if (evalAgent && !availableAgents.has(evalAgent)) {
        return { ok: false, error: `Unknown eval agent: ${evalAgent}` };
    }
    if (reviewAgent && !availableAgents.has(reviewAgent)) {
        return { ok: false, error: `Unknown review agent: ${reviewAgent}` };
    }

    const isFleet = agents.length > 1;
    if (isFleet && stopAfter === 'review') {
        return { ok: false, error: '--stop-after=review is only supported in solo mode' };
    }
    if (!isFleet && stopAfter === 'review' && !reviewAgent) {
        return { ok: false, error: '--stop-after=review requires --review-agent to be set' };
    }

    const mergedModels = [modelsCsv, reviewAgent && reviewModel ? `${reviewAgent}:${reviewModel}` : ''].filter(Boolean).join(',');
    const mergedEfforts = [effortsCsv, reviewAgent && reviewEffort ? `${reviewAgent}:${reviewEffort}` : ''].filter(Boolean).join(',');

    return {
        ok: true,
        normalized: {
            featureId,
            agents,
            stopAfter,
            evalAgent: evalAgent || null,
            reviewAgent: reviewAgent || null,
            modelsCsv: mergedModels,
            effortsCsv: mergedEfforts,
            workflowSlug: workflowSlug || null,
            isFleet,
        },
    };
}

/**
 * CLI argv tail after aigon-cli.js (i.e. ['feature-autonomous-start', featureId, ...]).
 * @param {object} n — output of validateFeatureAutonomousPayload.normalized
 * @returns {string[]}
 */
function buildFeatureAutonomousCliArgv(n) {
    const args = ['feature-autonomous-start', n.featureId, ...n.agents];
    if (n.evalAgent) args.push(`--eval-agent=${n.evalAgent}`);
    if (n.reviewAgent) args.push(`--review-agent=${n.reviewAgent}`);
    args.push(`--stop-after=${n.stopAfter}`);
    if (n.modelsCsv) args.push(`--models=${n.modelsCsv}`);
    if (n.effortsCsv) args.push(`--efforts=${n.effortsCsv}`);
    if (n.workflowSlug) args.push(`--workflow=${n.workflowSlug}`);
    return args;
}

module.exports = {
    validateFeatureAutonomousPayload,
    buildFeatureAutonomousCliArgv,
    STOP_AFTER,
    AGENT_PATTERN,
};
