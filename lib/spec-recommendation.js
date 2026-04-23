'use strict';

/**
 * Spec frontmatter → per-agent {model, effort} recommendation for start flows.
 *
 * Frontmatter shape (specs):
 *   complexity: low | medium | high | very-high
 *
 * Model and effort are NOT read from the spec — only the complexity label is.
 * At start time each agent's defaults come from:
 *   agent.cli.complexityDefaults[complexity] → null (caller uses aigon config)
 *
 * Rationale: model SKUs change over time; the spec stays a product/requirements
 * document, not a runtime manifest.
 */

const fs = require('fs');
const { parseFrontMatter } = require('./cli-parse');
const agentRegistry = require('./agent-registry');

const ALLOWED_COMPLEXITY = Object.freeze(['low', 'medium', 'high', 'very-high']);

function readSpecRecommendation(specPath) {
    if (!specPath) return null;
    let content;
    try {
        content = fs.readFileSync(specPath, 'utf8');
    } catch (_) {
        return null;
    }
    return parseSpecRecommendation(content);
}

function parseSpecRecommendation(content) {
    const { data, hasFrontMatter } = parseFrontMatter(content || '');
    if (!hasFrontMatter) return null;
    const complexity = ALLOWED_COMPLEXITY.includes(data.complexity) ? data.complexity : null;
    if (!complexity) return null;
    return { complexity };
}

/**
 * Resolve the final {model, effort} recommendation for an agent from
 * complexity only (agent template ladder → null for config).
 * Returns { model, effort, modelSource, effortSource } where source ∈
 * 'agent-default' | 'none' per field.
 */
function resolveAgentRecommendation(agentId, recommendation) {
    const spec = recommendation || {};
    const agent = agentRegistry.getAgent(agentId);
    const agentDefaults = agent?.cli?.complexityDefaults;
    const complexityBucket = spec.complexity && agentDefaults ? agentDefaults[spec.complexity] : null;

    function pick(field) {
        if (complexityBucket && complexityBucket[field] != null) {
            return { value: complexityBucket[field], source: 'agent-default' };
        }
        return { value: null, source: 'none' };
    }

    const modelPick = pick('model');
    const effortPick = pick('effort');
    return {
        model: modelPick.value,
        modelSource: modelPick.source,
        effort: effortPick.value,
        effortSource: effortPick.source,
    };
}

/**
 * Build a full recommendation payload for the dashboard: `{ complexity,
 * agents: { <id>: { model, effort, modelSource, effortSource } } }`.
 */
function buildRecommendationPayload(recommendation) {
    const complexity = recommendation?.complexity || null;
    const agents = {};
    for (const agent of agentRegistry.getAllAgents()) {
        agents[agent.id] = resolveAgentRecommendation(agent.id, recommendation || {});
    }
    return { complexity, agents };
}

module.exports = {
    ALLOWED_COMPLEXITY,
    readSpecRecommendation,
    parseSpecRecommendation,
    resolveAgentRecommendation,
    buildRecommendationPayload,
};
