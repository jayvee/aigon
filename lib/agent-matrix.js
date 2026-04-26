'use strict';

/**
 * Agent capability matrix — read-only join collector (F370).
 *
 * Joins:
 *   1. agent-registry  → modelOptions with pricing/notes/score/lastRefreshAt
 *   2. stats-aggregate → perTriplet usage counters (features, cost, tokens)
 *
 * Returns a flat array of MatrixRow, one per concrete (agent, modelValue) pair
 * across all registered agents. Null-value "Default" options are included so
 * the UI can show an agent row even when no concrete model is set.
 *
 * The five operations are: spec, spec_review, implement, review, research.
 */

const agentRegistry = require('./agent-registry');
const statsAggregate = require('./stats-aggregate');

const OPERATIONS = ['spec', 'spec_review', 'implement', 'review', 'research'];

const OPERATION_LABELS = {
    spec:         'Spec',
    spec_review:  'Spec Review',
    implement:    'Implement',
    review:       'Review',
    research:     'Research',
};

/**
 * Build the full matrix for a given repo.
 *
 * @param {string} [repoPath] - Repo root; defaults to cwd.
 * @returns {MatrixRow[]}
 *
 * MatrixRow shape:
 *   agentId          string
 *   agentDisplayName string
 *   modelValue       string | null
 *   modelLabel       string
 *   pricing          { inputPerM: number, outputPerM: number } | null
 *   notes            { spec?, spec_review?, implement?, review?, research? }
 *   score            { spec?: number|null, spec_review?: number|null,
 *                      implement?: number|null, review?: number|null,
 *                      research?: number|null }
 *   lastRefreshAt    string | null
 *   quarantined      object | null
 *   stats            { features, research, cost, sessions,
 *                      inputTokens, outputTokens } | null
 */
function buildMatrix(repoPath) {
    const root = repoPath || process.cwd();

    // Collect perTriplet stats (best-effort; non-fatal on missing cache)
    let perTriplet = {};
    try {
        const agg = statsAggregate.collectAggregateStats(root);
        perTriplet = agg.perTriplet || {};
    } catch (_) { /* no stats available */ }

    const rows = [];

    for (const agent of agentRegistry.getAllAgents()) {
        const options = agent.cli?.modelOptions;
        if (!Array.isArray(options) || options.length === 0) continue;

        for (const opt of options) {
            // Find best-matching triplet key for this (agent, model) pair.
            // perTriplet keys are: "${agentId}|${model}|${effort}"
            const modelVal = opt.value || '';
            let stats = null;
            for (const [key, bucket] of Object.entries(perTriplet)) {
                const [a, m] = key.split('|');
                if (a === agent.id && m === modelVal) {
                    stats = {
                        features: bucket.features || 0,
                        research: bucket.research || 0,
                        cost: bucket.cost || 0,
                        sessions: bucket.sessions || 0,
                        inputTokens: bucket.inputTokens || 0,
                        outputTokens: bucket.outputTokens || 0,
                    };
                    break;
                }
            }

            rows.push({
                agentId: agent.id,
                agentDisplayName: agent.displayName || agent.name,
                modelValue: opt.value,
                modelLabel: opt.label || opt.value || 'Default',
                pricing: opt.pricing
                    ? { inputPerM: opt.pricing.input, outputPerM: opt.pricing.output }
                    : null,
                notes: opt.notes || {},
                score: opt.score || {},
                lastRefreshAt: opt.lastRefreshAt || null,
                quarantined: opt.quarantined || null,
                stats,
            });
        }
    }

    return rows;
}

/**
 * Return matrix rows grouped by agentId.
 */
function buildMatrixByAgent(repoPath) {
    const rows = buildMatrix(repoPath);
    const groups = {};
    for (const row of rows) {
        if (!groups[row.agentId]) groups[row.agentId] = [];
        groups[row.agentId].push(row);
    }
    return groups;
}

module.exports = {
    OPERATIONS,
    OPERATION_LABELS,
    buildMatrix,
    buildMatrixByAgent,
};
