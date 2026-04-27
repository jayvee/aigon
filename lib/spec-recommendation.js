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
const statsAggregate = require('./stats-aggregate');

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

/**
 * Rank all eligible agents for a given operation and complexity level.
 *
 * Score = qualitative score (1–5 from cli.modelOptions[].score[op])
 *         − normalised cost penalty (avgCostPerSession / maxAvgCostPerSession).
 *
 * Sparse cells (zero benchmark sessions) fall back to the qualitative score
 * alone with confidence 'low'. Cells with no qualitative score either return
 * score: null or rely solely on cost ordering.
 *
 * @param {string} op          - Operation key: research | spec | spec_review | implement | review
 * @param {string} complexity  - Complexity: low | medium | high | very-high
 * @param {object} [opts]
 * @param {boolean} [opts.excludeOverBudget=false]    - No-op until feature-agent-cost-awareness ships
 * @param {boolean} [opts.excludeQuarantined=true]
 * @param {string}  [opts.repoPath]                   - Repo root for stats; defaults to cwd
 * @returns {{ agentId, model, effort, score, rationale, confidence }[]}
 */
function rankAgentsForOperation(op, complexity, opts = {}) {
    const { excludeOverBudget: _unused = false, excludeQuarantined = true, repoPath } = opts;
    void _unused; // no-op until feature-agent-cost-awareness ships

    let perTriplet = {};
    try {
        const agg = statsAggregate.collectAggregateStats(repoPath || process.cwd());
        perTriplet = agg.perTriplet || {};
    } catch (_) {}

    const candidates = [];

    for (const agent of agentRegistry.getAllAgents()) {
        const agentDefaults = agent.cli?.complexityDefaults;
        const complexityBucket = (complexity && agentDefaults) ? agentDefaults[complexity] : null;
        const model = complexityBucket?.model ?? null;
        const effort = complexityBucket?.effort ?? null;

        const options = agent.cli?.modelOptions || [];
        const opt = options.find(o => o.value === model) ?? null;
        if (!opt) continue;

        if (excludeQuarantined && agentRegistry.isModelOptionQuarantined(opt)) continue;

        const qualScore = (opt.score && opt.score[op] != null) ? opt.score[op] : null;

        const tripletKey = `${agent.id}|${model || ''}|${effort || ''}`;
        const tripletBucket = perTriplet[tripletKey] ?? null;
        const sessions = tripletBucket ? (tripletBucket.sessions || 0) : 0;
        const totalCost = tripletBucket ? (tripletBucket.cost || 0) : 0;
        const totalRuns = tripletBucket
            ? ((tripletBucket.features || 0) + (tripletBucket.research || 0))
            : 0;

        candidates.push({ agentId: agent.id, model, effort, qualScore, sessions, totalCost, totalRuns });
    }

    // Normalise cost: find max avgCostPerSession among cells with benchmark data
    const costsWithData = candidates.filter(c => c.sessions > 0).map(c => c.totalCost / c.sessions);
    const maxAvgCost = costsWithData.length > 0 ? Math.max(...costsWithData) : 0;

    const results = candidates.map(c => {
        const hasBenchmarkData = c.sessions > 0;
        const avgCost = hasBenchmarkData ? c.totalCost / c.sessions : 0;
        const normalizedPenalty = maxAvgCost > 0 ? avgCost / maxAvgCost : 0;

        let score, confidence, rationale;

        if (!hasBenchmarkData) {
            score = c.qualScore;
            confidence = 'low';
            rationale = 'no benchmark data — qualitative only';
        } else {
            // Penalty is in [0, 1]; deducts at most 1 point from the 1–5 scale
            score = c.qualScore != null ? _round2(c.qualScore - normalizedPenalty) : null;
            confidence = c.totalRuns >= 3 ? 'high' : 'medium';
            rationale = c.qualScore != null
                ? `qual ${c.qualScore} − cost-penalty ${normalizedPenalty.toFixed(2)} (${c.sessions} sessions)`
                : `cost-only ordering (${c.sessions} sessions; no qualitative score yet)`;
        }

        return {
            agentId: c.agentId, model: c.model, effort: c.effort,
            score, rationale, confidence,
            qualScore: c.qualScore,
            avgCostPerSession: hasBenchmarkData ? _round2(c.totalCost / c.sessions) : null,
        };
    });

    // Non-null scores first (descending); null scores preserve insertion order
    results.sort((a, b) => {
        if (a.score != null && b.score != null) return b.score - a.score;
        if (a.score != null) return -1;
        if (b.score != null) return 1;
        return 0;
    });

    return results;
}

function _round2(n) {
    return Math.round(n * 100) / 100;
}

/**
 * Add badge labels to a ranked list from rankAgentsForOperation.
 * Badges: 'best_value' (top combined score), 'highest_quality' (best qualScore),
 *         'fastest' (lowest avgCostPerSession, benchmark data required).
 * Each result gains a `badges` array. Ties: first occurrence wins per badge.
 * @param {object[]} ranked - output of rankAgentsForOperation
 * @returns {object[]} same array with `badges` field added (mutated in place)
 */
function applyRankBadges(ranked) {
    if (!ranked || ranked.length === 0) return ranked;

    // best_value: highest non-null score (ranked list is already sorted)
    const bestValueEntry = ranked.find(r => r.score != null);

    // highest_quality: highest qualScore
    let bestQual = null;
    let bestQualEntry = null;
    for (const r of ranked) {
        if (r.qualScore != null && (bestQual === null || r.qualScore > bestQual)) {
            bestQual = r.qualScore;
            bestQualEntry = r;
        }
    }

    // fastest: lowest avgCostPerSession (only when benchmark data exists)
    let lowestCost = null;
    let fastestEntry = null;
    for (const r of ranked) {
        if (r.avgCostPerSession != null && (lowestCost === null || r.avgCostPerSession < lowestCost)) {
            lowestCost = r.avgCostPerSession;
            fastestEntry = r;
        }
    }

    for (const r of ranked) {
        const badges = [];
        if (bestValueEntry && r.agentId === bestValueEntry.agentId) badges.push('best_value');
        if (bestQualEntry && r.agentId === bestQualEntry.agentId) badges.push('highest_quality');
        if (fastestEntry && r.agentId === fastestEntry.agentId) badges.push('fastest');
        r.badges = badges;
    }

    return ranked;
}

module.exports = {
    ALLOWED_COMPLEXITY,
    readSpecRecommendation,
    parseSpecRecommendation,
    resolveAgentRecommendation,
    buildRecommendationPayload,
    rankAgentsForOperation,
    applyRankBadges,
};
