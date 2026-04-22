'use strict';

/**
 * Feature 313: spec frontmatter → per-agent {model, effort} recommendation.
 *
 * Frontmatter shape:
 *   complexity: low | medium | high | very-high
 *   recommended_models:
 *     <agentId>: { model: <string|null>, effort: <string|null> }
 *
 * Fallback chain when a field is absent:
 *   1. spec frontmatter recommended_models[agent][field]
 *   2. agent.cli.complexityDefaults[complexity][field]
 *   3. null (caller falls back to aigon config)
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
    const raw = data.recommended_models;
    const recommendedModels = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [agentId, entry] of Object.entries(raw)) {
            if (entry && typeof entry === 'object') {
                recommendedModels[agentId] = {
                    model: entry.model == null ? null : String(entry.model),
                    effort: entry.effort == null ? null : String(entry.effort),
                };
            }
        }
    }
    if (!complexity && Object.keys(recommendedModels).length === 0) return null;
    return { complexity, recommendedModels };
}

/**
 * Resolve the final {model, effort} recommendation for an agent, applying
 * the fallback chain (spec → agent.cli.complexityDefaults → null).
 * Returns { model, effort, source } where source ∈
 * 'spec' | 'agent-default' | 'none' per field.
 */
function resolveAgentRecommendation(agentId, recommendation) {
    const spec = recommendation || {};
    const specEntry = (spec.recommendedModels && spec.recommendedModels[agentId]) || null;
    const agent = agentRegistry.getAgent(agentId);
    const agentDefaults = agent?.cli?.complexityDefaults;
    const complexityBucket = spec.complexity && agentDefaults ? agentDefaults[spec.complexity] : null;

    function pick(field) {
        if (specEntry && specEntry[field] != null) {
            return { value: specEntry[field], source: 'spec' };
        }
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
